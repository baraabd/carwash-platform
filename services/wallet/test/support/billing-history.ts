import { randomUUID } from 'node:crypto';
import {
  BILLING_CASH_COLLECTED_V1,
  BILLING_CASH_COLLECTION_REVERSED_V1,
  BILLING_CUSTODY_HANDOVER_CHANGED_V1,
} from '@carwash/event-contracts';

/**
 * TEST MODEL of Billing's cash custody state machine (P03-B semantics) that
 * emits the exact billing.v1 envelopes Billing writes to its outbox. Every
 * envelope is checked with the shared contract parser before it is returned,
 * so the projection is fed only shapes Billing could publish. The model's own
 * per-holder totals are the oracle for the projection.
 */
export type Currency = 'SYP' | 'USD';

export interface Envelope {
  readonly eventId: string;
  readonly eventType: string;
  readonly [key: string]: unknown;
}

export interface Truth {
  collected: bigint;
  reversed: bigint;
  held: bigint;
  inHandover: bigint;
  receivedByTreasury: bigint;
  settled: bigint;
  shortage: bigint;
  overage: bigint;
}

type ReceiptStatus = 'HELD' | 'IN_HANDOVER' | 'DEPOSITED' | 'SETTLED' | 'REVERSED';
interface Receipt {
  id: string;
  holder: string;
  currency: Currency;
  amount: bigint;
  status: ReceiptStatus;
  revision: number;
}
type HandoverStatus = 'PENDING' | 'CANCELLED' | 'RECEIVED' | 'RECONCILED';
interface Handover {
  id: string;
  holder: string;
  currency: Currency;
  receipts: Receipt[];
  declared: bigint;
  status: HandoverStatus;
  counted: bigint | null;
  revision: number;
}

