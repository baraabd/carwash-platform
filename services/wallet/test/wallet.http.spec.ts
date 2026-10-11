import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { CustodyProjectionService } from '../src/application';
import { RandomIds, Sha256Hasher } from '../src/infrastructure/system/system.adapters';
import { BillingCustodyModel } from './support/billing-history';
import { SUBJECTS, TOKENS, startIdentityStub, type IdentityStub } from './support/identity-stub';
import { MemoryCustodyStore } from './support/memory-store';
import { startWalletHttp, type WalletHttpHarness } from './support/wallet-http-harness';

/*
 * HTTP authentication and object-access rules of the Wallet custody read API.
 * Real Nest transport and real Identity adapter against a local Identity
 * double; the store is the in-memory double (PostgreSQL has its own specs).
 */
const clock = { now: () => new Date('2026-10-11T09:00:00.000Z') };
let identity: IdentityStub;
let http: WalletHttpHarness;
const store = new MemoryCustodyStore();

before(async () => {
  identity = await startIdentityStub();
  http = await startWalletHttp({ store, identity, clock });
  const projection = new CustodyProjectionService({
    store,
    clock,
    hasher: new Sha256Hasher(),
    ids: new RandomIds(),
  });
  const model = new BillingCustodyModel();
  for (const [holder, minor] of [
    [SUBJECTS.technician, 150_000n],
    [SUBJECTS.technician, 50_000n],
    [SUBJECTS.otherTechnician, 9_900n],
  ] as const) {
    const e = model.collect(holder, 'SYP', minor);
    await projection.apply({ id: e.eventId, type: e.eventType, payload: e });
  }
});

after(async () => {
  await http.close();
  await identity.close();
});

const errorCode = (body: Record<string, unknown>) =>
  (body.error as { code?: string } | undefined)?.code;

test('http: a technician reads only their own custody projection', async () => {
  const reply = await http.get('/custody/holders/me', TOKENS.technician);
  assert.equal(reply.status, 200);
  assert.equal(reply.body.holder, SUBJECTS.technician);
  assert.equal(reply.body.authoritative, false);
  assert.equal(reply.body.authority, 'billing');
  assert.equal(reply.body.asOf, '2026-10-11T09:00:00.000Z');
  const [position] = reply.body.positions as Record<string, unknown>[];
  assert.deepEqual(position?.held, { currency: 'SYP', amountMinor: '200000', scale: 2 });
  assert.deepEqual(position?.outstanding, { currency: 'SYP', amountMinor: '200000', scale: 2 });
  assert.equal(position?.complete, true);
  assert.ok(!JSON.stringify(reply.body).includes(SUBJECTS.otherTechnician));
  assert.ok(!/PAID|paid/.test(JSON.stringify(reply.body)));
});

test('http: a technician cannot read another holder; Finance can', async () => {
  const denied = await http.get(`/custody/holders/${SUBJECTS.otherTechnician}`, TOKENS.technician);
  assert.equal(denied.status, 403);
  assert.equal(errorCode(denied.body), 'AUTH_FORBIDDEN');
  const finance = await http.get(`/custody/holders/${SUBJECTS.otherTechnician}`, TOKENS.finance);
  assert.equal(finance.status, 200);
  const [position] = finance.body.positions as Record<string, unknown>[];
  assert.deepEqual(position?.collected, { currency: 'SYP', amountMinor: '9900', scale: 2 });
  const empty = await http.get(`/custody/holders/${SUBJECTS.customer}`, TOKENS.finance);
  assert.deepEqual(empty.body.positions, []);
});

test('http: deny by default for guests, customers and Finance on /me', async () => {
  for (const token of [TOKENS.guestCollector, TOKENS.customer, TOKENS.finance]) {
    const reply = await http.get('/custody/holders/me', token);
    assert.equal(reply.status, 403, token);
  }
  const customer = await http.get(`/custody/holders/${SUBJECTS.technician}`, TOKENS.customer);
  assert.equal(customer.status, 403);
});

test('http: missing or unknown credentials are 401; Identity failure is 503, never a grant', async () => {
  assert.equal((await http.get('/custody/holders/me')).status, 401);
  assert.equal((await http.get('/custody/holders/me', 'not-a-jwt')).status, 401);
  assert.equal((await http.get('/custody/holders/me', TOKENS.unknown)).status, 401);
  identity.mode = 'error-500';
  try {
    const reply = await http.get('/custody/holders/me', TOKENS.technician);
    assert.equal(reply.status, 503);
    assert.equal(errorCode(reply.body), 'AUTH_UNAVAILABLE');
  } finally {
    identity.mode = 'normal';
  }
  identity.mode = 'hang';
  try {
    assert.equal((await http.get('/custody/holders/me', TOKENS.technician)).status, 503);
  } finally {
    identity.mode = 'normal';
  }
});

test('http: an invalid holder id is rejected after authorization', async () => {
  const reply = await http.get('/custody/holders/not-a-uuid', TOKENS.finance);
  assert.equal(reply.status, 400);
  assert.equal(errorCode(reply.body), 'REQUEST_INVALID');
  const unauth = await http.get('/custody/holders/not-a-uuid', TOKENS.technician);
  assert.equal(unauth.status, 403);
});
