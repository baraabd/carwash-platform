import {
  DELTAS,
  PACKAGE_ID,
  RELEASE_REASONS,
  REVERSE_REASONS,
  SubscriptionRuleError,
  applyMovement,
  nextReservationStatus,
  planReservation,
  type ReservationStatus,
  type SettlementKind,
} from '../domain';
import type {
  AccessAuthority,
  ActorRef,
  AuditAction,
  Clock,
  Hasher,
  IdGenerator,
  ReservationRecord,
  ServiceCallerAuthority,
  SettlementReason,
  SubscriptionRepository,
  SubscriptionUnitOfWork,
} from '../ports';
import { canonicalJson } from './canonical-json';
import { asApplicationError, receiptCommand, type CommandResult } from './command-support';
import { entitlementChangedEvent, entitlementReservedEvent } from './events';
import {
  MANAGE_PERMISSION,
  idempotencyKey,
  objectWithKeys,
  oneOf,
  pathId,
  serviceCaller,
  timestamp,
  uuidField,
  verifiedPrincipal,
  type RequestContext,
} from './request-support';
import { SubscriptionApplicationError } from './subscription-errors';
import { ledgerView, reservationView } from './views';

export const REVERSE_OPERATION = 'subscription.entitlement.reverse.v1';

const SETTLEMENT_ACTIONS: Readonly<Record<SettlementKind, AuditAction>> = {
  RESERVE: 'subscription.entitlement.reserved',
  COMMIT: 'subscription.entitlement.committed',
  RELEASE: 'subscription.entitlement.released',
  REVERSE: 'subscription.entitlement.reversed',
};

const TARGET: Readonly<Record<'COMMIT' | 'RELEASE', ReservationStatus>> = {
  COMMIT: 'COMMITTED',
  RELEASE: 'RELEASED',
};

/**
 * Entitlement reservations used by the Booking saga (service credential with
 * an explicit scope) plus the audited staff reversal.
 *
 * Idempotency is natural: (subscription, booking) identifies a reservation, so a
 * retried reserve returns the same reservation and can never take a second
 * unit; commit/release of a reservation already in that state is a replay.
 * Concurrent reservations serialise on the subscription row lock, and the
 * database refuses any period whose reserved + consumed exceeds its grant.
 */
export class EntitlementService {
  constructor(
    private readonly deps: {
      readonly repository: SubscriptionRepository;
      readonly authority: AccessAuthority;
      readonly callers: ServiceCallerAuthority;
      readonly clock: Clock;
      readonly ids: IdGenerator;
      readonly hasher: Hasher;
    },
  ) {}

  private async record(
    uow: SubscriptionUnitOfWork,
    now: Date,
    actor: ActorRef,
    kind: SettlementKind,
    reservation: ReservationRecord,
    previous: ReservationStatus | null,
    correlationId: string,
  ): Promise<void> {
    const delta = DELTAS[kind];
    await uow.appendMovement({
      id: this.deps.ids.uuid(),
      subscriptionId: reservation.subscriptionId,
      periodNo: reservation.periodNo,
      reservationId: reservation.id,
      kind,
      granted: delta.granted,
      reserved: delta.reserved,
      consumed: delta.consumed,
      occurredAt: now,
      actor,
      correlationId,
    });
    await uow.appendAudit({
      id: this.deps.ids.uuid(),
      occurredAt: now,
      actor,
      action: SETTLEMENT_ACTIONS[kind],
      planCode: null,
      subscriptionId: reservation.subscriptionId,
      reservationId: reservation.id,
      outcome: reservation.status,
      correlationId,
    });
    const context = {
      eventId: this.deps.ids.uuid(),
      occurredAt: now,
      correlationId,
      actor,
      aggregateId: reservation.id,
      version: reservation.version,
    };
    await uow.appendOutbox(
      previous === null
        ? entitlementReservedEvent(
            {
              subscriptionId: reservation.subscriptionId,
              bookingId: reservation.bookingId,
              periodNo: reservation.periodNo,
            },
            context,
          )
        : entitlementChangedEvent(
            {
              subscriptionId: reservation.subscriptionId,
              bookingId: reservation.bookingId,
              periodNo: reservation.periodNo,
              previousStatus: previous,
              status: reservation.status,
              reason: reservation.reason,
            },
            context,
          ),
    );
  }

