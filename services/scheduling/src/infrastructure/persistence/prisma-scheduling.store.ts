import { randomUUID } from 'node:crypto';
import { traceHeaders } from '@carwash/service-kit';
import { SchedulingError } from '../../domain';
import type {
  CapacityWindowState,
  HoldState,
  HoldStatus,
  PrincipalKind,
  ReleaseReason,
  WindowStatus,
} from '../../domain';
import type {
  Actor,
  AuditAppend,
  AvailabilityRow,
  IdempotencyClaim,
  InsertWindowResult,
  OutboxAppend,
  SchedulingReadModel,
  SchedulingTransaction,
  SchedulingUnitOfWork,
  StoredResponse,
} from '../../ports';
import type { Prisma } from '../../generated/prisma/client';
import type { PrismaService } from './prisma.service';

/**
 * PostgreSQL adapter for the scheduling ports.
 *
 * Correctness does not rest on application code alone:
 *   - `lockWindow` is SELECT ... FOR UPDATE, so all capacity arithmetic for one
 *     window is serialised by the row lock;
 *   - every UPDATE is guarded by the version that was read under that lock;
 *   - the CHECK constraint held + reserved <= capacity rejects any write that
 *     would oversell, even one produced by a defect above this layer;
 *   - capacity_hold_shape_ck and the partial unique index on booking_id keep
 *     every v1 hold complete and one booking to one CONFIRMED hold at a time.
 *
 * Tables are qualified with the "app" schema; the runtime role has DML on that
 * schema only.
 */
type Tx = Prisma.TransactionClient;

interface WindowRow {
  id: string;
  zone_id: string;
  starts_at: Date;
  ends_at: Date;
  capacity: number;
  held: number;
  reserved: number;
  status: string;
  version: number;
}

interface HoldRow {
  id: string;
  window_id: string;
  zone_id: string;
  beneficiary_kind: string;
  beneficiary_subject: string;
  quote_id: string;
  quote_revision: number;
  slot_starts_at: Date;
  slot_ends_at: Date;
  units: number;
  status: string;
  expires_at: Date;
  booking_id: string | null;
  release_reason: string | null;
  created_at: Date;
  updated_at: Date;
  version: number;
}

interface IdempotencyRow {
  fingerprint: string;
  response_status: number | null;
  response_body: unknown;
}

/**
 * scheduling.v1 hold rows only. Rows written by the pre-v1 (C1) API have no
 * beneficiary and are invisible to the v1 surface; the sweeper still expires
 * them (expireLegacyDueHolds) so their units return to the window.
 */
const V1_ROW = `beneficiary_kind IS NOT NULL`;
const HOLD_COLUMNS = `id::text, window_id::text, zone_id::text, beneficiary_kind,
  beneficiary_subject::text, quote_id::text, quote_revision, slot_starts_at, slot_ends_at,
  units, status, expires_at, booking_id::text, release_reason, created_at, updated_at, version`;
const WINDOW_COLUMNS = `id::text, zone_id::text, starts_at, ends_at, capacity, held, reserved, status, version`;
/** Wait at most this long for a concurrent holder of the same idempotency key. */
const IDEMPOTENCY_WAIT = '3s';
const TRACEPARENT = /^00-(?!0{32})[0-9a-f]{32}-(?!0{16})[0-9a-f]{16}-[0-9a-f]{2}$/;

export class ConcurrencyViolation extends Error {
  constructor(what: string) {
    super(`${what}_VERSION_MISMATCH`);
    this.name = 'ConcurrencyViolation';
  }
}

/**
 * SQLSTATE of a failed statement, as surfaced by the pg driver adapter. Most
 * errors carry it as `code`; ones the adapter classifies itself (for example a
 * deadlock, as TransactionWriteConflict) carry only `originalCode`.
 */
export function sqlState(error: unknown): string | undefined {
  const cause = (
    error as {
      meta?: { driverAdapterError?: { cause?: { code?: unknown; originalCode?: unknown } } };
    }
  ).meta?.driverAdapterError?.cause;
  const code = cause?.code ?? cause?.originalCode;
  return typeof code === 'string' ? code : undefined;
}

/** Deadlock / serialization failure: PostgreSQL rolled the whole transaction back. */
export function isTransientConflict(error: unknown): boolean {
  const state = sqlState(error);
  return state === '40P01' || state === '40001';
}

function toWindow(row: WindowRow): CapacityWindowState {
  return {
    id: row.id,
    zoneId: row.zone_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    capacity: row.capacity,
    held: row.held,
    reserved: row.reserved,
    status: row.status as WindowStatus,
    version: row.version,
  };
}

