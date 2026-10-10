import {
  MediaError,
  SNIFF_BYTES,
  assertClaimable,
  declaredOf,
  declaredUpload,
  invalid,
  isExpiryDue,
  isPurgeDue,
  isReservationOpen,
  isSweepDue,
  markAvailable,
  markExpired,
  markPurged,
  markRejected,
  markSwept,
  notAvailable,
  objectKey,
  reserve,
  residualKeys,
  stagingKey,
  uuid,
  verifyUpload,
  type MediaObjectState,
  type Verification,
} from '../domain';
import type {
  Clock,
  IdGenerator,
  MediaPolicy,
  MediaReadModel,
  MediaTransaction,
  MediaUnitOfWork,
  ObjectClaim,
  ObjectRecord,
  ObjectStore,
  PresignedRequest,
  RequestMeta,
} from '../ports';
import {
  WORK_EXECUTE,
  actorKey,
  forbidden,
  hasScope,
  requirePermission,
  workReader,
  type UserActor,
} from './authorization';
import { fingerprint, sha256Hex } from './canonical-json';

export interface CommandResult<T> {
  readonly value: T;
  /** True when an earlier identical request produced it (same key/claimRef). */
  readonly replayed: boolean;
}

export interface UploadTicket {
  readonly record: ObjectRecord;
  /** A fresh presigned PUT while the reservation is open, otherwise null. */
  readonly upload: PresignedRequest | null;
}

export interface ClaimResult {
  readonly record: ObjectRecord;
  readonly claim: ObjectClaim;
}

export interface ReservationInput {
  readonly purpose: unknown;
  readonly contentType: unknown;
  readonly byteLength: unknown;
  readonly sha256: unknown;
}

export interface ClaimInput {
  readonly claimRef: unknown;
  readonly holder: unknown;
}

/** The only holder media.v1 knows. */
export const CLAIM_HOLDERS = ['dispatch.task-evidence'] as const;

export interface PassResult {
  readonly expired: number;
  readonly purged: number;
  readonly swept: number;
}

const KEY = /^[A-Za-z0-9_-]{16,128}$/;

function idempotencyKey(key: string | undefined): string {
  if (key === undefined || key === '') {
    throw new MediaError('IDEMPOTENCY_KEY_REQUIRED', 'An Idempotency-Key header is required.');
  }
  if (!KEY.test(key)) throw invalid('Idempotency-Key is malformed.');
  return key;
}

function notFound(): MediaError {
  return new MediaError('OBJECT_NOT_FOUND', 'The object was not found.');
}

function conflict(): MediaError {
  return new MediaError(
    'IDEMPOTENCY_CONFLICT',
    'The Idempotency-Key was already used for a different request.',
  );
}

/**
 * Media application service.
 *
 * Network I/O against the object store never runs inside a database
 * transaction of a client command: finalize reads and verifies the stored
 * bytes first, then commits the outcome under the object row lock after
 * re-checking the state it read. The purge passes hold one row lock (SKIP
 * LOCKED) across one bounded delete so two replicas never act on one object.
 */
export class MediaService {
  constructor(
    private readonly uow: MediaUnitOfWork,
    private readonly read: MediaReadModel,
    private readonly store: ObjectStore,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly policy: MediaPolicy,
  ) {}

  // --------------------------------------------------------------- uploads

  async reserve(
    meta: RequestMeta,
    input: ReservationInput,
    key: string | undefined,
  ): Promise<CommandResult<UploadTicket>> {
    const user = requirePermission(meta.actor, WORK_EXECUTE);
    const declared = declaredUpload(input);
    const idemKey = idempotencyKey(key);
    const scope = `${actorKey(user)}|reserve`;
    const print = fingerprint(declared);
    const now = this.clock.now();
    const outcome = await this.uow.run(async (tx) => {
      const claim = await tx.claimIdempotency(scope, idemKey, print);
      if (claim.kind === 'CONFLICT') throw conflict();
      if (claim.kind === 'REPLAY') return { objectId: claim.objectId, replayed: true };
      const object = reserve({
        id: this.ids.next(),
        ownerSubject: user.subject,
        declared,
        now,
        ttlMs: this.policy.reservationTtlMs,
      });
      await tx.insertObject(object);
      await tx.appendAudit({
        action: 'media.reserved',
        actor: user,
        targetId: object.id,
        correlationId: meta.correlationId,
        details: {
          purpose: object.purpose,
          contentType: object.contentType,
          byteLength: object.byteLength,
        },
      });
      await tx.completeIdempotency(scope, idemKey, object.id);
      return { objectId: object.id, replayed: false };
    });
    const record = await this.read.findObject(outcome.objectId);
    if (!record) throw notFound();
    return {
      value: { record, upload: this.uploadFor(record.object, this.clock.now()) },
      replayed: outcome.replayed,
    };
  }

