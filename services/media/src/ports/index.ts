/**
 * Media ports: what the application needs from the outside world.
 *
 * Framework-free. Adapters live in infrastructure/ and transport/.
 */
import type { ContentType, MediaObjectState } from '../domain';

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  next(): string;
}

/** Service-to-service scopes this service grants. Deny by default. */
export const MEDIA_SCOPES = ['media.object.read', 'media.object.claim'] as const;
export type MediaScope = (typeof MEDIA_SCOPES)[number];

/**
 * The authenticated caller, resolved at the edge.
 *
 * USER permissions come from Identity's own session view, never from a header
 * the caller could forge. SERVICE identity comes from a configured credential.
 * SYSTEM is an in-process component (the purge worker).
 */
export type Actor =
  | {
      readonly kind: 'USER';
      readonly subject: string;
      readonly permissions: readonly string[];
    }
  | {
      readonly kind: 'SERVICE';
      readonly clientId: string;
      readonly scopes: readonly MediaScope[];
    }
  | { readonly kind: 'SYSTEM'; readonly component: string };

export interface RequestMeta {
  readonly actor: Actor;
  readonly correlationId: string;
}

export interface AuditAppend {
  readonly action: string;
  readonly actor: Actor;
  readonly targetId: string;
  readonly correlationId: string;
  /** Opaque, non-personal facts only: no subject ids, keys, URLs or signatures. */
  readonly details: Readonly<Record<string, string | number | boolean | null>>;
}

export type IdempotencyClaim =
  | { readonly kind: 'NEW' }
  | { readonly kind: 'REPLAY'; readonly objectId: string }
  | { readonly kind: 'CONFLICT' };

export interface ObjectClaim {
  readonly objectId: string;
  readonly claimRef: string;
  readonly holder: string;
  readonly createdAt: Date;
}

/** An object and whether any holder has claimed it. */
export interface ObjectRecord {
  readonly object: MediaObjectState;
  readonly claimed: boolean;
}

/**
 * One local ACID transaction. Lock order is ALWAYS
 *   idempotency record -> media object -> object claims
 * in every command and in the worker, so two transactions cannot deadlock on
 * these rows. Status updates are version-guarded.
 */
export interface MediaTransaction {
  /**
   * Insert (scope, key) or wait for a concurrent holder of it to finish, then
   * report NEW, a REPLAY of its committed object, or a fingerprint CONFLICT.
   * The record commits with the command's effect, so a failed command leaves
   * no record and a retry is evaluated afresh.
   */
  claimIdempotency(scope: string, key: string, fingerprint: string): Promise<IdempotencyClaim>;
  completeIdempotency(scope: string, key: string, objectId: string): Promise<void>;

  insertObject(object: MediaObjectState): Promise<void>;
  /** SELECT ... FOR UPDATE. With skipLocked, returns null instead of waiting. */
  lockObject(
    id: string,
    options?: { readonly skipLocked?: boolean },
  ): Promise<MediaObjectState | null>;
  /** Version-guarded; throws on a lost update. */
  updateObject(object: MediaObjectState, expectedVersion: number): Promise<void>;

  /** Caller holds the object lock. */
  hasClaims(objectId: string): Promise<boolean>;
  findClaim(objectId: string, claimRef: string): Promise<ObjectClaim | null>;
  insertClaim(claim: ObjectClaim): Promise<void>;

  appendAudit(entry: AuditAppend): Promise<void>;
}

export interface MediaUnitOfWork {
  run<T>(work: (tx: MediaTransaction) => Promise<T>): Promise<T>;
}

export interface MediaReadModel {
  findObject(id: string): Promise<ObjectRecord | null>;
  findClaim(objectId: string, claimRef: string): Promise<ObjectClaim | null>;
  /** RESERVED objects whose deadline is at or before `dueBefore`; bounded. */
  reservationsDue(dueBefore: Date, limit: number): Promise<string[]>;
  /** Unclaimed AVAILABLE objects finalized at or before `finalizedBefore`; bounded. */
  purgeCandidates(finalizedBefore: Date, limit: number): Promise<string[]>;
  /** Finalized, unswept objects whose reservation ended at or before `dueBefore`. */
  sweepCandidates(dueBefore: Date, limit: number): Promise<string[]>;
}

export interface IdempotencyRetention {
  purgeIdempotencyBefore(cutoff: Date, limit: number): Promise<number>;
}

/** A request the client (or a holder service) performs against the object store. */
export interface PresignedRequest {
  readonly method: 'PUT' | 'GET';
  readonly url: string;
  /** Exactly the signed headers the caller must send, lower-case names. */
  readonly headers: Readonly<Record<string, string>>;
  readonly expiresAt: Date;
}

export type StoredRead =
  | { readonly kind: 'MISSING' }
  | {
      readonly kind: 'FOUND';
      /** The bytes read, at most `limit` (the read stops there). */
      readonly bytes: Uint8Array;
      /** True when the stored object is longer than `limit`. */
      readonly truncated: boolean;
    };

/**
 * The private object store. Every method fails with MediaError
 * STORAGE_UNAVAILABLE on a timeout, a network failure or a 5xx; nothing is
 * ever reported as success that the store did not confirm.
 */
export interface ObjectStore {
  presignUpload(
    key: string,
    content: {
      readonly contentType: ContentType;
      readonly contentLength: number;
      readonly sha256Hex: string;
    },
    expiresAt: Date,
    now: Date,
  ): PresignedRequest;
  presignDownload(key: string, expiresAt: Date, now: Date): PresignedRequest;
  /** Reads at most `limit` bytes of the object. */
  read(key: string, limit: number): Promise<StoredRead>;
  /** Writes bytes with a signed payload digest the store verifies. */
  write(key: string, bytes: Uint8Array, contentType: ContentType): Promise<void>;
  /** Deleting a missing key succeeds. */
  remove(key: string): Promise<void>;
}

/** Bounded lifetimes and retention; validated when the process starts. */
export interface MediaPolicy {
  readonly reservationTtlMs: number;
  readonly uploadUrlTtlMs: number;
  readonly readUrlTtlMs: number;
  readonly retentionMs: number;
  readonly claimGuardMs: number;
  readonly expiryGraceMs: number;
}
