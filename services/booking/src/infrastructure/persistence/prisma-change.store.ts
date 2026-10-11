import { randomUUID } from 'node:crypto';
import { traceHeaders } from '@carwash/service-kit';
import {
  BOOKING_EVENTS_EXCHANGE,
  type Booking,
  type BookingEvent,
  type CancellationReason,
  type ChangeKind,
  type ChangeOutcome,
  type ChangeRefusal,
  type ChangeState,
  type ChangeStep,
  type Requester,
  type Settlement,
} from '../../domain';
import type {
  AuditFact,
  ChangeRecord,
  ChangeStore,
  InsertChangeResult,
  SagaLease,
} from '../../ports';
import type { Prisma } from '../../generated/prisma/client';
import { ConcurrencyViolation, appendAudit, isTransientConflict } from './prisma-booking.store';
import type { PrismaService } from './prisma.service';

/**
 * PostgreSQL adapter of the ChangeStore port (P04-C3).
 *
 * Correctness does not rest on application code alone:
 *   - a change is inserted only while the booking row is locked (FOR UPDATE)
 *     and still at the version the client saw;
 *   - partial unique indexes allow one OPEN change per booking and one change
 *     per (requester, Idempotency-Key);
 *   - every saga write is conditional on (lease owner, fence);
 *   - triggers keep the request facts of a change, a finished change, a
 *     cancellation and past schedules immutable, and refuse deletes.
 */
type Tx = Prisma.TransactionClient;

interface ChangeRow {
  change_id: string;
  booking_id: string;
  kind: string;
  step: string;
  outcome: string | null;
  reason: string | null;
  refusal: string | null;
  requester_kind: string;
  requester_subject: string;
  from_hold_id: string;
  zone_id: string;
  from_starts_at: Date;
  from_ends_at: Date;
  to_hold_id: string | null;
  to_hold_revision: number | null;
  to_starts_at: Date | null;
  to_ends_at: Date | null;
  to_expires_at: Date | null;
  settlement: string | null;
  pivot_attempted: boolean;
  attempts: number;
  next_attempt_at: Date;
  deadline_at: Date | null;
  last_error: string | null;
  attention: boolean;
  correlation_id: string;
  version: number;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
}

const CHANGE_COLUMNS = `change_id::text, booking_id::text, kind, step, outcome, reason, refusal,
  requester_kind, requester_subject::text, from_hold_id::text, zone_id::text, from_starts_at,
  from_ends_at, to_hold_id::text, to_hold_revision, to_starts_at, to_ends_at, to_expires_at,
  settlement, pivot_attempted, attempts, next_attempt_at, deadline_at, last_error, attention,
  correlation_id::text, version, created_at, updated_at, completed_at`;