  /**
   * Reserves one wash unit for a booking. The caller (Booking) states the
   * customer it acts for; a subscription of anyone else is NOT_FOUND.
   */
  async reserve(context: RequestContext, body: unknown): Promise<CommandResult> {
    const client = serviceCaller(this.deps.callers, context, 'subscription.entitlement.reserve');
    const input = objectWithKeys(body, [
      'subscriptionId',
      'bookingId',
      'customerSubject',
      'packageId',
      'scheduledFor',
    ]);
    const subscriptionId = uuidField(input.subscriptionId, 'subscriptionId');
    const bookingId = uuidField(input.bookingId, 'bookingId');
    const customerSubject = uuidField(input.customerSubject, 'customerSubject');
    if (typeof input.packageId !== 'string' || !PACKAGE_ID.test(input.packageId))
      throw new SubscriptionApplicationError('REQUEST_INVALID', { field: 'packageId' });
    const packageId = input.packageId;
    const scheduledFor = timestamp(input.scheduledFor, 'scheduledFor', false) ?? new Date(0);
    const actor: ActorRef = { kind: 'service', id: client };
    try {
      return await this.deps.repository.transaction(async (uow) => {
        const locked = await uow.lockSubscription(subscriptionId);
        if (!locked || locked.subscription.customerSubject !== customerSubject)
          throw new SubscriptionApplicationError('NOT_FOUND');
        const existing = await uow.reservationFor(subscriptionId, bookingId);
        if (existing) {
          // Retried reserve: the same booking never takes a second unit.
          if (
            existing.packageId !== packageId ||
            existing.scheduledFor.getTime() !== scheduledFor.getTime()
          )
            throw new SubscriptionApplicationError('RESERVATION_CONFLICT');
          return { status: 200, body: reservationView(existing), replayed: true };
        }
        const now = this.deps.clock.now();
        const next = planReservation({
          state: {
            status: locked.subscription.status,
            version: locked.subscription.version,
            terms: locked.subscription.terms,
            currentPeriod: locked.period,
          },
          packageId,
          scheduledFor,
          now,
        });
        const reservation: ReservationRecord = {
          id: this.deps.ids.uuid(),
          subscriptionId,
          periodNo: next.periodNo,
          bookingId,
          packageId,
          scheduledFor,
          status: 'RESERVED',
          version: 1,
          reservedAt: now,
          reservedBy: client,
          settledAt: null,
          settledBy: null,
          reason: null,
          correlationId: context.correlationId,
        };
        await uow.insertReservation(reservation);
        await uow.updatePeriodCounters({ ...next, subscriptionId });
        await this.record(uow, now, actor, 'RESERVE', reservation, null, context.correlationId);
        return { status: 201, body: reservationView(reservation), replayed: false };
      });
    } catch (error: unknown) {
      throw asApplicationError(error);
    }
  }

  /** Saga recovery: every reservation a booking holds (any status). */
  async forBooking(
    context: RequestContext,
    bookingId: string | undefined,
  ): Promise<{ reservations: Record<string, unknown>[] }> {
    serviceCaller(this.deps.callers, context, 'subscription.entitlement.reserve');
    const id = uuidField(bookingId, 'bookingId');
    const reservations = await this.deps.repository.reservationsForBooking(id);
    return { reservations: reservations.map(reservationView) };
  }

  private async settle(
    uow: SubscriptionUnitOfWork,
    now: Date,
    actor: ActorRef,
    reservation: ReservationRecord,
    kind: 'COMMIT' | 'RELEASE' | 'REVERSE',
    reason: SettlementReason | null,
    correlationId: string,
  ): Promise<ReservationRecord> {
    const status = nextReservationStatus(reservation.status, kind);
    const period = await uow.lockPeriod(reservation.subscriptionId, reservation.periodNo);
    if (!period) throw new Error('RESERVATION_PERIOD_MISSING');
    const next = applyMovement(period, kind);
    const updated: ReservationRecord = {
      ...reservation,
      status,
      version: reservation.version + 1,
      settledAt: now,
      settledBy: actor.id,
      reason,
    };
    await uow.updateReservation(updated);
    await uow.updatePeriodCounters({ ...next, subscriptionId: reservation.subscriptionId });
    await this.record(uow, now, actor, kind, updated, reservation.status, correlationId);
    return updated;
  }

