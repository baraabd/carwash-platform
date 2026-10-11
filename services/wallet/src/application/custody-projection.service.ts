import {
  createLogger,
  type ApplicationMessage,
  type ApplicationMessageHandler,
} from '@carwash/service-kit';
import {
  CustodyIntegrityError,
  applyHandoverFact,
  applyReceiptFact,
  type Applied,
  type CustodyFact,
  type MovementPlan,
} from '../domain';
import type {
  Clock,
  CustodyProjectionStore,
  CustodyUnitOfWork,
  Hasher,
  IdGenerator,
  InboxEntry,
  InboxOutcome,
} from '../ports';
import { canonicalJson } from './canonical-json';
import { translate, type FactMeta } from './billing-events';
import { WalletApplicationError } from './errors';

export type ProjectionOutcome = InboxOutcome | 'DUPLICATE' | 'CONFLICT';

export interface CustodyProjectionDeps {
  readonly store: CustodyProjectionStore;
  readonly clock: Clock;
  readonly hasher: Hasher;
  readonly ids: IdGenerator;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENT_TYPE = /^[a-z][a-z0-9.-]{2,95}$/;

/**
 * Applies one billing.v1 delivery to the custody projection, exactly once.
 *
 * The inbox row, the state rows, the account balances and the movements are
 * written by ONE local transaction, so a redelivery after a crash either finds
 * the committed inbox row (DUPLICATE) or nothing at all. The broker ACKs only
 * after this returns. Same event id with different bytes is an integrity fault:
 * recorded, never applied, and surfaced as non-retryable so the broker
 * dead-letters it. Unreadable or contradictory events are recorded as POISON
 * and acknowledged: retrying identical bytes cannot succeed.
 */
export class CustodyProjectionService implements ApplicationMessageHandler<unknown> {
  private readonly logger = createLogger({
    service: 'wallet',
    base: { component: 'wallet-custody-projection' },
  });

  constructor(private readonly deps: CustodyProjectionDeps) {}

  async handle(message: ApplicationMessage<unknown>): Promise<void> {
    const outcome = await this.apply(message);
    if (outcome === 'CONFLICT') throw new WalletApplicationError('INBOX_CONFLICT');
  }

  async apply(message: ApplicationMessage<unknown>): Promise<ProjectionOutcome> {
    if (!UUID.test(message.id) || !EVENT_TYPE.test(message.type))
      throw new WalletApplicationError('REQUEST_INVALID');
    const eventId = message.id.toLowerCase();
    const payload = decode(message.payload);
    const payloadHash = this.deps.hasher.sha256Hex(
      payload === undefined ? 'undecodable' : canonicalJson(payload),
    );
    const translation =
      payload === undefined
        ? ({ kind: 'POISON', reason: 'PAYLOAD_NOT_JSON' } as const)
        : translate(eventId, message.type, payload);

    const outcome = await this.deps.store.transaction(async (uow) => {
      const now = this.deps.clock.now();
      const committed = await uow.inbox(eventId);
      if (committed) return this.classify(uow, eventId, committed.payloadHash, payloadHash, now);
      const base = {
        eventId,
        eventType: message.type,
        payloadHash,
        correlationId: null,
        occurredAt: null,
        aggregate: null,
        receivedAt: now,
      };
      if (translation.kind !== 'FACT') {
        const entry: InboxEntry = {
          ...base,
          outcome: translation.kind,
          reason: translation.reason,
        };
        return this.claimed(uow, entry, payloadHash, now, () => translation.kind);
      }
      const { fact, meta } = translation;
      const entry = (outcome: InboxOutcome, reason: string | null): InboxEntry => ({
        ...base,
        outcome,
        reason,
        correlationId: meta.correlationId,
        occurredAt: meta.occurredAt,
        aggregate: meta.aggregate,
      });
      await uow.lockAggregate(meta.aggregate.id);
      let applied: Applied<unknown> & { holder: string | null };
      let save: () => Promise<void>;
      try {
        ({ applied, save } = await this.plan(uow, fact, now));
      } catch (error: unknown) {
        if (!(error instanceof CustodyIntegrityError)) throw error;
        return this.claimed(uow, entry('POISON', error.code), payloadHash, now, () => 'POISON');
      }
      if (applied.outcome === 'STALE')
        return this.claimed(uow, entry('STALE', null), payloadHash, now, () => 'STALE');
      const movements = applied.movements;
      const holder = applied.holder;
      return this.claimed(
        uow,
        entry('APPLIED', null),
        payloadHash,
        now,
        async (): Promise<ProjectionOutcome> => {
          await save();
          if (holder !== null && movements.length > 0)
            await this.post(uow, holder, movements, meta, now);
          return 'APPLIED';
        },
      );
    });

    this.logger.info('wallet_custody_event', {
      eventId,
      eventType: message.type,
      outcome,
      correlationId: translation.kind === 'FACT' ? translation.meta.correlationId : null,
      reason: translation.kind === 'FACT' ? null : translation.reason,
    });
    return outcome;
  }

