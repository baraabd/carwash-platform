import { randomUUID } from 'node:crypto';
import type { Clock } from '../../src/ports';

/**
 * Builds Billing envelope-v2 events exactly as the Billing producer writes them
 * (services/billing/src/application/custody-events.ts) and as the shared
 * @carwash/event-contracts parsers accept them. TEST DATA: Billing is not running.
 */
export const HOLDER = '7a8b9c0d-1e2f-4a7b-8c9d-0e1f2a3b4c5d';
export const OTHER_HOLDER = '8b9c0d1e-2f3a-4b8c-9d0e-1f2a3b4c5d6e';
export const FINANCE_SUBJECT = '9c0d1e2f-3a4b-4c9d-8e1f-2a3b4c5d6e7f';
export const RECEIVER_SUBJECT = '0d1e2f3a-4b5c-4d0e-9f2a-3b4c5d6e7f80';

export class FixedClock implements Clock {
  constructor(private current: Date) {}
  now(): Date {
    return new Date(this.current.getTime());
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export interface Money {
  readonly currency: 'SYP' | 'USD';
  readonly amountMinor: string;
  readonly scale: 2;
}

export const syp = (minor: bigint | number): Money => ({
  currency: 'SYP',
  amountMinor: String(minor),
  scale: 2,
});

type Actor = { kind: 'account' | 'service' | 'system'; id: string | null };

function envelope(
  eventType: string,
  aggregateType: string,
  aggregateId: string,
  version: number,
  actor: Actor,
  data: Record<string, unknown>,
): Record<string, unknown> {
  return {
    eventId: randomUUID(),
    eventType,
    envelopeVersion: 2,
    producer: 'billing',
    occurredAt: new Date(Math.floor(Date.now())).toISOString(),
    correlationId: randomUUID(),
    causationId: null,
    traceparent: null,
    aggregate: { type: aggregateType, id: aggregateId, version },
    actor,
    data,
  };
}

export function collected(input: {
  receiptId?: string;
  holder?: string;
  amount?: Money;
  actor?: Actor;
  version?: number;
}): Record<string, unknown> {
  return envelope(
    'billing.cash-collected.v1',
    'billing-cash-receipt',
    input.receiptId ?? randomUUID(),
    input.version ?? 1,
    input.actor ?? { kind: 'account', id: input.holder ?? HOLDER },
    {
      obligationId: randomUUID(),
      bookingId: randomUUID(),
      assignmentId: randomUUID(),
      amount: input.amount ?? syp(150_000),
      custodyStatus: 'HELD',
    },
  );
}

export function reversed(input: {
  receiptId: string;
  amount?: Money;
  version?: number;
}): Record<string, unknown> {
  return envelope(
    'billing.cash-collection-reversed.v1',
    'billing-cash-receipt',
    input.receiptId,
    input.version ?? 2,
    { kind: 'account', id: FINANCE_SUBJECT },
    {
      obligationId: randomUUID(),
      bookingId: randomUUID(),
      amount: input.amount ?? syp(150_000),
      reason: 'RECORDED_IN_ERROR',
    },
  );
}

export function handover(input: {
  handoverId: string;
  version: number;
  previousStatus: 'PENDING' | 'RECEIVED' | 'RECONCILED' | 'CANCELLED' | null;
  status: 'PENDING' | 'RECEIVED' | 'RECONCILED' | 'CANCELLED';
  declared: Money;
  counted?: Money | null;
  shortage?: Money | null;
  overage?: Money | null;
  holder?: string;
  receiptCount?: number;
}): Record<string, unknown> {
  return envelope(
    'billing.custody-handover-changed.v1',
    'billing-custody-handover',
    input.handoverId,
    input.version,
    {
      kind: 'account',
      id: input.status === 'PENDING' ? (input.holder ?? HOLDER) : RECEIVER_SUBJECT,
    },
    {
      holder: input.holder ?? HOLDER,
      previousStatus: input.previousStatus,
      status: input.status,
      receiptCount: input.receiptCount ?? 1,
      declared: input.declared,
      counted: input.counted ?? null,
      shortage: input.shortage ?? null,
      overage: input.overage ?? null,
    },
  );
}