  /** Booking saga: the wash was delivered (COMMIT) or the booking failed/cancelled (RELEASE). */
  async complete(
    context: RequestContext,
    id: string,
    kind: 'COMMIT' | 'RELEASE',
    body: unknown,
  ): Promise<CommandResult> {
    const client = serviceCaller(this.deps.callers, context, 'subscription.entitlement.settle');
    const reservationId = pathId(id);
    let reason: SettlementReason | null = null;
    if (kind === 'RELEASE')
      reason = oneOf(objectWithKeys(body, ['reason']).reason, RELEASE_REASONS, 'reason');
    else objectWithKeys(body ?? {}, []);
    const actor: ActorRef = { kind: 'service', id: client };
    try {
      return await this.deps.repository.transaction(async (uow) => {
        const reservation = await uow.lockReservation(reservationId);
        if (!reservation) throw new SubscriptionApplicationError('NOT_FOUND');
        // Same terminal state again is a replay, whatever reason was sent.
        if (reservation.status === TARGET[kind])
          return { status: 200, body: reservationView(reservation), replayed: true };
        const now = this.deps.clock.now();
        const updated = await this.settle(
          uow,
          now,
          actor,
          reservation,
          kind,
          reason,
          context.correlationId,
        );
        return { status: 200, body: reservationView(updated), replayed: false };
      });
    } catch (error: unknown) {
      throw asApplicationError(error);
    }
  }

  /**
   * Staff return a CONSUMED unit (e.g. the wash was not actually delivered).
   * Receipt-idempotent; never on the reviewer's own subscription.
   */
  async reverse(
    context: RequestContext,
    key: unknown,
    id: string,
    body: unknown,
  ): Promise<CommandResult> {
    const principal = await verifiedPrincipal(this.deps.authority, context, MANAGE_PERMISSION);
    const idempotency = idempotencyKey(key);
    const reservationId = pathId(id);
    const reason = oneOf(objectWithKeys(body, ['reason']).reason, REVERSE_REASONS, 'reason');
    const actor: ActorRef = { kind: 'account', id: principal.subject };
    const fingerprint = this.deps.hasher.sha256Hex(
      canonicalJson({
        operation: REVERSE_OPERATION,
        actor: principal.subject,
        reservationId,
        reason,
      }),
    );
    // The owner of a reservation's subscription never changes: read it before locking.
    const known = await this.deps.repository.reservation(reservationId);
    const owner = known ? await this.deps.repository.subscription(known.subscriptionId) : null;
    if (!known || !owner) throw new SubscriptionApplicationError('NOT_FOUND');
    if (owner.customerSubject === principal.subject)
      throw new SubscriptionApplicationError('SELF_SERVICE_FORBIDDEN');
    return receiptCommand({
      repository: this.deps.repository,
      clock: this.deps.clock,
      actor: principal.subject,
      operation: REVERSE_OPERATION,
      key: idempotency,
      fingerprint,
      work: async (uow, now) => {
        const reservation = await uow.lockReservation(reservationId);
        if (!reservation) throw new SubscriptionApplicationError('NOT_FOUND');
        if (reservation.status !== 'COMMITTED')
          throw new SubscriptionRuleError('RESERVATION_NOT_COMMITTED');
        const updated = await this.settle(
          uow,
          now,
          actor,
          reservation,
          'REVERSE',
          reason,
          context.correlationId,
        );
        return { status: 200, body: reservationView(updated) };
      },
    });
  }

  /** Staff reconciliation of a subscription's entitlement ledger. */
  async ledger(context: RequestContext, id: string): Promise<Record<string, unknown>> {
    await verifiedPrincipal(this.deps.authority, context, MANAGE_PERMISSION);
    const subscriptionId = pathId(id);
    if (!(await this.deps.repository.subscription(subscriptionId)))
      throw new SubscriptionApplicationError('NOT_FOUND');
    return { subscriptionId, ...ledgerView(await this.deps.repository.ledger(subscriptionId)) };
  }
}
