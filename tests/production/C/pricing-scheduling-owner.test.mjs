/**
 * Actual Catalog -> Pricing -> Scheduling production processes, each with its
 * own runtime PostgreSQL role. Identity is the only HTTP double. Currency,
 * prices, Catalog definitions and TTL here are test fixtures, never launch
 * policy. No Booking, Billing, browser or external-provider claim is made.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import pg from '../../../services/scheduling/node_modules/pg/lib/index.js';
import {
  ROOT,
  freePort,
  identityDouble,
  publishedContracts,
  readContext,
  startProcess,
  waitHttp,
} from './_support.mjs';

const { parseQuoteV1 } = publishedContracts().pricing;
const { parseHoldV1 } = publishedContracts().scheduling;
const { parseApiErrorEnvelope } = publishedContracts().errors;
const customer = { token: 'customer-capacity.payload.signature', subject: randomUUID() };
const guest = { token: 'guest-capacity.payload.signature', subject: customer.subject };
const other = { token: 'other-capacity.payload.signature', subject: randomUUID() };
const admin = { token: 'admin-capacity.payload.signature', subject: randomUUID() };
const definitionIds = { package: randomUUID(), extra: randomUUID() };
const definitions = [
  {
    definitionId: definitionIds.package,
    kind: 'PACKAGE',
    code: 'capacity-package',
    durationMinutes: 35,
  },
  { definitionId: definitionIds.extra, kind: 'EXTRA', code: 'capacity-extra', durationMinutes: 10 },
].map((definition, index) => ({
  ...definition,
  name: { ar: 'تعريف قبول', en: 'Acceptance definition' },
  description: { ar: 'بيانات اختبار غير إنتاجية', en: null },
  vehicleTypes: ['sedan'],
  status: 'PUBLISHED',
  sortOrder: index,
}));
const processes = [];
const origins = {};
let identity;
let db;
let oldQuote;
let newQuote;
let held;
let heldRequest;
let heldKey;
let pricingProcess;
const key = () => `quote-hold-${randomUUID()}`;
const money = (amountMinor) => ({ currency: 'SYP', amountMinor, scale: 2 });
const as = (who) => ({ authorization: `Bearer ${who.token}` });

async function call(owner, method, route, who, body, idempotencyKey) {
  const response = await fetch(`${origins[owner]}/internal/v1/${owner}${route}`, {
    method,
    headers: {
      ...as(who),
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: globalThis.AbortSignal.timeout(15_000),
  });
  return { status: response.status, body: await response.json() };
}

async function start(owner, databaseUrl, env) {
  const port = await freePort();
  const process = startProcess(path.join(ROOT, 'services', owner, 'dist/main.js'), {
    PORT: String(port),
    HOST: '127.0.0.1',
    DATABASE_URL: databaseUrl,
    IDENTITY_URL: identity.url,
    IDENTITY_SESSION_ORIGIN: identity.url,
    ...env,
  });
  processes.push(process);
  origins[owner] = `http://127.0.0.1:${port}`;
  await waitHttp(`${origins[owner]}/health/live`, (status) => status === 200);
  return process;
}

before(async () => {
  const context = await readContext();
  assert.ok(
    context.databases.catalog && context.databases.pricing && context.databases.scheduling,
    'catalog, pricing and scheduling runtime databases are required',
  );
  identity = await identityDouble({
    [admin.token]: {
      subject: admin.subject,
      principalKind: 'account',
      permissions: ['catalog.publish', 'pricing.prices.publish', 'operations.dispatch'],
    },
    [customer.token]: {
      subject: customer.subject,
      principalKind: 'account',
      permissions: ['bookings.create:self'],
    },
    [guest.token]: {
      subject: guest.subject,
      principalKind: 'guest',
      permissions: ['bookings.create:self'],
    },
    [other.token]: {
      subject: other.subject,
      principalKind: 'account',
      permissions: ['bookings.create:self'],
    },
  });
  db = new pg.Pool({
    connectionString: context.databases.scheduling.appUrl.replace('?schema=app', ''),
    max: 2,
  });
  await start('catalog', context.databases.catalog.appUrl, {});
  pricingProcess = await start('pricing', context.databases.pricing.appUrl, {
    CATALOG_ORIGIN: origins.catalog,
    PRICING_CURRENCY_POLICY: JSON.stringify({
      revision: 'acceptance-only-1',
      currency: 'SYP',
      minorUnitExponent: 2,
      maxAmountMinor: '100000000000',
    }),
    PRICING_QUOTE_TTL_SECONDS: '900',
  });
  await start('scheduling', context.databases.scheduling.appUrl, {
    PRICING_ORIGIN: origins.pricing,
    SCHEDULING_USER_REQUESTS_PER_MINUTE: '1000',
  });
});

after(async () => {
  for (const process of [...processes].reverse()) await process.kill();
  await db?.end();
  await identity?.close();
});

async function publish(catalogRevision, bookRevision, items) {
  const catalog = await call(
    'catalog',
    'POST',
    '/publications',
    admin,
    {
      expectedCatalogRevision: catalogRevision,
      definitions: items,
      reasonCode: 'ACCEPTANCE_ONLY',
    },
    key(),
  );
  assert.equal(catalog.status, 201, JSON.stringify(catalog.body));
  const pricing = await call(
    'pricing',
    'POST',
    '/price-books',
    admin,
    {
      expectedPriceBookRevision: bookRevision,
      currency: 'SYP',
      entries: items.map((definition) => ({
        definitionId: definition.definitionId,
        vehicleType: null,
        unitPrice: money('10000'),
      })),
    },
    key(),
  );
  assert.equal(pricing.status, 201, JSON.stringify(pricing.body));
}

async function quote(zoneId, who = customer, extraQuantity = 2) {
  const result = await call(
    'pricing',
    'POST',
    '/quotes',
    who,
    {
      beneficiary: { kind: who === guest ? 'guest' : 'account', subjectId: who.subject },
      vehicleType: 'sedan',
      zoneId,
      selections: [
        { definitionId: definitionIds.package, quantity: 1 },
        { definitionId: definitionIds.extra, quantity: extraQuantity },
      ],
    },
    key(),
  );
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return parseQuoteV1(result.body);
}

async function window(capacity = 2) {
  const startsAt = new Date(Date.now() + 3 * 3_600_000);
  startsAt.setUTCSeconds(0, 0);
  const request = {
    zoneId: randomUUID(),
    startsAt: startsAt.toISOString(),
    endsAt: new Date(startsAt.getTime() + 3 * 3_600_000).toISOString(),
    capacity,
  };
  const result = await call('scheduling', 'POST', '/windows', admin, request);
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return { ...request, windowId: result.body.windowId };
}

function request(w, q) {
  return {
    beneficiary: q.beneficiary,
    zoneId: w.zoneId,
    startsAt: w.startsAt,
    durationMinutes: q.durationMinutes,
    quoteRef: { quoteId: q.quoteId, revision: q.revision },
  };
}

async function facts(w) {
  const result = await db.query(
    `SELECT w.held, w.reserved,
      (SELECT count(*)::int FROM app.capacity_hold h WHERE h.window_id = w.id) AS holds,
      (SELECT count(*)::int FROM app.audit_entry a WHERE a.target_id IN (SELECT id FROM app.capacity_hold h WHERE h.window_id = w.id)) AS audits
     FROM app.capacity_window w WHERE w.id = $1`,
    [w.windowId],
  );
  return result.rows[0];
}

function refusal(result, status, reason) {
  assert.equal(result.status, status, JSON.stringify(result.body));
  assert.equal(parseApiErrorEnvelope(result.body).error.reason, reason);
}

test('real Catalog publication produces an exact quantity-weighted duration in the Pricing owner response', async () => {
  await publish(0, 1, definitions);
  oldQuote = await quote(null);
  assert.equal(oldQuote.durationMinutes, 55);
  assert.equal(oldQuote.total.amountMinor, '30000');
});

test('new Catalog and price-book publications cannot reinterpret an existing quote duration', async () => {
  await publish(
    1,
    2,
    definitions.map((definition) => ({
      ...definition,
      durationMinutes: definition.kind === 'PACKAGE' ? 90 : 10,
    })),
  );
  newQuote = await quote(null);
  assert.equal(newQuote.durationMinutes, 110);
  const existing = await call('pricing', 'GET', `/quotes/${oldQuote.quoteId}`, customer);
  assert.equal(existing.status, 200);
  assert.deepEqual(
    parseQuoteV1(existing.body),
    oldQuote,
    'all old snapshot fields including duration are immutable',
  );
});

test('Scheduling refuses forged duration/revision/zone and foreign principals before any capacity mutation', async () => {
  const w = await window();
  const q = await quote(w.zoneId);
  const body = request(w, q);
  const before = await facts(w);
  refusal(
    await call('scheduling', 'POST', '/holds', customer, { ...body, durationMinutes: 5 }, key()),
    422,
    'QUOTE_MISMATCH',
  );
  refusal(
    await call(
      'scheduling',
      'POST',
      '/holds',
      customer,
      { ...body, quoteRef: { ...body.quoteRef, revision: 2 } },
      key(),
    ),
    422,
    'QUOTE_MISMATCH',
  );
  refusal(
    await call('scheduling', 'POST', '/holds', customer, { ...body, zoneId: randomUUID() }, key()),
    422,
    'QUOTE_MISMATCH',
  );
  refusal(
    await call(
      'scheduling',
      'POST',
      '/holds',
      other,
      { ...body, beneficiary: { kind: 'account', subjectId: other.subject } },
      key(),
    ),
    422,
    'QUOTE_NOT_USABLE',
  );
  refusal(
    await call(
      'scheduling',
      'POST',
      '/holds',
      guest,
      { ...body, beneficiary: { kind: 'guest', subjectId: guest.subject } },
      key(),
    ),
    422,
    'QUOTE_NOT_USABLE',
  );
  assert.deepEqual(await facts(w), before);
  heldRequest = body;
  heldKey = key();
  held = await call('scheduling', 'POST', '/holds', customer, body, heldKey);
  assert.equal(held.status, 201, JSON.stringify(held.body));
  const parsed = parseHoldV1(held.body);
  assert.deepEqual(parsed.quoteRef, body.quoteRef);
  assert.equal(Date.parse(parsed.endsAt) - Date.parse(parsed.startsAt), q.durationMinutes * 60_000);
});

test('verified owner quote preserves concurrent same-key replay and one-unit capacity under contention', async () => {
  const w = await window(1);
  const q = await quote(w.zoneId, other);
  const body = request(w, q);
  const k = key();
  const replies = await Promise.all(
    Array.from({ length: 12 }, () => call('scheduling', 'POST', '/holds', other, body, k)),
  );
  assert.ok(
    replies.every((reply) => reply.status === 201),
    JSON.stringify(replies),
  );
  for (const reply of replies) assert.deepEqual(reply, replies[0]);
  assert.equal((await facts(w)).holds, 1);
  assert.equal((await facts(w)).held, 1);
  refusal(await call('scheduling', 'POST', '/holds', other, body, key()), 422, 'SLOT_UNAVAILABLE');
});

test('Scheduling retains its 480-minute ceiling and never truncates a longer valid Pricing selection', async () => {
  await publish(
    2,
    3,
    definitions.map((definition) => ({ ...definition, durationMinutes: 480 })),
  );
  const w = await window();
  const q = await quote(w.zoneId, other);
  assert.equal(
    q.durationMinutes,
    1440,
    'quote semantics are independent of the bounded scheduling API',
  );
  const result = await call('scheduling', 'POST', '/holds', other, request(w, q), key());
  assert.equal(result.status, 400);
  assert.equal(parseApiErrorEnvelope(result.body).error.code, 'REQUEST_INVALID');
  assert.equal((await facts(w)).holds, 0);
});

test('Pricing outage denies new holds while a committed successful receipt replays exactly', async () => {
  await pricingProcess.kill();
  const w = await window();
  const body = request(w, newQuote);
  refusal(
    await call('scheduling', 'POST', '/holds', customer, body, key()),
    503,
    'PRICING_UNAVAILABLE',
  );
  assert.equal((await facts(w)).holds, 0);
  assert.deepEqual(
    await call('scheduling', 'POST', '/holds', customer, heldRequest, heldKey),
    held,
  );
});
