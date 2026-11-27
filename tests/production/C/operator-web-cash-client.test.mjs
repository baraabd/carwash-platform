/**
 * Operator cash orchestration over the actual TypeScript source, with a fetch
 * double. Proves separate authorities, stable retry bodies and current receipt
 * verification; database and browser evidence are separate suites.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(import.meta.url);
const ts = require(path.join(root, 'node_modules/typescript'));
const { apiError, API_ERROR_STATUS } = require(path.join(root, 'packages/contracts/dist/common'));
let temporary;
let api;
let model;
let client;
before(() => {
  temporary = mkdtempSync(path.join(tmpdir(), 'operator-cash-client-'));
  writeFileSync(path.join(temporary, 'package.json'), '{"type":"commonjs"}');
  symlinkSync(
    path.join(root, 'apps/operator-web/node_modules'),
    path.join(temporary, 'node_modules'),
    'dir',
  );
  const source = path.join(root, 'apps/operator-web/src');
  const compile = (directory, relative = '') => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const next = path.join(relative, entry.name);
      if (entry.isDirectory()) compile(path.join(directory, entry.name), next);
      else if (entry.name.endsWith('.ts')) {
        const output = path.join(temporary, next.replace(/\.ts$/, '.js'));
        mkdirSync(path.dirname(output), { recursive: true });
        writeFileSync(
          output,
          ts.transpileModule(readFileSync(path.join(directory, entry.name), 'utf8'), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
          }).outputText,
        );
      }
    }
  };
  compile(source);
  api = require(path.join(temporary, 'api/operator-api.js'));
  model = require(path.join(temporary, 'model.js'));
  client = require(path.join(temporary, 'api/client.js'));
});
after(() => rmSync(temporary, { recursive: true, force: true }));

const amount = { currency: 'SYP', amountMinor: '105000', scale: 2 };
const at = '2026-11-22T09:00:00.000Z';
function job() {
  return {
    taskId: randomUUID(),
    bookingId: randomUUID(),
    assignmentId: randomUUID(),
    revision: 8,
    stage: 'FINISHED',
    collection: null,
    startsAt: at,
    endsAt: at,
  };
}
function funding(task, financialSource = 'DIRECT') {
  return {
    bookingId: task.bookingId,
    paymentMethod: 'CASH_ON_COMPLETION',
    financialSource,
    total: amount,
  };
}
function bookingView(task, financialSource = 'DIRECT') {
  return {
    ...funding(task, financialSource),
    revision: 1,
    status: 'CONFIRMED',
    slot: { zoneId: randomUUID(), startsAt: at, endsAt: '2026-11-22T10:00:00.000Z' },
    vehicle: { type: 'sedan', make: null, model: null, color: null, plate: null },
    address: { location: { mode: 'manual', description: 'عنوان اختبار' }, details: null },
    contact: { name: 'عميل اختبار', phone: '+963900000001', notes: null },
    lines: [
      { lineId: randomUUID(), kind: 'PACKAGE', definitionId: randomUUID(), quantity: 1, amount },
    ],
  };
}
function target(task, overrides = {}) {
  return {
    bookingId: task.bookingId,
    obligationId: randomUUID(),
    revision: 2,
    amountDue: amount,
    receipt: null,
    ...overrides,
  };
}
function receipt(target, task) {
  return {
    receiptId: randomUUID(),
    revision: 1,
    obligationId: target.obligationId,
    bookingId: target.bookingId,
    assignmentId: task.assignmentId,
    assignmentRevision: 2,
    collector: randomUUID(),
    amount,
    custodyStatus: 'HELD',
    handoverId: null,
    collectedAt: at,
    updatedAt: at,
    reversal: null,
  };
}
function recorded(pending, committed) {
  return {
    receipt: committed,
    obligation: {
      obligationId: pending.obligationId,
      revision: 3,
      financialStatus: 'CASH_COLLECTED',
      amount,
      verified: amount,
      outstanding: { ...amount, amountMinor: '0' },
      method: 'CASH_ON_COMPLETION',
    },
  };
}
const activeTarget = (pending, committed) => ({
  ...pending,
  revision: 3,
  amountDue: { ...amount, amountMinor: '0' },
  receipt: committed,
});
const json = (body, status = 200) =>
  new globalThis.Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
const gatewayError = (code) =>
  json(
    apiError(code, 'The request could not be completed.', {
      requestId: randomUUID(),
      correlationId: randomUUID(),
    }),
    API_ERROR_STATUS[code],
  );

function network(t, handler) {
  const originalFetch = globalThis.fetch;
  const originalDocument = globalThis.document;
  const requests = [];
  globalThis.document = { cookie: 'wg_csrf=fixture-csrf' };
  globalThis.fetch = async (url, init) => {
    const request = {
      path: String(url),
      method: init.method,
      key: init.headers['idempotency-key'],
      body: init.body ? JSON.parse(init.body) : null,
      init,
    };
    requests.push(request);
    return handler(request, requests.length);
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  });
  return requests;
}

test('cash close requires Dispatch declaration, separate Billing command and a fresh bound receipt', async (t) => {
  const task = job();
  const pending = target(task);
  const committed = receipt(pending, task);
  const responses = [{}, pending, recorded(pending, committed), activeTarget(pending, committed)];
  const requests = network(t, (_, n) => json(responses[n - 1], n === 3 ? 201 : 200));
  const key = randomUUID();
  const result = await api.sendMutation(api.M.closeCollected(task, amount, funding(task)), key);
  assert.equal(result.kind, 'ok');
  assert.deepEqual(result.value, committed);
  assert.deepEqual(
    requests.map((r) => r.method),
    ['POST', 'GET', 'POST', 'GET'],
  );
  assert.equal(requests[0].key, key);
  assert.equal(requests[2].key, `${key}_billing`);
  assert.match(requests[2].path, /\/obligations\/[^/]+\/cash-collections$/);
  assert.deepEqual(requests[2].body, { expectedRevision: 2, bookingId: task.bookingId, amount });
  assert.equal(requests[2].init.headers['x-csrf-token'], 'fixture-csrf');
  assert.equal(requests[2].init.headers.authorization, undefined);
});

test('a lost financial response restores the current receipt without creating another collection', async (t) => {
  const task = job();
  const pending = target(task);
  const committed = receipt(pending, task);
  let saved = false;
  let writes = 0;
  network(t, (request) => {
    if (request.path.endsWith('/close')) return json({});
    if (request.method === 'GET') return json(saved ? activeTarget(pending, committed) : pending);
    writes++;
    saved = true;
    throw new Error('LOST_AFTER_COMMIT');
  });
  const request = api.M.closeCollected(task, amount, funding(task));
  const key = randomUUID();
  assert.equal((await api.sendMutation(request, key)).kind, 'unknown');
  assert.equal((await api.sendMutation(request, key)).kind, 'ok');
  assert.equal(writes, 1);
});

test('an unknown financial write retries the exact body and the same financial key', async (t) => {
  const task = job();
  const pending = target(task);
  const committed = receipt(pending, task);
  let writes = 0;
  const requests = network(t, (request) => {
    if (request.path.endsWith('/close')) return json({});
    if (request.method === 'GET')
      return json(writes > 1 ? activeTarget(pending, committed) : pending);
    if (++writes === 1) throw new Error('LOST_BEFORE_COMMIT');
    return json(recorded(pending, committed), 201);
  });
  const request = api.M.closeCollected(task, amount, funding(task));
  const key = randomUUID();
  assert.equal((await api.sendMutation(request, key)).kind, 'unknown');
  assert.equal((await api.sendMutation(request, key)).kind, 'ok');
  const billing = requests.filter((r) => r.path.endsWith('/cash-collections'));
  assert.equal(billing.length, 2);
  assert.equal(billing[0].key, billing[1].key);
  assert.deepEqual(billing[0].body, billing[1].body);
});

test('normative ambiguous Gateway errors preserve unknown mutation outcome while auth and conflicts stay explicit', async (t) => {
  let code;
  network(t, () => gatewayError(code));
  for (code of ['UPSTREAM_TIMEOUT', 'UPSTREAM_INVALID', 'OUTCOME_UNKNOWN', 'INTERNAL_ERROR']) {
    assert.equal(
      apiError(code, 'failure', { requestId: 'test', correlationId: 'test' }).error.retryable,
      false,
    );
    const result = await client.call({
      method: 'POST',
      path: '/api/operator/tasks/test/close',
      body: {},
      idempotencyKey: randomUUID(),
      parse: null,
    });
    assert.equal(result.kind, 'unknown', code);
  }
  for (code of ['AUTH_REQUIRED', 'AUTH_FORBIDDEN', 'REVISION_CONFLICT', 'REVISION_REQUIRED']) {
    const result = await client.call({
      method: 'POST',
      path: '/api/operator/tasks/test/close',
      body: {},
      idempotencyKey: randomUUID(),
      parse: null,
    });
    assert.equal(result.kind, 'error', code);
    assert.equal(result.status, API_ERROR_STATUS[code]);
    assert.equal(result.code, code);
    assert.equal(result.retryable, false);
  }
  code = 'UPSTREAM_UNAVAILABLE';
  const unavailable = await client.call({
    method: 'POST',
    path: '/api/operator/tasks/test/close',
    body: {},
    idempotencyKey: randomUUID(),
    parse: null,
  });
  assert.equal(unavailable.kind, 'error');
  assert.equal(unavailable.retryable, true);
});

test('a post-commit target timeout keeps the pending financial request until its current receipt is recovered', async (t) => {
  const task = job();
  const pending = target(task);
  const committed = receipt(pending, task);
  let reads = 0;
  let writes = 0;
  network(t, (request) => {
    if (request.path.endsWith('/close')) return json({});
    if (request.method === 'GET') {
      reads++;
      if (reads === 2) return gatewayError('UPSTREAM_TIMEOUT');
      return json(writes ? activeTarget(pending, committed) : pending);
    }
    writes++;
    return json(recorded(pending, committed), 201);
  });
  const request = api.M.closeCollected(task, amount, funding(task));
  const key = randomUUID();
  const uncertain = await api.sendMutation(request, key);
  assert.equal(uncertain.kind, 'unknown');
  assert.equal(uncertain.cause, 'timeout');
  const restored = await api.sendMutation(request, key);
  assert.equal(restored.kind, 'ok');
  assert.equal(restored.value.receiptId, committed.receiptId);
  assert.equal(writes, 1);
});

test('a historical successful replay followed by reversal is never shown as current collected cash', async (t) => {
  const task = job();
  const pending = target(task);
  const original = receipt(pending, task);
  let reads = 0;
  let writes = 0;
  network(t, (request) => {
    if (request.path.endsWith('/close')) return json({});
    if (request.method === 'GET')
      return json(++reads === 1 ? pending : { ...pending, revision: 4 });
    writes++;
    return json(recorded(pending, original), 201);
  });
  const result = await api.sendMutation(
    api.M.closeCollected(task, amount, funding(task)),
    randomUUID(),
  );
  assert.equal(result.kind, 'error');
  assert.equal(result.code, 'CASH_RECEIPT_NOT_ACTIVE');
  assert.equal(result.retryable, false);
  assert.equal(writes, 1, 'no automatic recollection after reversal');
});

test('a newer revision without a receipt never replaces a pending financial request body', async (t) => {
  const task = job();
  const pending = target(task);
  let lost = false;
  let writes = 0;
  network(t, (request) => {
    if (request.path.endsWith('/close')) return json({});
    if (request.method === 'GET') return json(lost ? { ...pending, revision: 4 } : pending);
    writes++;
    lost = true;
    throw new Error('LOST_RESPONSE_THEN_REVERSED');
  });
  const request = api.M.closeCollected(task, amount, funding(task));
  const key = randomUUID();
  assert.equal((await api.sendMutation(request, key)).kind, 'unknown');
  const retry = await api.sendMutation(request, key);
  assert.equal(retry.kind, 'error');
  assert.equal(retry.code, 'CASH_RECEIPT_NOT_ACTIVE');
  assert.equal(writes, 1, 'same key is never repurposed for a new expectedRevision');
});

test('recovery of an already declared CLOSED task skips a duplicate Dispatch late declaration', async (t) => {
  const task = {
    ...job(),
    stage: 'CLOSED',
    collection: { outcome: 'CASH_COLLECTED', amount, lateAmount: null },
  };
  const pending = target(task);
  const committed = receipt(pending, task);
  let saved = false;
  const requests = network(t, (request) => {
    assert.ok(!request.path.includes('/tasks/'));
    if (request.method === 'GET') return json(saved ? activeTarget(pending, committed) : pending);
    saved = true;
    return json(recorded(pending, committed), 201);
  });
  assert.equal(
    (await api.sendMutation(api.M.lateCash(task, amount, funding(task)), randomUUID())).kind,
    'ok',
  );
  assert.deepEqual(
    requests.map((r) => r.method),
    ['GET', 'POST', 'GET'],
  );
});

test('Billing unavailable or a foreign receipt leaves collection unconfirmed despite Dispatch completion', async (t) => {
  const task = {
    ...job(),
    stage: 'CLOSED',
    collection: { outcome: 'CASH_COLLECTED', amount, lateAmount: null },
  };
  network(t, (request) =>
    request.method === 'GET'
      ? json({ error: { code: 'UPSTREAM_UNAVAILABLE', reason: null, retryable: true } }, 503)
      : json({}),
  );
  const result = await api.sendMutation(api.M.lateCash(task, amount, funding(task)), randomUUID());
  assert.equal(result.kind, 'error');
  assert.equal(result.status, 503);
  const booking = funding(task);
  const jobs = model.buildJobs([], [task], new Map([[task.bookingId, booking]]));
  assert.equal(model.collected(jobs[0]), false);
  const pending = target(task);
  const foreign = receipt({ ...pending, bookingId: randomUUID() }, task);
  assert.equal(model.collected({ ...jobs[0], cashReceipt: foreign }), false);
});

test('a malformed target is UNKNOWN and cannot trigger a cash command', async (t) => {
  const task = job();
  let writes = 0;
  network(t, (request) => {
    if (request.path.endsWith('/close')) return json({});
    if (request.method === 'GET') return json(target(task, { bookingId: randomUUID() }));
    writes++;
    return json({});
  });
  const result = await api.sendMutation(
    api.M.closeCollected(task, amount, funding(task)),
    randomUUID(),
  );
  assert.equal(result.kind, 'unknown');
  assert.equal(result.cause, 'shape');
  assert.equal(writes, 0);
});

test('Booking funding is required and bound to the requested booking before financial choices', async (t) => {
  const parse = require(path.join(temporary, 'api/parse.js'));
  const task = job();
  const covered = bookingView(task, 'SUBSCRIPTION');
  assert.equal(parse.parseBooking(covered).financialSource, 'SUBSCRIPTION');
  const missing = { ...covered };
  delete missing.financialSource;
  assert.throws(() => parse.parseBooking(missing), /SHAPE/);
  assert.throws(() => parse.parseBooking({ ...covered, financialSource: 'PAID' }), /SHAPE/);
  network(t, () => json({ ...covered, bookingId: randomUUID() }));
  const result = await api.readBooking(task.bookingId);
  assert.equal(result.kind, 'unknown');
  assert.equal(result.cause, 'shape');
});

test('subscription coverage cannot construct cash close, failed collection or late collection commands', () => {
  const task = job();
  const covered = funding(task, 'SUBSCRIPTION');
  assert.throws(() => api.M.closeCollected(task, amount, covered), /CASH_NOT_APPLICABLE/);
  assert.throws(() => api.M.closeNotCollected(task, 'reason', covered), /CASH_NOT_APPLICABLE/);
  assert.throws(() => api.M.lateCash(task, amount, covered), /CASH_NOT_APPLICABLE/);
  assert.throws(() => api.M.closeCollected(task, amount, null), /FUNDING_UNVERIFIED/);
  assert.throws(() => api.M.closeNotCash(task, null), /FUNDING_UNVERIFIED/);
  assert.throws(() => api.M.closeNotCash(task, funding(task)), /NON_CASH_FUNDING_REQUIRED/);
  assert.throws(
    () => api.M.closeCollected(task, amount, { ...funding(task), bookingId: randomUUID() }),
    /FUNDING_UNVERIFIED/,
  );
});

test('subscription delivery sends only Dispatch NOT_CASH and never requests or writes a Billing receipt', async (t) => {
  const task = job();
  const requests = network(t, (request) => {
    assert.equal(request.path, `/api/operator/tasks/${task.taskId}/close`);
    return json({});
  });
  const request = api.M.closeNotCash(task, funding(task, 'SUBSCRIPTION'));
  assert.equal(Object.hasOwn(request, 'cashReceipt'), false);
  assert.equal((await api.sendMutation(request, randomUUID())).kind, 'ok');
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].body, {
    expectedRevision: task.revision,
    collection: { outcome: 'NOT_CASH' },
  });
});

test('subscription views show coverage without cash controls, wallet verification or payment completion', () => {
  const views = require(path.join(temporary, 'views/task.js'));
  const common = require(path.join(temporary, 'views/common.js'));
  const sheets = require(path.join(temporary, 'views/sheets.js'));
  const state = require(path.join(temporary, 'state.js')).S;
  const task = {
    ...job(),
    evidence: { BEFORE: [null, null], AFTER: [null, null] },
    notes: [],
    history: [],
  };
  const booking = bookingView(task, 'SUBSCRIPTION');
  const [handoff] = model.buildJobs([], [task], new Map([[task.bookingId, booking]]));
  assert.equal(model.method(handoff), 'subscription');
  assert.equal(model.outstanding(handoff), false);
  assert.equal(model.collected(handoff), false);
  assert.equal(model.walletVerified(handoff), false);
  assert.equal(sheets.cashSheet(handoff), null);
  state.jobs = [handoff];
  state.selectedId = handoff.id;
  const markup = [
    views.handoff(handoff),
    common.paymentSummary(handoff),
    common.paymentPill(handoff),
    sheets.handoffSheet(handoff).body,
    views.renderTaskDock(),
  ].join('');
  assert.match(markup, /مغطى بالاشتراك/);
  assert.doesNotMatch(
    markup,
    /data-action="(?:cash-dialog|cash-issue|cash-confirm|payment-followup)"/,
  );
  assert.doesNotMatch(markup, /المبلغ المطلوب|المبلغ المستحق|قيد المراجعة|تم التحصيل|معتمد/);
  const closedTask = { ...task, stage: 'CLOSED', collection: { outcome: 'NOT_CASH' } };
  const [closed] = model.buildJobs([], [closedTask], new Map([[task.bookingId, booking]]));
  assert.equal(model.collected({ ...closed, cashReceipt: receipt(target(task), task) }), false);
  const completed = views.completed(closed);
  assert.match(completed, /اكتملت المهمة/);
  assert.match(completed, /مغطى بالاشتراك · لا تحصيل إضافي/);
  assert.doesNotMatch(completed, /تم التحصيل|معتمد|قيد المراجعة|تسجيل تحصيل لاحق/);
  state.jobs = [];
  state.selectedId = null;
});
