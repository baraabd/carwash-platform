import test from 'node:test';
import assert from 'node:assert/strict';
import { ProductionMembership } from '../src/data/productionMembership.ts';
import {
  id,
  later,
  money,
  session as guestSession,
  response,
  error,
} from './support/journey-fixture.mjs';
import {
  session,
  principal,
  plan,
  quote,
  purchase,
  subscription,
  obligation,
  page,
  harness,
} from './support/membership-fixture.mjs';

const select = async (h) => {
  await h.client.loadPlans();
  assert.equal(await h.client.choosePlan(id(90)), true);
};

const expired = () => ({
  ...subscription(),
  status: 'EXPIRED',
  startsAt: '2026-10-01T08:00:00.000Z',
  expiresAt: '2026-11-01T08:00:00.000Z',
  periodNo: 2,
  renewalAvailable: true,
});

const selectRenewal = async (h) => {
  h.state.subscription = expired();
  await h.client.loadPlans();
  await h.client.loadSubscriptions();
  assert.equal(await h.client.chooseRenewal(id(94)), true);
};

test('renewal quotes a new purchase bound to the owned expired subscription and exact next period', async () => {
  const h = harness();
  await selectRenewal(h);
  const before = h.client.getSnapshot().subscriptions[0];
  assert.equal(await h.client.purchase('SYRIATEL_CASH'), true);
  const command = h.requests.find((r) => r.path.endsWith('/renewals'));
  assert.equal(command.path, `/api/v1/customer/subscriptions/${id(94)}/renewals`);
  assert.equal(command.body.expectedRevision, before.revision);
  assert.equal(command.body.planVersion, plan().version);
  assert.equal(command.body.quoteId, quote().quoteId);
  assert.deepEqual(h.client.getSnapshot().purchase.renewalOf, {
    subscriptionId: id(94),
    periodNo: 3,
  });
  assert.equal(h.client.getSnapshot().purchase.status, 'PENDING_PAYMENT');
  assert.deepEqual(
    h.client.getSnapshot().subscriptions[0],
    before,
    'purchase cannot extend expiry or grant units locally',
  );
  assert.equal(
    h.requests.some((r) => r.path.endsWith('/subscription-purchases')),
    false,
  );
});

test('renewal requires the current owner eligibility and cannot renew an active or foreign subscription', async () => {
  for (const candidate of [subscription(), { ...expired(), renewalAvailable: false }]) {
    const h = harness();
    h.state.subscription = candidate;
    await h.client.loadPlans();
    await h.client.loadSubscriptions();
    assert.equal(await h.client.chooseRenewal(id(94)), false);
    assert.equal(await h.client.chooseRenewal(id(99)), false);
    assert.equal(
      h.requests.some((r) => r.method === 'POST'),
      false,
    );
  }
});

test('wrong renewal target or period remains unresolved and retries the identical renewal command', async () => {
  for (const renewalOf of [
    null,
    { subscriptionId: id(99), periodNo: 3 },
    { subscriptionId: id(94), periodNo: 2 },
  ]) {
    const h = harness();
    await selectRenewal(h);
    h.state.override = (r) =>
      r.path.endsWith('/renewals') ? response({ ...purchase(), renewalOf }, 201) : null;
    assert.equal(await h.client.purchase('SHAM_CASH'), false);
    assert.equal(h.client.getSnapshot().pending, 'purchase');
    assert.equal(h.client.getSnapshot().purchase, null);
    h.state.override = null;
    await h.client.retryPending();
    assert.equal(h.client.getSnapshot().pending, null);
    assert.deepEqual(h.client.getSnapshot().purchase.renewalOf, {
      subscriptionId: id(94),
      periodNo: 3,
    });
    const commands = h.requests.filter((r) => r.path.endsWith('/renewals'));
    assert.deepEqual(commands[0].body, commands[1].body);
    assert.equal(commands[0].headers['idempotency-key'], commands[1].headers['idempotency-key']);
  }
});

test('lost renewal response recovers the owner period by opaque request without another purchase', async () => {
  const h = harness();
  await selectRenewal(h);
  h.state.override = (r) => {
    if (r.path.endsWith('/renewals')) {
      h.state.byRequest.set(r.headers['idempotency-key'], {
        ...purchase(),
        renewalOf: { subscriptionId: id(94), periodNo: 3 },
      });
      throw new Error('lost renewal receipt');
    }
    return null;
  };
  assert.equal(await h.client.purchase('SHAM_CASH'), false);
  const reloaded = new ProductionMembership(h.options);
  reloaded.bindSession(session);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(reloaded.getSnapshot().purchase.renewalOf, {
    subscriptionId: id(94),
    periodNo: 3,
  });
  assert.equal(reloaded.getSnapshot().unknownPurchaseKey, null);
  assert.equal(h.requests.filter((r) => r.path.endsWith('/renewals')).length, 1);
});

