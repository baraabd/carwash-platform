/**
 * Wallet technician-custody PROJECTION.
 *
 * Owner decision B-08 approves exactly one Wallet use case: showing the cash a
 * technician holds for the company. Wallet is "balances and holds referencing
 * Billing ledger postings; no second financial ledger": every bucket change here
 * mirrors one registered Billing event and cites it. Billing remains the only
 * financial authority; customer stored value, funding and withdrawal do not
 * exist in this service.
 *
 * Buckets per (holder, currency), exact integer minor units:
 *   held        - collected cash the holder still holds (receipts HELD);
 *   inHandover  - declared to treasury, not yet counted (handover PENDING);
 *   deposited   - counted by treasury, settlement not yet reconciled (RECEIVED);
 *   settled     - reconciled settlements (RECONCILED);
 *   shortage    - recorded shortages (receivable facts, never auto-resolved);
 *   overage     - recorded overages (suspense facts, never auto-resolved).
 */
export const CURRENCIES = ['SYP', 'USD'] as const;
export type Currency = (typeof CURRENCIES)[number];

export const BUCKETS = [
  'held',
  'inHandover',
  'deposited',
  'settled',
  'shortage',
  'overage',
] as const;
export type Bucket = (typeof BUCKETS)[number];
export type Buckets = Readonly<Record<Bucket, bigint>>;

export const MOVEMENT_KINDS = [
  'CASH_COLLECTED',
  'CASH_COLLECTION_REVERSED',
  'HANDOVER_DECLARED',
  'HANDOVER_RECEIVED',
  'HANDOVER_RECONCILED',
  'HANDOVER_CANCELLED',
] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