function toHold(row: HoldRow): HoldState {
  return {
    id: row.id,
    windowId: row.window_id,
    zoneId: row.zone_id,
    beneficiaryKind: row.beneficiary_kind as PrincipalKind,
    beneficiarySubject: row.beneficiary_subject,
    quoteId: row.quote_id,
    quoteRevision: row.quote_revision,
    slotStartsAt: row.slot_starts_at,
    slotEndsAt: row.slot_ends_at,
    units: row.units,
    status: row.status as HoldStatus,
    expiresAt: row.expires_at,
    bookingId: row.booking_id,
    releaseReason: row.release_reason as ReleaseReason | null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

function actorId(actor: Actor): string {
  if (actor.kind === 'USER') return actor.subject;
  if (actor.kind === 'SERVICE') return actor.clientId;
  return actor.component;
}

/** The active W3C trace parent, if well-formed; never invented. */
function activeTraceparent(): string | null {
  const value = traceHeaders()['traceparent'];
  return typeof value === 'string' && TRACEPARENT.test(value) ? value : null;
}

class PrismaSchedulingTransaction implements SchedulingTransaction {
  constructor(private readonly tx: Tx) {}

  async claimIdempotency(
    scope: string,
    key: string,
    fingerprint: string,
  ): Promise<IdempotencyClaim> {
    // A concurrent first request holds the uncommitted row; our INSERT waits on
    // the unique key until it commits (we then read its outcome) or rolls back
    // (we then insert). The wait is bounded so a stuck holder reads as in flight.
    await this.tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${IDEMPOTENCY_WAIT}'`);
    await this.tx.$executeRawUnsafe('SAVEPOINT claim_idempotency');
    let inserted: { scope: string }[];
    try {
      inserted = await this.tx.$queryRawUnsafe<{ scope: string }[]>(
        `INSERT INTO app.idempotency_record (scope, key, fingerprint)
         VALUES ($1, $2, $3)
         ON CONFLICT (scope, key) DO NOTHING
         RETURNING scope`,
        scope,
        key,
        fingerprint,
      );
    } catch (error) {
      // Anything but a lock timeout aborts the whole unit of work.
      if (sqlState(error) !== '55P03') throw error;
      await this.tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT claim_idempotency');
      await this.tx.$executeRawUnsafe('SET LOCAL lock_timeout = 0');
      return { kind: 'IN_PROGRESS' };
    }
    await this.tx.$executeRawUnsafe('RELEASE SAVEPOINT claim_idempotency');
    await this.tx.$executeRawUnsafe('SET LOCAL lock_timeout = 0');
    if (inserted.length === 1) return { kind: 'NEW' };
    const [row] = await this.tx.$queryRawUnsafe<IdempotencyRow[]>(
      `SELECT fingerprint, response_status, response_body FROM app.idempotency_record
        WHERE scope = $1 AND key = $2`,
      scope,
      key,
    );
    if (!row) return { kind: 'IN_PROGRESS' };
    if (row.fingerprint !== fingerprint) return { kind: 'CONFLICT' };
    if (row.response_status === null) return { kind: 'IN_PROGRESS' };
    return { kind: 'REPLAY', response: { status: row.response_status, body: row.response_body } };
  }

  async completeIdempotency(scope: string, key: string, response: StoredResponse): Promise<void> {
    const rows = await this.tx.$queryRawUnsafe<{ scope: string }[]>(
      `UPDATE app.idempotency_record
          SET response_status = $3, response_body = $4::jsonb, completed_at = now()
        WHERE scope = $1 AND key = $2 AND completed_at IS NULL
      RETURNING scope`,
      scope,
      key,
      response.status,
      JSON.stringify(response.body),
    );
    if (rows.length !== 1) throw new ConcurrencyViolation('IDEMPOTENCY');
  }

  async abandonIdempotency(scope: string, key: string): Promise<void> {
    await this.tx.$executeRawUnsafe(
      `DELETE FROM app.idempotency_record WHERE scope = $1 AND key = $2 AND completed_at IS NULL`,
      scope,
      key,
    );
  }

  async lockBeneficiary(kind: PrincipalKind, subject: string): Promise<void> {
    await this.tx.$executeRawUnsafe(
      `SELECT pg_advisory_xact_lock(hashtextextended('scheduling.beneficiary:' || $1 || ':' || $2, 0))`,
      kind,
      subject,
    );
  }

  async countActiveHolds(kind: PrincipalKind, subject: string, now: Date): Promise<number> {
    const [row] = await this.tx.$queryRawUnsafe<{ count: number }[]>(
      `SELECT count(*)::int AS count FROM app.capacity_hold
        WHERE beneficiary_kind = $1 AND beneficiary_subject = $2::uuid
          AND status = 'ACTIVE' AND expires_at > $3`,
      kind,
      subject,
      now,
    );
    return row?.count ?? 0;
  }

  async lockWindow(
    id: string,
    options?: { readonly skipLocked?: boolean },
  ): Promise<CapacityWindowState | null> {
    const rows = options?.skipLocked
      ? await this.tx.$queryRawUnsafe<WindowRow[]>(
          `SELECT ${WINDOW_COLUMNS} FROM app.capacity_window WHERE id = $1::uuid FOR UPDATE SKIP LOCKED`,
          id,
        )
      : await this.tx.$queryRawUnsafe<WindowRow[]>(
          `SELECT ${WINDOW_COLUMNS} FROM app.capacity_window WHERE id = $1::uuid FOR UPDATE`,
          id,
        );
    const [row] = rows;
    return row ? toWindow(row) : null;
  }

  async lockCoveringWindow(
    zoneId: string,
    startsAt: Date,
    endsAt: Date,
  ): Promise<CapacityWindowState | null> {
    // Windows of one zone never overlap (exclusion constraint): at most one row.
    const [row] = await this.tx.$queryRawUnsafe<WindowRow[]>(
      `SELECT ${WINDOW_COLUMNS} FROM app.capacity_window
        WHERE zone_id = $1::uuid AND starts_at <= $2 AND ends_at >= $3
        FOR UPDATE`,
      zoneId,
      startsAt,
      endsAt,
    );
    return row ? toWindow(row) : null;
  }

  async insertWindow(window: CapacityWindowState): Promise<InsertWindowResult> {
    // Concurrent inserts checked by one gist exclusion constraint can deadlock
    // each other (40P01). Window definitions are rare operator actions, so they
    // are serialised per zone with a transaction-scoped advisory lock instead.
    await this.tx.$executeRawUnsafe(
      `SELECT pg_advisory_xact_lock(hashtextextended('scheduling.zone:' || $1::text, 0))`,
      window.zoneId,
    );
    // The exclusion constraint cannot be targeted by ON CONFLICT, so it is
    // isolated in a savepoint: an overlap is an answer, not an aborted transaction.
    await this.tx.$executeRawUnsafe('SAVEPOINT insert_window');
    try {
      const rows = await this.tx.$queryRawUnsafe<{ id: string }[]>(
        `INSERT INTO app.capacity_window (id, zone_id, starts_at, ends_at, capacity, held, reserved, status, version)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (zone_id, starts_at) DO NOTHING
         RETURNING id::text`,
        window.id,
        window.zoneId,
        window.startsAt,
        window.endsAt,
        window.capacity,
        window.held,
        window.reserved,
        window.status,
        window.version,
      );
      await this.tx.$executeRawUnsafe('RELEASE SAVEPOINT insert_window');
      return rows.length === 1 ? 'CREATED' : 'DUPLICATE_START';
    } catch (error) {
      if (sqlState(error) !== '23P01') throw error;
      await this.tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT insert_window');
      return 'OVERLAPS';
    }
  }

  async updateWindow(window: CapacityWindowState, expectedVersion: number): Promise<void> {
    const rows = await this.tx.$queryRawUnsafe<{ id: string }[]>(
      `UPDATE app.capacity_window
          SET capacity = $3, held = $4, reserved = $5, status = $6, version = $7, updated_at = now()
        WHERE id = $1::uuid AND version = $2
      RETURNING id::text`,
      window.id,
      expectedVersion,
      window.capacity,
      window.held,
      window.reserved,
      window.status,
      // Several domain steps in one transaction each advance the version; the
      // row only needs to move forward monotonically, by at least one.
      Math.max(window.version, expectedVersion + 1),
    );
    if (rows.length !== 1) throw new ConcurrencyViolation('WINDOW');
  }

  async lockHold(id: string): Promise<HoldState | null> {
    const [row] = await this.tx.$queryRawUnsafe<HoldRow[]>(
      `SELECT ${HOLD_COLUMNS} FROM app.capacity_hold WHERE id = $1::uuid AND ${V1_ROW} FOR UPDATE`,
      id,
    );
    return row ? toHold(row) : null;
  }

  async lockDueHolds(windowId: string, now: Date): Promise<HoldState[]> {
    const rows = await this.tx.$queryRawUnsafe<HoldRow[]>(
      `SELECT ${HOLD_COLUMNS} FROM app.capacity_hold
        WHERE window_id = $1::uuid AND status = 'ACTIVE' AND expires_at <= $2 AND ${V1_ROW}
        ORDER BY id
        FOR UPDATE`,
      windowId,
      now,
    );
    return rows.map(toHold);
  }

  async expireLegacyDueHolds(windowId: string, now: Date): Promise<number> {
    const [row] = await this.tx.$queryRawUnsafe<{ units: number }[]>(
      `WITH expired AS (
         UPDATE app.capacity_hold
            SET status = 'EXPIRED', version = version + 1, updated_at = $2
          WHERE window_id = $1::uuid AND status = 'ACTIVE' AND expires_at <= $2
            AND beneficiary_kind IS NULL
         RETURNING units)
       SELECT COALESCE(SUM(units), 0)::int AS units FROM expired`,
      windowId,
      now,
    );
    return row?.units ?? 0;
  }

  async insertHold(hold: HoldState): Promise<void> {
    await this.tx.$executeRawUnsafe(
      `INSERT INTO app.capacity_hold (id, window_id, zone_id, beneficiary_kind, beneficiary_subject,
         quote_id, quote_revision, slot_starts_at, slot_ends_at, units, status, expires_at,
         booking_id, release_reason, version, created_at, updated_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::uuid, $6::uuid, $7, $8, $9, $10, $11, $12,
         $13::uuid, $14, $15, $16, $17)`,
      hold.id,
      hold.windowId,
      hold.zoneId,
      hold.beneficiaryKind,
      hold.beneficiarySubject,
      hold.quoteId,
      hold.quoteRevision,
      hold.slotStartsAt,
      hold.slotEndsAt,
      hold.units,
      hold.status,
      hold.expiresAt,
      hold.bookingId,
      hold.releaseReason,
      hold.version,
      hold.createdAt,
      hold.updatedAt,
    );
  }

  async updateHold(hold: HoldState, expectedVersion: number): Promise<void> {
    let rows: { id: string }[];
    try {
      rows = await this.tx.$queryRawUnsafe<{ id: string }[]>(
        `UPDATE app.capacity_hold
          SET status = $3, release_reason = $4, version = $5, updated_at = $6, booking_id = $7::uuid
        WHERE id = $1::uuid AND version = $2
      RETURNING id::text`,
        hold.id,
        expectedVersion,
        hold.status,
        hold.releaseReason,
        hold.version,
        hold.updatedAt,
        hold.bookingId,
      );
    } catch (error) {
      // capacity_hold_booking_confirmed_key: the booking already has a CONFIRMED hold.
      if (sqlState(error) === '23505') {
        throw new SchedulingError('BOOKING_ALREADY_COMMITTED', 'The booking holds another slot.');
      }
      throw error;
    }
    if (rows.length !== 1) throw new ConcurrencyViolation('HOLD');
  }

  async appendEvent(entry: OutboxAppend): Promise<void> {
    // The envelope's traceparent is the trace active when the change committed.
    const traceparent = activeTraceparent();
    await this.tx.$executeRawUnsafe(
      `INSERT INTO app.outbox_message (id, event_id, event_type, exchange, routing_key, payload, correlation_id, trace_parent)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::uuid, $8)`,
      randomUUID(),
      entry.event.eventId,
      entry.event.eventType,
      entry.exchange,
      entry.routingKey,
      JSON.stringify({ ...entry.event, traceparent }),
      entry.event.correlationId,
      traceparent,
    );
  }

  async appendAudit(entry: AuditAppend): Promise<void> {
    await this.tx.$executeRawUnsafe(
      `INSERT INTO app.audit_entry (id, actor_kind, actor_id, action, target_type, target_id, correlation_id, details)
       VALUES ($1::uuid, $2, $3, $4, $5, $6::uuid, $7::uuid, $8::jsonb)`,
      randomUUID(),
      entry.actor.kind,
      actorId(entry.actor),
      entry.action,
      entry.targetType,
      entry.targetId,
      entry.correlationId,
      JSON.stringify(entry.details),
    );
  }
}

export class PrismaSchedulingStore implements SchedulingUnitOfWork, SchedulingReadModel {
  constructor(
    private readonly prisma: PrismaService,
    private readonly options: {
      readonly transactionTimeoutMs?: number;
      readonly maxWaitMs?: number;
      readonly conflictAttempts?: number;
    } = {},
  ) {}

  async run<T>(work: (tx: SchedulingTransaction) => Promise<T>): Promise<T> {
    // A deadlock or serialization failure means PostgreSQL rolled the whole
    // transaction back and nothing was written; the unit of work touches only
    // this database, so re-running it is safe. Bounded, with jitter; the last
    // failure propagates (as a retryable 503 at the edge), never as success.
    const attempts = this.options.conflictAttempts ?? 3;
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.once(work);
      } catch (error) {
        if (!isTransientConflict(error) || attempt >= attempts) throw error;
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 25 * attempt));
      }
    }
  }

  private once<T>(work: (tx: SchedulingTransaction) => Promise<T>): Promise<T> {
    // READ COMMITTED + explicit row locks: every decision is made on rows read
    // under FOR UPDATE, so the stronger isolation levels would only add
    // serialization failures without adding protection.
    return this.prisma.client.$transaction((tx) => work(new PrismaSchedulingTransaction(tx)), {
      isolationLevel: 'ReadCommitted',
      maxWait: this.options.maxWaitMs ?? 5_000,
      timeout: this.options.transactionTimeoutMs ?? 10_000,
    });
  }

  async findWindow(id: string): Promise<CapacityWindowState | null> {
    const [row] = await this.prisma.client.$queryRawUnsafe<WindowRow[]>(
      `SELECT ${WINDOW_COLUMNS} FROM app.capacity_window WHERE id = $1::uuid`,
      id,
    );
    return row ? toWindow(row) : null;
  }

  async findWindowByStart(zoneId: string, startsAt: Date): Promise<CapacityWindowState | null> {
    const [row] = await this.prisma.client.$queryRawUnsafe<WindowRow[]>(
      `SELECT ${WINDOW_COLUMNS} FROM app.capacity_window WHERE zone_id = $1::uuid AND starts_at = $2`,
      zoneId,
      startsAt,
    );
    return row ? toWindow(row) : null;
  }

  async findHold(id: string): Promise<HoldState | null> {
    const [row] = await this.prisma.client.$queryRawUnsafe<HoldRow[]>(
      `SELECT ${HOLD_COLUMNS} FROM app.capacity_hold WHERE id = $1::uuid AND ${V1_ROW}`,
      id,
    );
    return row ? toHold(row) : null;
  }

  async availability(input: {
    readonly zoneId: string;
    readonly from: Date;
    readonly to: Date;
    readonly now: Date;
  }): Promise<AvailabilityRow[]> {
    // Free units are computed from the deadline, not from the `held` counter,
    // so a hold that is due but not yet swept never hides capacity.
    const rows = await this.prisma.client.$queryRawUnsafe<(WindowRow & { live_held: number })[]>(
      `SELECT w.id::text, w.zone_id::text, w.starts_at, w.ends_at, w.capacity, w.held, w.reserved,
              w.status, w.version,
              COALESCE(SUM(h.units) FILTER (WHERE h.expires_at > $4), 0)::int AS live_held
         FROM app.capacity_window w
         LEFT JOIN app.capacity_hold h ON h.window_id = w.id AND h.status = 'ACTIVE'
        WHERE w.zone_id = $1::uuid AND w.starts_at >= $2 AND w.starts_at < $3
        GROUP BY w.id
        ORDER BY w.starts_at
        LIMIT 500`,
      input.zoneId,
      input.from,
      input.to,
      input.now,
    );
    return rows.map((row) => ({
      window: toWindow(row),
      freeUnits: Math.max(0, row.capacity - row.reserved - row.live_held),
    }));
  }

  async windowsWithDueHolds(now: Date, limit: number): Promise<string[]> {
    const rows = await this.prisma.client.$queryRawUnsafe<{ window_id: string }[]>(
      `SELECT DISTINCT window_id::text FROM app.capacity_hold
        WHERE status = 'ACTIVE' AND expires_at <= $1
        LIMIT $2`,
      now,
      limit,
    );
    return rows.map((row) => row.window_id);
  }

  async purgeIdempotency(retentionMs: number, limit: number): Promise<number> {
    return this.prisma.client.$executeRawUnsafe(
      `DELETE FROM app.idempotency_record
        WHERE ctid IN (SELECT ctid FROM app.idempotency_record
                        WHERE completed_at < now() - make_interval(secs => $1::double precision / 1000)
                        LIMIT $2)`,
      retentionMs,
      limit,
    );
  }
}
