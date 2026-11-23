import {
  BILLING_CASH_COLLECTED_V1,
  BILLING_CASH_COLLECTION_REVERSED_V1,
  BILLING_CUSTODY_HANDOVER_CHANGED_V1,
  type MoneyData,
} from '@carwash/event-contracts';
import {
  ProjectionRejected,
  applyStep,
  cashCollected,
  cashReversed,
  handoverChanged,
  type ProjectionStep,
  type SourceKind,
  type SourceState,
} from '../domain';
import type { Clock, IdGenerator, InboxRecord, WalletRepository, WalletUnitOfWork } from '../ports';

/** Billing events this projection consumes (registered by Lane E in P04-E1). */
export const CONSUMED_EVENT_TYPES = [
  BILLING_CASH_COLLECTED_V1.eventType,
  BILLING_CASH_COLLECTION_REVERSED_V1.eventType,
  BILLING_CUSTODY_HANDOVER_CHANGED_V1.eventType,
] as const;

export type ProjectionOutcome =
  | { readonly outcome: 'APPLIED' | 'STALE' | 'DUPLICATE'; readonly eventId: string }
  | { readonly outcome: 'REJECTED'; readonly eventId: string | null; readonly reason: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface Decoded {
  readonly eventId: string;
  readonly eventType: string;
  readonly correlationId: string;
  readonly occurredAt: Date;
  readonly sourceKind: SourceKind;
  readonly aggregateId: string;
  readonly version: number;
  /** Computes the step from the projected source state (inside the transaction). */
  readonly plan: (source: SourceState | null) => ProjectionStep;
}

function amount(money: MoneyData): { currency: MoneyData['currency']; minor: bigint } {
  return { currency: money.currency, minor: BigInt(money.amountMinor) };
}

/** Strictly validates the envelope with the shared Lane E parser, then maps it to a projection plan. */
function decode(raw: unknown): Decoded {
  const type = (raw as { eventType?: unknown } | null)?.eventType;
  if (type === BILLING_CASH_COLLECTED_V1.eventType) {
    const event = BILLING_CASH_COLLECTED_V1.parse(raw);
    // cash-collected.v1 names no holder: the custody holder is the collector,
    // who is the envelope actor (Billing writes collector = acting account).
    // CR-B-12.2 asks E for an explicit holder field.
    if (event.actor.kind !== 'account' || event.actor.id === null)
      throw new ProjectionRejected('HOLDER_UNATTRIBUTABLE');
    if (event.data.custodyStatus !== 'HELD') throw new ProjectionRejected('EVENT_INVALID');
    const holder = event.actor.id;
    const money = amount(event.data.amount);
    return {
      eventId: event.eventId,
      eventType: event.eventType,
      correlationId: event.correlationId,
      occurredAt: new Date(event.occurredAt),
      sourceKind: 'RECEIPT',
      aggregateId: event.aggregate.id,
      version: event.aggregate.version,
      plan: () =>
        cashCollected({
          receiptId: event.aggregate.id,
          version: event.aggregate.version,
          holder,
          currency: money.currency,
          amountMinor: money.minor,
        }),
    };
  }
  if (type === BILLING_CASH_COLLECTION_REVERSED_V1.eventType) {
    const event = BILLING_CASH_COLLECTION_REVERSED_V1.parse(raw);
    const money = amount(event.data.amount);
    return {
      eventId: event.eventId,
      eventType: event.eventType,
      correlationId: event.correlationId,
      occurredAt: new Date(event.occurredAt),
      sourceKind: 'RECEIPT',
      aggregateId: event.aggregate.id,
      version: event.aggregate.version,
      plan: (receipt) =>
        cashReversed({
          receipt,
          version: event.aggregate.version,
          currency: money.currency,
          amountMinor: money.minor,
        }),
    };
  }
  if (type === BILLING_CUSTODY_HANDOVER_CHANGED_V1.eventType) {
    const event = BILLING_CUSTODY_HANDOVER_CHANGED_V1.parse(raw);
    const d = event.data;
    const declared = amount(d.declared);
    return {
      eventId: event.eventId,
      eventType: event.eventType,
      correlationId: event.correlationId,
      occurredAt: new Date(event.occurredAt),
      sourceKind: 'HANDOVER',
      aggregateId: event.aggregate.id,
      version: event.aggregate.version,
      plan: (previous) =>
        handoverChanged(previous, {
          handoverId: event.aggregate.id,
          version: event.aggregate.version,
          holder: d.holder,
          previousStatus: d.previousStatus,
          status: d.status,
          currency: declared.currency,
          declaredMinor: declared.minor,
          countedMinor: d.counted ? amount(d.counted).minor : null,
          shortageMinor: d.shortage ? amount(d.shortage).minor : null,
          overageMinor: d.overage ? amount(d.overage).minor : null,
        }),
    };
  }
  throw new ProjectionRejected('EVENT_UNSUPPORTED');
}

class Duplicate extends Error {
  constructor() {
    super('DUPLICATE_EVENT');
  }
}

/**
 * Idempotent Inbox consumer: each Billing event is applied at most once, in one
 * local transaction with its inbox row, movement and account update.
 *  - same event id again (sequential or concurrent)  -> DUPLICATE, no effect;
 *  - aggregate version not newer than projected      -> STALE, recorded;
 *  - invalid / unsupported / unattributable           -> REJECTED, recorded, acked;
 *  - depends on an event not yet projected            -> ProjectionDeferred thrown,
 *    nothing recorded, so the broker redelivers it (and dead-letters it by policy).
 */
export class CustodyProjector {
  constructor(
    private readonly deps: {
      readonly repository: WalletRepository;
      readonly clock: Clock;
      readonly ids: IdGenerator;
    },
  ) {}

  async project(raw: unknown): Promise<ProjectionOutcome> {
    const rawId = (raw as { eventId?: unknown } | null)?.eventId;
    const rawType = (raw as { eventType?: unknown } | null)?.eventType;
    const eventId = typeof rawId === 'string' && UUID.test(rawId) ? rawId.toLowerCase() : null;
    if (eventId && (await this.deps.repository.inboxRecord(eventId)))
      return { outcome: 'DUPLICATE', eventId };
    let decoded: Decoded;
    try {
      decoded = decode(raw);
    } catch (error: unknown) {
      const reason = error instanceof ProjectionRejected ? error.reason : 'EVENT_INVALID';
      // Without a valid id there is no key to record under: rejected, not retried.
      if (!eventId) return { outcome: 'REJECTED', eventId: null, reason };
      const eventType = typeof rawType === 'string' ? rawType.slice(0, 120) : 'unknown';
      return this.recordOnly(eventId, eventType, null, reason);
    }
    return this.apply(decoded);
  }

  private async recordOnly(
    eventId: string,
    eventType: string,
    decoded: Decoded | null,
    reason: string,
  ): Promise<ProjectionOutcome> {
    const claimed = await this.deps.repository.transaction((uow) =>
      uow.claimEvent(this.inbox(eventId, eventType, decoded, 'REJECTED', reason)),
    );
    return claimed ? { outcome: 'REJECTED', eventId, reason } : { outcome: 'DUPLICATE', eventId };
  }

  private inbox(
    eventId: string,
    eventType: string,
    decoded: Decoded | null,
    outcome: InboxRecord['outcome'],
    reason: string | null,
  ): InboxRecord {
    return {
      eventId,
      eventType,
      aggregateType: decoded
        ? decoded.sourceKind === 'RECEIPT'
          ? 'billing-cash-receipt'
          : 'billing-custody-handover'
        : null,
      aggregateId: decoded?.aggregateId ?? null,
      aggregateVersion: decoded?.version ?? null,
      outcome,
      reason,
      correlationId: decoded?.correlationId ?? null,
      receivedAt: this.deps.clock.now(),
    };
  }

  private async apply(decoded: Decoded): Promise<ProjectionOutcome> {
    try {
      return await this.deps.repository.transaction(async (uow) => this.applyIn(uow, decoded));
    } catch (error: unknown) {
      if (error instanceof Duplicate) return { outcome: 'DUPLICATE', eventId: decoded.eventId };
      if (error instanceof ProjectionRejected)
        return this.recordOnly(decoded.eventId, decoded.eventType, decoded, error.reason);
      throw error;
    }
  }

  private async applyIn(uow: WalletUnitOfWork, decoded: Decoded): Promise<ProjectionOutcome> {
    const source = await uow.lockSource(decoded.sourceKind, decoded.aggregateId);
    if (source && decoded.version <= source.lastVersion) {
      if (
        !(await uow.claimEvent(
          this.inbox(decoded.eventId, decoded.eventType, decoded, 'STALE', 'VERSION_NOT_NEWER'),
        ))
      )
        throw new Duplicate();
      return { outcome: 'STALE', eventId: decoded.eventId };
    }
    const step = decoded.plan(source);
    const now = this.deps.clock.now();
    const account = await uow.lockAccount(step.holder, step.currency, now);
    const balances = applyStep(account.balances, step);
    // The account lock serialises concurrent deliveries of one event: the
    // loser finds the winner's inbox row here and writes nothing.
    if (
      !(await uow.claimEvent(
        this.inbox(decoded.eventId, decoded.eventType, decoded, 'APPLIED', null),
      ))
    )
      throw new Duplicate();
    await uow.saveSource(step.source, now);
    await uow.appendMovement({
      id: this.deps.ids.uuid(),
      holder: step.holder,
      currency: step.currency,
      kind: step.kind,
      delta: step.delta,
      eventId: decoded.eventId,
      eventType: decoded.eventType,
      sourceKind: decoded.sourceKind,
      sourceId: decoded.aggregateId,
      sourceVersion: decoded.version,
      occurredAt: decoded.occurredAt,
      recordedAt: now,
    });
    await uow.updateAccount({ ...account, balances, version: account.version + 1, updatedAt: now });
    return { outcome: 'APPLIED', eventId: decoded.eventId };
  }
}
