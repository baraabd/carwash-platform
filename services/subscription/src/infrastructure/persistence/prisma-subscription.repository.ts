import { Injectable } from '@nestjs/common';
import {
  CANCEL_REASONS,
  FREEZE_REASONS,
  MOVEMENT_KINDS,
  Money,
  RELEASE_REASONS,
  RESERVATION_STATUSES,
  REVERSE_REASONS,
  SUBSCRIPTION_STATUSES,
  type PeriodState,
  type PlanTerms,
  type RevisionHead,
} from '../../domain';
import {
  ReceiptAlreadyExists,
  UniqueConflict,
  type AuditRecord,
  type IdempotencyReceipt,
  type LedgerView,
  type LockedSubscription,
  type MovementRecord,
  type OutboxEvent,
  type PeriodRecord,
  type PlanRevisionRecord,
  type ReservationRecord,
  type SettlementReason,
  type SubscriptionRecord,
  type SubscriptionRepository,
  type SubscriptionUnitOfWork,
  type UniqueTarget,
  RepositoryBusy,
} from '../../ports';
import { Prisma, type PrismaClient } from '../../generated/prisma/client';
import { PrismaService } from './prisma.service';

type Tx = Prisma.TransactionClient;
type Db = Tx | PrismaClient;

/** Values read back are trusted only after re-checking them against the closed vocabularies. */
function member<T extends string>(value: string, allowed: readonly T[]): T {
  const found = allowed.find((candidate) => candidate === value);
  if (found === undefined) throw new Error('STORED_VALUE_UNKNOWN');
  return found;
}

function nullableMember<T extends string>(value: string | null, allowed: readonly T[]): T | null {
  return value === null ? null : member(value, allowed);
}

interface TermsColumns {
  displayName: string;
  priceCurrency: string;
  priceMinor: bigint;
  washUnits: number;
  periodDays: number;
  coveredPackageIds: string[];
  available: boolean;
}

function toTerms(row: TermsColumns): PlanTerms {
  return {
    displayName: row.displayName,
    price: Money.of(row.priceCurrency, row.priceMinor),
    washUnits: row.washUnits,
    periodDays: row.periodDays,
    coveredPackageIds: [...row.coveredPackageIds],
    available: row.available,
  };
}

function termsColumns(terms: PlanTerms): TermsColumns {
  return {
    displayName: terms.displayName,
    priceCurrency: terms.price.currency,
    priceMinor: terms.price.amountMinor,
    washUnits: terms.washUnits,
    periodDays: terms.periodDays,
    coveredPackageIds: [...terms.coveredPackageIds],
    available: terms.available,
  };
}

function toRevision(row: Prisma.SubscriptionPlanRevisionGetPayload<object>): PlanRevisionRecord {
  return {
    planCode: row.planCode,
    revision: row.revision,
    effectiveFrom: row.effectiveFrom,
    publishedAt: row.publishedAt,
    publishedBy: row.publishedBy,
    correlationId: row.correlationId,
    terms: toTerms(row),
  };
}

function toSubscription(row: Prisma.CustomerSubscriptionGetPayload<object>): SubscriptionRecord {
  return {
    id: row.id,
    customerSubject: row.customerSubject,
    planCode: row.planCode,
    planRevision: row.planRevision,
    status: member(row.status, SUBSCRIPTION_STATUSES),
    version: row.version,
    terms: toTerms(row),
    currentPeriodNo: row.currentPeriodNo,
    requestedAt: row.requestedAt,
    updatedAt: row.updatedAt,
    freezeReason: nullableMember(row.freezeReason, FREEZE_REASONS),
    cancelReason: nullableMember(row.cancelReason, CANCEL_REASONS),
  };
}

function toPeriod(row: Prisma.SubscriptionPeriodGetPayload<object>): PeriodRecord {
  return {
    subscriptionId: row.subscriptionId,
    periodNo: row.periodNo,
    planRevision: row.planRevision,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    granted: row.granted,
    reserved: row.reserved,
    consumed: row.consumed,
    paymentReference: row.paymentReference,
    grantedBy: row.grantedBy,
    grantedAt: row.grantedAt,
  };
}

