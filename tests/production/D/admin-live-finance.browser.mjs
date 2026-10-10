/**
 * P03-D3 admin live operations and cash finance: three-role browser journeys
 * on real services.
 *
 * One machine runs headless Chromium against:
 *   - the built admin-web bundle served by apps/admin-web/server.mjs;
 *   - the REAL Gateway with the routes requested in CR-D-P02-01/CR-D-P03-02/06,
 *     so this suite needs the CANDIDATE tree described in
 *     docs/production/D/P03-D3_ADMIN_LIVE_OPERATIONS_AND_FINANCE.md
 *     (main + #109 + P03-D1 + P03-D2 + P03-D3 + P03_CANDIDATE_GATEWAY.patch);
 *   - the REAL Identity, Reporting, Booking, Dispatch, Billing and
 *     Communications HTTP adapters on the acceptance PostgreSQL.
 *
 * What is NOT real, and is declared:
 *   - Booking's other owners (Pricing, Scheduling, Vehicle, Customer, Billing)
 *     are Booking's own test doubles (services/booking/test/support), so a
 *     real Booking record can be created through Booking's HTTP API;
 *   - Billing's Pricing upstream is a quote double defined below;
 *   - Dispatch's assignment is opened through Dispatch's own inbox effect
 *     (holdChangedConsumerParts), Reporting rows through Reporting's own
 *     projector and the notification intent through Communications' own
 *     inbox handler, because no producer publishes those events on the
 *     accepted topology yet.
 *
 * Booking, Dispatch and Billing are migrated here with their migration
 * identities (the Lane D runner migrates only Lane D's services).
 *
 *   node scripts/production/D/run-real-infra.mjs --browser [--evidence <file>]
 */
/* global document, getComputedStyle, crypto -- page.evaluate callbacks run in the browser */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { ROOT, appDsn, context, sql } from '../../integration/_support.mjs';
import { hardenPrivileges, migrateDeploy } from '../../../scripts/acceptance/lib/migrations.mjs';
import { STAFF_PASSWORD, account, bearer, staff, startIdentity } from './_identity.mjs';
import { comparePngBuffers } from '../../../scripts/f010/pixel-compare.mjs';

const require = createRequire(path.join(ROOT, 'package.json'));
const EVIDENCE = path.join(ROOT, 'docs', 'production', 'D', 'evidence', 'p03-d3');
const REFERENCE = path.join(ROOT, 'design', 'reference', 'approved', 'washgo-admin-prototype.html');
const TIMEZONE = 'Asia/Damascus';
const SYRIA_OFFSET_MS = 3 * 3_600_000;
const MIN = 60_000;

const owned = (service) => createRequire(path.join(ROOT, 'services', service, 'package.json'));
const dist = (service, file) => owned(service)(path.join(ROOT, 'services', service, 'dist', file));

/* --------------------------------- stack --------------------------------- */

function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server.address().port));
  });
}

async function nestService(service, env) {
  for (const [name, value] of Object.entries(env)) process.env[name] = value;
  const own = owned(service);
  own('reflect-metadata');
  const { createHttpApplication } = own('./dist/transport/http/create-app.js');
  const app = await createHttpApplication();
  await app.listen(env.PORT ? Number(env.PORT) : 0, '127.0.0.1');
  const port = Number(new URL(await app.getUrl()).port);
  return { app, port, origin: `http://127.0.0.1:${port}` };
}

function ingressHandler(gatewayPort, webPort) {
  return (req, res) => {
    const upstream = httpRequest(
      {
        host: '127.0.0.1',
        port: req.url?.startsWith('/api/') ? gatewayPort : webPort,
        method: req.method,
        path: req.url,
        headers: req.headers,
      },
      (reply) => {
        res.writeHead(reply.statusCode ?? 502, reply.headers);
        reply.pipe(res);
      },
    );
    upstream.on('error', () => {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'INGRESS_UPSTREAM_DOWN' } }));
    });
    req.pipe(upstream);
  };
}

/** Billing's Pricing upstream: answers the published quote shape for known quotes. */
async function startQuoteDouble() {
  const quotes = new Map();
  const server = createServer((req, res) => {
    const prefix = '/internal/v1/pricing/quotes/';
    const quote = req.url?.startsWith(prefix) ? quotes.get(req.url.slice(prefix.length)) : null;
    if (req.method !== 'GET' || !quote || !/^Bearer .{20,}/.test(req.headers.authorization ?? '')) {
      res
        .writeHead(404, { 'content-type': 'application/json' })
        .end('{"error":{"code":"NOT_FOUND"}}');
      return;
    }
    const money = { currency: 'SYP', amountMinor: quote.amountMinor, scale: 2 };
    res.writeHead(200, { 'content-type': 'application/json' }).end(
      JSON.stringify({
        quoteId: quote.quoteId,
        revision: 1,
        status: 'USABLE',
        beneficiary: { kind: 'account', subjectId: quote.owner },
        vehicleType: 'SEDAN',
        zoneId: null,
        currency: 'SYP',
        lines: [
          {
            lineId: randomUUID(),
            kind: 'PACKAGE',
            definitionId: randomUUID(),
            quantity: 1,
            unitPrice: money,
            amount: money,
          },
        ],
        total: money,
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      }),
    );
  });
  const port = await listen(server);
  return { quotes, origin: `http://127.0.0.1:${port}`, close: () => server.close() };
}

async function migrateOwners() {
  const ctx = { ...context, root: ROOT };
  for (const service of ['booking', 'dispatch', 'billing']) {
    const migrated = await migrateDeploy(ctx, service);
    assert.equal(migrated.code, 0, `${service} migrate deploy: ${migrated.stderr}`);
    const hardened = await hardenPrivileges(ctx, service);
    assert.equal(hardened.code, 0, `${service} hardening: ${hardened.stderr}`);
  }
}

