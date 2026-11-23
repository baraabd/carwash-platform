/** Exact source client boundaries; real ownership and browser recovery have separate suites. */
/* global Response -- Node 24 web globals */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { registerHooks } from 'node:module';

const sourceRoot = new URL('../src/', import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      context.parentURL?.startsWith(sourceRoot) &&
      /^\.\.?\//.test(specifier) &&
      !/\.[a-z]+$/i.test(specifier)
    )
      return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  },
});
after(() => hooks.deregister());
const { readStatementCredit } = await import('../src/api/statement-credit.ts');
const { allocateStatementCredit } = await import('../src/api/finance.ts');

const amount = { currency: 'SYP', amountMinor: '150000', scale: 2 };
const candidate = () => ({
  attemptId: randomUUID(),
  obligationId: randomUUID(),
  obligationRevision: 3,
  creditId: randomUUID(),
  creditRevision: 1,
  provider: 'SHAM_CASH',
  status: 'PENDING_APPROVAL',
  amount,
  merchantAccount: '…sham',
  reference: '…A123',
  evidenceFingerprint: 'abcdef012345',
  occurredAt: '2026-11-22T09:00:00.000Z',
  recordedAt: '2026-11-22T09:01:00.000Z',
});

test('statement selector is a credentialled read of this exact attempt, exposing masked facts only', async (t) => {
  const record = candidate();
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    return Response.json(record);
  });
  const result = await readStatementCredit(record.attemptId);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, record);
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    `/api/v1/admin/billing/payment-attempts/${record.attemptId}/statement-credit`,
  );
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.credentials, 'same-origin');
  assert.equal(calls[0].options.body, undefined);
});

test('wrong-attempt, unmasked, consumed, zero-value and invalid-version statement records fail closed', async (t) => {
  const record = candidate();
  let body = record;
  t.mock.method(globalThis, 'fetch', async () => Response.json(body));
  for (const invalid of [
    { attemptId: randomUUID() },
    { merchantAccount: 'unmasked-merchant' },
    { reference: 'UNMASKED123' },
    { evidenceFingerprint: 'not-an-evidence-digest' },
    { status: 'ALLOCATED' },
    { creditRevision: 0 },
    { obligationRevision: 0 },
    { amount: { ...amount, amountMinor: '0' } },
    { recordedAt: '2026-11-22T08:00:00.000Z' },
  ]) {
    body = { ...record, ...invalid };
    const result = await readStatementCredit(record.attemptId);
    assert.equal(result.ok, false, JSON.stringify(invalid));
    assert.equal(result.failure, 'MALFORMED', JSON.stringify(invalid));
  }
});

test('allocation sends the selected credit and both revisions with the same key after an uncertain response', async (t) => {
  const record = candidate();
  const previousDocument = globalThis.document;
  globalThis.document = { cookie: 'wg_csrf=statement-test-csrf' };
  t.after(() => {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  });
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) throw new TypeError('response lost after commit');
    return Response.json({
      obligationId: record.obligationId,
      revision: 4,
      status: 'SETTLED',
      financialStatus: 'PAID',
      amount,
      verified: amount,
      outstanding: { ...amount, amountMinor: '0' },
      activeIntent: null,
      attempts: [],
      updatedAt: record.recordedAt,
    });
  });
  const command = {
    attemptId: record.attemptId,
    creditId: record.creditId,
    expectedCreditRevision: record.creditRevision,
    expectedRevision: record.obligationRevision,
    observedAmount: amount,
    key: randomUUID(),
  };
  const unknown = await allocateStatementCredit(command);
  assert.equal(unknown.ok, false);
  assert.equal(unknown.failure, 'UNKNOWN_OUTCOME');
  const completed = await allocateStatementCredit(command);
  assert.equal(completed.ok, true);
  assert.equal(completed.value.financialStatus, 'PAID');
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(
      call.url,
      `/api/v1/admin/billing/payment-attempts/${record.attemptId}/statement-credit-allocation`,
    );
    assert.equal(call.options.method, 'POST');
    assert.equal(call.options.headers['idempotency-key'], command.key);
    assert.equal(call.options.headers['x-csrf-token'], 'statement-test-csrf');
    assert.deepEqual(JSON.parse(call.options.body), {
      creditId: record.creditId,
      expectedCreditRevision: 1,
      expectedRevision: 3,
      observedAmount: amount,
    });
  }
});