test('membership plans are anonymous owner data; guests cannot quote, buy or see subscriptions', async () => {
  const h = harness();
  h.client.bindSession(guestSession);
  await h.client.loadPlans();
  await h.client.loadSubscriptions();
  assert.equal(h.requests[0].credentials, 'omit');
  assert.equal(await h.client.choosePlan(id(90)), false);
  assert.equal(h.requests.length, 1);
  h.state.override = () => error(503, 'DEPENDENCY_UNAVAILABLE');
  await h.client.loadPlans();
  assert.equal(h.client.getSnapshot().plansStatus, 'unavailable');
  assert.deepEqual(h.client.getSnapshot().plans, []);
});

test('subscription purchase binds immutable plan and Pricing total, not advertised client amount; never locally activates', async () => {
  const h = harness();
  await select(h);
  assert.equal(await h.client.purchase('SHAM_CASH'), true);
  const request = h.requests.find((r) => r.path.endsWith('/subscription-purchases'));
  assert.deepEqual(request.body, {
    planId: id(90),
    planVersion: 3,
    quoteId: id(92),
    total: money('490200'),
    paymentMethod: 'SHAM_CASH',
  });
  assert.notEqual(request.body.total.amountMinor, plan().price.amountMinor);
  assert.equal(h.client.getSnapshot().purchase.status, 'PENDING_PAYMENT');
  assert.equal(h.client.getSnapshot().purchase.subscriptionId, null);
  assert.equal(
    h.requests.some((r) =>
      r.path.split('/').some((segment) => ['entitlements', 'payments'].includes(segment)),
    ),
    false,
  );
  assert.deepEqual(h.storage.get(session.subject), { pendingKey: null, purchaseId: id(93) });
});

test('expired or foreign quote cannot create a membership purchase', async () => {
  const h = harness();
  await select(h);
  h.state.now = Date.parse(later);
  assert.equal(await h.client.purchase('SHAM_CASH'), false);
  assert.equal(
    h.requests.some((r) => r.path.endsWith('/subscription-purchases')),
    false,
  );
  const foreign = harness();
  await foreign.client.loadPlans();
  foreign.state.override = (r) =>
    r.path.endsWith('/subscription-quotes')
      ? response({ ...quote(), beneficiary: { ...principal, subjectId: id(99) } })
      : null;
  assert.equal(await foreign.client.choosePlan(id(90)), false);
  assert.equal(foreign.client.getSnapshot().quote, null);
  assert.equal(
    foreign.client.getSnapshot().pending,
    'quote',
    'unreadable accepted write stays ambiguous',
  );
});

test('lost purchase receipt retries the same command and key; opaque reload recovery never repeats POST', async () => {
  const h = harness();
  await select(h);
  let lost = true;
  h.state.override = (r) => {
    if (r.path.endsWith('/subscription-purchases') && r.method === 'POST' && lost) {
      h.state.byRequest.set(r.headers['idempotency-key'], purchase());
      lost = false;
      throw new Error('lost persisted response');
    }
    return null;
  };
  assert.equal(await h.client.purchase('SHAM_CASH'), false);
  assert.equal(h.client.getSnapshot().pending, 'purchase');
  const persisted = h.storage.get(session.subject);
  assert.deepEqual(Object.keys(persisted).sort(), ['pendingKey', 'purchaseId']);
  assert.match(persisted.pendingKey, /^member_request_/);
  assert.equal(JSON.stringify(persisted).includes('490200'), false);
  const reloaded = new ProductionMembership(h.options);
  reloaded.bindSession(session);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(reloaded.getSnapshot().purchase.status, 'PENDING_PAYMENT');
  assert.equal(reloaded.getSnapshot().unknownPurchaseKey, null);
  assert.equal(
    h.requests.filter((r) => r.path.endsWith('/subscription-purchases') && r.method === 'POST')
      .length,
    1,
  );
  await h.client.retryPending();
  const calls = h.requests.filter(
    (r) => r.path.endsWith('/subscription-purchases') && r.method === 'POST',
  );
  assert.deepEqual(calls[0].body, calls[1].body);
  assert.equal(calls[0].headers['idempotency-key'], calls[1].headers['idempotency-key']);
});

test('a missing ambiguous purchase does not unlock a second checkout', async () => {
  const h = harness();
  await select(h);
  h.state.override = (r) => {
    if (r.path.endsWith('/subscription-purchases')) throw new Error('socket closed');
    return null;
  };
  await h.client.purchase('SHAM_CASH');
  await h.client.recoverPurchase();
  assert.ok(h.client.getSnapshot().unknownPurchaseKey);
  assert.equal(await h.client.purchase('SYRIATEL_CASH'), false);
  assert.equal(await h.client.choosePlan(id(90)), false);
  assert.equal(h.requests.filter((r) => r.path.endsWith('/subscription-purchases')).length, 1);
});