const SETTLEMENT_REASONS: readonly SettlementReason[] = [...RELEASE_REASONS, ...REVERSE_REASONS];

function toReservation(row: Prisma.EntitlementReservationGetPayload<object>): ReservationRecord {
  return {
    id: row.id,
    subscriptionId: row.subscriptionId,
    periodNo: row.periodNo,
    bookingId: row.bookingId,
    packageId: row.packageId,
    scheduledFor: row.scheduledFor,
    status: member(row.status, RESERVATION_STATUSES),
    version: row.version,
    reservedAt: row.reservedAt,
    reservedBy: row.reservedBy,
    settledAt: row.settledAt,
    settledBy: row.settledBy,
    reason: nullableMember(row.reason, SETTLEMENT_REASONS),
    correlationId: row.correlationId,
  };
}

function toMovement(row: Prisma.EntitlementMovementGetPayload<object>): MovementRecord {
  return {
    id: row.id,
    subscriptionId: row.subscriptionId,
    periodNo: row.periodNo,
    reservationId: row.reservationId,
    kind: member(row.kind, MOVEMENT_KINDS),
    granted: row.granted,
    reserved: row.reserved,
    consumed: row.consumed,
    occurredAt: row.occurredAt,
    actor: { kind: member(row.actorKind, ['account', 'service'] as const), id: row.actorId },
    correlationId: row.correlationId,
  };
}

function uniqueTarget(
  error: unknown,
  targets: Readonly<Record<string, UniqueTarget>>,
): UniqueTarget | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002')
    return null;
  const meta = JSON.stringify(error.meta ?? {});
  for (const [index, target] of Object.entries(targets)) if (meta.includes(index)) return target;
  return null;
}

/**
 * P2028: no connection/transaction could be started within maxWait (or the
 * transaction expired). Nothing was committed, so the caller may retry.
 */
function busyOr(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2028')
    return new RepositoryBusy();
  return error;
}

async function findReceipt(
  db: Db,
  actor: string,
  operation: string,
  key: string,
): Promise<IdempotencyReceipt | null> {
  const row = await db.subscriptionIdempotencyReceipt.findUnique({
    where: {
      actorSubject_operation_idempotencyKey: {
        actorSubject: actor,
        operation,
        idempotencyKey: key,
      },
    },
  });
  if (!row) return null;
  return {
    actorSubject: row.actorSubject,
    operation: row.operation,
    idempotencyKey: row.idempotencyKey,
    requestFingerprint: row.requestFingerprint,
    // Written by saveReceipt from an object.
    outcome: {
      status: row.outcomeStatus,
      body: row.outcomeBody as Readonly<Record<string, unknown>>,
    },
  };
}

async function revisionsOf(db: Db, planCode: string): Promise<PlanRevisionRecord[]> {
  const rows = await db.subscriptionPlanRevision.findMany({
    where: { planCode },
    orderBy: { revision: 'asc' },
  });
  return rows.map(toRevision);
}

class PrismaSubscriptionUnitOfWork implements SubscriptionUnitOfWork {
  constructor(private readonly tx: Tx) {}

  async lockPlan(planCode: string, createdBy: string, at: Date): Promise<RevisionHead | null> {
    await this.tx.$executeRaw`
      INSERT INTO app.subscription_plan (code, created_at, created_by)
      VALUES (${planCode}, ${at}, ${createdBy}::uuid) ON CONFLICT (code) DO NOTHING`;
    await this.tx
      .$queryRaw`SELECT code FROM app.subscription_plan WHERE code = ${planCode} FOR UPDATE`;
    const head = await this.tx.subscriptionPlanRevision.findFirst({
      where: { planCode },
      orderBy: { revision: 'desc' },
    });
    return head ? { revision: head.revision, effectiveFrom: head.effectiveFrom } : null;
  }