/** Deterministic PRNG so a failing seed can be replayed. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const money = (currency: Currency, minor: bigint) => ({
  currency,
  amountMinor: minor.toString(),
  scale: 2,
});

export class BillingCustodyModel {
  readonly events: Envelope[] = [];
  private readonly receipts: Receipt[] = [];
  private readonly handovers: Handover[] = [];
  private clock = Date.parse('2026-10-11T08:00:00.000Z');
  private readonly corrector = randomUUID();

  constructor(private readonly random: () => number = Math.random) {}

  private pick<T>(items: readonly T[]): T | undefined {
    return items.length === 0 ? undefined : items[Math.floor(this.random() * items.length)];
  }

  private envelope(
    spec: { eventType: string; aggregateType: string; parse(value: unknown): unknown },
    aggregate: { id: string; version: number },
    actor: string,
    data: Record<string, unknown>,
  ): Envelope {
    this.clock += 1000;
    const envelope = {
      eventId: randomUUID(),
      eventType: spec.eventType,
      envelopeVersion: 2,
      producer: 'billing',
      occurredAt: new Date(this.clock).toISOString(),
      correlationId: randomUUID(),
      causationId: null,
      traceparent: null,
      aggregate: { type: spec.aggregateType, id: aggregate.id, version: aggregate.version },
      actor: { kind: 'account', id: actor },
      data,
    };
    spec.parse(envelope);
    this.events.push(envelope);
    return envelope;
  }

  collect(holder: string, currency: Currency, amount: bigint): Envelope {
    const receipt: Receipt = {
      id: randomUUID(),
      holder,
      currency,
      amount,
      status: 'HELD',
      revision: 1,
    };
    this.receipts.push(receipt);
    return this.envelope(BILLING_CASH_COLLECTED_V1, { id: receipt.id, version: 1 }, holder, {
      obligationId: randomUUID(),
      bookingId: randomUUID(),
      assignmentId: randomUUID(),
      amount: money(currency, amount),
      custodyStatus: 'HELD',
    });
  }

  reverse(receipt: { id: string }): Envelope {
    const r = this.receipts.find((candidate) => candidate.id === receipt.id);
    if (!r || r.status !== 'HELD') throw new Error('MODEL_RECEIPT_NOT_HELD');
    r.status = 'REVERSED';
    r.revision += 1;
    return this.envelope(
      BILLING_CASH_COLLECTION_REVERSED_V1,
      { id: r.id, version: r.revision },
      this.corrector,
      {
        obligationId: randomUUID(),
        bookingId: randomUUID(),
        amount: money(r.currency, r.amount),
        reason: 'RECORDED_IN_ERROR',
      },
    );
  }

  private handoverEvent(h: Handover, previous: HandoverStatus | null): Envelope {
    const counted = h.counted;
    const shortage = counted === null ? null : counted < h.declared ? h.declared - counted : 0n;
    const overage = counted === null ? null : counted > h.declared ? counted - h.declared : 0n;
    const opt = (value: bigint | null) => (value === null ? null : money(h.currency, value));
    return this.envelope(
      BILLING_CUSTODY_HANDOVER_CHANGED_V1,
      { id: h.id, version: h.revision },
      h.holder,
      {
        holder: h.holder,
        previousStatus: previous,
        status: h.status,
        receiptCount: h.receipts.length,
        declared: money(h.currency, h.declared),
        counted: opt(counted),
        shortage: opt(shortage),
        overage: opt(overage),
      },
    );
  }

  declare(holder: string, currency: Currency, receiptIds?: readonly string[]): Envelope | null {
    const held = this.receipts.filter(
      (r) =>
        r.holder === holder &&
        r.currency === currency &&
        r.status === 'HELD' &&
        (!receiptIds || receiptIds.includes(r.id)),
    );
    // Billing caps one handover at 200 receipts.
    const chosen = (receiptIds ? held : held.filter(() => this.random() < 0.7)).slice(0, 200);
    if (chosen.length === 0) return null;
    for (const r of chosen) r.status = 'IN_HANDOVER';
    const h: Handover = {
      id: randomUUID(),
      holder,
      currency,
      receipts: chosen,
      declared: chosen.reduce((sum, r) => sum + r.amount, 0n),
      status: 'PENDING',
      counted: null,
      revision: 1,
    };
    this.handovers.push(h);
    return this.handoverEvent(h, null);
  }

  private move(h: Handover, to: HandoverStatus, counted?: bigint): Envelope {
    const previous = h.status;
    h.status = to;
    h.revision += 1;
    if (counted !== undefined) h.counted = counted;
    const receiptStatus: Record<HandoverStatus, ReceiptStatus> = {
      PENDING: 'IN_HANDOVER',
      CANCELLED: 'HELD',
      RECEIVED: 'DEPOSITED',
      RECONCILED: 'SETTLED',
    };
    for (const r of h.receipts) r.status = receiptStatus[to];
    return this.handoverEvent(h, previous);
  }

  cancel(id: string): Envelope {
    const h = this.handovers.find((c) => c.id === id && c.status === 'PENDING');
    if (!h) throw new Error('MODEL_HANDOVER_NOT_PENDING');
    return this.move(h, 'CANCELLED');
  }

  receive(id: string, counted: bigint): Envelope {
    const h = this.handovers.find((c) => c.id === id && c.status === 'PENDING');
    if (!h) throw new Error('MODEL_HANDOVER_NOT_PENDING');
    return this.move(h, 'RECEIVED', counted);
  }

  reconcile(id: string): Envelope {
    const h = this.handovers.find((c) => c.id === id && c.status === 'RECEIVED');
    if (!h) throw new Error('MODEL_HANDOVER_NOT_RECEIVED');
    return this.move(h, 'RECONCILED');
  }

  handoverIds(status: HandoverStatus): string[] {
    return this.handovers.filter((h) => h.status === status).map((h) => h.id);
  }

  receiptIds(holder: string, status: ReceiptStatus): string[] {
    return this.receipts.filter((r) => r.holder === holder && r.status === status).map((r) => r.id);
  }

  /** One random legal Billing step. */
  step(holders: readonly string[], currencies: readonly Currency[]): void {
    const roll = this.random();
    const holder = this.pick(holders);
    const currency = this.pick(currencies);
    if (!holder || !currency) throw new Error('MODEL_EMPTY_DOMAIN');
    if (roll < 0.4) {
      this.collect(holder, currency, BigInt(1 + Math.floor(this.random() * 500_000)));
      return;
    }
    if (roll < 0.5) {
      const r = this.pick(this.receipts.filter((c) => c.status === 'HELD'));
      if (r) this.reverse(r);
      return;
    }
    if (roll < 0.7) {
      this.declare(holder, currency);
      return;
    }
    if (roll < 0.78) {
      const id = this.pick(this.handoverIds('PENDING'));
      if (id) this.cancel(id);
      return;
    }
    if (roll < 0.92) {
      const h = this.pick(this.handovers.filter((c) => c.status === 'PENDING'));
      if (!h) return;
      const delta =
        BigInt(Math.floor(this.random() * 3) - 1) * BigInt(Math.floor(this.random() * 100));
      const counted = h.declared + delta < 0n ? 0n : h.declared + delta;
      this.receive(h.id, counted);
      return;
    }
    const id = this.pick(this.handoverIds('RECEIVED'));
    if (id) this.reconcile(id);
  }

  truth(holder: string, currency: Currency): Truth {
    const sum = (values: readonly bigint[]) => values.reduce((a, b) => a + b, 0n);
    const rs = this.receipts.filter((r) => r.holder === holder && r.currency === currency);
    const hs = this.handovers.filter((h) => h.holder === holder && h.currency === currency);
    const declared = (status: HandoverStatus) =>
      sum(hs.filter((h) => h.status === status).map((h) => h.declared));
    const counted = hs.filter((h) => h.counted !== null);
    return {
      collected: sum(rs.map((r) => r.amount)),
      reversed: sum(rs.filter((r) => r.status === 'REVERSED').map((r) => r.amount)),
      held: sum(rs.filter((r) => r.status === 'HELD').map((r) => r.amount)),
      inHandover: declared('PENDING'),
      receivedByTreasury: declared('RECEIVED'),
      settled: declared('RECONCILED'),
      shortage: sum(
        counted.map((h) =>
          h.counted !== null && h.counted < h.declared ? h.declared - h.counted : 0n,
        ),
      ),
      overage: sum(
        counted.map((h) =>
          h.counted !== null && h.counted > h.declared ? h.counted - h.declared : 0n,
        ),
      ),
    };
  }
}

/** Fisher-Yates with the supplied PRNG. */
export function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const a = out[i] as T;
    out[i] = out[j] as T;
    out[j] = a;
  }
  return out;
}
