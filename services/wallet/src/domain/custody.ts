import type { Amount, Currency } from './money';

/**
 * Technician cash-custody PROJECTION.
 *
 * Billing owns cash receipts, custody and the authoritative ledger (P03-B).
 * Wallet keeps a read model folded from Billing's published billing.v1 events
 * so balances can be shown without a second financial ledger: every state row
 * and movement here references the Billing event that caused it, and nothing
 * in this module can create, settle or move money.
 *
 * Billing semantics mirrored (read-only):
 *  - cash-collected (receipt v1): the collector (event actor) holds the cash.
 *  - cash-collection-reversed (receipt v>=2): a HELD receipt is corrected; the
 *    actor is the corrector, so the holder comes from the collected event.
 *  - custody-handover-changed: PENDING -> CANCELLED | RECEIVED -> RECONCILED,
 *    each event carrying the full handover state for its revision.
 *
 * Events can arrive late, twice or out of order. Receipt state merges the two
 * receipt facts commutatively; handover state is last-revision-wins because
 * every event carries the complete state. Contradictions between facts are
 * integrity faults, never silently resolved.
 */

export const HANDOVER_STATUSES = ['PENDING', 'CANCELLED', 'RECEIVED', 'RECONCILED'] as const;
export type HandoverStatus = (typeof HANDOVER_STATUSES)[number];

export const MOVEMENT_KINDS = [
  'CASH_COLLECTED',
  'COLLECTION_REVERSED',
  'HANDOVER_DECLARED',
  'HANDOVER_CANCELLED',
  'HANDOVER_RECEIVED',
  'HANDOVER_RECONCILED',
] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

export type CustodyIntegrityCode =
  | 'RECEIPT_AMOUNT_CONFLICT'
  | 'RECEIPT_HOLDER_CONFLICT'
  | 'REVERSAL_VERSION_INVALID'
  | 'COLLECTION_VERSION_INVALID'
  | 'HANDOVER_IDENTITY_CONFLICT'
  | 'HANDOVER_TRANSITION_INVALID'
  | 'HANDOVER_AMOUNTS_INVALID';

/** Two Billing facts contradict each other; the event is not applied. */
export class CustodyIntegrityError extends Error {
  constructor(readonly code: CustodyIntegrityCode) {
    super(code);
    this.name = 'CustodyIntegrityError';
  }
}

export interface CollectedFact {
  readonly kind: 'COLLECTED';
  readonly eventId: string;
  readonly receiptId: string;
  readonly version: number;
  readonly holder: string;
  readonly amount: Amount;
}

export interface ReversedFact {
  readonly kind: 'REVERSED';
  readonly eventId: string;
  readonly receiptId: string;
  readonly version: number;
  readonly amount: Amount;
}

export interface HandoverFact {
  readonly kind: 'HANDOVER';
  readonly eventId: string;
  readonly handoverId: string;
  readonly version: number;
  readonly holder: string;
  readonly previousStatus: HandoverStatus | null;
  readonly status: HandoverStatus;
  readonly receiptCount: number;
  readonly declared: Amount;
  readonly counted: Amount | null;
  readonly shortage: Amount | null;
  readonly overage: Amount | null;
}

export type ReceiptFact = CollectedFact | ReversedFact;
export type CustodyFact = ReceiptFact | HandoverFact;

export interface ReceiptState {
  readonly receiptId: string;
  /** null while only the reversal is known (the holder comes from collection). */
  readonly holder: string | null;
  readonly amount: Amount;
  readonly collectedEventId: string | null;
  readonly reversedEventId: string | null;
  readonly version: number;
}

export interface HandoverState {
  readonly handoverId: string;
  readonly holder: string;
  readonly status: HandoverStatus;
  readonly receiptCount: number;
  readonly declared: Amount;
  readonly counted: Amount | null;
  readonly shortage: Amount | null;
  readonly overage: Amount | null;
  readonly version: number;
  readonly lastEventId: string;
}

/** A movement attributed to one holder account, always naming its Billing event. */
export interface MovementPlan {
  readonly eventId: string;
  readonly kind: MovementKind;
  readonly amount: Amount;
}

export type Applied<TState> =
  | { readonly outcome: 'APPLIED'; readonly next: TState; readonly movements: MovementPlan[] }
  | { readonly outcome: 'STALE' };

const sameAmount = (a: Amount, b: Amount) => a.currency === b.currency && a.minor === b.minor;

