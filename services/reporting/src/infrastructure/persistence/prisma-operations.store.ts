import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import {
  OperationsRuleError,
  currentSlot,
  decideFact,
  linkedBooking,
  type BookingConfirmedFact,
  type DerivedOperationsStatus,
  type Eligibility,
  type EligibilityChangedFact,
  type FreshnessCheckpoint,
  type HoldChangedFact,
  type HoldState,
  type OperationsSource,
} from '../../domain/operations';
import type {
  BookingOperationRow,
  EligibilitySummary,
  FactOutcome,
  LinkedHoldRow,
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
  if (value !== 'booking' && value !== 'scheduling' && value !== 'workforce')
    throw new Error('CORRUPT_PERSISTED_SOURCE');
  return value;
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
