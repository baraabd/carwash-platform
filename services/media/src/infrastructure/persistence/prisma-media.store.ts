import { randomUUID } from 'node:crypto';
import {
  isContentType,
  isPurpose,
  type MediaObjectState,
  type ObjectStatus,
  type RejectReason,
  OBJECT_STATUSES,
  REJECT_REASONS,
} from '../../domain';
import type {
  Actor,
  AuditAppend,
  IdempotencyClaim,
  IdempotencyRetention,
  MediaReadModel,
  MediaTransaction,
  MediaUnitOfWork,
  ObjectClaim,
  ObjectRecord,
} from '../../ports';
import type { Prisma } from '../../generated/prisma/client';
import type { PrismaService } from './prisma.service';

/**
 * PostgreSQL adapter for the media ports.
 *
 * Correctness does not rest on application code alone:
 *   - every decision is made on rows read under FOR UPDATE, in the lock order
 *     idempotency -> media object -> object claims;
 *   - every status UPDATE is guarded by the version read under that lock;
 *   - CHECK constraints and triggers reject any write that would break an
 *     invariant (illegal transition, inconsistent timestamps, claim on a
 *     non-AVAILABLE object, purge of a claimed object), even one produced by a
 *     defect above.
 *
 * Tables are qualified with the "app" schema; the runtime role has DML only.
 */
type Tx = Prisma.TransactionClient;