export function applyReceiptFact(
  current: ReceiptState | null,
  fact: ReceiptFact,
): Applied<ReceiptState> {
  if (fact.kind === 'COLLECTED') {
    // Billing writes a receipt with revision 1 and emits collection for it.
    if (fact.version !== 1) throw new CustodyIntegrityError('COLLECTION_VERSION_INVALID');
    const collected: MovementPlan = {
      eventId: fact.eventId,
      kind: 'CASH_COLLECTED',
      amount: fact.amount,
    };
    if (!current) {
      return {
        outcome: 'APPLIED',
        next: {
          receiptId: fact.receiptId,
          holder: fact.holder,
          amount: fact.amount,
          collectedEventId: fact.eventId,
          reversedEventId: null,
          version: 1,
        },
        movements: [collected],
      };
    }
    if (!sameAmount(current.amount, fact.amount))
      throw new CustodyIntegrityError('RECEIPT_AMOUNT_CONFLICT');
    if (current.collectedEventId !== null) {
      if (current.holder !== fact.holder)
        throw new CustodyIntegrityError('RECEIPT_HOLDER_CONFLICT');
      return { outcome: 'STALE' };
    }
    // The reversal arrived first: attribute both facts to the holder now.
    const reversedEventId = current.reversedEventId;
    if (reversedEventId === null) throw new Error('RECEIPT_STATE_WITHOUT_FACT');
    return {
      outcome: 'APPLIED',
      next: { ...current, holder: fact.holder, collectedEventId: fact.eventId },
      movements: [
        collected,
        { eventId: reversedEventId, kind: 'COLLECTION_REVERSED', amount: fact.amount },
      ],
    };
  }

  if (fact.version < 2) throw new CustodyIntegrityError('REVERSAL_VERSION_INVALID');
  if (!current) {
    return {
      outcome: 'APPLIED',
      next: {
        receiptId: fact.receiptId,
        holder: null,
        amount: fact.amount,
        collectedEventId: null,
        reversedEventId: fact.eventId,
        version: fact.version,
      },
      // Unattributed until the collection names the holder.
      movements: [],
    };
  }
  if (!sameAmount(current.amount, fact.amount))
    throw new CustodyIntegrityError('RECEIPT_AMOUNT_CONFLICT');
  if (current.reversedEventId !== null) return { outcome: 'STALE' };
  return {
    outcome: 'APPLIED',
    next: { ...current, reversedEventId: fact.eventId, version: fact.version },
    movements: [{ eventId: fact.eventId, kind: 'COLLECTION_REVERSED', amount: fact.amount }],
  };
}

const NEXT: Readonly<Record<HandoverStatus, readonly HandoverStatus[]>> = {
  PENDING: ['CANCELLED', 'RECEIVED'],
  CANCELLED: [],
  RECEIVED: ['RECONCILED'],
  RECONCILED: [],
};

function reachable(from: HandoverStatus, to: HandoverStatus): boolean {
  return NEXT[from].some((step) => step === to || reachable(step, to));
}

const HANDOVER_MOVEMENT: Readonly<Record<HandoverStatus, MovementKind>> = {
  PENDING: 'HANDOVER_DECLARED',
  CANCELLED: 'HANDOVER_CANCELLED',
  RECEIVED: 'HANDOVER_RECEIVED',
  RECONCILED: 'HANDOVER_RECONCILED',
};

/** Shape rules Billing's own table constraints guarantee for each status. */
function assertHandoverShape(fact: HandoverFact): void {
  const edgeOk =
    fact.previousStatus === null
      ? fact.status === 'PENDING'
      : NEXT[fact.previousStatus].includes(fact.status);
  if (!edgeOk || (fact.previousStatus === null) !== (fact.version === 1))
    throw new CustodyIntegrityError('HANDOVER_TRANSITION_INVALID');
  const currency = fact.declared.currency;
  const others = [fact.counted, fact.shortage, fact.overage];
  if (others.some((amount) => amount !== null && amount.currency !== currency))
    throw new CustodyIntegrityError('HANDOVER_AMOUNTS_INVALID');
  const counted = fact.status === 'RECEIVED' || fact.status === 'RECONCILED';
  if (!counted) {
    if (others.some((amount) => amount !== null))
      throw new CustodyIntegrityError('HANDOVER_AMOUNTS_INVALID');
    return;
  }
  const [c, s, o] = others;
  if (!c || !s || !o) throw new CustodyIntegrityError('HANDOVER_AMOUNTS_INVALID');
  if ((s.minor !== 0n && o.minor !== 0n) || c.minor - fact.declared.minor !== o.minor - s.minor)
    throw new CustodyIntegrityError('HANDOVER_AMOUNTS_INVALID');
}