  /** A fresh presigned PUT for the same RESERVED object (retry path). */
  async issueUploadUrl(meta: RequestMeta, id: string): Promise<UploadTicket> {
    const user = requirePermission(meta.actor, WORK_EXECUTE);
    const record = await this.ownRecord(user, uuid(id, 'objectId'));
    const upload = this.uploadFor(record.object, this.clock.now());
    if (!upload) throw notAvailable();
    return { record, upload };
  }

  /**
   * Reads the stored upload back, verifies exact length, SHA-256 and signature,
   * and records AVAILABLE or REJECTED. Replay-safe: a finalized object is
   * returned as it is; concurrent finalizes produce one transition.
   */
  async finalize(
    meta: RequestMeta,
    id: string,
    key: string | undefined,
  ): Promise<CommandResult<ObjectRecord>> {
    const user = requirePermission(meta.actor, WORK_EXECUTE);
    const objectId = uuid(id, 'objectId');
    const idemKey = idempotencyKey(key);
    const scope = `${actorKey(user)}|finalize`;
    const print = fingerprint({ objectId });
    const seen = await this.ownRecord(user, objectId);

    // Network I/O first, outside any transaction. UPLOAD_MISSING and
    // STORAGE_UNAVAILABLE propagate from here with no state change.
    let verdict: Verification | null = null;
    if (isReservationOpen(seen.object, this.clock.now())) {
      verdict = await this.inspect(seen.object);
    }

    const now = this.clock.now();
    const outcome = await this.uow.run(async (tx) => {
      const claim = await tx.claimIdempotency(scope, idemKey, print);
      if (claim.kind === 'CONFLICT') throw conflict();
      if (claim.kind === 'REPLAY') return { replayed: true, transitioned: false };
      const locked = await tx.lockObject(objectId);
      if (!locked || locked.ownerSubject !== user.subject) throw notFound();
      if (locked.status === 'AVAILABLE' || locked.status === 'REJECTED') {
        // Another request already finalized it: return that outcome, no second transition.
        await tx.completeIdempotency(scope, idemKey, objectId);
        return { replayed: false, transitioned: false };
      }
      // Re-check under the lock: still RESERVED and still before the deadline.
      if (verdict === null || !isReservationOpen(locked, now)) throw notAvailable();
      const next = verdict.ok
        ? markAvailable(locked, now)
        : markRejected(locked, verdict.reason, now);
      await tx.updateObject(next, locked.version);
      await tx.appendAudit({
        action: next.status === 'AVAILABLE' ? 'media.finalized' : 'media.rejected',
        actor: user,
        targetId: objectId,
        correlationId: meta.correlationId,
        details: {
          contentType: next.contentType,
          byteLength: next.byteLength,
          rejectReason: next.rejectReason,
        },
      });
      await tx.completeIdempotency(scope, idemKey, objectId);
      return { replayed: false, transitioned: true };
    });

    const record = await this.read.findObject(objectId);
    if (!record) throw notFound();
    await this.clearAfterFinalize(record.object);
    return { value: record, replayed: outcome.replayed };
  }

  // ----------------------------------------------------------------- reads

  /** Owner (work permission) or a service with `media.object.read`. */
  async getObject(meta: RequestMeta, id: string): Promise<ObjectRecord> {
    return this.readable(meta, uuid(id, 'objectId'));
  }

