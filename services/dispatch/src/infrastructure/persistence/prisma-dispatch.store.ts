import { randomUUID } from 'node:crypto';
import { traceHeaders } from '@carwash/service-kit';
import {
  DispatchError,
  type AssignmentState,
  type AssignmentStatus,
  type CancelReason,
  type DeclineReason,
  type EvidenceLink,
  type HoldEventState,
  type HoldObservation,
  type OfferState,
  type OfferStatus,
  type ResourceObservation,
  type TaskState,
  type WithdrawReason,
} from '../../domain';
import type {
  Actor,
  AssignmentQuery,
  AuditAppend,
  DispatchReadModel,
  DispatchTransaction,
  DispatchUnitOfWork,
  IdempotencyClaim,
  IdempotencyRetention,
  IdempotentResult,
  InsertAssignmentResult,
  OutboxAppend,
  TaskHistoryEntry,
  TaskNote,
} from '../../ports';
import type { Prisma } from '../../generated/prisma/client';
import type { PrismaService } from './prisma.service';
import {
  EVIDENCE_COLUMNS,
  OPEN_STAGES_SQL,
  TASK_COLUMNS,
  taskParameters,
  toEvidence,
  toHistory,
  toNote,
  toObservation,
  toTask,
  type EvidenceRow,
  type NoteRow,
  type TaskRow,
} from './task-rows';

/**
 * PostgreSQL adapter for the dispatch ports.
 *
 * Correctness does not rest on application code alone:
 *   - every decision is made on rows read under FOR UPDATE, in the lock order
 *     idempotency -> hold observation -> assignment -> offer;
 *   - every UPDATE is guarded by the version read under that lock;
 *   - UNIQUE, partial UNIQUE, CHECK and EXCLUDE constraints reject any write
 *     that would break an invariant, even one produced by a defect above.
 *
 * Tables are qualified with the "app" schema; the runtime role has DML only.
 */
type Tx = Prisma.TransactionClient;