export function applyHandoverFact(
  current: HandoverState | null,
  fact: HandoverFact,
): Applied<HandoverState> {
  assertHandoverShape(fact);
  const next: HandoverState = {
    handoverId: fact.handoverId,
    holder: fact.holder,
    status: fact.status,
    receiptCount: fact.receiptCount,
    declared: fact.declared,
    counted: fact.counted,
    shortage: fact.shortage,
    overage: fact.overage,
    version: fact.version,
    lastEventId: fact.eventId,
  };
  const movements: MovementPlan[] = [
    { eventId: fact.eventId, kind: HANDOVER_MOVEMENT[fact.status], amount: fact.declared },
  ];
  if (!current) return { outcome: 'APPLIED', next, movements };
  if (
    current.holder !== fact.holder ||
    current.receiptCount !== fact.receiptCount ||
    !sameAmount(current.declared, fact.declared)
  )
    throw new CustodyIntegrityError('HANDOVER_IDENTITY_CONFLICT');
  if (fact.version <= current.version) {
    // An older or repeated revision. A same-revision status disagreement is a
    // contradiction; anything else is simply already reflected.
    if (fact.version === current.version && fact.status !== current.status)
      throw new CustodyIntegrityError('HANDOVER_TRANSITION_INVALID');
    return { outcome: 'STALE' };
  }
  if (!reachable(current.status, fact.status))
    throw new CustodyIntegrityError('HANDOVER_TRANSITION_INVALID');
  return { outcome: 'APPLIED', next, movements };
}

/**
 * Per holder and currency. `held` is cash still with the holder and not yet
 * declared; it can be transiently negative when a handover arrives before the
 * collections it contains (`complete` is then false). `outstanding` is what
 * the company has not received yet; a recorded `shortage` remains open with
 * Billing and is shown separately, never netted.
 */
export interface CustodyPosition {
  readonly currency: Currency;
  readonly collected: bigint;
  readonly reversed: bigint;
  readonly held: bigint;
  readonly inHandover: bigint;
  readonly receivedByTreasury: bigint;
  readonly settled: bigint;
  readonly outstanding: bigint;
  readonly shortage: bigint;
  readonly overage: bigint;
  readonly complete: boolean;
}

export interface PositionTotals {
  readonly collected: bigint;
  readonly reversed: bigint;
  readonly inHandover: bigint;
  readonly receivedByTreasury: bigint;
  readonly settled: bigint;
  readonly shortage: bigint;
  readonly overage: bigint;
}

export function positionFromTotals(currency: Currency, totals: PositionTotals): CustodyPosition {
  const held =
    totals.collected -
    totals.reversed -
    totals.inHandover -
    totals.receivedByTreasury -
    totals.settled;
  return {
    currency,
    ...totals,
    held,
    outstanding: held + totals.inHandover,
    complete: held >= 0n,
  };
}

/** Reference fold over state rows of ONE holder; the store must agree with it. */
export function positionOf(
  holder: string,
  currency: Currency,
  receipts: readonly ReceiptState[],
  handovers: readonly HandoverState[],
): CustodyPosition {
  const sum = (values: readonly bigint[]) => values.reduce((a, b) => a + b, 0n);
  const mine = receipts.filter(
    (r) => r.holder === holder && r.amount.currency === currency && r.collectedEventId !== null,
  );
  const ho = handovers.filter((h) => h.holder === holder && h.declared.currency === currency);
  const declared = (status: HandoverStatus) =>
    sum(ho.filter((h) => h.status === status).map((h) => h.declared.minor));
  const counted = ho.filter((h) => h.status === 'RECEIVED' || h.status === 'RECONCILED');
  return positionFromTotals(currency, {
    collected: sum(mine.map((r) => r.amount.minor)),
    reversed: sum(mine.filter((r) => r.reversedEventId !== null).map((r) => r.amount.minor)),
    inHandover: declared('PENDING'),
    receivedByTreasury: declared('RECEIVED'),
    settled: declared('RECONCILED'),
    shortage: sum(counted.map((h) => h.shortage?.minor ?? 0n)),
    overage: sum(counted.map((h) => h.overage?.minor ?? 0n)),
  });
}