interface ObjectRow {
  id: string;
  owner_subject: string;
  purpose: string;
  content_type: string;
  byte_length: number;
  sha256: string;
  status: string;
  reject_reason: string | null;
  reservation_expires_at: Date;
  finalized_at: Date | null;
  expired_at: Date | null;
  purged_at: Date | null;
  storage_swept_at: Date | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

interface ClaimRow {
  object_id: string;
  claim_ref: string;
  holder: string;
  created_at: Date;
}

const OBJECT_COLUMNS = `id::text, owner_subject::text, purpose, content_type, byte_length, sha256,
  status, reject_reason, reservation_expires_at, finalized_at, expired_at, purged_at,
  storage_swept_at, version, created_at, updated_at`;

export class ConcurrencyViolation extends Error {
  constructor(what: string) {
    super(`${what}_VERSION_MISMATCH`);
    this.name = 'ConcurrencyViolation';
  }
}

/** A row read back that the domain does not recognise: refuse, never coerce. */
export class CorruptRow extends Error {
  constructor(column: string) {
    super(`CORRUPT_ROW_${column}`);
    this.name = 'CorruptRow';
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

function toObject(row: ObjectRow): MediaObjectState {
  const status = OBJECT_STATUSES.find((candidate) => candidate === row.status);
  if (!status) throw new CorruptRow('status');
  if (!isPurpose(row.purpose)) throw new CorruptRow('purpose');
  if (!isContentType(row.content_type)) throw new CorruptRow('content_type');
  let rejectReason: RejectReason | null = null;
  if (row.reject_reason !== null) {
    const known = REJECT_REASONS.find((candidate) => candidate === row.reject_reason);
    if (!known) throw new CorruptRow('reject_reason');
    rejectReason = known;
  }
  return {
    id: row.id,
    ownerSubject: row.owner_subject,
    purpose: row.purpose,
    contentType: row.content_type,
    byteLength: row.byte_length,
    sha256: row.sha256,
    status: status satisfies ObjectStatus,
    rejectReason,
    reservationExpiresAt: row.reservation_expires_at,
    finalizedAt: row.finalized_at,
    expiredAt: row.expired_at,
    purgedAt: row.purged_at,
    storageSweptAt: row.storage_swept_at,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toClaim(row: ClaimRow): ObjectClaim {
  return {
    objectId: row.object_id,
    claimRef: row.claim_ref,
    holder: row.holder,
    createdAt: row.created_at,
  };
}

function actorId(actor: Actor): string {
  if (actor.kind === 'USER') return actor.subject;
  if (actor.kind === 'SERVICE') return actor.clientId;
  return actor.component;
}

class PrismaMediaTransaction implements MediaTransaction {
  constructor(private readonly tx: Tx) {}

  async claimIdempotency(
    scope: string,
    key: string,
    fingerprint: string,
  ): Promise<IdempotencyClaim> {
    // A concurrent insert of the same (scope, key) makes this statement WAIT
    // for the other transaction: if it commits we see a conflict and read its
    // record; if it rolls back our insert goes ahead.
    const inserted = await this.tx.$queryRawUnsafe<{ scope: string }[]>(
      `INSERT INTO app.idempotency_record (scope, idempotency_key, request_fingerprint)
       VALUES ($1, $2, $3)
       ON CONFLICT (scope, idempotency_key) DO NOTHING
       RETURNING scope`,
      scope,
      key,
      fingerprint,
    );
    if (inserted.length === 1) return { kind: 'NEW' };
    const [row] = await this.tx.$queryRawUnsafe<
      { request_fingerprint: string; object_id: string | null }[]
    >(
      `SELECT request_fingerprint, object_id::text FROM app.idempotency_record
        WHERE scope = $1 AND idempotency_key = $2`,
      scope,
      key,
    );
    if (!row) throw new Error('IDEMPOTENCY_RECORD_VANISHED');
    if (row.request_fingerprint !== fingerprint) return { kind: 'CONFLICT' };
    if (row.object_id === null) throw new Error('IDEMPOTENCY_RECORD_INCOMPLETE');
    return { kind: 'REPLAY', objectId: row.object_id };
  }

  async completeIdempotency(scope: string, key: string, objectId: string): Promise<void> {
    const rows = await this.tx.$queryRawUnsafe<{ scope: string }[]>(
      `UPDATE app.idempotency_record SET object_id = $3::uuid
        WHERE scope = $1 AND idempotency_key = $2 RETURNING scope`,
      scope,
      key,
      objectId,
    );
    if (rows.length !== 1) throw new Error('IDEMPOTENCY_RECORD_MISSING');
  }

  async insertObject(object: MediaObjectState): Promise<void> {
    await this.tx.$executeRawUnsafe(
      `INSERT INTO app.media_object (id, owner_subject, purpose, content_type, byte_length, sha256,
         status, reject_reason, reservation_expires_at, finalized_at, expired_at, purged_at,
         storage_swept_at, version, created_at, updated_at)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      object.id,
      object.ownerSubject,
      object.purpose,
      object.contentType,
      object.byteLength,
      object.sha256,
      object.status,
      object.rejectReason,
      object.reservationExpiresAt,
      object.finalizedAt,
      object.expiredAt,
      object.purgedAt,
      object.storageSweptAt,
      object.version,
      object.createdAt,
      object.updatedAt,
    );
  }

  async lockObject(
    id: string,
    options?: { readonly skipLocked?: boolean },
  ): Promise<MediaObjectState | null> {
    const [row] = await this.tx.$queryRawUnsafe<ObjectRow[]>(
      `SELECT ${OBJECT_COLUMNS} FROM app.media_object WHERE id = $1::uuid
         FOR UPDATE${options?.skipLocked ? ' SKIP LOCKED' : ''}`,
      id,
    );
    return row ? toObject(row) : null;
  }

  async updateObject(object: MediaObjectState, expectedVersion: number): Promise<void> {
    const rows = await this.tx.$queryRawUnsafe<{ id: string }[]>(
      `UPDATE app.media_object
          SET status = $3, reject_reason = $4, finalized_at = $5, expired_at = $6,
              purged_at = $7, storage_swept_at = $8, version = $9, updated_at = $10
        WHERE id = $1::uuid AND version = $2
      RETURNING id::text`,
      object.id,
      expectedVersion,
      object.status,
      object.rejectReason,
      object.finalizedAt,
      object.expiredAt,
      object.purgedAt,
      object.storageSweptAt,
      object.version,
      object.updatedAt,
    );
    if (rows.length !== 1) throw new ConcurrencyViolation('MEDIA_OBJECT');
  }

  async hasClaims(objectId: string): Promise<boolean> {
    const rows = await this.tx.$queryRawUnsafe<{ one: number }[]>(
      `SELECT 1 AS one FROM app.object_claim WHERE object_id = $1::uuid LIMIT 1`,
      objectId,
    );
    return rows.length > 0;
  }

  async findClaim(objectId: string, claimRef: string): Promise<ObjectClaim | null> {
    const [row] = await this.tx.$queryRawUnsafe<ClaimRow[]>(
      `SELECT object_id::text, claim_ref::text, holder, created_at FROM app.object_claim
        WHERE object_id = $1::uuid AND claim_ref = $2::uuid`,
      objectId,
      claimRef,
    );
    return row ? toClaim(row) : null;
  }

  async insertClaim(claim: ObjectClaim): Promise<void> {
    await this.tx.$executeRawUnsafe(
      `INSERT INTO app.object_claim (object_id, claim_ref, holder, created_at)
       VALUES ($1::uuid, $2::uuid, $3, $4)`,
      claim.objectId,
      claim.claimRef,
      claim.holder,
      claim.createdAt,
    );
  }

  async appendAudit(entry: AuditAppend): Promise<void> {
    await this.tx.$executeRawUnsafe(
      `INSERT INTO app.audit_entry (id, actor_kind, actor_id, action, target_type, target_id, correlation_id, details)
       VALUES ($1::uuid, $2, $3, $4, 'MEDIA_OBJECT', $5::uuid, $6::uuid, $7::jsonb)`,
      randomUUID(),
      entry.actor.kind,
      actorId(entry.actor),
      entry.action,
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

export class PrismaMediaStore implements MediaUnitOfWork, MediaReadModel, IdempotencyRetention {
  constructor(
    private readonly prisma: PrismaService,
    private readonly options: StoreOptions = {},
  ) {}

  run<T>(work: (tx: MediaTransaction) => Promise<T>): Promise<T> {
    // A deadlock or serialization failure means PostgreSQL rolled the whole
    // transaction back and nothing was written; re-running it is safe. The
    // last failure propagates (a retryable 503 at the edge), never as success.
    return withConflictRetry(this.options.conflictAttempts ?? 3, () =>
      this.prisma.client.$transaction((tx) => work(new PrismaMediaTransaction(tx)), {
        isolationLevel: 'ReadCommitted',
        maxWait: this.options.maxWaitMs ?? 5_000,
        // Covers the worker's two bounded object-store deletes (≤ 10 s each)
        // held under one row lock; API transactions do no network I/O.
        timeout: this.options.transactionTimeoutMs ?? 30_000,
      }),
    );
  }

  async findObject(id: string): Promise<ObjectRecord | null> {
    const [row] = await this.prisma.client.$queryRawUnsafe<(ObjectRow & { claimed: boolean })[]>(
      `SELECT ${OBJECT_COLUMNS},
              EXISTS (SELECT 1 FROM app.object_claim c WHERE c.object_id = o.id) AS claimed
         FROM app.media_object o WHERE id = $1::uuid`,
      id,
    );
    return row ? { object: toObject(row), claimed: row.claimed } : null;
  }

  async findClaim(objectId: string, claimRef: string): Promise<ObjectClaim | null> {
    const [row] = await this.prisma.client.$queryRawUnsafe<ClaimRow[]>(
      `SELECT object_id::text, claim_ref::text, holder, created_at FROM app.object_claim
        WHERE object_id = $1::uuid AND claim_ref = $2::uuid`,
      objectId,
      claimRef,
    );
    return row ? toClaim(row) : null;
  }

  async reservationsDue(dueBefore: Date, limit: number): Promise<string[]> {
    const rows = await this.prisma.client.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id::text FROM app.media_object
        WHERE status = 'RESERVED' AND reservation_expires_at <= $1
        ORDER BY reservation_expires_at, id
        LIMIT $2`,
      dueBefore,
      limit,
    );
    return rows.map((row) => row.id);
  }

  async purgeCandidates(finalizedBefore: Date, limit: number): Promise<string[]> {
    const rows = await this.prisma.client.$queryRawUnsafe<{ id: string }[]>(
      `SELECT o.id::text FROM app.media_object o
        WHERE o.status = 'AVAILABLE' AND o.finalized_at <= $1
          AND NOT EXISTS (SELECT 1 FROM app.object_claim c WHERE c.object_id = o.id)
        ORDER BY o.finalized_at, o.id
        LIMIT $2`,
      finalizedBefore,
      limit,
    );
    return rows.map((row) => row.id);
  }

  async sweepCandidates(dueBefore: Date, limit: number): Promise<string[]> {
    const rows = await this.prisma.client.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id::text FROM app.media_object
        WHERE storage_swept_at IS NULL AND status IN ('AVAILABLE', 'REJECTED')
          AND reservation_expires_at <= $1
        ORDER BY reservation_expires_at, id
        LIMIT $2`,
      dueBefore,
      limit,
    );
    return rows.map((row) => row.id);
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