  async insertRevision(revision: PlanRevisionRecord): Promise<void> {
    await this.tx.subscriptionPlanRevision.create({
      data: {
        planCode: revision.planCode,
        revision: revision.revision,
        effectiveFrom: revision.effectiveFrom,
        publishedAt: revision.publishedAt,
        publishedBy: revision.publishedBy,
        correlationId: revision.correlationId,
        ...termsColumns(revision.terms),
      },
    });
  }

  revisionsOf(planCode: string): Promise<PlanRevisionRecord[]> {
    return revisionsOf(this.tx, planCode);
  }

  findReceipt(actor: string, operation: string, key: string): Promise<IdempotencyReceipt | null> {
    return findReceipt(this.tx, actor, operation, key);
  }

  async saveReceipt(receipt: IdempotencyReceipt, recordedAt: Date): Promise<void> {
    try {
      await this.tx.subscriptionIdempotencyReceipt.create({
        data: {
          actorSubject: receipt.actorSubject,
          operation: receipt.operation,
          idempotencyKey: receipt.idempotencyKey,
          requestFingerprint: receipt.requestFingerprint,
          outcomeStatus: receipt.outcome.status,
          outcomeBody: receipt.outcome.body as Prisma.InputJsonObject,
          recordedAt,
        },
      });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ReceiptAlreadyExists();
      throw error;
    }
  }

  async insertSubscription(subscription: SubscriptionRecord): Promise<void> {
    try {
      await this.tx.customerSubscription.create({
        data: {
          id: subscription.id,
          customerSubject: subscription.customerSubject,
          planCode: subscription.planCode,
          planRevision: subscription.planRevision,
          status: subscription.status,
          version: subscription.version,
          ...termsColumns(subscription.terms),
          currentPeriodNo: subscription.currentPeriodNo,
          requestedAt: subscription.requestedAt,
          updatedAt: subscription.updatedAt,
          freezeReason: subscription.freezeReason,
          cancelReason: subscription.cancelReason,
          openSlot: subscription.status === 'CANCELLED' ? null : 1,
        },
      });
    } catch (error: unknown) {
      const target = uniqueTarget(error, { customer_subscription_open_key: 'OPEN_SUBSCRIPTION' });
      if (target) throw new UniqueConflict(target);
      throw error;
    }
  }

  async lockSubscription(id: string): Promise<LockedSubscription | null> {
    const locked = await this.tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM app.customer_subscription WHERE id = ${id}::uuid FOR UPDATE`;
    if (locked.length === 0) return null;
    const row = await this.tx.customerSubscription.findUnique({ where: { id } });
    if (!row) return null;
    const subscription = toSubscription(row);
    const period =
      subscription.currentPeriodNo === null
        ? null
        : await this.lockPeriod(id, subscription.currentPeriodNo);
    return { subscription, period };
  }

  async updateSubscription(subscription: SubscriptionRecord): Promise<void> {
    await this.tx.customerSubscription.update({
      where: { id: subscription.id },
      data: {
        planRevision: subscription.planRevision,
        status: subscription.status,
        version: subscription.version,
        ...termsColumns(subscription.terms),
        currentPeriodNo: subscription.currentPeriodNo,
        updatedAt: subscription.updatedAt,
        freezeReason: subscription.freezeReason,
        cancelReason: subscription.cancelReason,
        openSlot: subscription.status === 'CANCELLED' ? null : 1,
      },
    });
  }

  async insertPeriod(period: PeriodRecord): Promise<void> {
    try {
      await this.tx.subscriptionPeriod.create({
        data: {
          subscriptionId: period.subscriptionId,
          periodNo: period.periodNo,
          planRevision: period.planRevision,
          startsAt: period.startsAt,
          endsAt: period.endsAt,
          granted: period.granted,
          reserved: period.reserved,
          consumed: period.consumed,
          paymentReference: period.paymentReference,
          grantedBy: period.grantedBy,
          grantedAt: period.grantedAt,
        },
      });
    } catch (error: unknown) {
      const target = uniqueTarget(error, { subscription_period_payment_key: 'PAYMENT_REFERENCE' });
      if (target) throw new UniqueConflict(target);
      throw error;
    }
  }

  async lockPeriod(subscriptionId: string, periodNo: number): Promise<PeriodRecord | null> {
    const locked = await this.tx.$queryRaw<{ period_no: number }[]>`
      SELECT period_no FROM app.subscription_period
       WHERE subscription_id = ${subscriptionId}::uuid AND period_no = ${periodNo} FOR UPDATE`;
    if (locked.length === 0) return null;
    const row = await this.tx.subscriptionPeriod.findUnique({
      where: { subscriptionId_periodNo: { subscriptionId, periodNo } },
    });
    return row ? toPeriod(row) : null;
  }

  async updatePeriodCounters(
    period: PeriodState & { readonly subscriptionId: string },
  ): Promise<void> {
    await this.tx.subscriptionPeriod.update({
      where: {
        subscriptionId_periodNo: {
          subscriptionId: period.subscriptionId,
          periodNo: period.periodNo,
        },
      },
      data: { reserved: period.reserved, consumed: period.consumed },
    });
  }

  async reservationFor(
    subscriptionId: string,
    bookingId: string,
  ): Promise<ReservationRecord | null> {
    const row = await this.tx.entitlementReservation.findUnique({
      where: { subscriptionId_bookingId: { subscriptionId, bookingId } },
    });
    return row ? toReservation(row) : null;
  }

  async lockReservation(id: string): Promise<ReservationRecord | null> {
    const locked = await this.tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM app.entitlement_reservation WHERE id = ${id}::uuid FOR UPDATE`;
    if (locked.length === 0) return null;
    const row = await this.tx.entitlementReservation.findUnique({ where: { id } });
    return row ? toReservation(row) : null;
  }

