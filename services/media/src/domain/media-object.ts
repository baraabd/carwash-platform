import type { ContentType, DeclaredUpload, Purpose, RejectReason } from './content';
import { MediaError } from './errors';

/**
 * A stored media object and its lifecycle.
 *
 *   RESERVED  -> AVAILABLE   finalize: stored bytes match length, SHA-256 and signature
 *   RESERVED  -> REJECTED    finalize: they do not (reason UPLOAD_MISMATCH | UNSUPPORTED_MEDIA)
 *   RESERVED  -> EXPIRED     the reservation deadline passed without a finalize
 *   AVAILABLE -> PURGED      unclaimed beyond the retention window
 *
 * REJECTED, EXPIRED and PURGED are terminal. Every transition increments the
 * version; persistence applies it only against the version it read under a
 * row lock, and the database refuses any other transition (trigger) and any
 * status/timestamp/reason combination that is not listed here (CHECKs).
 */
export type ObjectStatus = 'RESERVED' | 'AVAILABLE' | 'REJECTED' | 'EXPIRED' | 'PURGED';

export const OBJECT_STATUSES: readonly ObjectStatus[] = [
  'RESERVED',
  'AVAILABLE',
  'REJECTED',
  'EXPIRED',
  'PURGED',
];

export interface MediaObjectState {
  readonly id: string;
  readonly ownerSubject: string;
  readonly purpose: Purpose;
  readonly contentType: ContentType;
  readonly byteLength: number;
  readonly sha256: string;
  readonly status: ObjectStatus;
  readonly rejectReason: RejectReason | null;
  readonly reservationExpiresAt: Date;
  readonly finalizedAt: Date | null;
  readonly expiredAt: Date | null;
  readonly purgedAt: Date | null;
  /** When residual storage keys were last confirmed deleted (see sweep). */
  readonly storageSweptAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly version: number;
}

/** Where the verified bytes live. No personal data, ever: only the opaque object id. */
export function objectKey(id: string): string {
  return `objects/${id}`;
}

/**
 * Where the untrusted client upload lands before verification. Only the
 * server writes `objects/<id>`, with the bytes it verified, so a client that
 * re-uses a still-valid upload URL after finalize cannot change them.
 */
export function stagingKey(id: string): string {
  return `uploads/${id}`;
}

export function reserve(input: {
  readonly id: string;
  readonly ownerSubject: string;
  readonly declared: DeclaredUpload;
  readonly now: Date;
  readonly ttlMs: number;
}): MediaObjectState {
  return {
    id: input.id,
    ownerSubject: input.ownerSubject,
    purpose: input.declared.purpose,
    contentType: input.declared.contentType,
    byteLength: input.declared.byteLength,
    sha256: input.declared.sha256,
    status: 'RESERVED',
    rejectReason: null,
    reservationExpiresAt: new Date(input.now.getTime() + input.ttlMs),
    finalizedAt: null,
    expiredAt: null,
    purgedAt: null,
    storageSweptAt: null,
    createdAt: input.now,
    updatedAt: input.now,
    version: 1,
  };
}

/** A RESERVED object may be uploaded and finalized strictly before its deadline. */
export function isReservationOpen(object: MediaObjectState, now: Date): boolean {
  return object.status === 'RESERVED' && now.getTime() < object.reservationExpiresAt.getTime();
}

export function declaredOf(object: MediaObjectState): DeclaredUpload {
  return {
    purpose: object.purpose,
    contentType: object.contentType,
    byteLength: object.byteLength,
    sha256: object.sha256,
  };
}

export function notAvailable(): MediaError {
  return new MediaError('OBJECT_NOT_AVAILABLE', 'The object is not in a usable state.');
}

function bump(
  object: MediaObjectState,
  change: Partial<MediaObjectState>,
  now: Date,
): MediaObjectState {
  return { ...object, ...change, updatedAt: now, version: object.version + 1 };
}

function assertOpen(object: MediaObjectState, now: Date): void {
  if (!isReservationOpen(object, now)) throw notAvailable();
}