function toChange(row: ChangeRow): ChangeState {
  const requester: Requester =
    row.requester_kind === 'staff'
      ? { kind: 'staff', subjectId: row.requester_subject }
      : { kind: row.requester_kind as 'account' | 'guest', subjectId: row.requester_subject };
  return {
    changeId: row.change_id,
    bookingId: row.booking_id,
    kind: row.kind as ChangeKind,
    step: row.step as ChangeStep,
    outcome: row.outcome as ChangeOutcome | null,
    reason: row.reason as CancellationReason | null,
    refusal: row.refusal as ChangeRefusal | null,
    requester,
    from: {
      holdId: row.from_hold_id,
      zoneId: row.zone_id,
      startsAt: row.from_starts_at,
      endsAt: row.from_ends_at,
    },
    to:
      row.to_hold_id !== null &&
      row.to_hold_revision !== null &&
      row.to_starts_at !== null &&
      row.to_ends_at !== null &&
      row.to_expires_at !== null
        ? {
            holdId: row.to_hold_id,
            holdRevision: row.to_hold_revision,
            zoneId: row.zone_id,
            startsAt: row.to_starts_at,
            endsAt: row.to_ends_at,
            expiresAt: row.to_expires_at,
          }
        : null,
    settlement: row.settlement as Settlement | null,
    pivotAttempted: row.pivot_attempted,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    deadlineAt: row.deadline_at,
    lastError: row.last_error,
    attention: row.attention,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

class LeaseLost extends Error {
  constructor() {
    super('CHANGE_LEASE_LOST');
    this.name = 'LeaseLost';
  }
}

export class PrismaChangeStore implements ChangeStore {
  constructor(
    private readonly prisma: PrismaService,
    private readonly options: { readonly leaseMs: number; readonly conflictAttempts?: number },
  ) {}

  private async run<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    const attempts = this.options.conflictAttempts ?? 3;
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.prisma.client.$transaction(work, {
          isolationLevel: 'ReadCommitted',
          maxWait: 5_000,
          timeout: 10_000,
        });
      } catch (error) {
        if (!isTransientConflict(error) || attempt >= attempts) throw error;
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 25 * attempt));
      }
    }
  }

  async insertChange(input: {
    readonly change: ChangeState;
    readonly idempotencyKey: string;
    readonly fingerprint: string;
    readonly expectedBookingVersion: number;
    readonly correlationId: string;
    readonly audit: AuditFact;
  }): Promise<InsertChangeResult> {
    const { change } = input;
    return this.run(async (tx) => {
      // The booking lock serialises every change request of this booking,
      // including two retries of one key.
      const [booking] = await tx.$queryRawUnsafe<{ version: number }[]>(
        `SELECT version FROM app.booking WHERE id = $1::uuid FOR UPDATE`,
        change.bookingId,
      );
      const replay = await this.byKey(tx, change.requester, input.idempotencyKey);
      if (replay) {
        return replay.fingerprint === input.fingerprint
          ? { kind: 'REPLAY', changeId: replay.change_id }
          : { kind: 'IDEMPOTENCY_CONFLICT' };
      }
      if (!booking || booking.version !== input.expectedBookingVersion) {
        return { kind: 'REVISION_CONFLICT' };
      }
      const inserted = await tx.$queryRawUnsafe<{ change_id: string }[]>(
        `INSERT INTO app.booking_change (
           change_id, booking_id, kind, step, outcome, reason, refusal, requester_kind,
           requester_subject, idempotency_key, fingerprint, from_hold_id, zone_id, from_starts_at,
           from_ends_at, to_hold_id, to_hold_revision, to_starts_at, to_ends_at, to_expires_at,
           settlement, pivot_attempted, attempts, next_attempt_at, deadline_at, last_error,
           attention, fence, correlation_id, version, created_at, updated_at, completed_at)
         VALUES ($1::uuid, $2::uuid, $3, $4, NULL, $5, NULL, $6, $7::uuid, $8, $9, $10::uuid,
           $11::uuid, $12, $13, $14::uuid, $15, $16, $17, $18, $19, false, 0, $20, $21, NULL,
           false, 0, $22::uuid, $23, $24, $24, NULL)
         ON CONFLICT DO NOTHING
         RETURNING change_id::text`,
        change.changeId,
        change.bookingId,
        change.kind,
        change.step,
        change.reason,
        change.requester.kind,
        change.requester.subjectId,
        input.idempotencyKey,
        input.fingerprint,
        change.from.holdId,
        change.from.zoneId,
        change.from.startsAt,
        change.from.endsAt,
        change.to?.holdId ?? null,
        change.to?.holdRevision ?? null,
        change.to?.startsAt ?? null,
        change.to?.endsAt ?? null,
        change.to?.expiresAt ?? null,
        change.settlement,
        change.nextAttemptAt,
        change.deadlineAt,
        input.correlationId,
        change.version,
        change.createdAt,
      );
      if (inserted.length === 0) {
        // Either the key was taken concurrently (another booking, same requester)
        // or another change of this booking is open.
        const raced = await this.byKey(tx, change.requester, input.idempotencyKey);
        if (raced) {
          return raced.fingerprint === input.fingerprint
            ? { kind: 'REPLAY', changeId: raced.change_id }
            : { kind: 'IDEMPOTENCY_CONFLICT' };
        }
        return { kind: 'CHANGE_IN_PROGRESS' };
      }
      await appendAudit(tx, input.audit);
      return { kind: 'CREATED' };
    });
  }

  private async byKey(
    tx: Tx,
    requester: Requester,
    key: string,
  ): Promise<{ change_id: string; fingerprint: string } | null> {
    const [row] = await tx.$queryRawUnsafe<{ change_id: string; fingerprint: string }[]>(
      `SELECT change_id::text, fingerprint FROM app.booking_change
        WHERE requester_kind = $1 AND requester_subject = $2::uuid AND idempotency_key = $3`,
      requester.kind,
      requester.subjectId,
      key,
    );
    return row ?? null;
  }

  async findByKey(
    requester: Requester,
    key: string,
  ): Promise<{ readonly changeId: string; readonly fingerprint: string } | null> {
    const [row] = await this.prisma.client.$queryRawUnsafe<
      { change_id: string; fingerprint: string }[]
    >(
      `SELECT change_id::text, fingerprint FROM app.booking_change
        WHERE requester_kind = $1 AND requester_subject = $2::uuid AND idempotency_key = $3`,
      requester.kind,
      requester.subjectId,
      key,
    );
    return row ? { changeId: row.change_id, fingerprint: row.fingerprint } : null;
  }

  async findChange(changeId: string): Promise<ChangeRecord | null> {
    const [row] = await this.prisma.client.$queryRawUnsafe<ChangeRow[]>(
      `SELECT ${CHANGE_COLUMNS} FROM app.booking_change WHERE change_id = $1::uuid`,
      changeId,
    );
    return row ? { change: toChange(row), correlationId: row.correlation_id } : null;
  }

  async listChanges(bookingId: string, limit: number): Promise<ChangeState[]> {
    const rows = await this.prisma.client.$queryRawUnsafe<ChangeRow[]>(
      `SELECT ${CHANGE_COLUMNS} FROM app.booking_change WHERE booking_id = $1::uuid
        ORDER BY created_at DESC, change_id DESC LIMIT $2`,
      bookingId,
      limit,
    );
    return rows.map(toChange);
  }

  async findOpenChange(bookingId: string): Promise<ChangeState | null> {
    const [row] = await this.prisma.client.$queryRawUnsafe<ChangeRow[]>(
      `SELECT ${CHANGE_COLUMNS} FROM app.booking_change
        WHERE booking_id = $1::uuid AND outcome IS NULL`,
      bookingId,
    );
    return row ? toChange(row) : null;
  }

  async leaseChange(
    changeId: string,
    owner: string,
    now: Date,
    leaseMs: number,
  ): Promise<{ readonly record: ChangeRecord; readonly lease: SagaLease } | null> {
    const [leased] = await this.prisma.client.$queryRawUnsafe<{ fence: number }[]>(
      `UPDATE app.booking_change
          SET fence = fence + 1, lease_owner = $2, lease_until = $3
        WHERE change_id = $1::uuid AND outcome IS NULL
          AND (lease_until IS NULL OR lease_until <= $4)
       RETURNING fence`,
      changeId,
      owner,
      new Date(now.getTime() + leaseMs),
      now,
    );
    if (!leased) return null;
    const record = await this.findChange(changeId);
    return record ? { record, lease: { owner, fence: leased.fence } } : null;
  }

  async leaseDueChanges(
    owner: string,
    now: Date,
    leaseMs: number,
    limit: number,
  ): Promise<{ readonly record: ChangeRecord; readonly lease: SagaLease }[]> {
    const leased = await this.prisma.client.$queryRawUnsafe<{ change_id: string; fence: number }[]>(
      `UPDATE app.booking_change AS c
          SET fence = c.fence + 1, lease_owner = $1, lease_until = $2
        WHERE c.change_id IN (
          SELECT d.change_id FROM app.booking_change AS d
           WHERE d.outcome IS NULL
             AND d.next_attempt_at <= $3
             AND (d.lease_until IS NULL OR d.lease_until <= $3)
           ORDER BY d.next_attempt_at, d.change_id
           FOR UPDATE SKIP LOCKED
           LIMIT $4)
       RETURNING c.change_id::text, c.fence`,
      owner,
      new Date(now.getTime() + leaseMs),
      now,
      limit,
    );
    const result: { record: ChangeRecord; lease: SagaLease }[] = [];
    for (const row of leased) {
      const record = await this.findChange(row.change_id);
      if (record) result.push({ record, lease: { owner, fence: row.fence } });
    }
    return result;
  }

  async saveChange(change: ChangeState, lease: SagaLease, release: boolean): Promise<boolean> {
    return this.writeChange(this.prisma.client, change, lease, release);
  }

  private async writeChange(
    client: Tx | PrismaService['client'],
    change: ChangeState,
    lease: SagaLease,
    release: boolean,
  ): Promise<boolean> {
    const rows = await client.$queryRawUnsafe<{ change_id: string }[]>(
      `UPDATE app.booking_change
          SET step = $3, outcome = $4, refusal = $5, settlement = $6, pivot_attempted = $7,
              attempts = $8, next_attempt_at = $9, last_error = $10, attention = $11,
              version = $12, updated_at = $13, completed_at = $14,
              lease_owner = CASE WHEN $15::boolean THEN NULL ELSE lease_owner END,
              lease_until = CASE WHEN $15::boolean THEN NULL ELSE $16::timestamptz END
        WHERE change_id = $1::uuid AND fence = $2 AND lease_owner = $17
       RETURNING change_id::text`,
      change.changeId,
      lease.fence,
      change.step,
      change.outcome,
      change.refusal,
      change.settlement,
      change.pivotAttempted,
      change.attempts,
      change.nextAttemptAt,
      change.lastError === null ? null : change.lastError.slice(0, 64),
      change.attention,
      change.version,
      change.updatedAt,
      change.completedAt,
      release,
      new Date(change.updatedAt.getTime() + this.options.leaseMs),
      lease.owner,
    );
    return rows.length === 1;
  }

  async applyChange(input: {
    readonly change: ChangeState;
    readonly lease: SagaLease;
    readonly release: boolean;
    readonly booking: Booking | null;
    readonly expectedBookingVersion: number | null;
    readonly event: BookingEvent | null;
    readonly audit: AuditFact | null;
  }): Promise<boolean> {
    try {
      return await this.run(async (tx) => {
        if (!(await this.writeChange(tx, input.change, input.lease, input.release))) {
          throw new LeaseLost();
        }
        const { booking, change } = input;
        if (booking !== null) {
          const updated = await tx.$executeRawUnsafe(
            `UPDATE app.booking
                SET status = $3, cancellation_reason = $4, cancelled_at = $5,
                    schedule_revision = $6, schedule_hold_id = $7::uuid, schedule_starts_at = $8,
                    schedule_ends_at = $9, version = $10, updated_at = $11
              WHERE id = $1::uuid AND version = $2`,
            booking.id,
            input.expectedBookingVersion,
            booking.status,
            booking.cancellation?.reason ?? null,
            booking.cancellation?.cancelledAt ?? null,
            booking.scheduleRevision,
            booking.rescheduledSlot?.holdId ?? null,
            booking.rescheduledSlot?.startsAt ?? null,
            booking.rescheduledSlot?.endsAt ?? null,
            booking.version,
            booking.updatedAt,
          );
          if (updated !== 1) throw new ConcurrencyViolation('BOOKING');
          if (change.kind === 'RESCHEDULE' && booking.rescheduledSlot !== null) {
            await tx.$executeRawUnsafe(
              `INSERT INTO app.booking_schedule (booking_id, revision, change_id, previous_hold_id,
                 hold_id, zone_id, starts_at, ends_at, created_at)
               VALUES ($1::uuid, $2, $3::uuid, $4::uuid, $5::uuid, $6::uuid, $7, $8, $9)`,
              booking.id,
              booking.scheduleRevision,
              change.changeId,
              change.from.holdId,
              booking.rescheduledSlot.holdId,
              booking.rescheduledSlot.zoneId,
              booking.rescheduledSlot.startsAt,
              booking.rescheduledSlot.endsAt,
              booking.updatedAt,
            );
          }
        }
        if (input.event) {
          await tx.$executeRawUnsafe(
            `INSERT INTO app.outbox_message (id, event_id, event_type, exchange, routing_key, payload, correlation_id, trace_parent)
             VALUES ($1::uuid, $2::uuid, $3, $4, $3, $5, $6::uuid, $7)`,
            randomUUID(),
            input.event.eventId,
            input.event.eventType,
            BOOKING_EVENTS_EXCHANGE,
            JSON.stringify(input.event),
            input.event.correlationId,
            input.event.traceparent ?? traceHeaders()['traceparent'] ?? null,
          );
        }
        if (input.audit) await appendAudit(tx, input.audit);
        return true;
      });
    } catch (error) {
      if (error instanceof LeaseLost) return false;
      throw error;
    }
  }
}