  async insertReservation(reservation: ReservationRecord): Promise<void> {
    try {
      await this.tx.entitlementReservation.create({
        data: {
          id: reservation.id,
          subscriptionId: reservation.subscriptionId,
          periodNo: reservation.periodNo,
          bookingId: reservation.bookingId,
          packageId: reservation.packageId,
          scheduledFor: reservation.scheduledFor,
          status: reservation.status,
          version: reservation.version,
          reservedAt: reservation.reservedAt,
          reservedBy: reservation.reservedBy,
          settledAt: reservation.settledAt,
          settledBy: reservation.settledBy,
          reason: reservation.reason,
          correlationId: reservation.correlationId,
          liveSlot: 1,
        },
      });
    } catch (error: unknown) {
      const target = uniqueTarget(error, {
        entitlement_reservation_live_booking_key: 'LIVE_BOOKING_RESERVATION',
        entitlement_reservation_booking_key: 'RESERVATION_BOOKING',
      });
      if (target) throw new UniqueConflict(target);
      throw error;
    }
  }

  async updateReservation(reservation: ReservationRecord): Promise<void> {
    await this.tx.entitlementReservation.update({
      where: { id: reservation.id },
      data: {
        status: reservation.status,
        version: reservation.version,
        settledAt: reservation.settledAt,
        settledBy: reservation.settledBy,
        reason: reservation.reason,
        liveSlot:
          reservation.status === 'RESERVED' || reservation.status === 'COMMITTED' ? 1 : null,
      },
    });
  }

  async appendMovement(movement: MovementRecord): Promise<void> {
    await this.tx.entitlementMovement.create({
      data: {
        id: movement.id,
        subscriptionId: movement.subscriptionId,
        periodNo: movement.periodNo,
        reservationId: movement.reservationId,
        kind: movement.kind,
        granted: movement.granted,
        reserved: movement.reserved,
        consumed: movement.consumed,
        occurredAt: movement.occurredAt,
        actorKind: movement.actor.kind,
        actorId: movement.actor.id,
        correlationId: movement.correlationId,
      },
    });
  }

