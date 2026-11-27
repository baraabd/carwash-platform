import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { OutboxRecord } from '@carwash/platform-messaging';
import { obligationCreatedEvent, obligationStatusChangedEvent } from '../src/application/events';
import { validateObligationOutbox } from '../src/outbox/obligation-events';

const money = { currency: 'SYP' as const, amountMinor: '150000', scale: 2 };
const context = () => ({
  eventId: randomUUID(),
  occurredAt: new Date(),
  correlationId: randomUUID(),
  actor: null,
  obligationId: randomUUID(),
  revision: 1,
});
function record(row: ReturnType<typeof obligationCreatedEvent>): OutboxRecord {
  return { ...row, id: randomUUID(), attempts: 1, createdAtMs: row.createdAt.getTime() };
}

test('obligation outbox accepts the published created/status contracts and retains CASH_COLLECTED as its own fact', () => {
  const created = record(
    obligationCreatedEvent(
      { quoteId: randomUUID(), amount: money, financialStatus: 'UNPAID' },
      context(),
    ),
  );
  validateObligationOutbox(created);
  const collected = record(
    obligationStatusChangedEvent(
      {
        previousFinancialStatus: 'AWAITING_CASH',
        financialStatus: 'CASH_COLLECTED',
        verified: money,
        outstanding: { ...money, amountMinor: '0' },
      },
      { ...context(), revision: 3 },
    ),
  );
  validateObligationOutbox(collected);
  assert.equal(JSON.parse(collected.payload).data.financialStatus, 'CASH_COLLECTED');
  assert.throws(
    () =>
      obligationStatusChangedEvent(
        {
          previousFinancialStatus: 'PAID',
          financialStatus: 'REFUNDED',
          verified: money,
          outstanding: { ...money, amountMinor: '0' },
        },
        context(),
      ),
    /INVALID_EVENT_DATA/,
    'refund outcomes must use the separate published refund event',
  );
});

test('obligation relay rejects legacy routes, altered identity, private fields and non-exact money before publish', () => {
  const value = record(
    obligationCreatedEvent(
      { quoteId: randomUUID(), amount: money, financialStatus: 'UNPAID' },
      context(),
    ),
  );
  for (const patch of [
    { exchange: 'billing.events' },
    { routingKey: '#' },
    { eventType: 'billing.provider-credit-changed.v1' },
    { eventId: randomUUID() },
  ])
    assert.throws(() => validateObligationOutbox({ ...value, ...patch }));
  const envelope = JSON.parse(value.payload) as { data: Record<string, unknown> };
  for (const data of [
    { ...envelope.data, providerReference: 'PRIVATE' },
    { ...envelope.data, amount: { ...money, amountMinor: '1.5' } },
  ])
    assert.throws(() =>
      validateObligationOutbox({ ...value, payload: JSON.stringify({ ...envelope, data }) }),
    );
});
