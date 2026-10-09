import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import {
  ASSIGNMENT_STATUSES,
  CASH_STATES,
  DERIVED_STATUSES,
  OPERATIONS_SOURCES,
  OperationsIntegrityError,
  OperationsRuleError,
  currentSlot,
  decideFact,
  linkedBooking,
  type AssignmentChangedFact,
  type AssignmentStatus,
  type BookingConfirmedFact,
  type CashState,
  type DerivedOperationsStatus,
  type Eligibility,
  type EligibilityChangedFact,
  type FreshnessCheckpoint,
  type HoldChangedFact,
  type HoldState,
  type ObligationStatusFact,
  type OperationsSource,
} from '../../domain/operations';
import {
  mergeMilestones,
  type AssignmentMilestones,
  type DurationSummary,
} from '../../domain/live-operations';
import type {
  AssignmentRow,
  BookingOperationRow,
  CashStateRow,
  EligibilitySummary,
  FactOutcome,
  LinkedHoldRow,
  OperationsKpiRows,
  OperationsReader,
  OperationsWriter,
  Page,
  ResourceEligibilityRow,
} from '../../ports/operations.ports';

const HOLD_STATES: readonly HoldState[] = ['HELD', 'COMMITTED', 'RELEASED', 'EXPIRED'];

function holdState(value: string): HoldState {
  const state = HOLD_STATES.find((s) => s === value);
  if (!state) throw new Error('CORRUPT_PERSISTED_HOLD_STATE');
  return state;
}

function eligibilityOf(value: string): Eligibility {
  if (value !== 'ELIGIBLE' && value !== 'INELIGIBLE')
    throw new Error('CORRUPT_PERSISTED_ELIGIBILITY');
  return value;
}

function sourceOf(value: string): OperationsSource {
  const source = OPERATIONS_SOURCES.find((s) => s === value);
  if (!source) throw new Error('CORRUPT_PERSISTED_SOURCE');
  return source;
}

function assignmentStatusOf(value: string): AssignmentStatus {
  const status = ASSIGNMENT_STATUSES.find((s) => s === value);
  if (!status) throw new Error('CORRUPT_PERSISTED_ASSIGNMENT_STATUS');
  return status;
}

function cashStateOf(value: string): CashState {
  const state = CASH_STATES.find((s) => s === value);
  if (!state) throw new Error('CORRUPT_PERSISTED_CASH_STATE');
  return state;
}

function sameTime(a: Date | null, b: Date | null): boolean {
  return a === null || b === null ? a === b : a.getTime() === b.getTime();
}

function sameMilestones(a: AssignmentMilestones, b: AssignmentMilestones): boolean {
  return (
    sameTime(a.firstObservedAt, b.firstObservedAt) &&
    sameTime(a.firstOfferedAt, b.firstOfferedAt) &&
    sameTime(a.firstAssignedAt, b.firstAssignedAt)
  );
}

function latest(a: Date | null, b: Date): Date {
  return a && a.getTime() > b.getTime() ? a : b;
}

/**
 * Transaction-scoped advisory lock on one aggregate key. It references no
 * table, so it needs no schema qualification. Lock order is always hold then
 * booking, so two writers can never wait on each other in a cycle.
 */