  async appendAudit(record: AuditRecord): Promise<void> {
    await this.tx.subscriptionAuditEvent.create({
      data: {
        id: record.id,
        occurredAt: record.occurredAt,
        actorKind: record.actor.kind,
        actorId: record.actor.id,
        action: record.action,
        planCode: record.planCode,
        subscriptionId: record.subscriptionId,
        reservationId: record.reservationId,
        outcome: record.outcome,
        correlationId: record.correlationId,
      },
    });
  }

  async appendOutbox(event: OutboxEvent): Promise<void> {
    await this.tx.outboxMessage.create({
      data: {
        id: event.eventId,
        eventId: event.eventId,
        eventType: event.eventType,
        exchange: event.exchange,
        routingKey: event.routingKey,
        payload: event.payload,
        correlationId: event.correlationId,
        traceParent: event.traceParent,
        createdAt: event.createdAt,
      },
    });
  }
}

@Injectable()
export class PrismaSubscriptionRepository implements SubscriptionRepository {
  private readonly client: PrismaClient;

  constructor(prisma: PrismaService) {
    this.client = prisma.client;
  }

  async transaction<T>(work: (uow: SubscriptionUnitOfWork) => Promise<T>): Promise<T> {
    try {
      return await this.client.$transaction((tx) => work(new PrismaSubscriptionUnitOfWork(tx)), {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 10_000,
        timeout: 15_000,
      });
    } catch (error: unknown) {
      throw busyOr(error);
    }
  }

  findReceipt(actor: string, operation: string, key: string): Promise<IdempotencyReceipt | null> {
    return findReceipt(this.client, actor, operation, key);
  }

  async planCodes(limit: number): Promise<string[]> {
    const rows = await this.client.subscriptionPlan.findMany({
      orderBy: { code: 'asc' },
      take: limit,
    });
    return rows.map((row) => row.code);
  }

  revisionsOf(planCode: string): Promise<PlanRevisionRecord[]> {
    return revisionsOf(this.client, planCode);
  }

  async subscription(id: string): Promise<SubscriptionRecord | null> {
    const row = await this.client.customerSubscription.findUnique({ where: { id } });
    return row ? toSubscription(row) : null;
  }

  async period(subscriptionId: string, periodNo: number): Promise<PeriodRecord | null> {
    const row = await this.client.subscriptionPeriod.findUnique({
      where: { subscriptionId_periodNo: { subscriptionId, periodNo } },
    });
    return row ? toPeriod(row) : null;
  }

  async subscriptionsOf(customerSubject: string, limit: number): Promise<SubscriptionRecord[]> {
    const rows = await this.client.customerSubscription.findMany({
      where: { customerSubject },
      orderBy: [{ requestedAt: 'desc' }, { id: 'asc' }],
      take: limit,
    });
    return rows.map(toSubscription);
  }

  async reservation(id: string): Promise<ReservationRecord | null> {
    const row = await this.client.entitlementReservation.findUnique({ where: { id } });
    return row ? toReservation(row) : null;
  }

  async reservationsForBooking(bookingId: string): Promise<ReservationRecord[]> {
    const rows = await this.client.entitlementReservation.findMany({
      where: { bookingId },
      orderBy: [{ reservedAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toReservation);
  }

  /** One consistent snapshot of every period and its movements. */
  async ledger(subscriptionId: string): Promise<LedgerView[]> {
    try {
      return await this.ledgerSnapshot(subscriptionId);
    } catch (error: unknown) {
      throw busyOr(error);
    }
  }

  private ledgerSnapshot(subscriptionId: string): Promise<LedgerView[]> {
    return this.client.$transaction(
      async (tx) => {
        const periods = await tx.subscriptionPeriod.findMany({
          where: { subscriptionId },
          orderBy: { periodNo: 'asc' },
        });
        const movements = await tx.entitlementMovement.findMany({
          where: { subscriptionId },
          orderBy: [{ periodNo: 'asc' }, { seq: 'asc' }],
        });
        return periods.map((period) => ({
          period: toPeriod(period),
          movements: movements.filter((m) => m.periodNo === period.periodNo).map(toMovement),
        }));
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        maxWait: 5_000,
        timeout: 10_000,
      },
    );
  }
}