  /** A short-lived presigned GET of the verified bytes; AVAILABLE only. */
  async issueReadUrl(meta: RequestMeta, id: string): Promise<PresignedRequest> {
    const record = await this.readable(meta, uuid(id, 'objectId'));
    if (record.object.status !== 'AVAILABLE') throw notAvailable();
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + this.policy.readUrlTtlMs);
    const url = this.store.presignDownload(objectKey(record.object.id), expiresAt, now);
    await this.uow.run((tx) =>
      tx.appendAudit({
        action: 'media.read-url.issued',
        actor: meta.actor,
        targetId: record.object.id,
        correlationId: meta.correlationId,
        details: { ttlSeconds: Math.round(this.policy.readUrlTtlMs / 1_000) },
      }),
    );
    return url;
  }

  // ---------------------------------------------------------------- claims

  /**
   * Records that a holder keeps the object (e.g. Dispatch attached it to a
   * task). Idempotent per (object, claimRef); only AVAILABLE objects inside
   * their claim window; a claimed object is never purged.
   */
  async claim(
    meta: RequestMeta,
    id: string,
    input: ClaimInput,
  ): Promise<CommandResult<ClaimResult>> {
    if (!hasScope(meta.actor, 'media.object.claim')) throw forbidden();
    const objectId = uuid(id, 'objectId');
    const claimRef = uuid(input.claimRef, 'claimRef');
    const holder = CLAIM_HOLDERS.find((candidate) => candidate === input.holder);
    if (!holder) throw invalid('holder is not supported.');
    const now = this.clock.now();
    const outcome = await this.uow.run(async (tx) => {
      const locked = await tx.lockObject(objectId);
      if (!locked) throw notFound();
      const existing = await tx.findClaim(objectId, claimRef);
      if (existing) {
        if (existing.holder !== holder) throw conflict();
        return { claim: existing, created: false };
      }
      assertClaimable(locked, this.policy, now);
      const claim: ObjectClaim = { objectId, claimRef, holder, createdAt: now };
      await tx.insertClaim(claim);
      await tx.appendAudit({
        action: 'media.claimed',
        actor: meta.actor,
        targetId: objectId,
        correlationId: meta.correlationId,
        details: { holder, claimRef },
      });
      return { claim, created: true };
    });
    const record = await this.read.findObject(objectId);
    if (!record) throw notFound();
    return { value: { record, claim: outcome.claim }, replayed: !outcome.created };
  }

  // ----------------------------------------------------------------- system

  /**
   * One bounded pass of the purge worker. Stateless and safe in any number of
   * replicas: each object is locked with SKIP LOCKED and its eligibility is
   * re-checked under the lock; the bytes are deleted before the transition
   * commits, so a crash leaves the row for the next pass (deletes are idempotent).
   */
  async purgePass(correlationId: string, limit: number): Promise<PassResult> {
    const meta: RequestMeta = {
      actor: { kind: 'SYSTEM', component: 'media-purge' },
      correlationId,
    };
    const expired = await this.expireReservations(meta, limit);
    const purged = await this.purgeUnclaimed(meta, limit);
    const swept = await this.sweepResiduals(limit);
    return { expired, purged, swept };
  }

  private async expireReservations(meta: RequestMeta, limit: number): Promise<number> {
    const now = this.clock.now();
    const grace = this.policy.expiryGraceMs;
    let count = 0;
    for (const id of await this.read.reservationsDue(new Date(now.getTime() - grace), limit)) {
      count += await this.uow.run(async (tx) => {
        const locked = await tx.lockObject(id, { skipLocked: true });
        if (!locked || !isExpiryDue(locked, now, grace)) return 0;
        await this.removeAll(residualKeys({ ...locked, status: 'EXPIRED' }));
        await tx.updateObject(markExpired(locked, now, grace), locked.version);
        await this.audit(tx, meta, 'media.expired', locked);
        return 1;
      });
    }
    return count;
  }

  private async purgeUnclaimed(meta: RequestMeta, limit: number): Promise<number> {
    const now = this.clock.now();
    const cutoff = new Date(now.getTime() - this.policy.retentionMs);
    let count = 0;
    for (const id of await this.read.purgeCandidates(cutoff, limit)) {
      count += await this.uow.run(async (tx) => {
        const locked = await tx.lockObject(id, { skipLocked: true });
        if (!locked) return 0;
        const claimed = await tx.hasClaims(id);
        if (!isPurgeDue(locked, claimed, this.policy, now)) return 0;
        await this.removeAll([objectKey(id), stagingKey(id)]);
        await tx.updateObject(markPurged(locked, claimed, this.policy, now), locked.version);
        await this.audit(tx, meta, 'media.purged', locked);
        return 1;
      });
    }
    return count;
  }

  private async sweepResiduals(limit: number): Promise<number> {
    const now = this.clock.now();
    const grace = this.policy.expiryGraceMs;
    let count = 0;
    for (const id of await this.read.sweepCandidates(new Date(now.getTime() - grace), limit)) {
      count += await this.uow.run(async (tx) => {
        const locked = await tx.lockObject(id, { skipLocked: true });
        if (!locked || !isSweepDue(locked, now, grace)) return 0;
        await this.removeAll(residualKeys(locked));
        await tx.updateObject(markSwept(locked, now), locked.version);
        return 1;
      });
    }
    return count;
  }

  // -------------------------------------------------------------- internals

  private uploadFor(object: MediaObjectState, now: Date): PresignedRequest | null {
    if (!isReservationOpen(object, now)) return null;
    const expiresAt = new Date(
      Math.min(now.getTime() + this.policy.uploadUrlTtlMs, object.reservationExpiresAt.getTime()),
    );
    return this.store.presignUpload(
      stagingKey(object.id),
      {
        contentType: object.contentType,
        contentLength: object.byteLength,
        sha256Hex: object.sha256,
      },
      expiresAt,
      now,
    );
  }

  /**
   * Reads at most declared+1 bytes of the staged upload. Accepted bytes are
   * written by the server to the final key with a signed payload digest, so
   * the final key only ever holds bytes the server verified.
   */
  private async inspect(object: MediaObjectState): Promise<Verification> {
    const stored = await this.store.read(stagingKey(object.id), object.byteLength + 1);
    if (stored.kind === 'MISSING') {
      throw new MediaError('UPLOAD_MISSING', 'No upload is stored for this object yet.');
    }
    const verdict = verifyUpload(declaredOf(object), {
      byteLength: stored.truncated ? object.byteLength + 1 : stored.bytes.length,
      sha256: sha256Hex(stored.bytes),
      head: stored.bytes.subarray(0, SNIFF_BYTES),
    });
    if (verdict.ok) await this.store.write(objectKey(object.id), stored.bytes, object.contentType);
    return verdict;
  }

  /**
   * After the outcome is durable: a rejected object's bytes are deleted, and
   * the staging upload of an accepted one. Best effort; the sweep finishes the
   * job once no upload URL can still be valid, so a failure here is not an
   * error of the (already committed) finalize.
   */
  private async clearAfterFinalize(object: MediaObjectState): Promise<void> {
    if (object.status !== 'AVAILABLE' && object.status !== 'REJECTED') return;
    try {
      await this.removeAll(residualKeys(object));
    } catch (error: unknown) {
      if (!(error instanceof MediaError)) throw error;
    }
  }

  private async removeAll(keys: readonly string[]): Promise<void> {
    for (const key of keys) await this.store.remove(key);
  }

  private async audit(
    tx: MediaTransaction,
    meta: RequestMeta,
    action: string,
    object: MediaObjectState,
  ): Promise<void> {
    await tx.appendAudit({
      action,
      actor: meta.actor,
      targetId: object.id,
      correlationId: meta.correlationId,
      details: { previousStatus: object.status, byteLength: object.byteLength },
    });
  }

  /** Another owner's object is reported as not found, so ids cannot be probed. */
  private async ownRecord(user: UserActor, objectId: string): Promise<ObjectRecord> {
    const record = await this.read.findObject(objectId);
    if (!record || record.object.ownerSubject !== user.subject) throw notFound();
    return record;
  }

  private async readable(meta: RequestMeta, objectId: string): Promise<ObjectRecord> {
    if (meta.actor.kind === 'SERVICE') {
      if (!hasScope(meta.actor, 'media.object.read')) throw forbidden();
      const record = await this.read.findObject(objectId);
      if (!record) throw notFound();
      return record;
    }
    const user = workReader(meta.actor);
    if (!user) throw forbidden();
    return this.ownRecord(user, objectId);
  }
}