  /** Runs `effect` only when this delivery wins the inbox claim. */
  private async claimed(
    uow: CustodyUnitOfWork,
    entry: InboxEntry,
    payloadHash: string,
    now: Date,
    effect: () => ProjectionOutcome | Promise<ProjectionOutcome>,
  ): Promise<ProjectionOutcome> {
    if (await uow.claimInbox(entry)) return effect();
    const winner = await uow.inbox(entry.eventId);
    if (!winner) throw new Error('INBOX_CLAIM_LOST_WITHOUT_WINNER');
    return this.classify(uow, entry.eventId, winner.payloadHash, payloadHash, now);
  }

  private async classify(
    uow: CustodyUnitOfWork,
    eventId: string,
    committedHash: string,
    payloadHash: string,
    now: Date,
  ): Promise<ProjectionOutcome> {
    if (committedHash === payloadHash) return 'DUPLICATE';
    await uow.recordInboxConflict(eventId, payloadHash, now);
    return 'CONFLICT';
  }

  private async plan(
    uow: CustodyUnitOfWork,
    fact: CustodyFact,
    now: Date,
  ): Promise<{
    applied: Applied<unknown> & { holder: string | null };
    save: () => Promise<void>;
  }> {
    if (fact.kind === 'HANDOVER') {
      const current = await uow.handover(fact.handoverId);
      const result = applyHandoverFact(current, fact);
      return {
        applied: { ...result, holder: fact.holder },
        save: async () => {
          if (result.outcome === 'APPLIED')
            await uow.saveHandover(result.next, current !== null, now);
        },
      };
    }
    const current = await uow.receipt(fact.receiptId);
    const result = applyReceiptFact(current, fact);
    return {
      applied: {
        ...result,
        holder: result.outcome === 'APPLIED' ? result.next.holder : null,
      },
      save: async () => {
        if (result.outcome === 'APPLIED') await uow.saveReceipt(result.next, current !== null, now);
      },
    };
  }

  /** Account balances are re-derived from state rows, then movements reference the events. */
  private async post(
    uow: CustodyUnitOfWork,
    holder: string,
    movements: readonly MovementPlan[],
    meta: FactMeta,
    now: Date,
  ): Promise<void> {
    const first = movements[0];
    if (!first) return;
    const account = await uow.lockAccount(holder, first.amount.currency, this.deps.ids.uuid(), now);
    const revision = await uow.refreshAccount(
      account,
      { eventId: meta.eventId, occurredAt: meta.occurredAt },
      now,
    );
    for (const movement of movements) {
      await uow.appendMovement({
        id: this.deps.ids.uuid(),
        account,
        eventId: movement.eventId,
        kind: movement.kind,
        amountMinor: movement.amount.minor,
        source: { type: meta.aggregate.type, id: meta.aggregate.id },
        appliedWithEventId: meta.eventId,
        accountRevision: revision,
        recordedAt: now,
      });
    }
  }
}

/** Accepts a parsed object or the raw JSON text a broker adapter hands over. */
function decode(payload: unknown): unknown {
  if (typeof payload !== 'string') return payload ?? undefined;
  try {
    return JSON.parse(payload) as unknown;
  } catch {
    return undefined;
  }
}