export const SOURCE_KINDS = ['RECEIPT', 'HANDOVER'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** Projected state of one Billing aggregate (a cash receipt or a custody handover). */
export const SOURCE_STATUSES = [
  'HELD',
  'REVERSED',
  'PENDING',
  'RECEIVED',
  'RECONCILED',
  'CANCELLED',
] as const;
export type SourceStatus = (typeof SOURCE_STATUSES)[number];

export interface SourceState {
  readonly kind: SourceKind;
  readonly aggregateId: string;
  readonly lastVersion: number;
  readonly holder: string;
  readonly currency: Currency;
  readonly status: SourceStatus;
  /** Receipt: collected amount. Handover: declared amount. */
  readonly amountMinor: bigint;
  /** Handover only, once counted. */
  readonly countedMinor: bigint | null;
}

export const ZERO: Buckets = {
  held: 0n,
  inHandover: 0n,
  deposited: 0n,
  settled: 0n,
  shortage: 0n,
  overage: 0n,
};

export function delta(changes: Partial<Record<Bucket, bigint>>): Buckets {
  return { ...ZERO, ...changes };
}

export function addBuckets(a: Buckets, b: Buckets): Buckets {
  return {
    held: a.held + b.held,
    inHandover: a.inHandover + b.inHandover,
    deposited: a.deposited + b.deposited,
    settled: a.settled + b.settled,
    shortage: a.shortage + b.shortage,
    overage: a.overage + b.overage,
  };
}

/**
 * The projection is AHEAD of an event it depends on (another aggregate's event
 * has not arrived yet, or this aggregate skipped a transition). Nothing is
 * applied; the delivery is retried later and dead-lettered by the broker policy
 * if it never becomes applicable (reconciliation path).
 */
export class ProjectionDeferred extends Error {
  constructor(readonly reason: DeferralReason) {
    super(reason);
    this.name = 'ProjectionDeferred';
  }
}

export type DeferralReason =
  'RECEIPT_NOT_YET_PROJECTED' | 'HANDOVER_TRANSITION_GAP' | 'INSUFFICIENT_PROJECTED_CUSTODY';

/** A terminal, recorded rejection: the event can never apply (never crashes the consumer). */
export class ProjectionRejected extends Error {
  constructor(readonly reason: RejectionReason) {
    super(reason);
    this.name = 'ProjectionRejected';
  }
}

export type RejectionReason =
  | 'EVENT_INVALID'
  | 'EVENT_UNSUPPORTED'
  | 'HOLDER_UNATTRIBUTABLE'
  | 'CURRENCY_MISMATCH'
  | 'AMOUNT_MISMATCH'
  | 'COUNTED_MISSING';

export interface ProjectionStep {
  readonly kind: MovementKind;
  readonly holder: string;
  readonly currency: Currency;
  readonly delta: Buckets;
  readonly source: SourceState;
}

/** Applying a step must leave every bucket non-negative; otherwise wait for earlier events. */
export function applyStep(account: Buckets, step: ProjectionStep): Buckets {
  const next = addBuckets(account, step.delta);
  for (const bucket of BUCKETS)
    if (next[bucket] < 0n) throw new ProjectionDeferred('INSUFFICIENT_PROJECTED_CUSTODY');
  return next;
}

export function cashCollected(input: {
  readonly receiptId: string;
  readonly version: number;
  readonly holder: string;
  readonly currency: Currency;
  readonly amountMinor: bigint;
}): ProjectionStep {
  return {
    kind: 'CASH_COLLECTED',
    holder: input.holder,
    currency: input.currency,
    delta: delta({ held: input.amountMinor }),
    source: {
      kind: 'RECEIPT',
      aggregateId: input.receiptId,
      lastVersion: input.version,
      holder: input.holder,
      currency: input.currency,
      status: 'HELD',
      amountMinor: input.amountMinor,
      countedMinor: null,
    },
  };
}

/**
 * Billing reverses only a HELD receipt. The reversal names no holder; it is the
 * holder of the projected receipt (same Billing aggregate). Receipt revisions
 * also move when the receipt joins a handover without a receipt event, so a
 * version gap on this aggregate is normal; the collected event must be known.
 */
export function cashReversed(input: {
  readonly receipt: SourceState | null;
  readonly version: number;
  readonly currency: Currency;
  readonly amountMinor: bigint;
}): ProjectionStep {
  const { receipt } = input;
  if (!receipt || receipt.kind !== 'RECEIPT')
    throw new ProjectionDeferred('RECEIPT_NOT_YET_PROJECTED');
  if (receipt.currency !== input.currency) throw new ProjectionRejected('CURRENCY_MISMATCH');
  if (receipt.amountMinor !== input.amountMinor) throw new ProjectionRejected('AMOUNT_MISMATCH');
  if (receipt.status !== 'HELD') throw new ProjectionRejected('EVENT_INVALID');
  return {
    kind: 'CASH_COLLECTION_REVERSED',
    holder: receipt.holder,
    currency: receipt.currency,
    delta: delta({ held: -receipt.amountMinor }),
    source: { ...receipt, lastVersion: input.version, status: 'REVERSED' },
  };
}

export type HandoverStatus = 'PENDING' | 'RECEIVED' | 'RECONCILED' | 'CANCELLED';

export interface HandoverFacts {
  readonly handoverId: string;
  readonly version: number;
  readonly holder: string;
  readonly previousStatus: HandoverStatus | null;
  readonly status: HandoverStatus;
  readonly currency: Currency;
  readonly declaredMinor: bigint;
  readonly countedMinor: bigint | null;
  readonly shortageMinor: bigint | null;
  readonly overageMinor: bigint | null;
}

/**
 * Handover transitions carry their previous status, so the projection only
 * applies a transition from the status it actually holds; anything else is a
 * gap (an earlier handover event has not arrived) and is deferred.
 */
export function handoverChanged(
  previous: SourceState | null,
  facts: HandoverFacts,
): ProjectionStep {
  const projectedStatus = previous?.status ?? null;
  if (projectedStatus !== facts.previousStatus)
    throw new ProjectionDeferred('HANDOVER_TRANSITION_GAP');
  if (previous && (previous.holder !== facts.holder || previous.currency !== facts.currency))
    throw new ProjectionRejected('EVENT_INVALID');
  if (previous && previous.amountMinor !== facts.declaredMinor)
    throw new ProjectionRejected('AMOUNT_MISMATCH');
  const declared = facts.declaredMinor;
  const source: SourceState = {
    kind: 'HANDOVER',
    aggregateId: facts.handoverId,
    lastVersion: facts.version,
    holder: facts.holder,
    currency: facts.currency,
    status: facts.status,
    amountMinor: declared,
    countedMinor: facts.countedMinor,
  };
  const step = (kind: MovementKind, changes: Partial<Record<Bucket, bigint>>): ProjectionStep => ({
    kind,
    holder: facts.holder,
    currency: facts.currency,
    delta: delta(changes),
    source,
  });
  switch (facts.status) {
    case 'PENDING':
      return step('HANDOVER_DECLARED', { held: -declared, inHandover: declared });
    case 'CANCELLED':
      return step('HANDOVER_CANCELLED', { inHandover: -declared, held: declared });
    case 'RECEIVED': {
      if (facts.countedMinor === null) throw new ProjectionRejected('COUNTED_MISSING');
      const shortage = facts.shortageMinor ?? 0n;
      const overage = facts.overageMinor ?? 0n;
      // The recorded difference must explain counted vs declared exactly.
      if (facts.countedMinor + shortage - overage !== declared)
        throw new ProjectionRejected('AMOUNT_MISMATCH');
      return step('HANDOVER_RECEIVED', {
        inHandover: -declared,
        deposited: facts.countedMinor,
        shortage,
        overage,
      });
    }
    case 'RECONCILED': {
      const counted = previous?.countedMinor ?? null;
      if (counted === null || (facts.countedMinor !== null && facts.countedMinor !== counted))
        throw new ProjectionRejected('COUNTED_MISSING');
      return step('HANDOVER_RECONCILED', { deposited: -counted, settled: counted });
    }
  }
}