export function markAvailable(object: MediaObjectState, now: Date): MediaObjectState {
  assertOpen(object, now);
  return bump(object, { status: 'AVAILABLE', finalizedAt: now }, now);
}

export function markRejected(
  object: MediaObjectState,
  reason: RejectReason,
  now: Date,
): MediaObjectState {
  assertOpen(object, now);
  return bump(object, { status: 'REJECTED', rejectReason: reason, finalizedAt: now }, now);
}

/**
 * The worker expires a reservation only after its deadline plus a grace that
 * covers clock skew with the object store, so an upload signed to be valid
 * until the deadline cannot land after the residual keys were deleted.
 */
export function isExpiryDue(object: MediaObjectState, now: Date, graceMs: number): boolean {
  return (
    object.status === 'RESERVED' && now.getTime() >= object.reservationExpiresAt.getTime() + graceMs
  );
}

export function markExpired(
  object: MediaObjectState,
  now: Date,
  graceMs: number,
): MediaObjectState {
  if (!isExpiryDue(object, now, graceMs)) throw new Error('RESERVATION_NOT_DUE');
  return bump(object, { status: 'EXPIRED', expiredAt: now, storageSweptAt: now }, now);
}

/**
 * Retention policy of unclaimed evidence.
 *
 * An AVAILABLE object can be claimed until `finalizedAt + retention - guard`
 * and is purged only when unclaimed at `finalizedAt + retention`. The guard
 * band means a claim and a purge are never both allowed at the same instant,
 * even across replicas whose clocks disagree by less than the guard, so a
 * purge that already deleted the bytes can never be followed by a claim.
 */
export interface RetentionPolicy {
  readonly retentionMs: number;
  readonly claimGuardMs: number;
}

export function claimDeadline(object: MediaObjectState, policy: RetentionPolicy): Date | null {
  if (object.finalizedAt === null) return null;
  return new Date(object.finalizedAt.getTime() + policy.retentionMs - policy.claimGuardMs);
}

export function assertClaimable(
  object: MediaObjectState,
  policy: RetentionPolicy,
  now: Date,
): void {
  const deadline = claimDeadline(object, policy);
  if (object.status !== 'AVAILABLE' || deadline === null || now.getTime() >= deadline.getTime()) {
    throw notAvailable();
  }
}

export function isPurgeDue(
  object: MediaObjectState,
  claimed: boolean,
  policy: RetentionPolicy,
  now: Date,
): boolean {
  return (
    object.status === 'AVAILABLE' &&
    !claimed &&
    object.finalizedAt !== null &&
    now.getTime() >= object.finalizedAt.getTime() + policy.retentionMs
  );
}

export function markPurged(
  object: MediaObjectState,
  claimed: boolean,
  policy: RetentionPolicy,
  now: Date,
): MediaObjectState {
  if (!isPurgeDue(object, claimed, policy, now)) throw new Error('OBJECT_NOT_PURGEABLE');
  return bump(object, { status: 'PURGED', purgedAt: now, storageSweptAt: now }, now);
}

/**
 * Residual keys of a finalized object (a re-used staging upload, or verified
 * bytes written by a finalize that lost the race to a rejection) are deleted
 * once no upload URL for the object can still be valid.
 */
export function isSweepDue(object: MediaObjectState, now: Date, graceMs: number): boolean {
  return (
    (object.status === 'AVAILABLE' || object.status === 'REJECTED') &&
    object.storageSweptAt === null &&
    now.getTime() >= object.reservationExpiresAt.getTime() + graceMs
  );
}

/** Keys that must not exist for an object in this status once it is swept. */
export function residualKeys(object: MediaObjectState): string[] {
  if (object.status === 'AVAILABLE') return [stagingKey(object.id)];
  return [stagingKey(object.id), objectKey(object.id)];
}

/** Bookkeeping only: no status change and no new revision for clients. */
export function markSwept(object: MediaObjectState, now: Date): MediaObjectState {
  return { ...object, storageSweptAt: now };
}