async function startStack() {
  await migrateOwners();
  const { createWebRuntime } = await import(
    pathToFileURL(path.join(ROOT, 'apps', 'admin-web', 'server.mjs')).href
  );
  const web = createWebRuntime({ documentRoot: path.join(ROOT, 'apps', 'admin-web', 'dist') });
  const webPort = await listen(web);
  const front = createServer();
  const port = await listen(front);
  const origin = `http://127.0.0.1:${port}`;
  const identity = await startIdentity({ cookieSecure: false, origins: [origin] });
  const { startOwnerDoubles, bookingEnv } = owned('booking')(
    path.join(ROOT, 'services', 'booking', 'dist-tests', 'test', 'support', 'owner-doubles.js'),
  );
  const doubles = await startOwnerDoubles();
  const quotes = await startQuoteDouble();
  const env = {
    reporting: {
      DATABASE_URL: appDsn(context, 'reporting'),
      IDENTITY_ORIGIN: identity.base,
      REPORTING_READS_PER_MINUTE: '600',
    },
    communications: {
      DATABASE_URL: appDsn(context, 'communications'),
      IDENTITY_ORIGIN: identity.base,
      COMMUNICATIONS_READS_PER_MINUTE: '600',
    },
    dispatch: {
      DATABASE_URL: appDsn(context, 'dispatch'),
      IDENTITY_URL: identity.base,
      DISPATCH_SERVICE_CLIENTS: '',
      DISPATCH_USER_REQUESTS_PER_MINUTE: '600',
    },
    booking: {
      ...bookingEnv(doubles, appDsn(context, 'booking')),
      // Booking authorizes every caller with the REAL Identity; only its
      // upstream owners are doubles.
      IDENTITY_URL: identity.base,
      BOOKING_USER_REQUESTS_PER_MINUTE: '600',
      BOOKING_INLINE_SAGA_BUDGET_MS: '15000',
    },
    billing: {
      DATABASE_URL: appDsn(context, 'billing'),
      IDENTITY_SESSION_ORIGIN: identity.base,
      PRICING_ORIGIN: quotes.origin,
    },
  };
  const services = {};
  for (const name of Object.keys(env))
    services[name] = await nestService(name, { ...env[name], PORT: '' });
  const gatewayRequire = createRequire(path.join(ROOT, 'apps', 'api-gateway', 'package.json'));
  gatewayRequire('reflect-metadata');
  const { createGatewayApplication, loadGatewayConfig } = gatewayRequire('./dist/index.js');
  const gateway = await createGatewayApplication(
    loadGatewayConfig({
      GATEWAY_UPSTREAMS: JSON.stringify({
        identity: identity.base,
        ...Object.fromEntries(Object.entries(services).map(([n, s]) => [n, s.origin])),
      }),
      IDENTITY_ISSUER: 'https://identity.washgo.invalid',
      IDENTITY_AUDIENCE: 'washgo-web',
      GATEWAY_INSECURE_LOOPBACK_COOKIES: 'true',
      GATEWAY_ALLOWED_ORIGINS: origin,
      GATEWAY_TIMEOUT_MS: '3000',
    }),
  );
  await gateway.listen(0, '127.0.0.1');
  const gatewayPort = Number(new URL(await gateway.getUrl()).port);
  front.on('request', ingressHandler(gatewayPort, webPort));
  return {
    origin,
    identity,
    doubles,
    quotes,
    services,
    async stopService(name) {
      await services[name].app.close();
    },
    async startService(name) {
      services[name] = await nestService(name, { ...env[name], PORT: String(services[name].port) });
    },
    async stop() {
      for (const server of [front, web]) {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
      quotes.close();
      await doubles.close();
      for (const app of [gateway, ...Object.values(services).map((s) => s.app), identity.app])
        await app.close().catch(() => {});
    },
  };
}

/* ------------------------- owner-side fixtures ------------------------- */

async function ownerCall(origin, prefix, principal, route, { method = 'GET', body, key } = {}) {
  const response = await fetch(`${origin}${prefix}${route}`, {
    method,
    headers: {
      authorization: bearer(principal),
      'x-correlation-id': randomUUID(),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(key ? { 'idempotency-key': key } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

const ok2xx = (status) => status >= 200 && status < 300;

const commandKey = () => randomUUID().replaceAll('-', '');

/** A real Booking record, created by the customer through Booking's own API. */
async function createBooking(customer) {
  // Booking forwards the customer credential to its upstream owners; the
  // doubles must recognise the REAL Identity token for this customer.
  stack.doubles.sessions.set(customer.token, {
    subject: customer.subject,
    principalKind: 'account',
    permissions: ['bookings.create:self', 'bookings.read:self'],
  });
  const issued = stack.doubles.issue({ kind: 'account', subjectId: customer.subject });
  const created = await ownerCall(
    stack.services.booking.origin,
    '/internal/v1/booking',
    customer,
    '/bookings',
    {
      method: 'POST',
      key: commandKey(),
      body: {
        quote: { quoteId: issued.quoteId, revision: 1 },
        hold: { holdId: issued.holdId, revision: 1 },
        vehicle: { source: 'saved', vehicleId: randomUUID(), revision: 2 },
        address: { addressId: randomUUID(), revision: 1 },
        contact: { name: 'زبون اختبار', phone: '0912345678', notes: null },
        paymentMethod: 'SHAM_CASH',
      },
    },
  );
  assert.ok(ok2xx(created.status), JSON.stringify(created.body));
  return {
    bookingId: created.body.bookingId,
    holdId: issued.holdId,
    zoneId: issued.zoneId,
    startsAt: Date.parse(created.body.slot.startsAt),
    endsAt: Date.parse(created.body.slot.endsAt),
  };
}

/** Opens Dispatch's assignment through Dispatch's own inbox effect for the committed hold. */
async function openAssignment(booking) {
  const { PrismaService } = dist('dispatch', 'infrastructure/persistence/prisma.service.js');
  const { PrismaDispatchStore } = dist(
    'dispatch',
    'infrastructure/persistence/prisma-dispatch.store.js',
  );
  const { holdChangedConsumerParts } = dist(
    'dispatch',
    'transport/messaging/hold-changed.consumer.js',
  );
  const { systemClock, uuidGenerator } = dist('dispatch', 'infrastructure/runtime/system.js');
  const prisma = new PrismaService(appDsn(context, 'dispatch'));
  try {
    const parts = holdChangedConsumerParts(
      new PrismaDispatchStore(prisma),
      systemClock,
      uuidGenerator,
    );
    const event = holdCommitted(booking);
    const message = parts.parse(event);
    const outcome = await parts.store.applyOnce(
      {
        eventId: event.eventId,
        eventType: event.eventType,
        payloadHash: createHash('sha256').update(JSON.stringify(event)).digest('hex'),
        correlationId: event.correlationId,
      },
      (tx) => parts.effect(message, tx),
    );
    assert.equal(outcome, 'APPLIED');
  } finally {
    await prisma.client.$disconnect();
  }
}

function holdCommitted(booking) {
  return {
    eventId: randomUUID(),
    eventType: 'scheduling.hold-changed.v1',
    envelopeVersion: 2,
    producer: 'scheduling',
    occurredAt: new Date(Date.now() - MIN).toISOString(),
    correlationId: randomUUID(),
    causationId: null,
    traceparent: null,
    aggregate: { type: 'hold', id: booking.holdId, version: 2 },
    actor: { kind: 'service', id: 'scheduling' },
    data: {
      state: 'COMMITTED',
      zoneId: booking.zoneId,
      startsAt: new Date(booking.startsAt).toISOString(),
      endsAt: new Date(booking.endsAt).toISOString(),
      bookingId: booking.bookingId,
    },
  };
}

/** Reporting rows through Reporting's own projector (one transaction per fact). */
async function project(facts) {
  const { OperationsProjector } = dist('reporting', 'application/operations.service.js');
  const { PrismaOperationsWriter } = dist(
    'reporting',
    'infrastructure/persistence/prisma-operations.store.js',
  );
  const { sha256Hex } = dist('reporting', 'infrastructure/persistence/prisma-projection.store.js');
  const projector = new OperationsProjector(sha256Hex, { now: () => new Date() });
  for (const fact of facts)
    await reportingDb.$transaction((tx) => projector.apply(new PrismaOperationsWriter(tx), fact));
}

function reportingFactsFor(booking, customerId) {
  const { parseOperationsEvent } = dist('reporting', 'application/operations.service.js');
  return [
    parseOperationsEvent({
      eventId: randomUUID(),
      eventType: 'booking.confirmed.v1',
      schemaVersion: 1,
      producer: 'booking',
      occurredAt: new Date(Date.now() - 2 * MIN).toISOString(),
      correlationId: randomUUID(),
      aggregateVersion: 1,
      data: { bookingId: booking.bookingId, customerId },
    }).fact,
    parseOperationsEvent(holdCommitted(booking)).fact,
  ];
}

/** Assignment timing facts for synthetic jobs starting today, with known durations. */
function timingFacts(minutesToAssign) {
  const live = dist('reporting', 'domain/live-operations.js');
  const zoneId = randomUUID();
  const facts = [];
  minutesToAssign.forEach((m, i) => {
    const created = Date.now() - 90 * MIN;
    const startsAt = damascusToday(14 * 60 + i * 30);
    const base = {
      assignmentId: randomUUID(),
      bookingId: randomUUID(),
      zoneId,
      startsAt: new Date(startsAt),
      endsAt: new Date(startsAt + 3_600_000),
    };
    const fact = (version, status, at, resourceId = null) =>
      live.assignmentFact({
        ...base,
        eventId: randomUUID(),
        occurredAt: new Date(at),
        version,
        status,
        resourceId,
      });
    facts.push(fact(1, 'UNASSIGNED', created));
    facts.push(fact(2, 'OFFERED', created + MIN));
    facts.push(fact(3, 'ASSIGNED', created + m * MIN, randomUUID()));
  });
  return facts;
}

function obligationFact(obligationId, version, cashState, amountMinor) {
  const live = dist('reporting', 'domain/live-operations.js');
  return live.obligationFact({
    eventId: randomUUID(),
    occurredAt: new Date(),
    version,
    obligationId,
    cashState,
    outstanding: live.exactAmount({ currency: 'SYP', amountMinor, scale: 2 }),
  });
}

/** Notification intent through Communications' own inbox handler. */
async function notifyConfirmed(booking, customerId) {
  const { EventNotificationHandler } = dist(
    'communications',
    'application/event-notifications.service.js',
  );
  const { EnqueueNotification } = dist('communications', 'application/notification.service.js');
  const { PrismaNotificationIntake, sha256Hex } = dist(
    'communications',
    'infrastructure/persistence/prisma-notification.repository.js',
  );
  const clock = { now: () => new Date() };
  const handler = new EventNotificationHandler(
    new EnqueueNotification(clock, sha256Hex, () => randomUUID()),
    clock,
  );
  const { PrismaClient } = dist('communications', 'generated/prisma/client.js');
  const { PrismaPg } = owned('communications')('@prisma/adapter-pg');
  const db = new PrismaClient({
    adapter: new PrismaPg(
      { connectionString: appDsn(context, 'communications') },
      { schema: 'app' },
    ),
  });
  try {
    const outcome = await db.$transaction((tx) =>
      handler.handle(new PrismaNotificationIntake(tx), {
        kind: 'BOOKING_CONFIRMED',
        eventId: randomUUID(),
        occurredAt: new Date(),
        bookingId: booking.bookingId,
        customerId,
      }),
    );
    assert.equal(outcome.kind, 'CREATED');
  } finally {
    await db.$disconnect();
  }
}

/** A Billing obligation with one electronic attempt awaiting review, by the customer. */
async function obligationUnderReview(customer, amountMinor) {
  const quoteId = randomUUID();
  stack.quotes.quotes.set(quoteId, { quoteId, owner: customer.subject, amountMinor });
  const billing = (route, init) =>
    ownerCall(stack.services.billing.origin, '/internal/v1/billing', customer, route, init);
  const created = await billing('/obligations', {
    method: 'POST',
    key: commandKey(),
    body: { quoteId },
  });
  assert.ok(ok2xx(created.status), JSON.stringify(created.body));
  const obligationId = created.body.obligationId;
  const intent = await billing(`/obligations/${obligationId}/payment-intents`, {
    method: 'POST',
    key: commandKey(),
    body: { expectedRevision: created.body.revision, method: 'SHAM_CASH' },
  });
  assert.ok(ok2xx(intent.status), JSON.stringify(intent.body));
  const attempt = await billing(`/obligations/${obligationId}/payment-attempts`, {
    method: 'POST',
    key: commandKey(),
    body: {
      expectedRevision: intent.body.revision,
      providerReference: `SC-${randomUUID().slice(0, 8)}`,
    },
  });
  assert.ok(ok2xx(attempt.status), JSON.stringify(attempt.body));
  assert.equal(attempt.body.attempts[0].status, 'PENDING_REVIEW');
  return {
    obligationId,
    attemptId: attempt.body.attempts[0].attemptId,
    revision: attempt.body.revision,
  };
}

function damascusToday(minutes) {
  const now = new Date(Date.now() + SYRIA_OFFSET_MS);
  return (
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0) -
    SYRIA_OFFSET_MS +
    minutes * MIN
  );
}

/** Owner audit rows, read with the owner's runtime identity (test evidence only). */
async function auditRows(service, statement) {
  const result = await sql(appDsn(context, service), statement);
  assert.equal(result.ok, true, result.message);
  return result.rows;
}

/* ---------------------------- browser helpers ---------------------------- */

const DISABLE_MOTION = `*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}`;

async function signInUi(page, principal) {
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('البريد الإلكتروني').fill(principal.email);
  await dialog.getByLabel('كلمة المرور').fill(STAFF_PASSWORD);
  const login = page.waitForResponse((r) => r.url().endsWith('/api/v1/auth/login'));
  await dialog.getByRole('button', { name: 'متابعة' }).click();
  const { challengeId } = await (await login).json();
  await dialog.getByLabel('رمز التحقق').fill(stack.identity.delivered.get(challengeId).code);
  await dialog.getByRole('button', { name: 'تأكيد' }).click();
  await dialog.waitFor({ state: 'hidden' });
}

/**
 * Identity budgets OTP challenges per IP (30 per 15 minutes) and every
 * principal here shares 127.0.0.1, so each principal signs in through the UI
 * once and later pages reuse that browser session (cookies only).
 */
const sessions = new Map();

async function asUser(principal, options = {}) {
  const state = sessions.get(principal.subject);
  const browserContext = await browser.newContext({
    viewport: { width: options.width ?? 1440, height: options.height ?? 900 },
    deviceScaleFactor: 1,
    locale: 'ar-SY',
    timezoneId: TIMEZONE,
    reducedMotion: options.reducedMotion ?? 'no-preference',
    ...(state ? { storageState: state } : {}),
  });
  const page = await browserContext.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(stack.origin);
  if (!state) {
    await signInUi(page, principal);
    sessions.set(principal.subject, await browserContext.storageState());
  }
  return { page, browserContext, errors };
}

/** Dialog surfaces are measured on the dialog; the page behind it is measured on its own. */
async function axe(page, scope = null) {
  const source = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
  await page.evaluate(source);
  return page.evaluate(async (selector) => {
    const result = await globalThis.axe.run(
      selector ? document.querySelector(selector) : document,
      {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
      },
    );
    return result.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.length,
      targets: v.nodes.slice(0, 5).map((n) => n.target.join(' ')),
    }));
  }, scope);
}

/** The correlation id the console put on a request matching `match`. */
function capture(page, match) {
  return page
    .waitForRequest((r) => r.method() === 'POST' && match.test(r.url()))
    .then((r) => r.headers()['x-correlation-id']);
}

/** A hand-made same-origin call with the signed-in cookies and CSRF token, as a tampered client would. */
function tamper(page, url, body) {
  return page.evaluate(
    async ({ url: u, body: b }) => {
      const csrf = document.cookie
        .split(';')
        .map((c) => c.trim().split('='))
        .find(([n]) => n === 'wg_csrf' || n === '__Host-wg_csrf')?.[1];
      const r = await fetch(u, {
        method: b === undefined ? 'GET' : 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrf ?? '',
          'idempotency-key': crypto.randomUUID().replaceAll('-', ''),
        },
        ...(b === undefined ? {} : { body: JSON.stringify(b) }),
      });
      return r.status;
    },
    { url, body },
  );
}

/* --------------------------------- suite --------------------------------- */

let stack;
let browser;
let reportingDb;
let technician;
let technicianTwo;
let resourceOne;
let resourceTwo;
/** One account per role for the whole suite (see `asUser`). */
const principals = {};
const report = { journeys: {}, accessibility: {}, visual: [], audit: {}, consoleErrors: [] };

test.before(async () => {
  stack = await startStack();
  browser = await chromium.launch({ args: ['--font-render-hinting=none', '--disable-lcd-text'] });
  const { PrismaClient } = dist('reporting', 'generated/prisma/client.js');
  const { PrismaPg } = owned('reporting')('@prisma/adapter-pg');
  reportingDb = new PrismaClient({
    adapter: new PrismaPg({ connectionString: appDsn(context, 'reporting') }, { schema: 'app' }),
  });
  mkdirSync(EVIDENCE, { recursive: true });
  const probe = await fetch(`${stack.origin}/api/v1/admin/finance/cash`);
  assert.notEqual(probe.status, 404, 'GATEWAY_ROUTES_MISSING: apply P03_CANDIDATE_GATEWAY.patch');
  technician = await staff(stack.identity, ['technician']);
  technicianTwo = await staff(stack.identity, ['technician']);
  principals.operations = await staff(stack.identity, ['operations']);
  principals.finance = await staff(stack.identity, ['finance']);
  principals.superAdmin = await staff(stack.identity, ['super-admin']);
  principals.customer = await account(stack.identity);
  resourceOne = randomUUID();
  resourceTwo = randomUUID();
});

test.after(async () => {
  writeFileSync(path.join(EVIDENCE, 'browser-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  await reportingDb?.$disconnect();
  await browser?.close();
  await stack?.stop();
});

test('O1: operations — dashboard KPIs equal Reporting, live assignment, offer/accept/reassign/unassign with audit', async () => {
  const operations = principals.operations;
  const customer = principals.customer;
  const booking = await createBooking(customer);
  await openAssignment(booking);
  await project([...reportingFactsFor(booking, customer.subject), ...timingFacts([3, 5, 9])]);
  await notifyConfirmed(booking, customer.subject);

  const { OperationsQueries } = dist('reporting', 'application/operations.service.js');
  const { PrismaOperationsReader } = dist(
    'reporting',
    'infrastructure/persistence/prisma-operations.store.js',
  );
  const queries = new OperationsQueries(new PrismaOperationsReader(reportingDb), {
    now: () => new Date(),
  });

  const { page, browserContext, errors } = await asUser(operations);
  try {
    await page.waitForURL(/#\/dashboard$/);
    await page.locator('#dashboardKpis .kpi').first().waitFor();
    // Same window the console asks for (Damascus calendar day).
    const from = new Date(damascusToday(0)).toISOString();
    const to = new Date(damascusToday(24 * 60)).toISOString();
    const expected = await queries.operationsKpis({ from, to, zoneId: undefined });
    const cards = await page.locator('#dashboardKpis .kpi b').allInnerTexts();
    const total = [...expected.bookingsByStatus.values()].reduce((a, b) => a + b, 0);
    assert.equal(cards[0], String(total));
    assert.equal(cards[1], String(expected.assignmentsByStatus.get('ASSIGNED')));
    assert.equal(cards[3], `${Math.floor(expected.timeToAssign.p50Ms / MIN)} د`);
    assert.match(await page.locator('#dashboardTiming').innerText(), /غير متاحة بعد/);
    assert.equal(await page.locator('.nav button[data-screen="payments"]').isDisabled(), true);
    report.accessibility.dashboard = await axe(page);

    // Live table: Dispatch is the source of the technician column.
    await page.locator('.nav button[data-screen="bookings"]').click();
    const row = page.locator(`#bookingRows tr[data-booking="${booking.bookingId}"]`);
    await row.waitFor();
    await row.locator('td[data-assignment="UNASSIGNED"]').waitFor();

    // Detail: each owner answers for its own section.
    await row.click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('#detailBooking .detail-list').waitFor();
    assert.match(await dialog.locator('#detailBooking').innerText(), /شام كاش/);
    assert.ok(!(await dialog.innerText()).includes('0912345678'), 'contact is never rendered');
    await dialog.locator('#detailNotifications [data-delivery="QUEUED"]').waitFor();
    await dialog.locator('#detailAssignment [data-status="UNASSIGNED"]').waitFor();
    report.accessibility.bookingDetail = await axe(page, '.modal');

    // Validation before any request.
    await dialog.locator('#assignment-offer').click();
    await dialog.locator('#assignmentProblems').getByText('أدخل رقم مورد الفني الكامل.').waitFor();

    // Offer -> technician accepts -> ASSIGNED.
    await dialog.locator('#offerResource').fill(resourceOne);
    await dialog.locator('#offerTechnician').fill(technician.subject);
    const offerCorrelation = capture(page, /\/admin\/assignments\/[^/]+\/offers$/);
    await dialog.locator('#assignment-offer').click();
    await dialog.locator('#detailAssignment [data-status="OFFERED"]').waitFor();
    const offered = await offerCorrelation;
    const offers = await ownerCall(
      stack.services.dispatch.origin,
      '/internal/v1/dispatch',
      technician,
      '/me/offers',
    );
    assert.equal(offers.status, 200);
    const mine = offers.body.items.find((o) => o.job.bookingId === booking.bookingId);
    const accepted = await ownerCall(
      stack.services.dispatch.origin,
      '/internal/v1/dispatch',
      technician,
      `/offers/${mine.offerId}/accept`,
      {
        method: 'POST',
        key: commandKey(),
        body: {},
      },
    );
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
    await page.keyboard.press('Escape');
    await page.locator('.nav button[data-screen="dashboard"]').click();
    await page.locator('.nav button[data-screen="bookings"]').click();
    await row.locator('td[data-assignment="ASSIGNED"]').waitFor();

    // Reassign to a second technician, then release.
    await row.click();
    await dialog.locator('#detailAssignment [data-status="ASSIGNED"]').waitFor();
    await dialog.locator('#offerResource').fill(resourceTwo);
    await dialog.locator('#offerTechnician').fill(technicianTwo.subject);
    const reassignCorrelation = capture(page, /\/reassign$/);
    await dialog.locator('#assignment-reassign').click();
    await dialog.locator('#detailAssignment [data-status="OFFERED"]').waitFor();
    const reassigned = await reassignCorrelation;
    const unassignCorrelation = capture(page, /\/unassign$/);
    await dialog.locator('#assignment-unassign').click();
    await dialog.locator('#detailAssignment [data-status="UNASSIGNED"]').waitFor();
    const unassigned = await unassignCorrelation;
    await dialog.locator('[data-correlation]').waitFor();

    // Dispatch's own audit names the operations actor and the console's request ids.
    const rows = await auditRows(
      'dispatch',
      `SELECT action, actor_id, correlation_id::text AS correlation_id FROM app.audit_entry WHERE correlation_id IN ('${offered}','${reassigned}','${unassigned}') ORDER BY occurred_at`,
    );
    const byCorrelation = (id) => rows.filter((r) => r.correlation_id === id).map((r) => r.action);
    assert.ok(byCorrelation(offered).includes('offer.created'), JSON.stringify(rows));
    assert.ok(byCorrelation(reassigned).includes('assignment.reassigned'), JSON.stringify(rows));
    assert.ok(byCorrelation(unassigned).includes('assignment.unassigned'), JSON.stringify(rows));
    assert.ok(
      rows.every((r) => r.actor_id === operations.subject),
      'every row is the operations actor',
    );
    report.audit.dispatch = rows.map((r) => ({
      action: r.action,
      actorIsOperations: r.actor_id === operations.subject,
      correlationId: r.correlation_id,
    }));
    assert.deepEqual(errors, []);
    report.journeys.O1 = 'PASSED';
  } finally {
    await browserContext.close();
  }
});

test('O2: operations — a lost answer is UNKNOWN; only the same command is resent, and acts once', async () => {
  const operations = principals.operations;
  const customer = principals.customer;
  const booking = await createBooking(customer);
  await openAssignment(booking);
  await project(reportingFactsFor(booking, customer.subject));
  const { page, browserContext, errors } = await asUser(operations);
  try {
    await page.goto(`${stack.origin}/#/bookings`);
    const row = page.locator(`#bookingRows tr[data-booking="${booking.bookingId}"]`);
    await row.click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('#detailAssignment [data-status="UNASSIGNED"]').waitFor();
    await dialog.locator('#offerResource').fill(resourceOne);
    await dialog.locator('#offerTechnician').fill(technician.subject);

    await stack.stopService('dispatch');
    const firstKey = page
      .waitForRequest((r) => r.method() === 'POST' && /\/offers$/.test(r.url()))
      .then((r) => r.headers()['idempotency-key']);
    await dialog.locator('#assignment-offer').click();
    await dialog.getByText(/لم نتمكن من تأكيد نتيجة الأمر/).waitFor();
    assert.equal(await dialog.locator('#assignment-offer').innerText(), 'إعادة إرسال الأمر نفسه');
    assert.equal(
      await dialog.locator('#offerResource').inputValue(),
      resourceOne,
      'the same target is kept',
    );

    await stack.startService('dispatch');
    const secondKey = page
      .waitForRequest((r) => r.method() === 'POST' && /\/offers$/.test(r.url()))
      .then((r) => r.headers()['idempotency-key']);
    await dialog.locator('#assignment-offer').click();
    await dialog.locator('#detailAssignment [data-status="OFFERED"]').waitFor();
    assert.equal(await firstKey, await secondKey, 'the resend reuses the Idempotency-Key');
    const offers = await auditRows(
      'dispatch',
      `SELECT count(*)::int AS n FROM app.dispatch_offer o JOIN app.assignment a ON a.id = o.assignment_id WHERE a.booking_id = '${booking.bookingId}'`,
    );
    assert.equal(offers[0].n, 1, 'exactly one offer exists');

    // A stale revision is a conflict: Dispatch changed under the open dialog.
    await page.keyboard.press('Escape');
    await row.click();
    await dialog.locator('#detailAssignment [data-status="OFFERED"]').waitFor();
    const live = await ownerCall(
      stack.services.dispatch.origin,
      '/internal/v1/dispatch',
      operations,
      `/bookings/${booking.bookingId}/assignment`,
    );
    const moved = await ownerCall(
      stack.services.dispatch.origin,
      '/internal/v1/dispatch',
      operations,
      `/assignments/${live.body.assignmentId}/unassign`,
      {
        method: 'POST',
        key: commandKey(),
        body: { expectedRevision: live.body.revision },
      },
    );
    assert.equal(moved.status, 200);
    await dialog.locator('#assignment-unassign').click();
    await dialog.locator('[data-state="CONFLICT"]').waitFor();
    await dialog.locator('#detailAssignment [data-status="UNASSIGNED"]').waitFor();
    assert.deepEqual(errors, []);
    report.journeys.O2 = 'PASSED';
  } finally {
    await browserContext.close();
  }
});

test('F1: finance — cash KPIs equal Reporting; reconcile through Billing with audit; operations screens refused', async () => {
  const finance = principals.finance;
  const customer = principals.customer;
  const due = await obligationUnderReview(customer, '250000');
  await project([obligationFact(due.obligationId, due.revision, 'UNDER_REVIEW', '250000')]);
  const { OperationsQueries } = dist('reporting', 'application/operations.service.js');
  const { PrismaOperationsReader } = dist(
    'reporting',
    'infrastructure/persistence/prisma-operations.store.js',
  );
  const queries = new OperationsQueries(new PrismaOperationsReader(reportingDb), {
    now: () => new Date(),
  });

  const { page, browserContext, errors } = await asUser(finance);
  try {
    await page.waitForURL(/#\/payments$/);
    await page.locator('#paymentRows tr[data-cash-state]').first().waitFor();
    const cash = await queries.cashKpis();
    const review = cash.states
      .filter((s) => s.cashState === 'UNDER_REVIEW' || s.cashState === 'OUTCOME_UNKNOWN')
      .reduce((n, s) => n + s.count, 0);
    assert.equal(await page.locator('#cardReview h3').innerText(), String(review));
    assert.match(
      await page.locator('#paymentRows tr[data-cash-state="UNDER_REVIEW"]').innerText(),
      /SYP/,
    );
    for (const screen of ['dashboard', 'bookings'])
      assert.equal(await page.locator(`.nav button[data-screen="${screen}"]`).isDisabled(), true);
    report.accessibility.payments = await axe(page);

    await page.locator('#obligationRef').fill(due.obligationId);
    await page.locator('#obligationLookup button[type="submit"]').click();
    const dialog = page.getByRole('dialog');
    await dialog
      .locator(`tr[data-attempt="${due.attemptId}"][data-attempt-status="PENDING_REVIEW"]`)
      .waitFor();
    assert.match(await dialog.innerText(), /نظام المدفوعات وحده يقرر وصول المال/);
    await dialog.locator(`#reconcile-${due.attemptId}`).click();
    await dialog.locator('#reconcileSubmit').click();
    await dialog.locator('#reconcileProblem').getByText('اختر نتيجة المطابقة.').waitFor();
    await dialog.locator('#reconcileOutcome').selectOption('MATCHED');
    await dialog.locator('#reconcileObserved').fill('2500.001');
    await dialog.locator('#reconcileSubmit').click();
    await dialog.locator('#reconcileProblem').getByText('كسور أكثر مما تسمح به العملة.').waitFor();
    await dialog.locator('#reconcileObserved').fill('2,500');
    report.accessibility.reconcileDialog = await axe(page, '.modal');
    const correlation = capture(page, /\/reconciliation$/);
    await dialog.locator('#reconcileSubmit').click();
    await dialog.locator('[data-financial-status="PAID"]').waitFor();
    const reconciled = await correlation;

    const audit = await auditRows(
      'billing',
      `SELECT action, actor_subject::text AS actor, outcome, correlation_id::text AS correlation_id FROM app.billing_audit_event WHERE correlation_id = '${reconciled}'`,
    );
    assert.equal(audit.length, 1, JSON.stringify(audit));
    assert.equal(audit[0].action, 'billing.attempt.reconciled');
    assert.equal(audit[0].actor, finance.subject);
    assert.equal(audit[0].outcome, 'MATCHED');
    report.audit.billing = [
      {
        action: audit[0].action,
        actorIsFinance: true,
        outcome: audit[0].outcome,
        correlationId: reconciled,
      },
    ];

    // Denied by the Gateway even when hand-made with a valid CSRF token.
    assert.equal(
      await tamper(
        page,
        '/api/v1/admin/operations/kpis?from=2026-01-01T00:00:00Z&to=2026-01-02T00:00:00Z',
      ),
      403,
    );
    assert.equal(
      await tamper(page, `/api/v1/admin/assignments/${randomUUID()}/offers`, {
        expectedRevision: 1,
        resourceId: resourceOne,
        technicianSubjectId: technician.subject,
      }),
      403,
    );
    assert.equal(await tamper(page, `/api/v1/admin/bookings/${randomUUID()}`), 403);
    assert.deepEqual(errors, []);
    report.journeys.F1 = 'PASSED';
  } finally {
    await browserContext.close();
  }
});

test('S1: super-admin — every screen; reconcile MISMATCHED; may not reconcile its own payment', async () => {
  const superAdmin = principals.superAdmin;
  const customer = principals.customer;
  const due = await obligationUnderReview(customer, '120000');
  const own = await obligationUnderReview(superAdmin, '50000');
  const { page, browserContext, errors } = await asUser(superAdmin);
  try {
    await page.waitForURL(/#\/dashboard$/);
    for (const screen of ['dashboard', 'bookings', 'technicians', 'payments'])
      assert.equal(
        await page.locator(`.nav button[data-screen="${screen}"]`).isDisabled(),
        false,
        screen,
      );
    await page.locator('.nav button[data-screen="payments"]').click();
    await page.locator('#paymentRows tr[data-cash-state]').first().waitFor();

    await page.locator('#obligationRef').fill(due.obligationId);
    await page.locator('#obligationLookup button[type="submit"]').click();
    const dialog = page.getByRole('dialog');
    await dialog.locator(`#reconcile-${due.attemptId}`).click();
    await dialog.locator('#reconcileOutcome').selectOption('MISMATCHED');
    await dialog.locator('#reconcileObserved').fill('1000');
    const correlation = capture(page, /\/reconciliation$/);
    await dialog.locator('#reconcileSubmit').click();
    await dialog
      .locator(`tr[data-attempt="${due.attemptId}"][data-attempt-status="MISMATCHED"]`)
      .waitFor();
    const audit = await auditRows(
      'billing',
      `SELECT actor_subject::text AS actor, outcome FROM app.billing_audit_event WHERE correlation_id = '${await correlation}'`,
    );
    assert.deepEqual(audit, [{ actor: superAdmin.subject, outcome: 'MISMATCHED' }]);
    await page.keyboard.press('Escape');

    // Billing refuses self-reconciliation even for super-admin.
    await page.locator('#obligationRef').fill(own.obligationId);
    await page.locator('#obligationLookup button[type="submit"]').click();
    await dialog.locator(`#reconcile-${own.attemptId}`).click();
    await dialog.locator('#reconcileOutcome').selectOption('MATCHED');
    await dialog.locator('#reconcileObserved').fill('500');
    await dialog.locator('#reconcileSubmit').click();
    await dialog.locator('#reconcileStatus [data-state="FORBIDDEN"]').waitFor();
    assert.deepEqual(errors, []);
    report.journeys.S1 = 'PASSED';
  } finally {
    await browserContext.close();
  }
});

test('D1: denials — operations cannot reach finance; customers and technicians reach nothing', async () => {
  const operations = principals.operations;
  const { page, browserContext } = await asUser(operations);
  try {
    await page.waitForURL(/#\/dashboard$/);
    await page.goto(`${stack.origin}/#/payments`);
    await page.getByText('لا يملك هذا الحساب صلاحية هذه الشاشة.').waitFor();
    assert.equal(await tamper(page, '/api/v1/admin/finance/cash'), 403);
    assert.equal(await tamper(page, `/api/v1/admin/billing/obligations/${randomUUID()}`), 403);
    assert.equal(
      await tamper(page, `/api/v1/admin/billing/payment-attempts/${randomUUID()}/reconciliation`, {
        expectedRevision: 1,
        outcome: 'MATCHED',
        observedAmount: { currency: 'SYP', amountMinor: '100', scale: 2 },
      }),
      403,
    );
  } finally {
    await browserContext.close();
  }
  for (const who of [principals.customer, technician]) {
    const { page: p, browserContext: c } = await asUser(who);
    try {
      await p.getByText('هذا الحساب لا يملك صلاحية لوحة الإدارة.').waitFor();
      for (const route of [
        '/api/v1/admin/operations/kpis?from=2026-01-01T00:00:00Z&to=2026-01-02T00:00:00Z',
        '/api/v1/admin/finance/cash',
        '/api/v1/admin/notifications',
      ])
        assert.equal(await tamper(p, route), 403, route);
    } finally {
      await c.close();
    }
  }
  // Anonymous callers are refused before any owner is asked.
  assert.equal((await fetch(`${stack.origin}/api/v1/admin/finance/cash`)).status, 401);
  report.journeys.D1 = 'PASSED';
});

test('M1: LTR switch, reduced motion and the 390 px menu on the new screens', async () => {
  const superAdmin = principals.superAdmin;
  const { page, browserContext, errors } = await asUser(superAdmin, {
    width: 390,
    height: 844,
    reducedMotion: 'reduce',
  });
  try {
    await page.waitForURL(/#\/dashboard$/);
    assert.equal(
      await page.locator('#sidebar').evaluate((e) => getComputedStyle(e).transitionDuration),
      '0s',
    );
    await page.locator('#menuBtn').click();
    await page.locator('.nav button[data-screen="payments"]').click();
    await page.locator('#paymentRows tr[data-cash-state]').first().waitFor();
    await page.locator('#langBtn').click();
    assert.equal(await page.evaluate(() => document.documentElement.dir), 'ltr');
    assert.equal(await page.locator('#paymentsTitle').innerText(), 'Payments');
    await page.reload();
    assert.equal(await page.evaluate(() => document.documentElement.dir), 'ltr');
    await page.locator('#langBtn').click();
    assert.deepEqual(errors, []);
    report.journeys.M1 = 'PASSED';
  } finally {
    await browserContext.close();
  }
});

test('V1: reference / candidate / diff screenshots for dashboard and payments at three widths', async () => {
  const superAdmin = principals.superAdmin;
  const referenceServer = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(readFileSync(REFERENCE));
  });
  const referencePort = await listen(referenceServer);
  try {
    for (const width of [390, 768, 1440]) {
      for (const screen of ['dashboard', 'payments']) {
        const shot = async (url, prepare, storageState = undefined) => {
          const c = await browser.newContext({
            viewport: { width, height: 900 },
            deviceScaleFactor: 1,
            locale: 'ar-SY',
            timezoneId: TIMEZONE,
            reducedMotion: 'reduce',
            ...(storageState ? { storageState } : {}),
          });
          const page = await c.newPage();
          await page.goto(url);
          await prepare(page);
          await page.addStyleTag({ content: DISABLE_MOTION }).catch(() => {});
          await page.evaluate(() => document.fonts.ready);
          const png = await page.screenshot({ fullPage: false });
          await c.close();
          return png;
        };
        const reference = await shot(`http://127.0.0.1:${referencePort}/`, async (page) => {
          await page.evaluate((id) => {
            document
              .querySelectorAll('.screen')
              .forEach((x) => x.classList.toggle('active', x.id === id));
            document
              .querySelectorAll('.nav button[data-screen]')
              .forEach((x) => x.classList.toggle('active', x.dataset.screen === id));
          }, screen);
        });
        const candidate = await shot(
          stack.origin,
          async (page) => {
            await page.goto(`${stack.origin}/#/${screen}`);
            await page.locator(`#${screen}.active`).waitFor();
            await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
          },
          sessions.get(superAdmin.subject),
        );
        const result = await comparePngBuffers(browser, reference, candidate);
        const base = `${screen}-${width}`;
        writeFileSync(path.join(EVIDENCE, `${base}-reference.png`), reference);
        writeFileSync(path.join(EVIDENCE, `${base}-candidate.png`), candidate);
        if (result.diffBase64)
          writeFileSync(
            path.join(EVIDENCE, `${base}-diff.png`),
            Buffer.from(result.diffBase64, 'base64'),
          );
        report.visual.push({
          screen,
          width,
          sameDimensions: result.sameDimensions,
          diffRatio: result.diffRatio,
          referenceSha256: createHash('sha256').update(reference).digest('hex'),
          candidateSha256: createHash('sha256').update(candidate).digest('hex'),
        });
      }
    }
  } finally {
    referenceServer.close();
  }
  // Real data and the declared differences make pixel equality impossible by
  // design; this produces review evidence, it does not pass a threshold.
  assert.equal(report.visual.length, 6);
});

test('A11Y: no serious or critical WCAG 2.1 AA violations on the new surfaces', () => {
  const blocking = Object.entries(report.accessibility).flatMap(([surface, violations]) =>
    violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => ({ surface, ...v })),
  );
  assert.deepEqual(blocking, [], JSON.stringify(blocking, null, 2));
});
