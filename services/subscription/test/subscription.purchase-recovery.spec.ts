import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { subscriptionV1 } from '@carwash/contracts';
import { Money } from '../src/domain';
import type { IdempotencyReceipt, PurchaseRecord, SubscriptionRepository } from '../src/ports';
import {
  CUSTOMER_SUBJECT,
  OTHER_CUSTOMER_SUBJECT,
  FixedClock,
} from './support/subscription-fixtures';
import { startSubscriptionHttp, TOKENS } from './support/subscription-http-harness';

const operation = 'subscription.purchase.create.v1';

function fixture() {
  const key = randomUUID().replaceAll('-', '');
  const now = new Date('2026-11-27T10:00:00.000Z');
  const purchase: PurchaseRecord = {
    id: randomUUID(),
    customerSubject: CUSTOMER_SUBJECT,
    subscriptionId: randomUUID(),
    periodNo: 1,
    planId: randomUUID(),
    planVersion: 1,
    quoteId: randomUUID(),
    amount: Money.of('SYP', 600000n),
    paymentMethod: 'SHAM_CASH',
    status: 'ACTIVATED',
    revision: 3,
    obligationId: randomUUID(),
    createdAt: now,
    updatedAt: now,
  };
  const receipt: IdempotencyReceipt = {
    actorSubject: CUSTOMER_SUBJECT,
    operation,
    idempotencyKey: key,
    requestFingerprint: 'f'.repeat(64),
    outcome: { status: 201, body: { purchaseId: purchase.id, status: 'PENDING_PAYMENT' } },
  };
  const reads: Array<{ actor: string; operation: string; key: string }> = [];
  const records = new Map([[purchase.id, purchase]]);
  // Narrow repository double for the real HTTP/Identity boundary. Durable
  // receipt creation, cross-replica recovery and activation run in PostgreSQL.
  const repository = {
    findReceipt: (actor: string, requestedOperation: string, requestedKey: string) => {
      reads.push({ actor, operation: requestedOperation, key: requestedKey });
      return Promise.resolve(
        actor === receipt.actorSubject &&
          requestedOperation === receipt.operation &&
          requestedKey === receipt.idempotencyKey
          ? receipt
          : null,
      );
    },
    purchase: (id: string) => Promise.resolve(records.get(id) ?? null),
  } as unknown as SubscriptionRepository;
  return { key, now, purchase, receipt, reads, records, repository };
}

test('purchase recovery reads the account-scoped receipt and returns current state after a reload', async () => {
  const f = fixture();
  const h = await startSubscriptionHttp({ repository: f.repository, clock: new FixedClock(f.now) });
  try {
    const response = await h.request(
      'GET',
      `/internal/v1/subscription/purchases/by-request/${f.key}`,
      { token: TOKENS.customer },
    );
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const actual = subscriptionV1.parsePurchaseV1(response.body);
    assert.equal(actual.purchaseId, f.purchase.id);
    assert.equal(actual.status, 'ACTIVATED', 'a creation receipt is not current financial state');
    assert.equal(actual.subscriptionId, f.purchase.subscriptionId);
    assert.equal(actual.obligationId, f.purchase.obligationId);
    assert.deepEqual(f.reads, [{ actor: CUSTOMER_SUBJECT, operation, key: f.key }]);
  } finally {
    await h.close();
  }
});

test('purchase recovery rejects anonymous/guest requests and never enumerates another account receipt', async () => {
  const f = fixture();
  const h = await startSubscriptionHttp({ repository: f.repository, clock: new FixedClock(f.now) });
  const path = `/internal/v1/subscription/purchases/by-request/${f.key}`;
  try {
    assert.equal((await h.request('GET', path)).status, 401);
    assert.equal((await h.request('GET', path, { token: TOKENS.guest })).status, 403);
    assert.equal(
      (
        await h.request('GET', '/internal/v1/subscription/purchases/by-request/short', {
          token: TOKENS.customer,
        })
      ).status,
      400,
    );
    assert.equal(f.reads.length, 0, 'authority and key checks precede persistence');
    assert.equal((await h.request('GET', path, { token: TOKENS.otherCustomer })).status, 404);
    assert.equal(
      (
        await h.request('GET', `/internal/v1/subscription/purchases/by-request/${randomUUID()}`, {
          token: TOKENS.customer,
        })
      ).status,
      404,
    );
    assert.equal(f.reads[0]?.actor, OTHER_CUSTOMER_SUBJECT);
  } finally {
    await h.close();
  }
});

test('purchase recovery independently checks stored purchase ownership and hides rejected receipts', async () => {
  const f = fixture();
  const h = await startSubscriptionHttp({ repository: f.repository, clock: new FixedClock(f.now) });
  const path = `/internal/v1/subscription/purchases/by-request/${f.key}`;
  try {
    f.records.set(f.purchase.id, { ...f.purchase, customerSubject: OTHER_CUSTOMER_SUBJECT });
    assert.equal((await h.request('GET', path, { token: TOKENS.customer })).status, 404);
    f.records.set(f.purchase.id, f.purchase);
    // A durable business refusal did not create a recoverable purchase.
    Object.assign(f.receipt, { outcome: { status: 409, body: { code: 'QUOTE_MISMATCH' } } });
    assert.equal((await h.request('GET', path, { token: TOKENS.customer })).status, 404);
  } finally {
    await h.close();
  }
});
