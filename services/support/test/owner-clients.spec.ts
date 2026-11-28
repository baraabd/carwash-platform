import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage } from 'node:http';
import { randomUUID } from 'node:crypto';
import { BookingOwnerClient } from '../src/infrastructure/owners/booking-owner.client';
import { BillingOwnerClient } from '../src/infrastructure/owners/billing-owner.client';
import type { OnBehalfOf, OwnerRequest } from '../src/ports';

const auth: OnBehalfOf = {
  credential: `Bearer ${'test-owner-credential-'.repeat(3)}`,
  correlationId: randomUUID(),
};
type Call = {
  method: string;
  path: string;
  body: Record<string, unknown>;
  headers: IncomingMessage['headers'];
};
async function fixture(reply: (call: Call) => { status: number; body: unknown }) {
  const calls: Call[] = [];
  const server = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const raw = Buffer.concat(chunks).toString('utf8');
      const call = {
        method: request.method ?? '',
        path: request.url ?? '',
        body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {},
        headers: request.headers,
      };
      calls.push(call);
      const answer = reply(call);
      response.writeHead(answer.status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(answer.body));
    })().catch(() => {
      response.writeHead(500).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address !== 'object' || address === null) throw new Error('SERVER_ADDRESS');
  return {
    calls,
    endpoint: { origin: new URL(`http://127.0.0.1:${address.port}`), timeoutMs: 500 },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

test('Booking cancellation uses the original actor/key and stays pending until owner completion', async () => {
  const targetId = randomUUID();
  const changeId = randomUUID();
  let state = 'IN_PROGRESS';
  const owner = await fixture(() => ({
    status: 200,
    body: { changeId, bookingId: targetId, kind: 'CANCELLATION', state },
  }));
  try {
    const client = new BookingOwnerClient(owner.endpoint);
    const request: OwnerRequest = {
      operation: 'booking.cancel',
      targetId,
      key: randomUUID(),
      body: { expectedRevision: 4, reasonCode: 'CUSTOMER_REQUEST' },
    };
    const first = await client.execute(auth, request);
    assert.equal(first.kind, 'PENDING');
    assert.deepEqual(owner.calls[0]!.body, {
      expectedRevision: 4,
      reason: 'CUSTOMER_REQUEST_BY_PHONE',
    });
    assert.equal(owner.calls[0]!.path, `/internal/v1/booking/bookings/${targetId}/cancellation`);
    assert.equal(owner.calls[0]!.headers.authorization, auth.credential);
    assert.equal(owner.calls[0]!.headers['idempotency-key'], request.key);
    state = 'COMPLETED';
    assert.equal((await client.execute(auth, request)).kind, 'APPLIED');
    assert.deepEqual(owner.calls[1], owner.calls[0]);
    state = 'FAILED';
    assert.equal((await client.execute(auth, request)).kind, 'REJECTED');
  } finally {
    await owner.close();
  }
});

test('Booking reschedule requires the frozen Scheduling hold and refuses malformed success', async () => {
  const targetId = randomUUID();
  const holdId = randomUUID();
  let responseBody: unknown = {
    changeId: randomUUID(),
    bookingId: targetId,
    kind: 'RESCHEDULE',
    state: 'COMPLETED',
  };
  const owner = await fixture(() => ({ status: 200, body: responseBody }));
  try {
    const client = new BookingOwnerClient(owner.endpoint);
    const request: OwnerRequest = {
      operation: 'booking.reschedule',
      targetId,
      key: randomUUID(),
      body: { expectedRevision: 3, reasonCode: 'TECHNICIAN_UNAVAILABLE' },
    };
    assert.deepEqual(await client.execute(auth, request), {
      kind: 'UNAVAILABLE',
      code: 'BOOKING_HOLD_REQUIRED',
    });
    assert.equal(owner.calls.length, 0);
    const bound = { ...request, body: { ...request.body, holdId, holdRevision: 2 } };
    assert.equal((await client.execute(auth, bound)).kind, 'APPLIED');
    assert.deepEqual(owner.calls[0]!.body, { expectedRevision: 3, holdId, holdRevision: 2 });
    for (const invalid of [
      {},
      { changeId: randomUUID(), bookingId: randomUUID(), kind: 'RESCHEDULE', state: 'COMPLETED' },
    ]) {
      responseBody = invalid;
      assert.deepEqual(await client.execute(auth, bound), {
        kind: 'UNKNOWN',
        code: 'OWNER_INVALID_RESPONSE',
      });
    }
  } finally {
    await owner.close();
  }
});

test('Billing refund request alone is not success: exact replay reads the actual refund outcome', async () => {
  const targetId = randomUUID();
  const refundId = randomUUID();
  let status = 'REQUESTED';
  const owner = await fixture((call) => ({
    status: 200,
    body: {
      obligationId: targetId,
      refundId,
      status: call.method === 'POST' ? 'REQUESTED' : status,
    },
  }));
  try {
    const client = new BillingOwnerClient(owner.endpoint);
    const request: OwnerRequest = {
      operation: 'billing.refund',
      targetId,
      key: randomUUID(),
      body: {
        expectedRevision: 7,
        amount: { currency: 'SYP', amountMinor: '150000', scale: 2 },
        reasonCode: 'PAID_AFTER_CANCELLATION',
      },
    };
    assert.equal((await client.execute(auth, request)).kind, 'PENDING');
    assert.equal(owner.calls[0]!.path, `/internal/v1/billing/obligations/${targetId}/refunds`);
    assert.equal(owner.calls[0]!.body.reason, 'BOOKING_CANCELLED');
    assert.equal(owner.calls[1]!.path, `/internal/v1/billing/refunds/${refundId}`);
    status = 'OUTCOME_UNKNOWN';
    assert.equal((await client.execute(auth, request)).kind, 'PENDING');
    status = 'SUCCEEDED';
    assert.equal((await client.execute(auth, request)).kind, 'APPLIED');
    assert.deepEqual(
      owner.calls[4],
      owner.calls[0],
      'recovery retains the exact request and actor',
    );
    status = 'FAILED';
    assert.equal((await client.execute(auth, request)).kind, 'REJECTED');
    const count = owner.calls.length;
    assert.equal(
      (await client.execute(auth, { ...request, body: { ...request.body, reasonCode: 'OTHER' } }))
        .kind,
      'UNAVAILABLE',
    );
    assert.equal(
      owner.calls.length,
      count,
      'an ambiguous historical reason never creates a refund',
    );
  } finally {
    await owner.close();
  }
});

test('Billing unreadable or unrelated refund facts stay unknown', async () => {
  const targetId = randomUUID();
  const refundId = randomUUID();
  const owner = await fixture((call) => ({
    status: 200,
    body: {
      obligationId: call.method === 'POST' ? targetId : randomUUID(),
      refundId,
      status: 'SUCCEEDED',
    },
  }));
  try {
    const client = new BillingOwnerClient(owner.endpoint);
    assert.deepEqual(
      await client.execute(auth, {
        operation: 'billing.refund',
        targetId,
        key: randomUUID(),
        body: {
          expectedRevision: 7,
          amount: { currency: 'SYP', amountMinor: '150000', scale: 2 },
          reasonCode: 'DUPLICATE_PAYMENT',
        },
      }),
      { kind: 'UNKNOWN', code: 'OWNER_INVALID_RESPONSE' },
    );
  } finally {
    await owner.close();
  }
});
