import { subscriptionV1 } from '@carwash/contracts';
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
  FundingAuthority,
  Hasher,
  IdGenerator,
  ReservationRecord,
  RecordedOutcome,
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
import { requirePeriodFunding } from './period-funding';

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
      readonly funding: FundingAuthority;
      readonly authority: AccessAuthority;
      readonly callers: ServiceCallerAuthority;
      readonly clock: Clock;
      readonly ids: IdGenerator;
      readonly hasher: Hasher;
    },
  ) {}

  private canonicalInput<T>(parse: (body: unknown) => T, body: unknown): T {
    try {
      return parse(body);
    } catch {
      throw new SubscriptionApplicationError('REQUEST_INVALID');
    }
  }

  private async canonicalView(
    reservation: ReservationRecord,
    uow?: SubscriptionUnitOfWork,
  ): Promise<Record<string, unknown>> {
    const purchase = await this.deps.repository.purchaseForSubscription(reservation.subscriptionId);
    if (purchase?.status !== 'ACTIVATED') throw new SubscriptionApplicationError('NOT_FOUND');
    const period = uow
      ? await uow.lockPeriod(reservation.subscriptionId, reservation.periodNo)
      : await this.deps.repository.period(reservation.subscriptionId, reservation.periodNo);
    if (!period || reservation.status === 'REVERSED')
      throw new SubscriptionApplicationError('RESERVATION_NOT_RESERVED');
    return {
      ...subscriptionV1.parseEntitlementReservationV1({
        reservationId: reservation.id,
        revision: reservation.version,
        subscriptionId: reservation.subscriptionId,
        bookingId: reservation.bookingId,
        packageId: reservation.packageId,
        status: reservation.status === 'COMMITTED' ? 'CONSUMED' : reservation.status,
        reservedAt: reservation.reservedAt.toISOString(),
        expiresAt: period.endsAt.toISOString(),
        resolvedAt: reservation.settledAt?.toISOString() ?? null,
      }),
    };
  }

  private async workloadCommand(
    clientId: string,
    operation: string,
    rawKey: unknown,
    input: unknown,
    work: (uow: SubscriptionUnitOfWork, now: Date) => Promise<RecordedOutcome>,
  ): Promise<CommandResult> {
    const key = idempotencyKey(rawKey);
    const fingerprint = this.deps.hasher.sha256Hex(canonicalJson(input));
    try {
      return await this.deps.repository.transaction(async (uow) => {
        const receipt = await uow.lockWorkloadReceipt(clientId, operation, key);
        if (receipt) {
          if (receipt.fingerprint !== fingerprint)
            throw new SubscriptionApplicationError('IDEMPOTENCY_CONFLICT');
          return { ...receipt.outcome, replayed: true };
        }
        const now = this.deps.clock.now();
        const outcome = await work(uow, now);
        await uow.saveWorkloadReceipt({ clientId, operation, key, fingerprint, outcome }, now);
        return { ...outcome, replayed: false };
      });
    } catch (error: unknown) {
      throw asApplicationError(error);
    }
  }

  /** Published subscription.v1 participant, with durable key and natural Booking fences. */
  async reserveCanonical(
    context: RequestContext,
    rawKey: unknown,
    body: unknown,
  ): Promise<CommandResult> {
    const client = serviceCaller(this.deps.callers, context, 'subscription.entitlement.reserve');
    const input = this.canonicalInput(subscriptionV1.parseReserveEntitlementRequestV1, body);
    if (input.beneficiary.kind !== 'account') throw new SubscriptionApplicationError('NOT_FOUND');
    const purchase = await this.deps.repository.purchaseForSubscription(input.subscriptionId);
    if (
      purchase?.status !== 'ACTIVATED' ||
      purchase.customerSubject !== input.beneficiary.subjectId
    )
      throw new SubscriptionApplicationError('NOT_FOUND');
    if (!input.scheduledFor)
      throw new SubscriptionApplicationError('REQUEST_INVALID', { field: 'scheduledFor' });
    if (!input.vehicleType)
      throw new SubscriptionApplicationError('REQUEST_INVALID', { field: 'vehicleType' });
    const scheduledFor = new Date(input.scheduledFor);
    return this.workloadCommand(
      client,
      'subscription.entitlement.reserve.v1',
      rawKey,
      input,
      async (uow, now) => {
        const locked = await uow.lockSubscription(input.subscriptionId);
        if (!locked || locked.subscription.customerSubject !== input.beneficiary.subjectId)
          throw new SubscriptionApplicationError('NOT_FOUND');
        if (!locked.subscription.terms.vehicleTypes?.includes(input.vehicleType ?? ''))
          throw new SubscriptionApplicationError('PACKAGE_NOT_COVERED');
        const existing = await uow.reservationFor(input.subscriptionId, input.bookingId);
        if (existing) {
          if (
            existing.reservedBy !== client ||
            existing.packageId !== input.packageId ||
            existing.scheduledFor.getTime() !== scheduledFor.getTime()
          )
            throw new SubscriptionApplicationError('RESERVATION_CONFLICT');
          return { status: 200, body: await this.canonicalView(existing, uow) };
        }
        if (locked.subscription.version !== input.expectedRevision)
          throw new SubscriptionApplicationError('VERSION_CONFLICT');
        const next = planReservation({
          state: {
            status: locked.subscription.status,
            version: locked.subscription.version,
            terms: locked.subscription.terms,
            currentPeriod: locked.period,
          },
          packageId: input.packageId,
          scheduledFor,
          now,
        });
        const reservation: ReservationRecord = {
          id: this.deps.ids.uuid(),
          subscriptionId: input.subscriptionId,
          periodNo: next.periodNo,
          bookingId: input.bookingId,
          packageId: input.packageId,
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
        if (!locked.period) throw new SubscriptionApplicationError('SUBSCRIPTION_NOT_ACTIVE');
        await requirePeriodFunding(
          this.deps.funding,
          uow,
          locked.subscription,
          locked.period,
          context.correlationId,
        );
        await uow.insertReservation(reservation);
        await uow.updatePeriodCounters({ ...next, subscriptionId: input.subscriptionId });
        await this.record(
          uow,
          now,
          { kind: 'service', id: client },
          'RESERVE',
          reservation,
          null,
          context.correlationId,
        );
        return { status: 201, body: await this.canonicalView(reservation, uow) };
      },
    );
  }

  async resolveCanonical(
    context: RequestContext,
    rawKey: unknown,
    rawId: string,
    body: unknown,
  ): Promise<CommandResult> {
    const client = serviceCaller(this.deps.callers, context, 'subscription.entitlement.resolve');
    const reservationId = pathId(rawId);
    const input = this.canonicalInput(subscriptionV1.parseResolveEntitlementRequestV1, body);
    const kind = input.action === 'CONSUME' ? 'COMMIT' : 'RELEASE';
    return this.workloadCommand(
      client,
      'subscription.entitlement.resolve.v1',
      rawKey,
      { reservationId, ...input },
      async (uow, now) => {
        const reservation = await uow.lockReservation(reservationId);
        if (
          !reservation ||
          reservation.reservedBy !== client ||
          reservation.bookingId !== input.bookingId
        )
          throw new SubscriptionApplicationError('NOT_FOUND');
        if (reservation.status === TARGET[kind])
          return { status: 200, body: await this.canonicalView(reservation, uow) };
        const updated = await this.settle(
          uow,
          now,
          { kind: 'service', id: client },
          reservation,
          kind,
          kind === 'RELEASE' ? 'SAGA_COMPENSATION' : null,
          context.correlationId,
        );
        return { status: 200, body: await this.canonicalView(updated, uow) };
      },
    );
  }

  async getCanonical(context: RequestContext, rawId: string): Promise<Record<string, unknown>> {
    const client = serviceCaller(this.deps.callers, context, 'subscription.entitlement.read');
    const reservation = await this.deps.repository.reservation(pathId(rawId));
    if (!reservation || reservation.reservedBy !== client)
      throw new SubscriptionApplicationError('NOT_FOUND');
    return this.canonicalView(reservation);
  }

  async findCanonical(
    context: RequestContext,
    bookingId: unknown,
  ): Promise<{ items: Record<string, unknown>[] }> {
    const client = serviceCaller(this.deps.callers, context, 'subscription.entitlement.read');
    const reservations = await this.deps.repository.reservationsForBooking(
      uuidField(bookingId, 'bookingId'),
    );
    const visible = await Promise.all(
      reservations
        .filter((r) => r.reservedBy === client)
        .map(async (reservation) => {
          const purchase = await this.deps.repository.purchaseForSubscription(
            reservation.subscriptionId,
          );
          return purchase?.status === 'ACTIVATED' ? this.canonicalView(reservation) : null;
        }),
    );
    return { items: visible.filter((reservation) => reservation !== null) };
  }

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
    if (await this.deps.repository.purchaseForSubscription(subscriptionId))
      throw new SubscriptionApplicationError('LEGACY_OPERATION_NOT_ALLOWED');
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
        if (!locked.period) throw new SubscriptionApplicationError('SUBSCRIPTION_NOT_ACTIVE');
        await requirePeriodFunding(
          this.deps.funding,
          uow,
          locked.subscription,
          locked.period,
          context.correlationId,
        );
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
    if (kind === 'COMMIT') {
      const subscription = await this.deps.repository.subscription(reservation.subscriptionId);
      if (!subscription) throw new SubscriptionApplicationError('NOT_FOUND');
      await requirePeriodFunding(this.deps.funding, uow, subscription, period, correlationId);
    }
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
    const known = await this.deps.repository.reservation(reservationId);
    if (known && (await this.deps.repository.purchaseForSubscription(known.subscriptionId)))
      throw new SubscriptionApplicationError('LEGACY_OPERATION_NOT_ALLOWED');
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
    if (await this.deps.repository.purchaseForSubscription(known.subscriptionId))
      throw new SubscriptionApplicationError('LEGACY_OPERATION_NOT_ALLOWED');
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
