import { randomUUID } from 'node:crypto';
import { traceHeaders } from '@carwash/service-kit';
import {
  BOOKING_EVENTS_EXCHANGE,
  type Booking,
  type BookingEvent,
  type RejectionReason,
  type SagaOutcome,
  type SagaState,
  type SagaStep,
} from '../../domain';
import type {
  Actor,
  AuditFact,
  BookingRecord,
  BookingStore,
  InsertBookingResult,
  RequestClaim,
  RequestKey,
  SagaLease,
} from '../../ports';
import type { Prisma } from '../../generated/prisma/client';
import type { PrismaService } from './prisma.service';
import { BOOKING_COLUMNS, quoteToJson, toBooking, type BookingRow } from './snapshot-codec';

/**
 * PostgreSQL adapter of the BookingStore port.
 *
 * Every method is one READ COMMITTED transaction in the booking database.
 * Correctness does not rest on application code alone:
 *   - the request claim row is locked (FOR UPDATE) and fence-checked before a
 *     booking is bound to it, so one Idempotency-Key yields one booking;
 *   - partial unique indexes allow one live booking per hold and per quote;
 *   - saga writes are conditional on (lease owner, fence): a superseded
 *     worker's write changes nothing and reports `false`;
 *   - booking updates are guarded by version, and a trigger refuses any change
 *     of the snapshot columns and any delete.
 */
type Tx = Prisma.TransactionClient;

interface SagaRow {
  booking_id: string;
  step: string;
  outcome: string | null;
  pending_rejection: string | null;
  obligation_id: string | null;
  pivot_attempted: boolean;
  attempts: number;
  next_attempt_at: Date;
  deadline_at: Date;
  last_error: string | null;
  fence: number;
  correlation_id: string;
  saga_version: number;
  saga_updated_at: Date;
}

// Aliased: the booking row has its own version/updated_at in the same SELECT.
const SAGA_COLUMNS = `s.booking_id::text, s.step, s.outcome, s.pending_rejection, s.obligation_id,
  s.pivot_attempted, s.attempts, s.next_attempt_at, s.deadline_at, s.last_error, s.fence,
  s.correlation_id::text, s.version AS saga_version, s.updated_at AS saga_updated_at`;

const LIVE = `('VALIDATE_QUOTE', 'CREATE_OBLIGATION', 'COMMIT_HOLD', 'VOID_OBLIGATION')`;

/** The saga lease was taken over; the finishing transaction rolls back. */
class LeaseLost extends Error {
  constructor() {
    super('SAGA_LEASE_LOST');
    this.name = 'LeaseLost';
  }
}

export class ConcurrencyViolation extends Error {
  constructor(what: string) {
    super(`${what}_VERSION_MISMATCH`);
    this.name = 'ConcurrencyViolation';
  }
}