interface AssignmentRow {
  id: string;
  booking_id: string;
  hold_id: string;
  zone_id: string;
  starts_at: Date;
  ends_at: Date;
  status: string;
  resource_id: string | null;
  technician_subject: string | null;
  cancel_reason: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

interface OfferRow {
  id: string;
  assignment_id: string;
  resource_id: string;
  technician_subject: string;
  status: string;
  expires_at: Date;
  decline_reason: string | null;
  decline_note: string | null;
  withdraw_reason: string | null;
  created_by: string;
  version: number;
  created_at: Date;
  updated_at: Date;
}

const ASSIGNMENT_COLUMNS = `id::text, booking_id::text, hold_id::text, zone_id::text, starts_at, ends_at,
  status, resource_id::text, technician_subject::text, cancel_reason, version, created_at, updated_at`;
const OFFER_COLUMNS = `id::text, assignment_id::text, resource_id::text, technician_subject::text, status,
  expires_at, decline_reason, decline_note, withdraw_reason, created_by, version, created_at, updated_at`;

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

function toAssignment(row: AssignmentRow): AssignmentState {
  return {
    id: row.id,
    bookingId: row.booking_id,
    holdId: row.hold_id,
    zoneId: row.zone_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status as AssignmentStatus,
    resourceId: row.resource_id,
    technicianSubject: row.technician_subject,
    cancelReason: row.cancel_reason as CancelReason | null,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toOffer(row: OfferRow): OfferState {
  return {
    id: row.id,
    assignmentId: row.assignment_id,
    resourceId: row.resource_id,
    technicianSubject: row.technician_subject,
    status: row.status as OfferStatus,
    expiresAt: row.expires_at,
    declineReason: row.decline_reason as DeclineReason | null,
    declineNote: row.decline_note,
    withdrawReason: row.withdraw_reason as WithdrawReason | null,
    createdBy: row.created_by,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function actorId(actor: Actor): string {
  if (actor.kind === 'USER') return actor.subject;
  if (actor.kind === 'SERVICE') return actor.clientId;
  return actor.component;
}

class PrismaDispatchTransaction implements DispatchTransaction {
  constructor(private readonly tx: Tx) {}

  async claimIdempotency(
    scope: string,
    key: string,
    fingerprint: string,
  ): Promise<IdempotencyClaim> {
    // A concurrent insert of the same (scope, key) makes this statement WAIT
    // for the other transaction: if it commits we see a conflict and read its
    // record; if it rolls back our insert goes ahead. Placeholder result values
    // are overwritten by completeIdempotency in this same transaction.
    const inserted = await this.tx.$queryRawUnsafe<{ scope: string }[]>(
      `INSERT INTO app.idempotency_record (scope, idempotency_key, request_fingerprint, result_type, result_id)
       VALUES ($1, $2, $3, 'ASSIGNMENT', '00000000-0000-4000-8000-000000000000')
       ON CONFLICT (scope, idempotency_key) DO NOTHING
       RETURNING scope`,
      scope,
      key,
      fingerprint,
    );
    if (inserted.length === 1) return { kind: 'NEW' };
    const [row] = await this.tx.$queryRawUnsafe<
      { request_fingerprint: string; result_type: string; result_id: string }[]
    >(
      `SELECT request_fingerprint, result_type, result_id::text FROM app.idempotency_record
        WHERE scope = $1 AND idempotency_key = $2`,
      scope,
      key,
    );
    if (!row) throw new Error('IDEMPOTENCY_RECORD_VANISHED');
    if (row.request_fingerprint !== fingerprint) return { kind: 'CONFLICT' };
    return {
      kind: 'REPLAY',
      result: {
        resultType: row.result_type === 'OFFER' ? 'OFFER' : 'ASSIGNMENT',
        resultId: row.result_id,
      },
    };
  }

  async completeIdempotency(scope: string, key: string, result: IdempotentResult): Promise<void> {
    const rows = await this.tx.$queryRawUnsafe<{ scope: string }[]>(
      `UPDATE app.idempotency_record SET result_type = $3, result_id = $4::uuid
        WHERE scope = $1 AND idempotency_key = $2 RETURNING scope`,
      scope,
      key,
      result.resultType,
      result.resultId,
    );
    if (rows.length !== 1) throw new Error('IDEMPOTENCY_RECORD_MISSING');
  }

  async lockHoldObservation(holdId: string): Promise<HoldObservation | null> {
    // The first event for a hold has no row to lock yet, so concurrent first
    // deliveries are serialised by a transaction-scoped advisory lock.
    await this.tx.$executeRawUnsafe(
      `SELECT pg_advisory_xact_lock(hashtextextended('dispatch.hold:' || $1::text, 0))`,
      holdId,
    );
    const [row] = await this.tx.$queryRawUnsafe<
      { hold_id: string; version: number; state: string }[]
    >(
      `SELECT hold_id::text, version, state FROM app.hold_observation WHERE hold_id = $1::uuid FOR UPDATE`,
      holdId,
    );
    return row
      ? { holdId: row.hold_id, version: row.version, state: row.state as HoldEventState }
      : null;
  }

  async saveHoldObservation(observation: HoldObservation): Promise<void> {
    await this.tx.$executeRawUnsafe(
      `INSERT INTO app.hold_observation (hold_id, version, state, updated_at)
       VALUES ($1::uuid, $2, $3, now())
       ON CONFLICT (hold_id) DO UPDATE
         SET version = EXCLUDED.version, state = EXCLUDED.state, updated_at = now()
       WHERE app.hold_observation.version < EXCLUDED.version`,
      observation.holdId,
      observation.version,
      observation.state,
    );
  }

  async insertAssignment(assignment: AssignmentState): Promise<InsertAssignmentResult> {
    const rows = await this.tx.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO app.assignment (id, booking_id, hold_id, zone_id, starts_at, ends_at, status,
         resource_id, technician_subject, cancel_reason, version, created_at, updated_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8::uuid, $9::uuid, $10, $11, $12, $13)
       ON CONFLICT DO NOTHING
       RETURNING id::text`,
      assignment.id,
      assignment.bookingId,
      assignment.holdId,
      assignment.zoneId,
      assignment.startsAt,
      assignment.endsAt,
      assignment.status,
      assignment.resourceId,
      assignment.technicianSubject,
      assignment.cancelReason,
      assignment.version,
      assignment.createdAt,
      assignment.updatedAt,
    );
    if (rows.length === 1) return 'CREATED';
    const [byHold] = await this.tx.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id::text FROM app.assignment WHERE hold_id = $1::uuid`,
      assignment.holdId,
    );
    return byHold ? 'DUPLICATE_HOLD' : 'DUPLICATE_BOOKING';
  }

  async lockAssignment(
    id: string,
    options?: { readonly skipLocked?: boolean },
  ): Promise<AssignmentState | null> {
    const [row] = await this.tx.$queryRawUnsafe<AssignmentRow[]>(
      `SELECT ${ASSIGNMENT_COLUMNS} FROM app.assignment WHERE id = $1::uuid
         FOR UPDATE${options?.skipLocked ? ' SKIP LOCKED' : ''}`,
      id,
    );
    return row ? toAssignment(row) : null;
  }

  async lockAssignmentByHold(holdId: string): Promise<AssignmentState | null> {
    const [row] = await this.tx.$queryRawUnsafe<AssignmentRow[]>(
      `SELECT ${ASSIGNMENT_COLUMNS} FROM app.assignment WHERE hold_id = $1::uuid FOR UPDATE`,
      holdId,
    );
    return row ? toAssignment(row) : null;
  }

  async updateAssignment(assignment: AssignmentState, expectedVersion: number): Promise<void> {
    let rows: { id: string }[];
    try {
      rows = await this.tx.$queryRawUnsafe<{ id: string }[]>(
        `UPDATE app.assignment
            SET status = $3, resource_id = $4::uuid, technician_subject = $5::uuid,
                cancel_reason = $6, version = $7, updated_at = $8
          WHERE id = $1::uuid AND version = $2
        RETURNING id::text`,
        assignment.id,
        expectedVersion,
        assignment.status,
        assignment.resourceId,
        assignment.technicianSubject,
        assignment.cancelReason,
        assignment.version,
        assignment.updatedAt,
      );
    } catch (error) {
      // 23P01: the resource already has an ASSIGNED job overlapping this window.
      // The transaction is aborted either way; the caller's whole unit rolls back.
      if (sqlState(error) === '23P01') {
        throw new DispatchError('RESOURCE_BUSY', 'The resource already has a job in this window.');
      }
      throw error;
    }
    if (rows.length !== 1) throw new ConcurrencyViolation('ASSIGNMENT');
  }

  async readOffer(id: string): Promise<OfferState | null> {
    const [row] = await this.tx.$queryRawUnsafe<OfferRow[]>(
      `SELECT ${OFFER_COLUMNS} FROM app.dispatch_offer WHERE id = $1::uuid`,
      id,
    );
    return row ? toOffer(row) : null;
  }

  async lockOffer(id: string): Promise<OfferState | null> {
    const [row] = await this.tx.$queryRawUnsafe<OfferRow[]>(
      `SELECT ${OFFER_COLUMNS} FROM app.dispatch_offer WHERE id = $1::uuid FOR UPDATE`,
      id,
    );
    return row ? toOffer(row) : null;
  }

  async lockCurrentOffer(assignmentId: string): Promise<OfferState | null> {
    const rows = await this.tx.$queryRawUnsafe<OfferRow[]>(
      `SELECT ${OFFER_COLUMNS} FROM app.dispatch_offer
        WHERE assignment_id = $1::uuid AND status IN ('OFFERED', 'ACCEPTED')
        ORDER BY created_at DESC, id
        FOR UPDATE`,
      assignmentId,
    );
    if (rows.length > 1) throw new Error('MULTIPLE_CURRENT_OFFERS');
    const [row] = rows;
    return row ? toOffer(row) : null;
  }

  async insertOffer(offer: OfferState): Promise<void> {
    await this.tx.$executeRawUnsafe(
      `INSERT INTO app.dispatch_offer (id, assignment_id, resource_id, technician_subject, status,
         expires_at, decline_reason, withdraw_reason, created_by, version, created_at, updated_at, decline_note)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      offer.id,
      offer.assignmentId,
      offer.resourceId,
      offer.technicianSubject,
      offer.status,
      offer.expiresAt,
      offer.declineReason,
      offer.withdrawReason,
      offer.createdBy,
      offer.version,
      offer.createdAt,
      offer.updatedAt,
      offer.declineNote,
    );
  }

  async updateOffer(offer: OfferState, expectedVersion: number): Promise<void> {
    const rows = await this.tx.$queryRawUnsafe<{ id: string }[]>(
      `UPDATE app.dispatch_offer
          SET status = $3, decline_reason = $4, withdraw_reason = $5, version = $6, updated_at = $7,
              decline_note = $8
        WHERE id = $1::uuid AND version = $2
      RETURNING id::text`,
      offer.id,
      expectedVersion,
      offer.status,
      offer.declineReason,
      offer.withdrawReason,
      offer.version,
      offer.updatedAt,
      offer.declineNote,
    );
    if (rows.length !== 1) throw new ConcurrencyViolation('OFFER');
  }

  async lockResourceObservation(resourceId: string): Promise<ResourceObservation | null> {
    // Exclusive per-resource lock: serialises eligibility events for one
    // resource and waits for offer/accept transactions holding it shared.
    await this.tx.$executeRawUnsafe(
      `SELECT pg_advisory_xact_lock(hashtextextended('dispatch.resource:' || $1::text, 0))`,
      resourceId,
    );
    return this.selectObservation(resourceId);
  }

  async readResourceObservation(resourceId: string): Promise<ResourceObservation | null> {
    await this.tx.$executeRawUnsafe(
      `SELECT pg_advisory_xact_lock_shared(hashtextextended('dispatch.resource:' || $1::text, 0))`,
      resourceId,
    );
    return this.selectObservation(resourceId);
  }

  private async selectObservation(resourceId: string): Promise<ResourceObservation | null> {
    const [row] = await this.tx.$queryRawUnsafe<
      { resource_id: string; eligibility: string; revision: number }[]
    >(
      `SELECT resource_id::text, eligibility, revision FROM app.resource_observation
        WHERE resource_id = $1::uuid`,
      resourceId,
    );
    return row ? toObservation(row) : null;
  }

  async saveResourceObservation(observation: ResourceObservation): Promise<void> {
    await this.tx.$executeRawUnsafe(
      `INSERT INTO app.resource_observation (resource_id, eligibility, revision, updated_at)
       VALUES ($1::uuid, $2, $3, now())
       ON CONFLICT (resource_id) DO UPDATE
         SET eligibility = EXCLUDED.eligibility, revision = EXCLUDED.revision, updated_at = now()
       WHERE app.resource_observation.revision < EXCLUDED.revision`,
      observation.resourceId,
      observation.eligibility,
      observation.revision,
    );
  }

  async assignmentsTouchingResource(resourceId: string): Promise<string[]> {
    const rows = await this.tx.$queryRawUnsafe<{ assignment_id: string }[]>(
      `SELECT assignment_id::text AS assignment_id FROM app.dispatch_offer
        WHERE resource_id = $1::uuid AND status = 'OFFERED'
       UNION
       SELECT assignment_id::text AS assignment_id FROM app.task
        WHERE resource_id = $1::uuid AND stage IN ${OPEN_STAGES_SQL}
       ORDER BY 1`,
      resourceId,
    );
    return rows.map((row) => row.assignment_id);
  }

  async readTask(id: string): Promise<TaskState | null> {
    const [row] = await this.tx.$queryRawUnsafe<TaskRow[]>(
      `SELECT ${TASK_COLUMNS} FROM app.task WHERE id = $1::uuid`,
      id,
    );
    return row ? toTask(row) : null;
  }

  async lockTask(id: string): Promise<TaskState | null> {
    const [row] = await this.tx.$queryRawUnsafe<TaskRow[]>(
      `SELECT ${TASK_COLUMNS} FROM app.task WHERE id = $1::uuid FOR UPDATE`,
      id,
    );
    return row ? toTask(row) : null;
  }

  async lockLiveTask(assignmentId: string): Promise<TaskState | null> {
    const rows = await this.tx.$queryRawUnsafe<TaskRow[]>(
      `SELECT ${TASK_COLUMNS} FROM app.task
        WHERE assignment_id = $1::uuid AND stage NOT IN ('RELEASED', 'WITHDRAWN', 'CANCELLED')
        FOR UPDATE`,
      assignmentId,
    );
    if (rows.length > 1) throw new Error('MULTIPLE_LIVE_TASKS');
    const [row] = rows;
    return row ? toTask(row) : null;
  }

  async insertTask(task: TaskState): Promise<void> {
    await this.tx.$executeRawUnsafe(
      `INSERT INTO app.task (id, stage, checklist, condition_note, departed_at, arrived_at,
         arrival_method, started_at, documented_at, finished_at, closed_at, ended_at, end_reason,
         release_reason, attention_reason, collection_outcome, collection_currency, collection_scale,
         collection_amount_minor, collection_reason, collection_declared_at, late_amount_minor,
         late_declared_at, version, updated_at,
         assignment_id, offer_id, booking_id, resource_id, technician_subject, checklist_version,
         accepted_at, created_at)
       VALUES ($1::uuid, $2, $3::jsonb, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
         $17, $18, $19::bigint, $20, $21, $22::bigint, $23, $24, $25,
         $26::uuid, $27::uuid, $28::uuid, $29::uuid, $30::uuid, $31, $32, $33)`,
      task.id,
      ...taskParameters(task),
      task.assignmentId,
      task.offerId,
      task.bookingId,
      task.resourceId,
      task.technicianSubject,
      task.checklistVersion,
      task.acceptedAt,
      task.createdAt,
    );
  }

  async updateTask(task: TaskState, expectedVersion: number): Promise<void> {
    let rows: { id: string }[];
    try {
      rows = await this.tx.$queryRawUnsafe<{ id: string }[]>(
        `UPDATE app.task SET stage = $2, checklist = $3::jsonb, condition_note = $4,
            departed_at = $5, arrived_at = $6, arrival_method = $7, started_at = $8,
            documented_at = $9, finished_at = $10, closed_at = $11, ended_at = $12,
            end_reason = $13, release_reason = $14, attention_reason = $15,
            collection_outcome = $16, collection_currency = $17, collection_scale = $18,
            collection_amount_minor = $19::bigint, collection_reason = $20,
            collection_declared_at = $21, late_amount_minor = $22::bigint, late_declared_at = $23,
            version = $24, updated_at = $25
          WHERE id = $1::uuid AND version = $26
        RETURNING id::text`,
        task.id,
        ...taskParameters(task),
        expectedVersion,
      );
    } catch (error) {
      // 23505 on an update can only be the one-in-field-per-technician index.
      if (sqlState(error) === '23505') {
        throw new DispatchError('TECHNICIAN_BUSY', 'The technician is already on another job.');
      }
      throw error;
    }
    if (rows.length !== 1) throw new ConcurrencyViolation('TASK');
  }

  async listEvidence(taskId: string): Promise<EvidenceLink[]> {
    const rows = await this.tx.$queryRawUnsafe<EvidenceRow[]>(
      `SELECT ${EVIDENCE_COLUMNS} FROM app.task_evidence WHERE task_id = $1::uuid
        ORDER BY attached_at, id`,
      taskId,
    );
    return rows.map(toEvidence);
  }

  async insertEvidence(link: EvidenceLink): Promise<void> {
    try {
      await this.tx.$executeRawUnsafe(
        `INSERT INTO app.task_evidence (id, task_id, phase, slot, media_object_id, attached_at, removed_at)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5::uuid, $6, $7)`,
        link.id,
        link.taskId,
        link.phase,
        link.slot,
        link.mediaObjectId,
        link.attachedAt,
        link.removedAt,
      );
    } catch (error) {
      if (sqlState(error) === '23505') {
        throw new DispatchError('EVIDENCE_IN_USE', 'The photo is already linked to a job.');
      }
      throw error;
    }
  }

  async markEvidenceRemoved(id: string, at: Date): Promise<void> {
    const rows = await this.tx.$queryRawUnsafe<{ id: string }[]>(
      `UPDATE app.task_evidence SET removed_at = $2 WHERE id = $1::uuid AND removed_at IS NULL
       RETURNING id::text`,
      id,
      at,
    );
    if (rows.length !== 1) throw new ConcurrencyViolation('EVIDENCE');
  }

  async insertNote(note: TaskNote): Promise<void> {
    await this.tx.$executeRawUnsafe(
      `INSERT INTO app.task_note (id, task_id, kind, text, created_at)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5)`,
      note.id,
      note.taskId,
      note.kind,
      note.text,
      note.createdAt,
    );
  }

  async appendTaskHistory(taskId: string, action: string, at: Date): Promise<void> {
    // The caller holds the task's assignment lock, so MAX(seq)+1 cannot race.
    await this.tx.$executeRawUnsafe(
      `INSERT INTO app.task_event (id, task_id, seq, action, occurred_at)
       SELECT $1::uuid, $2::uuid, COALESCE(MAX(seq), 0) + 1, $3, $4
         FROM app.task_event WHERE task_id = $2::uuid`,
      randomUUID(),
      taskId,
      action,
      at,
    );
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

export interface StoreOptions {
  readonly transactionTimeoutMs?: number;
  readonly maxWaitMs?: number;
  readonly conflictAttempts?: number;
}

/** Bounded re-run of a whole local transaction on deadlock/serialization failure. */
export async function withConflictRetry<T>(attempts: number, once: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await once();
    } catch (error) {
      if (!isTransientConflict(error) || attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 25 * attempt));
    }
  }
}

export class PrismaDispatchStore
  implements DispatchUnitOfWork, DispatchReadModel, IdempotencyRetention
{
  constructor(
    private readonly prisma: PrismaService,
    private readonly options: StoreOptions = {},
  ) {}

  run<T>(work: (tx: DispatchTransaction) => Promise<T>): Promise<T> {
    // A deadlock or serialization failure means PostgreSQL rolled the whole
    // transaction back and nothing was written; the unit of work touches only
    // this database, so re-running it is safe. The last failure propagates (a
    // retryable 503 at the edge), never as success.
    return withConflictRetry(this.options.conflictAttempts ?? 3, () =>
      this.transaction((tx) => work(new PrismaDispatchTransaction(tx))),
    );
  }

  /** READ COMMITTED + explicit row locks; also used by the inbox store. */
  transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.client.$transaction(work, {
      isolationLevel: 'ReadCommitted',
      maxWait: this.options.maxWaitMs ?? 5_000,
      timeout: this.options.transactionTimeoutMs ?? 10_000,
    });
  }

  wrap(tx: Tx): DispatchTransaction {
    return new PrismaDispatchTransaction(tx);
  }

  async findAssignment(id: string): Promise<AssignmentState | null> {
    const [row] = await this.prisma.client.$queryRawUnsafe<AssignmentRow[]>(
      `SELECT ${ASSIGNMENT_COLUMNS} FROM app.assignment WHERE id = $1::uuid`,
      id,
    );
    return row ? toAssignment(row) : null;
  }

  async findAssignmentByBooking(bookingId: string): Promise<AssignmentState | null> {
    const [row] = await this.prisma.client.$queryRawUnsafe<AssignmentRow[]>(
      `SELECT ${ASSIGNMENT_COLUMNS} FROM app.assignment WHERE booking_id = $1::uuid`,
      bookingId,
    );
    return row ? toAssignment(row) : null;
  }

  async findOffer(id: string): Promise<OfferState | null> {
    const [row] = await this.prisma.client.$queryRawUnsafe<OfferRow[]>(
      `SELECT ${OFFER_COLUMNS} FROM app.dispatch_offer WHERE id = $1::uuid`,
      id,
    );
    return row ? toOffer(row) : null;
  }

  async findCurrentOffer(assignmentId: string): Promise<OfferState | null> {
    const [row] = await this.prisma.client.$queryRawUnsafe<OfferRow[]>(
      `SELECT ${OFFER_COLUMNS} FROM app.dispatch_offer
        WHERE assignment_id = $1::uuid AND status IN ('OFFERED', 'ACCEPTED')
        ORDER BY created_at DESC, id LIMIT 1`,
      assignmentId,
    );
    return row ? toOffer(row) : null;
  }

  async listAssignments(query: AssignmentQuery): Promise<AssignmentState[]> {
    const rows = await this.prisma.client.$queryRawUnsafe<AssignmentRow[]>(
      `SELECT ${ASSIGNMENT_COLUMNS} FROM app.assignment
        WHERE zone_id = $1::uuid AND starts_at >= $2 AND starts_at < $3
          AND ($4::text IS NULL OR status = $4::text)
        ORDER BY starts_at, id
        LIMIT 200`,
      query.zoneId,
      query.from,
      query.to,
      query.status,
    );
    return rows.map(toAssignment);
  }

  async listTechnicianOffers(
    technicianSubject: string,
    now: Date,
  ): Promise<Array<{ readonly offer: OfferState; readonly assignment: AssignmentState }>> {
    const rows = await this.prisma.client.$queryRawUnsafe<(OfferRow & { a: AssignmentRow })[]>(
      `SELECT o.id::text, o.assignment_id::text, o.resource_id::text, o.technician_subject::text,
              o.status, o.expires_at, o.decline_reason, o.decline_note, o.withdraw_reason,
              o.created_by, o.version,
              o.created_at, o.updated_at,
              json_build_object(
                'id', a.id, 'booking_id', a.booking_id, 'hold_id', a.hold_id, 'zone_id', a.zone_id,
                'starts_at', a.starts_at, 'ends_at', a.ends_at, 'status', a.status,
                'resource_id', a.resource_id, 'technician_subject', a.technician_subject,
                'cancel_reason', a.cancel_reason, 'version', a.version,
                'created_at', a.created_at, 'updated_at', a.updated_at) AS a
         FROM app.dispatch_offer o
         JOIN app.assignment a ON a.id = o.assignment_id
        WHERE o.technician_subject = $1::uuid
          AND ((o.status = 'OFFERED' AND o.expires_at > $2) OR o.status = 'ACCEPTED')
          AND a.ends_at > $2
        ORDER BY a.starts_at, o.id
        LIMIT 100`,
      technicianSubject,
      now,
    );
    return rows.map((row) => ({
      offer: toOffer(row),
      assignment: toAssignment({
        ...row.a,
        starts_at: new Date(row.a.starts_at),
        ends_at: new Date(row.a.ends_at),
        created_at: new Date(row.a.created_at),
        updated_at: new Date(row.a.updated_at),
      }),
    }));
  }

  async findTask(id: string): Promise<TaskState | null> {
    const [row] = await this.prisma.client.$queryRawUnsafe<TaskRow[]>(
      `SELECT ${TASK_COLUMNS} FROM app.task WHERE id = $1::uuid`,
      id,
    );
    return row ? toTask(row) : null;
  }

  async findLiveTask(assignmentId: string): Promise<TaskState | null> {
    const [row] = await this.prisma.client.$queryRawUnsafe<TaskRow[]>(
      `SELECT ${TASK_COLUMNS} FROM app.task
        WHERE assignment_id = $1::uuid AND stage NOT IN ('RELEASED', 'WITHDRAWN', 'CANCELLED')`,
      assignmentId,
    );
    return row ? toTask(row) : null;
  }

  async findTaskByOffer(offerId: string): Promise<TaskState | null> {
    const [row] = await this.prisma.client.$queryRawUnsafe<TaskRow[]>(
      `SELECT ${TASK_COLUMNS} FROM app.task WHERE offer_id = $1::uuid`,
      offerId,
    );
    return row ? toTask(row) : null;
  }

  async listTechnicianTasks(technicianSubject: string, since: Date): Promise<TaskState[]> {
    const rows = await this.prisma.client.$queryRawUnsafe<TaskRow[]>(
      `SELECT ${TASK_COLUMNS} FROM app.task
        WHERE technician_subject = $1::uuid
          AND (stage IN ${OPEN_STAGES_SQL} OR updated_at >= $2)
        ORDER BY accepted_at, id
        LIMIT 200`,
      technicianSubject,
      since,
    );
    return rows.map(toTask);
  }

  async listTaskEvidence(taskId: string): Promise<EvidenceLink[]> {
    const rows = await this.prisma.client.$queryRawUnsafe<EvidenceRow[]>(
      `SELECT ${EVIDENCE_COLUMNS} FROM app.task_evidence WHERE task_id = $1::uuid
        ORDER BY attached_at, id`,
      taskId,
    );
    return rows.map(toEvidence);
  }

  async listTaskNotes(taskId: string): Promise<TaskNote[]> {
    const rows = await this.prisma.client.$queryRawUnsafe<NoteRow[]>(
      `SELECT id::text, task_id::text, kind, text, created_at FROM app.task_note
        WHERE task_id = $1::uuid ORDER BY created_at, id LIMIT 200`,
      taskId,
    );
    return rows.map(toNote);
  }

  async listTaskHistory(taskId: string): Promise<TaskHistoryEntry[]> {
    const rows = await this.prisma.client.$queryRawUnsafe<
      { seq: number; action: string; occurred_at: Date }[]
    >(
      `SELECT seq, action, occurred_at FROM app.task_event WHERE task_id = $1::uuid
        ORDER BY seq LIMIT 500`,
      taskId,
    );
    return rows.map(toHistory);
  }

  async findResourceObservation(resourceId: string): Promise<ResourceObservation | null> {
    const [row] = await this.prisma.client.$queryRawUnsafe<
      { resource_id: string; eligibility: string; revision: number }[]
    >(
      `SELECT resource_id::text, eligibility, revision FROM app.resource_observation
        WHERE resource_id = $1::uuid`,
      resourceId,
    );
    return row ? toObservation(row) : null;
  }

  async assignmentsWithDueOffers(now: Date, limit: number): Promise<string[]> {
    const rows = await this.prisma.client.$queryRawUnsafe<{ assignment_id: string }[]>(
      `SELECT assignment_id::text FROM app.dispatch_offer
        WHERE status = 'OFFERED' AND expires_at <= $1
        ORDER BY expires_at
        LIMIT $2`,
      now,
      limit,
    );
    return rows.map((row) => row.assignment_id);
  }

  async purgeIdempotencyBefore(cutoff: Date, limit: number): Promise<number> {
    return this.prisma.client.$executeRawUnsafe(
      `DELETE FROM app.idempotency_record
        WHERE ctid IN (SELECT ctid FROM app.idempotency_record WHERE created_at < $1 LIMIT $2)`,
      cutoff,
      limit,
    );
  }
}