test('wrong owner, plan version or total in an accepted purchase receipt remains unknown', async () => {
  for (const corrupt of [
    (p) => ({ ...p, beneficiary: { ...principal, subjectId: id(99) } }),
    (p) => ({ ...p, planVersion: 2 }),
    (p) => ({ ...p, total: money('1') }),
  ]) {
    const h = harness();
    await select(h);
    h.state.override = (r) =>
      r.path.endsWith('/subscription-purchases') ? response(corrupt(purchase()), 201) : null;
    assert.equal(await h.client.purchase('SHAM_CASH'), false);
    assert.equal(h.client.getSnapshot().purchase, null);
    assert.equal(h.client.getSnapshot().pending, 'purchase');
  }
});

test('membership transfer reference is only a claim; owner review does not activate or credit units', async () => {
  const h = harness();
  await h.client.loadPurchase(id(93));
  assert.equal(await h.client.submitReference('TRANSFER-1234'), true);
  assert.equal(h.client.getSnapshot().obligation.financialStatus, 'UNDER_REVIEW');
  assert.equal(h.client.getSnapshot().obligation.verified.amountMinor, '0');
  assert.equal(h.client.getSnapshot().purchase.status, 'PENDING_PAYMENT');
  assert.deepEqual(h.client.getSnapshot().subscriptions, []);
  const request = h.requests.find((r) => r.path.endsWith('/transaction-reference'));
  assert.deepEqual(request.body, { expectedRevision: 2, providerReference: 'TRANSFER-1234' });
  assert.equal(await h.client.submitReference('SECOND-1234'), false);
  h.state.purchase = { ...purchase(), status: 'ACTIVATED', revision: 3, subscriptionId: id(94) };
  await h.client.loadPurchase(id(93));
  assert.equal(
    h.client.getSnapshot().purchase.status,
    'ACTIVATED',
    'only the canonical owner read activates',
  );
});

test('freeze request remains pending review and preserves paid expiry, units and status', async () => {
  const h = harness();
  await h.client.loadSubscriptions();
  assert.equal(await h.client.requestChange(id(94), 'FREEZE'), true);
  assert.equal(h.client.getSnapshot().change.status, 'PENDING_REVIEW');
  assert.deepEqual(h.client.getSnapshot().subscriptions[0], subscription());
  assert.deepEqual(h.requests.find((r) => r.path.endsWith('/changes')).body, {
    expectedRevision: 7,
    action: 'FREEZE',
    reason: 'CUSTOMER_REQUEST',
  });
});

test('identity replacement drops delayed private results and cannot recover another account storage', async () => {
  const h = harness();
  await h.client.loadPlans();
  let done;
  h.state.override = (r) =>
    r.path.endsWith('/subscription-quotes')
      ? new Promise((resolve) => {
          done = resolve;
        })
      : null;
  const pending = h.client.choosePlan(id(90));
  await new Promise((resolve) => setTimeout(resolve, 0));
  h.client.bindSession({ ...session, subject: id(99), sessionId: id(98) });
  done(response(quote()));
  await pending;
  assert.equal(h.client.getSnapshot().quote, null);
  assert.equal(h.client.getSnapshot().purchase, null);
  assert.equal(h.client.getSnapshot().principal.subjectId, id(99));
});

test('private subscription and financial reads reject foreign or inconsistent owner context', async () => {
  const h = harness();
  h.state.subscription = { ...subscription(), beneficiary: { ...principal, subjectId: id(99) } };
  await h.client.loadSubscriptions();
  assert.equal(h.client.getSnapshot().subscriptionsStatus, 'unavailable');
  assert.deepEqual(h.client.getSnapshot().subscriptions, []);
  h.state.obligation = { ...obligation(), quoteId: id(99) };
  await h.client.loadPurchase(id(93));
  assert.equal(h.client.getSnapshot().obligation, null);
  assert.equal(h.client.getSnapshot().purchase.status, 'PENDING_PAYMENT');
});

test('a pre-command refresh cannot overwrite the newer payment receipt', async () => {
  const h = harness();
  await h.client.loadPurchase(id(93));
  let done;
  h.state.override = (r) =>
    r.path === `/api/v1/customer/subscription-purchases/${id(93)}`
      ? new Promise((resolve) => {
          done = resolve;
        })
      : null;
  const staleRead = h.client.loadPurchase(id(93));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(await h.client.submitReference('TRANSFER-9999'), true);
  done(response(purchase()));
  await staleRead;
  assert.equal(h.client.getSnapshot().obligation.financialStatus, 'UNDER_REVIEW');
  assert.equal(h.client.getSnapshot().obligation.revision, 3);
});

test('duplicate public plan or owned subscription records are refused rather than rendered twice', async () => {
  const h = harness();
  h.state.override = (r) =>
    r.path.endsWith('/subscription-plans')
      ? response(page([plan(), plan()]))
      : response(page([subscription(), subscription()]));
  await h.client.loadPlans();
  await h.client.loadSubscriptions();
  assert.equal(h.client.getSnapshot().plansStatus, 'unavailable');
  assert.equal(h.client.getSnapshot().subscriptionsStatus, 'unavailable');
});