/**
 * SQLSTATE of a failed statement as surfaced by the pg driver adapter: most
 * errors carry `code`, ones the adapter classifies itself carry `originalCode`.
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

function toSaga(row: SagaRow): SagaState {
  return {
    bookingId: row.booking_id,
    step: row.step as SagaStep,
    outcome: row.outcome as SagaOutcome | null,
    pendingRejection: row.pending_rejection as RejectionReason | null,
    obligationId: row.obligation_id,
    pivotAttempted: row.pivot_attempted,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    deadlineAt: row.deadline_at,
    lastError: row.last_error,
    fence: row.fence,
    version: row.saga_version,
    updatedAt: row.saga_updated_at,
  };
}

function actorParts(actor: Actor): { kind: 'USER' | 'SYSTEM'; id: string } {
  return actor.kind === 'USER'
    ? { kind: 'USER', id: actor.subject }
    : { kind: 'SYSTEM', id: actor.component };
}

async function appendAudit(tx: Tx, fact: AuditFact): Promise<void> {
  const actor = actorParts(fact.actor);
  await tx.$executeRawUnsafe(
    `INSERT INTO app.audit_entry (id, actor_kind, actor_id, action, target_type, target_id, correlation_id, details)
     VALUES ($1::uuid, $2, $3, $4, 'BOOKING', $5::uuid, $6::uuid, $7::jsonb)`,
    randomUUID(),
    actor.kind,
    actor.id,
    fact.action,
    fact.bookingId,
    fact.correlationId,
    JSON.stringify(fact.details),
  );
}

export class PrismaBookingStore implements BookingStore {
  constructor(
    private readonly prisma: PrismaService,
    private readonly options: {
      /** Lease extension granted on every saga write that keeps the lease. */
      readonly sagaLeaseMs: number;
      readonly transactionTimeoutMs?: number;
      readonly conflictAttempts?: number;
    },
  ) {}

  private async run<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    // A deadlock or serialization failure rolled everything back and only this
    // database was touched, so re-running the unit is safe. Bounded, jittered.
    const attempts = this.options.conflictAttempts ?? 3;
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.prisma.client.$transaction(work, {
          isolationLevel: 'ReadCommitted',
          maxWait: 5_000,
          timeout: this.options.transactionTimeoutMs ?? 10_000,
        });
      } catch (error) {
        if (!isTransientConflict(error) || attempt >= attempts) throw error;
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 25 * attempt));
      }
    }
  }

  async claimRequest(
    key: RequestKey,
    candidateBookingId: string,
    now: Date,
    leaseMs: number,
  ): Promise<RequestClaim> {
    const leaseUntil = new Date(now.getTime() + leaseMs);
    for (let round = 0; round < 3; round += 1) {
      const claim = await this.run(async (tx): Promise<RequestClaim | null> => {
        const inserted = await tx.$queryRawUnsafe<{ booking_id: string; fence: number }[]>(
          `INSERT INTO app.booking_request
             (principal_kind, principal_subject, idempotency_key, fingerprint, booking_id, state, fence, lease_until, created_at, updated_at)
           VALUES ($1, $2::uuid, $3, $4, $5::uuid, 'CAPTURING', 1, $6, $7, $7)
           ON CONFLICT DO NOTHING
           RETURNING booking_id::text, fence`,
          key.principalKind,
          key.subject,
          key.key,
          key.fingerprint,
          candidateBookingId,
          leaseUntil,
          now,
        );
        const fresh = inserted[0];
        if (fresh) return { kind: 'NEW', bookingId: fresh.booking_id, fence: fresh.fence };

        const [existing] = await tx.$queryRawUnsafe<
          {
            fingerprint: string;
            booking_id: string;
            state: string;
            fence: number;
            lease_until: Date;
          }[]
        >(
          `SELECT fingerprint, booking_id::text, state, fence, lease_until FROM app.booking_request
            WHERE principal_kind = $1 AND principal_subject = $2::uuid AND idempotency_key = $3
            FOR UPDATE`,
          key.principalKind,
          key.subject,
          key.key,
        );
        if (!existing) return null; // abandoned concurrently: try again
        if (existing.fingerprint !== key.fingerprint) return { kind: 'CONFLICT' };
        if (existing.state === 'BOUND') return { kind: 'BOUND', bookingId: existing.booking_id };
        if (existing.lease_until.getTime() > now.getTime()) return { kind: 'IN_PROGRESS' };
        // The earlier attempt crashed (or stalled) before binding: take it over.
        // Its fence becomes stale, so it can no longer bind a booking.
        const [taken] = await tx.$queryRawUnsafe<{ fence: number }[]>(
          `UPDATE app.booking_request SET fence = fence + 1, lease_until = $4, updated_at = $5
            WHERE principal_kind = $1 AND principal_subject = $2::uuid AND idempotency_key = $3
            RETURNING fence`,
          key.principalKind,
          key.subject,
          key.key,
          leaseUntil,
          now,
        );
        if (!taken) return null;
        return { kind: 'TAKEN_OVER', bookingId: existing.booking_id, fence: taken.fence };
      });
      if (claim) return claim;
    }
    return { kind: 'IN_PROGRESS' };
  }

  async abandonRequest(key: RequestKey, fence: number): Promise<void> {
    await this.prisma.client.$executeRawUnsafe(
      `DELETE FROM app.booking_request
        WHERE principal_kind = $1 AND principal_subject = $2::uuid AND idempotency_key = $3
          AND fence = $4 AND state = 'CAPTURING'`,
      key.principalKind,
      key.subject,
      key.key,
      fence,
    );
  }

  async insertBooking(
    booking: Booking,
    saga: SagaState,
    claim: { readonly key: RequestKey; readonly fence: number },
    audit: AuditFact,
  ): Promise<InsertBookingResult> {
    return this.run(async (tx) => {
      const { key } = claim;
      const [request] = await tx.$queryRawUnsafe<
        { state: string; fence: number; booking_id: string }[]
      >(
        `SELECT state, fence, booking_id::text FROM app.booking_request
          WHERE principal_kind = $1 AND principal_subject = $2::uuid AND idempotency_key = $3
          FOR UPDATE`,
        key.principalKind,
        key.subject,
        key.key,
      );
      if (
        !request ||
        request.state !== 'CAPTURING' ||
        request.fence !== claim.fence ||
        request.booking_id !== booking.id
      ) {
        return 'CLAIM_LOST';
      }
      // ON CONFLICT DO NOTHING covers both partial unique indexes: a concurrent
      // insert for the same hold/quote waits for the other transaction and then
      // finds the live booking instead of failing the transaction.
      const inserted = await tx.$queryRawUnsafe<{ id: string }[]>(
        `INSERT INTO app.booking (
           id, principal_kind, principal_subject, status, rejection_reason, payment_method,
           contact, vehicle_snapshot, address_snapshot, quote_snapshot, quote_id, quote_revision,
           currency, total_minor, total_scale, hold_id, hold_revision, zone_id,
           requested_starts_at, requested_ends_at, version, created_at, updated_at)
         VALUES ($1::uuid, $2, $3::uuid, $4, NULL, $5,
           $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10::uuid, $11,
           $12, $13::bigint, $14, $15::uuid, $16, $17::uuid,
           $18, $19, $20, $21, $21)
         ON CONFLICT DO NOTHING
         RETURNING id::text`,
        booking.id,
        booking.beneficiary.kind,
        booking.beneficiary.subjectId,
        booking.status,
        booking.paymentMethod,
        JSON.stringify(booking.contact),
        JSON.stringify(booking.vehicle),
        JSON.stringify(booking.address),
        JSON.stringify(quoteToJson(booking.quote)),
        booking.quote.quoteId,
        booking.quote.revision,
        booking.total.currency,
        booking.total.amountMinor.toString(),
        booking.total.scale,
        booking.requestedSlot.holdId,
        booking.requestedSlot.holdRevision,
        booking.requestedSlot.zoneId,
        booking.requestedSlot.startsAt,
        booking.requestedSlot.endsAt,
        booking.version,
        booking.createdAt,
      );
      if (inserted.length === 0) {
        const [holdTaken] = await tx.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id::text FROM app.booking WHERE hold_id = $1::uuid AND status <> 'REJECTED'`,
          booking.requestedSlot.holdId,
        );
        return holdTaken ? 'HOLD_TAKEN' : 'QUOTE_TAKEN';
      }
      await tx.$executeRawUnsafe(
        `INSERT INTO app.booking_saga (
           booking_id, step, outcome, pending_rejection, obligation_id, pivot_attempted, attempts,
           next_attempt_at, deadline_at, last_error, fence, correlation_id, version, created_at, updated_at)
         VALUES ($1::uuid, $2, NULL, NULL, NULL, false, 0, $3, $4, NULL, 0, $5::uuid, $6, $7, $7)`,
        saga.bookingId,
        saga.step,
        saga.nextAttemptAt,
        saga.deadlineAt,
        audit.correlationId,
        saga.version,
        saga.updatedAt,
      );
      await tx.$executeRawUnsafe(
        `UPDATE app.booking_request SET state = 'BOUND', updated_at = $4
          WHERE principal_kind = $1 AND principal_subject = $2::uuid AND idempotency_key = $3`,
        key.principalKind,
        key.subject,
        key.key,
        booking.createdAt,
      );
      await appendAudit(tx, audit);
      return 'CREATED';
    });
  }

  async find(bookingId: string): Promise<BookingRecord | null> {
    const [row] = await this.prisma.client.$queryRawUnsafe<(BookingRow & SagaRow)[]>(
      `SELECT ${BOOKING_COLUMNS}, ${SAGA_COLUMNS}
         FROM app.booking b JOIN app.booking_saga s ON s.booking_id = b.id
        WHERE b.id = $1::uuid`,
      bookingId,
    );
    if (!row) return null;
    return { booking: toBooking(row), saga: toSaga(row), correlationId: row.correlation_id };
  }

  async recordAudit(fact: AuditFact): Promise<void> {
    await this.run((tx) => appendAudit(tx, fact));
  }

  async leaseSaga(
    bookingId: string,
    owner: string,
    now: Date,
    leaseMs: number,
  ): Promise<{ readonly record: BookingRecord; readonly lease: SagaLease } | null> {
    const [leased] = await this.prisma.client.$queryRawUnsafe<{ fence: number }[]>(
      `UPDATE app.booking_saga
          SET fence = fence + 1, lease_owner = $2, lease_until = $3
        WHERE booking_id = $1::uuid AND step IN ${LIVE}
          AND (lease_until IS NULL OR lease_until <= $4)
       RETURNING fence`,
      bookingId,
      owner,
      new Date(now.getTime() + leaseMs),
      now,
    );
    if (!leased) return null;
    const record = await this.find(bookingId);
    if (!record) return null;
    return { record, lease: { owner, fence: leased.fence } };
  }

  async leaseDue(
    owner: string,
    now: Date,
    leaseMs: number,
    limit: number,
  ): Promise<{ readonly record: BookingRecord; readonly lease: SagaLease }[]> {
    const leased = await this.prisma.client.$queryRawUnsafe<
      { booking_id: string; fence: number }[]
    >(
      `UPDATE app.booking_saga AS s
          SET fence = s.fence + 1, lease_owner = $1, lease_until = $2
        WHERE s.booking_id IN (
          SELECT c.booking_id FROM app.booking_saga AS c
           WHERE c.step IN ${LIVE}
             AND c.next_attempt_at <= $3
             AND (c.lease_until IS NULL OR c.lease_until <= $3)
           ORDER BY c.next_attempt_at, c.booking_id
           FOR UPDATE SKIP LOCKED
           LIMIT $4)
       RETURNING s.booking_id::text, s.fence`,
      owner,
      new Date(now.getTime() + leaseMs),
      now,
      limit,
    );
    const result: { record: BookingRecord; lease: SagaLease }[] = [];
    for (const row of leased) {
      const record = await this.find(row.booking_id);
      if (record) result.push({ record, lease: { owner, fence: row.fence } });
    }
    return result;
  }

  async saveSaga(saga: SagaState, lease: SagaLease, release: boolean): Promise<boolean> {
    return this.writeSaga(this.prisma.client, saga, lease, release);
  }

  private async writeSaga(
    client: Tx | PrismaService['client'],
    saga: SagaState,
    lease: SagaLease,
    release: boolean,
  ): Promise<boolean> {
    const rows = await client.$queryRawUnsafe<{ booking_id: string }[]>(
      `UPDATE app.booking_saga
          SET step = $3, outcome = $4, pending_rejection = $5, obligation_id = $6,
              pivot_attempted = $7, attempts = $8, next_attempt_at = $9, deadline_at = $10,
              last_error = $11, version = $12, updated_at = $13,
              lease_owner = CASE WHEN $14::boolean THEN NULL ELSE lease_owner END,
              lease_until = CASE WHEN $14::boolean THEN NULL ELSE $15::timestamptz END
        WHERE booking_id = $1::uuid AND fence = $2 AND lease_owner = $16
       RETURNING booking_id::text`,
      saga.bookingId,
      lease.fence,
      saga.step,
      saga.outcome,
      saga.pendingRejection,
      saga.obligationId,
      saga.pivotAttempted,
      saga.attempts,
      saga.nextAttemptAt,
      saga.deadlineAt,
      saga.lastError === null ? null : saga.lastError.slice(0, 64),
      saga.version,
      saga.updatedAt,
      release,
      new Date(saga.updatedAt.getTime() + this.options.sagaLeaseMs),
      lease.owner,
    );
    return rows.length === 1;
  }

  async finish(input: {
    readonly saga: SagaState;
    readonly lease: SagaLease;
    readonly booking: Booking;
    readonly expectedBookingVersion: number;
    readonly event: BookingEvent | null;
    readonly audit: AuditFact;
  }): Promise<boolean> {
    try {
      return await this.run(async (tx) => {
        if (!(await this.writeSaga(tx, input.saga, input.lease, true))) throw new LeaseLost();
        const { booking } = input;
        if (booking.version !== input.expectedBookingVersion) {
          const updated = await tx.$executeRawUnsafe(
            `UPDATE app.booking
                SET status = $3, rejection_reason = $4, slot_starts_at = $5, slot_ends_at = $6,
                    confirmed_at = $7, version = $8, updated_at = $9
              WHERE id = $1::uuid AND version = $2`,
            booking.id,
            input.expectedBookingVersion,
            booking.status,
            booking.rejectionReason,
            booking.slot?.startsAt ?? null,
            booking.slot?.endsAt ?? null,
            booking.confirmedAt,
            booking.version,
            booking.updatedAt,
          );
          if (updated !== 1) throw new ConcurrencyViolation('BOOKING');
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
        await appendAudit(tx, input.audit);
        return true;
      });
    } catch (error) {
      if (error instanceof LeaseLost) return false;
      throw error;
    }
  }
}