async function lock(tx: Prisma.TransactionClient, key: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

export class PrismaOperationsWriter implements OperationsWriter {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async applyBookingConfirmed(fact: BookingConfirmedFact, hash: string): Promise<FactOutcome> {
    await lock(this.tx, `ops-booking:${fact.bookingId}`);
    const current = await this.tx.opsBooking.findUnique({ where: { bookingId: fact.bookingId } });
    const decision = decideFact(
      current?.confirmationVersion != null && current.confirmationFingerprint
        ? { version: current.confirmationVersion, fingerprint: current.confirmationFingerprint }
        : null,
      { version: fact.version, fingerprint: hash },
    );
    if (decision !== 'APPLY') return decision;
    const confirmation = {
      customerRef: fact.customerRef,
      confirmedAt: fact.occurredAt,
      confirmationVersion: fact.version,
      confirmationFingerprint: hash,
    };
    await this.tx.opsBooking.upsert({
      where: { bookingId: fact.bookingId },
      create: { bookingId: fact.bookingId, ...confirmation, updatedAt: fact.occurredAt },
      update: { ...confirmation, updatedAt: latest(current?.updatedAt ?? null, fact.occurredAt) },
    });
    return 'APPLIED';
  }

  async applyHoldChanged(fact: HoldChangedFact, hash: string): Promise<FactOutcome> {
    await lock(this.tx, `ops-hold:${fact.holdId}`);
    const current = await this.tx.opsSlotHold.findUnique({ where: { holdId: fact.holdId } });
    const decision = decideFact(
      current && { version: current.version, fingerprint: current.fingerprint },
      { version: fact.version, fingerprint: hash },
    );
    // The link is learned from whichever delivery carries it, even a stale
    // one: a RELEASED that overtook its COMMITTED must still be attributed.
    const bookingId = linkedBooking(current?.bookingId ?? null, fact.bookingId);
    const linkLearned = current !== null && current.bookingId === null && bookingId !== null;
    if (decision === 'APPLY') {
      const data = {
        version: fact.version,
        state: fact.state,
        zoneId: fact.zoneId,
        startsAt: fact.startsAt,
        endsAt: fact.endsAt,
        bookingId,
        fingerprint: hash,
        sourceEventId: fact.eventId,
        occurredAt: fact.occurredAt,
      };
      await this.tx.opsSlotHold.upsert({
        where: { holdId: fact.holdId },
        create: { holdId: fact.holdId, ...data },
        update: data,
      });
    } else if (linkLearned) {
      await this.tx.opsSlotHold.update({ where: { holdId: fact.holdId }, data: { bookingId } });
    } else {
      return decision;
    }
    if (bookingId) await this.recomputeSlot(bookingId);
    return decision === 'APPLY' ? 'APPLIED' : decision;
  }

  /** Recompute from every linked hold so the result is independent of delivery order. */
  private async recomputeSlot(bookingId: string): Promise<void> {
    await lock(this.tx, `ops-booking:${bookingId}`);
    const holds = await this.tx.opsSlotHold.findMany({ where: { bookingId } });
    const slot = currentSlot(holds.map((h) => ({ ...h, state: holdState(h.state) })));
    if (!slot) return;
    // The newest source time among ALL linked holds: a release applied before
    // its link was known still counts once the link is learned.
    const observedAt = holds.reduce(
      (newest, h) => latest(newest, h.occurredAt),
      holds[0]?.occurredAt ?? new Date(0),
    );
    const columns = {
      slotHoldId: slot.holdId,
      slotState: slot.state,
      slotZoneId: slot.zoneId,
      slotStartsAt: slot.startsAt,
      slotEndsAt: slot.endsAt,
    };
    const existing = await this.tx.opsBooking.findUnique({
      where: { bookingId },
      select: { updatedAt: true },
    });
    await this.tx.opsBooking.upsert({
      where: { bookingId },
      create: { bookingId, ...columns, updatedAt: observedAt },
      update: { ...columns, updatedAt: latest(existing?.updatedAt ?? null, observedAt) },
    });
  }

  async applyEligibilityChanged(fact: EligibilityChangedFact, hash: string): Promise<FactOutcome> {
    await lock(this.tx, `ops-resource:${fact.resourceId}`);
    const current = await this.tx.opsResourceEligibility.findUnique({
      where: { resourceId: fact.resourceId },
    });
    const decision = decideFact(
      current && { version: current.version, fingerprint: current.fingerprint },
      { version: fact.version, fingerprint: hash },
    );
    if (decision !== 'APPLY') return decision;
    const data = {
      version: fact.version,
      eligibility: fact.eligibility,
      fingerprint: hash,
      sourceEventId: fact.eventId,
      occurredAt: fact.occurredAt,
    };
    await this.tx.opsResourceEligibility.upsert({
      where: { resourceId: fact.resourceId },
      create: { resourceId: fact.resourceId, ...data },
      update: data,
    });
    return 'APPLIED';
  }

  /**
   * Folds one Dispatch assignment fact. The current state follows the owner's
   * version; milestones and the reassignment set also learn from stale
   * deliveries, because those are true past occurrences.
   */
  async applyAssignmentChanged(fact: AssignmentChangedFact, hash: string): Promise<FactOutcome> {
    await lock(this.tx, `ops-assignment:${fact.assignmentId}`);
    const current = await this.tx.opsAssignment.findUnique({
      where: { assignmentId: fact.assignmentId },
    });
    if (current && current.bookingId !== fact.bookingId)
      throw new OperationsIntegrityError('ASSIGNMENT_BOOKING_CONFLICT');
    const decision = decideFact(
      current && { version: current.version, fingerprint: current.fingerprint },
      { version: fact.version, fingerprint: hash },
    );
    if (decision === 'SAME') return 'SAME';
    const milestones = mergeMilestones(current, fact);
    if (decision === 'APPLY') {
      const data = {
        bookingId: fact.bookingId,
        version: fact.version,
        status: fact.status,
        zoneId: fact.zoneId,
        startsAt: fact.startsAt,
        endsAt: fact.endsAt,
        resourceId: fact.resourceId,
        fingerprint: hash,
        sourceEventId: fact.eventId,
        occurredAt: fact.occurredAt,
        ...milestones,
      };
      await this.tx.opsAssignment.upsert({
        where: { assignmentId: fact.assignmentId },
        create: { assignmentId: fact.assignmentId, ...data },
        update: data,
      });
    } else if (current && !sameMilestones(current, milestones)) {
      await this.tx.opsAssignment.update({
        where: { assignmentId: fact.assignmentId },
        data: milestones,
      });
    }
    if (fact.status === 'ASSIGNED' && fact.resourceId !== null)
      await this.recordAssignedResource(fact.assignmentId, fact.resourceId, fact.occurredAt);
    return decision === 'APPLY' ? 'APPLIED' : decision;
  }

  /** Serialized by the assignment lock, so the read-then-write cannot race. */
  private async recordAssignedResource(
    assignmentId: string,
    resourceId: string,
    at: Date,
  ): Promise<void> {
    const key = { assignmentId_resourceId: { assignmentId, resourceId } };
    const existing = await this.tx.opsAssignmentResource.findUnique({ where: key });
    if (!existing)
      await this.tx.opsAssignmentResource.create({
        data: { assignmentId, resourceId, firstAssignedAt: at },
      });
    else if (at.getTime() < existing.firstAssignedAt.getTime())
      await this.tx.opsAssignmentResource.update({ where: key, data: { firstAssignedAt: at } });
  }

  /**
   * Folds one Billing obligation fact; the newest revision wins. `stateSince`
   * is when the obligation entered its current state, so the age of a cash or
   * review backlog is measured with the owner's own occurrence times.
   */
  async applyObligationStatus(fact: ObligationStatusFact, hash: string): Promise<FactOutcome> {
    await lock(this.tx, `ops-obligation:${fact.obligationId}`);
    const current = await this.tx.opsObligation.findUnique({
      where: { obligationId: fact.obligationId },
    });
    if (current && current.currency !== fact.outstanding.currency)
      throw new OperationsIntegrityError('OBLIGATION_CURRENCY_CONFLICT');
    const decision = decideFact(
      current && { version: current.version, fingerprint: current.fingerprint },
      { version: fact.version, fingerprint: hash },
    );
    if (decision !== 'APPLY') return decision;
    const stateSince =
      current &&
      current.cashState === fact.cashState &&
      current.stateSince.getTime() <= fact.occurredAt.getTime()
        ? current.stateSince
        : fact.occurredAt;
    const data = {
      version: fact.version,
      cashState: fact.cashState,
      outstandingMinor: fact.outstanding.amountMinor,
      currency: fact.outstanding.currency,
      scale: fact.outstanding.scale,
      stateSince,
      fingerprint: hash,
      sourceEventId: fact.eventId,
      occurredAt: fact.occurredAt,
    };
    await this.tx.opsObligation.upsert({
      where: { obligationId: fact.obligationId },
      create: { obligationId: fact.obligationId, ...data },
      update: data,
    });
    return 'APPLIED';
  }

  async touchFreshness(source: OperationsSource, occurredAt: Date, appliedAt: Date): Promise<void> {
    // Native INSERT .. ON CONFLICT: concurrent first deliveries of one source
    // cannot race into a unique violation.
    await this.tx.opsFreshness.upsert({
      where: { source },
      create: {
        source,
        lastEventOccurredAt: occurredAt,
        lastAppliedAt: appliedAt,
        appliedCount: 1n,
      },
      update: { lastAppliedAt: appliedAt, appliedCount: { increment: 1n } },
    });
    // The newest occurrence only moves forward, whatever the delivery order.
    await this.tx.opsFreshness.updateMany({
      where: { source, lastEventOccurredAt: { lt: occurredAt } },
      data: { lastEventOccurredAt: occurredAt },
    });
  }
}

type BookingRecord = Prisma.OpsBookingGetPayload<object>;

function bookingRow(row: BookingRecord): BookingOperationRow {
  const { slotHoldId, slotState, slotZoneId, slotStartsAt, slotEndsAt } = row;
  return {
    bookingId: row.bookingId,
    customerRef: row.customerRef,
    confirmedAt: row.confirmedAt,
    slot:
      slotHoldId && slotState && slotZoneId && slotStartsAt && slotEndsAt
        ? {
            holdId: slotHoldId,
            state: holdState(slotState),
            zoneId: slotZoneId,
            startsAt: slotStartsAt,
            endsAt: slotEndsAt,
          }
        : null,
    updatedAt: row.updatedAt,
  };
}

const CURSOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Opaque keyset cursor: `<iso timestamp>|<uuid>` in base64url. */
function encodeCursor(at: Date, id: string): string {
  return Buffer.from(`${at.toISOString()}|${id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string | null): { at: Date; id: string } | null {
  if (cursor === null) return null;
  const [iso, id, extra] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const at = new Date(iso ?? '');
  if (extra !== undefined || !id || !CURSOR_ID.test(id) || !Number.isFinite(at.getTime()))
    throw new OperationsRuleError('INVALID_CURSOR');
  return { at, id };
}

function statusWhere(status: DerivedOperationsStatus | null): Prisma.OpsBookingWhereInput {
  switch (status) {
    case null:
      return {};
    case 'SCHEDULED':
      return { confirmedAt: { not: null }, slotState: 'COMMITTED' };
    case 'SLOT_COMMITTED_UNCONFIRMED':
      return { confirmedAt: null, slotState: 'COMMITTED' };
    case 'SLOT_RELEASED':
      return { slotState: { in: ['RELEASED', 'EXPIRED'] } };
    case 'CONFIRMED_UNSCHEDULED':
      return { confirmedAt: { not: null }, OR: [{ slotState: null }, { slotState: 'HELD' }] };
  }
}

interface TimingRow {
  reassigned: number;
  assigned_after_start: number;
  to_offer_n: number;
  to_offer_p50: bigint | null;
  to_offer_p90: bigint | null;
  to_offer_max: bigint | null;
  to_assign_n: number;
  to_assign_p50: bigint | null;
  to_assign_p90: bigint | null;
  to_assign_max: bigint | null;
  offer_assign_n: number;
  offer_assign_p50: bigint | null;
  offer_assign_p90: bigint | null;
  offer_assign_max: bigint | null;
}

interface CashSqlRow {
  cash_state: string;
  currency: string;
  scale: number;
  n: number;
  total: string;
  oldest: Date;
}

/** Durations are milliseconds within one bounded window: always safe integers. */
function ms(value: bigint | null): number | null {
  if (value === null) return null;
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error('KPI_DURATION_OUT_OF_RANGE');
  return n;
}

function durations(
  count: number,
  p50: bigint | null,
  p90: bigint | null,
  max: bigint | null,
): DurationSummary {
  return { count, p50Ms: ms(p50), p90Ms: ms(p90), maxMs: ms(max) };
}

/** A NUMERIC sum rendered by PostgreSQL; checked so nothing but digits leaves. */
function exactDecimal(value: string): string {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error('KPI_AMOUNT_CORRUPT');
  return value;
}

export class PrismaOperationsReader implements OperationsReader {
  constructor(private readonly client: PrismaClient) {}

  async listBookings(
    input: Parameters<OperationsReader['listBookings']>[0],
  ): Promise<Page<BookingOperationRow>> {
    // Unscheduled bookings have no slot, so they are discovered by confirmation time.
    const byConfirmation = input.status === 'CONFIRMED_UNSCHEDULED';
    const timeField = byConfirmation ? 'confirmedAt' : 'slotStartsAt';
    const after = decodeCursor(input.cursor);
    const where: Prisma.OpsBookingWhereInput = {
      AND: [
        statusWhere(input.status),
        { [timeField]: { gte: input.from, lt: input.to } },
        input.zoneId ? { slotZoneId: input.zoneId } : {},
        after
          ? {
              OR: [
                { [timeField]: { gt: after.at } },
                { [timeField]: after.at, bookingId: { gt: after.id } },
              ],
            }
          : {},
      ],
    };
    const rows = await this.client.opsBooking.findMany({
      where,
      orderBy: [{ [timeField]: 'asc' }, { bookingId: 'asc' }],
      take: input.limit + 1,
    });
    const items = rows.slice(0, input.limit).map(bookingRow);
    const last = rows.length > input.limit ? rows[input.limit - 1] : undefined;
    const at = last ? (byConfirmation ? last.confirmedAt : last.slotStartsAt) : null;
    return { items, nextCursor: last && at ? encodeCursor(at, last.bookingId) : null };
  }

  async booking(bookingId: string): Promise<BookingOperationRow | null> {
    const row = await this.client.opsBooking.findUnique({ where: { bookingId } });
    return row && bookingRow(row);
  }

  async bookingHolds(bookingId: string): Promise<readonly LinkedHoldRow[]> {
    const rows = await this.client.opsSlotHold.findMany({
      where: { bookingId },
      orderBy: [{ occurredAt: 'desc' }, { holdId: 'desc' }],
      // A booking is rescheduled a handful of times at most; bound it anyway.
      take: 50,
    });
    return rows.map((h) => ({
      holdId: h.holdId,
      state: holdState(h.state),
      zoneId: h.zoneId,
      startsAt: h.startsAt,
      endsAt: h.endsAt,
      version: h.version,
      occurredAt: h.occurredAt,
    }));
  }

  async bookingAssignments(bookingId: string): Promise<readonly AssignmentRow[]> {
    const rows = await this.client.opsAssignment.findMany({
      where: { bookingId },
      orderBy: [{ occurredAt: 'desc' }, { assignmentId: 'desc' }],
      take: 20,
      include: { _count: { select: { resources: true } } },
    });
    return rows.map((a) => ({
      assignmentId: a.assignmentId,
      bookingId: a.bookingId,
      status: assignmentStatusOf(a.status),
      resourceId: a.resourceId,
      zoneId: a.zoneId,
      startsAt: a.startsAt,
      endsAt: a.endsAt,
      version: a.version,
      occurredAt: a.occurredAt,
      firstObservedAt: a.firstObservedAt,
      firstOfferedAt: a.firstOfferedAt,
      firstAssignedAt: a.firstAssignedAt,
      assignedResourceCount: a._count.resources,
    }));
  }

  /**
   * Window aggregates. Bookings use the same window semantics as the list
   * (slot start; confirmation time for unscheduled bookings) and assignments
   * use the job start. Percentiles are `percentile_disc` (nearest rank).
   */
  async operationsKpis(input: {
    from: Date;
    to: Date;
    zoneId: string | null;
  }): Promise<OperationsKpiRows> {
    const bookingsByStatus = new Map<DerivedOperationsStatus, number>();
    for (const status of DERIVED_STATUSES) {
      const timeField = status === 'CONFIRMED_UNSCHEDULED' ? 'confirmedAt' : 'slotStartsAt';
      bookingsByStatus.set(
        status,
        await this.client.opsBooking.count({
          where: {
            AND: [
              statusWhere(status),
              { [timeField]: { gte: input.from, lt: input.to } },
              input.zoneId ? { slotZoneId: input.zoneId } : {},
            ],
          },
        }),
      );
    }
    const groups = await this.client.opsAssignment.groupBy({
      by: ['status'],
      where: {
        startsAt: { gte: input.from, lt: input.to },
        ...(input.zoneId ? { zoneId: input.zoneId } : {}),
      },
      _count: { _all: true },
    });
    const assignmentsByStatus = new Map<AssignmentStatus, number>(
      ASSIGNMENT_STATUSES.map((s) => [s, 0]),
    );
    for (const g of groups) assignmentsByStatus.set(assignmentStatusOf(g.status), g._count._all);

    const [timing] = await this.client.$queryRaw<TimingRow[]>`
      WITH w AS (
        SELECT a.starts_at, a.first_observed_at, a.first_offered_at, a.first_assigned_at,
               (SELECT count(*) FROM app.ops_assignment_resource r
                 WHERE r.assignment_id = a.assignment_id) AS resource_count
          FROM app.ops_assignment a
         WHERE a.starts_at >= ${input.from} AND a.starts_at < ${input.to}
           AND (${input.zoneId}::uuid IS NULL OR a.zone_id = ${input.zoneId}::uuid)
      ), d AS (
        SELECT resource_count, starts_at, first_assigned_at,
               (EXTRACT(EPOCH FROM (first_offered_at - first_observed_at)) * 1000)::bigint AS to_offer,
               (EXTRACT(EPOCH FROM (first_assigned_at - first_observed_at)) * 1000)::bigint AS to_assign,
               CASE WHEN first_assigned_at >= first_offered_at
                    THEN (EXTRACT(EPOCH FROM (first_assigned_at - first_offered_at)) * 1000)::bigint
               END AS offer_assign
          FROM w
      )
      SELECT count(*) FILTER (WHERE resource_count > 1)::int AS reassigned,
             count(*) FILTER (WHERE first_assigned_at > starts_at)::int AS assigned_after_start,
             count(to_offer)::int AS to_offer_n,
             percentile_disc(0.5) WITHIN GROUP (ORDER BY to_offer) AS to_offer_p50,
             percentile_disc(0.9) WITHIN GROUP (ORDER BY to_offer) AS to_offer_p90,
             max(to_offer) AS to_offer_max,
             count(to_assign)::int AS to_assign_n,
             percentile_disc(0.5) WITHIN GROUP (ORDER BY to_assign) AS to_assign_p50,
             percentile_disc(0.9) WITHIN GROUP (ORDER BY to_assign) AS to_assign_p90,
             max(to_assign) AS to_assign_max,
             count(offer_assign)::int AS offer_assign_n,
             percentile_disc(0.5) WITHIN GROUP (ORDER BY offer_assign) AS offer_assign_p50,
             percentile_disc(0.9) WITHIN GROUP (ORDER BY offer_assign) AS offer_assign_p90,
             max(offer_assign) AS offer_assign_max
        FROM d`;
    if (!timing) throw new Error('KPI_AGGREGATE_MISSING');
    return {
      bookingsByStatus,
      assignmentsByStatus,
      reassigned: timing.reassigned,
      assignedAfterStart: timing.assigned_after_start,
      timeToFirstOffer: durations(
        timing.to_offer_n,
        timing.to_offer_p50,
        timing.to_offer_p90,
        timing.to_offer_max,
      ),
      timeToAssign: durations(
        timing.to_assign_n,
        timing.to_assign_p50,
        timing.to_assign_p90,
        timing.to_assign_max,
      ),
      offerToAssign: durations(
        timing.offer_assign_n,
        timing.offer_assign_p50,
        timing.offer_assign_p90,
        timing.offer_assign_max,
      ),
    };
  }

  /** Current cash states over every projected obligation, summed exactly per currency. */
  async cashKpis(): Promise<readonly CashStateRow[]> {
    const rows = await this.client.$queryRaw<CashSqlRow[]>`
      SELECT cash_state, currency, scale::int AS scale, count(*)::int AS n,
             sum(outstanding_minor)::text AS total, min(state_since) AS oldest
        FROM app.ops_obligation
       GROUP BY cash_state, currency, scale
       ORDER BY cash_state, currency`;
    return CASH_STATES.map((cashState) => {
      const mine = rows.filter((r) => cashStateOf(r.cash_state) === cashState);
      const oldest = mine.reduce<Date | null>(
        (min, r) => (min === null || r.oldest.getTime() < min.getTime() ? r.oldest : min),
        null,
      );
      return {
        cashState,
        count: mine.reduce((n, r) => n + r.n, 0),
        outstanding: mine.map((r) => ({
          currency: r.currency,
          scale: r.scale,
          amountMinor: exactDecimal(r.total),
        })),
        oldestSince: oldest,
      };
    });
  }

  async listResources(
    input: Parameters<OperationsReader['listResources']>[0],
  ): Promise<Page<ResourceEligibilityRow>> {
    const after = decodeCursor(input.cursor);
    const rows = await this.client.opsResourceEligibility.findMany({
      where: {
        ...(input.eligibility ? { eligibility: input.eligibility } : {}),
        ...(after ? { resourceId: { gt: after.id } } : {}),
      },
      orderBy: { resourceId: 'asc' },
      take: input.limit + 1,
    });
    const items = rows.slice(0, input.limit).map((row) => ({
      resourceId: row.resourceId,
      eligibility: eligibilityOf(row.eligibility),
      version: row.version,
      changedAt: row.occurredAt,
    }));
    const last = rows.length > input.limit ? rows[input.limit - 1] : undefined;
    return { items, nextCursor: last ? encodeCursor(last.occurredAt, last.resourceId) : null };
  }

  async resourceSummary(): Promise<EligibilitySummary> {
    const groups = await this.client.opsResourceEligibility.groupBy({
      by: ['eligibility'],
      _count: { _all: true },
    });
    const count = (value: Eligibility): number =>
      groups.find((g) => eligibilityOf(g.eligibility) === value)?._count._all ?? 0;
    return { eligible: count('ELIGIBLE'), ineligible: count('INELIGIBLE') };
  }

  async checkpoints(): Promise<ReadonlyMap<OperationsSource, FreshnessCheckpoint>> {
    const rows = await this.client.opsFreshness.findMany();
    return new Map(
      rows.map((row) => [
        sourceOf(row.source),
        {
          lastEventOccurredAt: row.lastEventOccurredAt,
          lastAppliedAt: row.lastAppliedAt,
          appliedCount: row.appliedCount,
        },
      ]),
    );
  }
}
