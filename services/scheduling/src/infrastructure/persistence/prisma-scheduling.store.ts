import { randomUUID } from 'node:crypto';
import { traceHeaders } from '@carwash/service-kit';
import type {
  CapacityWindowState,
  HoldState,
  ReleaseReason,
  WindowStatus,
  HoldStatus,
} from '../../domain';
import type {
  Actor,
  AuditAppend,
  AvailabilityRow,
  InsertHoldResult,
  InsertWindowResult,
  OutboxAppend,
  SchedulingReadModel,
  SchedulingTransaction,
  SchedulingUnitOfWork,
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
 *     would oversell, even one produced by a defect above this layer.
 *
 * Tables are qualified with the "app" schema exactly like the catalog outbox
 * store; the runtime role has DML on that schema only.
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
  client_id: string;
  holder_ref: string;
  units: number;
  status: string;
  expires_at: Date;
  idempotency_key: string;
  request_fingerprint: string;
  release_reason: string | null;
  created_at: Date;
  updated_at: Date;
  version: number;
}

const HOLD_COLUMNS = `id::text, window_id::text, client_id, holder_ref::text, units, status, expires_at,
  idempotency_key, request_fingerprint, release_reason, created_at, updated_at, version`;
const WINDOW_COLUMNS = `id::text, zone_id::text, starts_at, ends_at, capacity, held, reserved, status, version`;

export class ConcurrencyViolation extends Error {
  constructor(what: string) {
    super(`${what}_VERSION_MISMATCH`);
    this.name = 'ConcurrencyViolation';
  }
}

/** SQLSTATE of a failed raw statement, as surfaced by the pg driver adapter. */
export function sqlState(error: unknown): string | undefined {
  const meta = (error as { meta?: { driverAdapterError?: { cause?: { code?: unknown } } } }).meta;
  const code = meta?.driverAdapterError?.cause?.code;
  return typeof code === 'string' ? code : undefined;
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
    clientId: row.client_id,
    holderRef: row.holder_ref,
    units: row.units,
    status: row.status as HoldStatus,
    expiresAt: row.expires_at,
    idempotencyKey: row.idempotency_key,
    requestFingerprint: row.request_fingerprint,
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

class PrismaSchedulingTransaction implements SchedulingTransaction {
  constructor(private readonly tx: Tx) {}

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

  async insertWindow(window: CapacityWindowState): Promise<InsertWindowResult> {
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
      `SELECT ${HOLD_COLUMNS} FROM app.capacity_hold WHERE id = $1::uuid FOR UPDATE`,
      id,
    );
    return row ? toHold(row) : null;
  }

  async lockDueHolds(windowId: string, now: Date): Promise<HoldState[]> {
    const rows = await this.tx.$queryRawUnsafe<HoldRow[]>(
      `SELECT ${HOLD_COLUMNS} FROM app.capacity_hold
        WHERE window_id = $1::uuid AND status = 'ACTIVE' AND expires_at <= $2
        ORDER BY id
        FOR UPDATE`,
      windowId,
      now,
    );
    return rows.map(toHold);
  }

  async insertHold(hold: HoldState): Promise<InsertHoldResult> {
    const rows = await this.tx.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO app.capacity_hold (id, window_id, client_id, holder_ref, units, status, expires_at,
         idempotency_key, request_fingerprint, release_reason, version, created_at, updated_at)
       VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (client_id, idempotency_key) DO NOTHING
       RETURNING id::text`,
      hold.id,
      hold.windowId,
      hold.clientId,
      hold.holderRef,
      hold.units,
      hold.status,
      hold.expiresAt,
      hold.idempotencyKey,
      hold.requestFingerprint,
      hold.releaseReason,
      hold.version,
      hold.createdAt,
      hold.updatedAt,
    );
    return rows.length === 1 ? 'CREATED' : 'DUPLICATE_IDEMPOTENCY_KEY';
  }

  async updateHold(hold: HoldState, expectedVersion: number): Promise<void> {
    const rows = await this.tx.$queryRawUnsafe<{ id: string }[]>(
      `UPDATE app.capacity_hold
          SET status = $3, release_reason = $4, version = $5, updated_at = $6
        WHERE id = $1::uuid AND version = $2
      RETURNING id::text`,
      hold.id,
      expectedVersion,
      hold.status,
      hold.releaseReason,
      hold.version,
      hold.updatedAt,
    );
    if (rows.length !== 1) throw new ConcurrencyViolation('HOLD');
  }

  async appendEvent(entry: OutboxAppend): Promise<void> {
    await this.tx.$executeRawUnsafe(
      `INSERT INTO app.outbox_message (id, event_id, event_type, exchange, routing_key, payload, correlation_id, trace_parent)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::uuid, $8)`,
      randomUUID(),
      entry.event.eventId,
      entry.event.eventType,
      entry.exchange,
      entry.routingKey,
      JSON.stringify(entry.event),
      entry.event.correlationId,
      traceHeaders()['traceparent'] ?? null,
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
    } = {},
  ) {}

  run<T>(work: (tx: SchedulingTransaction) => Promise<T>): Promise<T> {
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
      `SELECT ${HOLD_COLUMNS} FROM app.capacity_hold WHERE id = $1::uuid`,
      id,
    );
    return row ? toHold(row) : null;
  }

  async findHoldByIdempotencyKey(clientId: string, key: string): Promise<HoldState | null> {
    const [row] = await this.prisma.client.$queryRawUnsafe<HoldRow[]>(
      `SELECT ${HOLD_COLUMNS} FROM app.capacity_hold WHERE client_id = $1 AND idempotency_key = $2`,
      clientId,
      key,
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
}
