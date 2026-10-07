import { parseUtc, type UtcTimestamp } from './time';
import { ContractViolation, canonicalJson, closed, integer, list, text } from './wire';

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

/**
 * Every mutating business command carries `Idempotency-Key`. The owner stores
 * (scope, key) -> (fingerprint, outcome) in its OWN database inside the same
 * transaction as the mutation. Replay policy:
 *  - same key, same fingerprint, completed  -> replay the stored response
 *  - same key, same fingerprint, in flight  -> 409 IDEMPOTENCY_IN_PROGRESS
 *  - same key, different fingerprint        -> 409 IDEMPOTENCY_CONFLICT
 * The scope always includes the authenticated actor so keys never collide
 * across principals.
 */
export const IDEMPOTENCY_HEADER = 'idempotency-key' as const;
const KEY = /^[A-Za-z0-9_-]{16,128}$/;

export function parseIdempotencyKey(value: unknown): string {
  if (typeof value !== 'string' || !KEY.test(value)) {
    throw new ContractViolation('INVALID_IDEMPOTENCY_KEY', `header.${IDEMPOTENCY_HEADER}`);
  }
  return value;
}

/** Fingerprint material. Hash it with SHA-256 server side (service-kit). */
export function idempotencyMaterial(input: {
  /** Contract id incl. major, e.g. "vehicle.v1". A new major never replays an old result. */
  readonly contract: string;
  readonly operation: string;
  readonly actor: string;
  readonly target: string | null;
  /** Business body plus expectedRevision; never trace, CSRF or cookie values. */
  readonly body: unknown;
}): string {
  return canonicalJson({
    v: 1,
    contract: input.contract,
    operation: input.operation,
    actor: input.actor,
    target: input.target,
    body: input.body ?? null,
  });
}

// ---------------------------------------------------------------------------
// Revision / optimistic concurrency
// ---------------------------------------------------------------------------

/**
 * Aggregates expose `revision` (integer >= 1, +1 per committed change).
 * Updates send `If-Match: "<revision>"`; a mismatch is 412 REVISION_CONFLICT,
 * a missing header on a revisioned update is 428 REVISION_REQUIRED.
 */
export const IF_MATCH_HEADER = 'if-match' as const;
export const MAX_REVISION = 2_147_483_647;

export function parseRevision(value: unknown, path: string): number {
  return integer(value, path, 1, MAX_REVISION);
}

export function formatIfMatch(revision: number): string {
  return `"${parseRevision(revision, '$')}"`;
}

export function parseIfMatch(value: unknown): number {
  if (typeof value !== 'string') {
    throw new ContractViolation('REVISION_REQUIRED', `header.${IF_MATCH_HEADER}`);
  }
  const match = /^"([1-9][0-9]{0,9})"$/.exec(value.trim());
  if (!match?.[1]) throw new ContractViolation('INVALID_REVISION', `header.${IF_MATCH_HEADER}`);
  return parseRevision(Number(match[1]), `header.${IF_MATCH_HEADER}`);
}

// ---------------------------------------------------------------------------
// Cursor pagination
// ---------------------------------------------------------------------------

/** Opaque cursor issued by the owner. Clients never construct or inspect it. */
const CURSOR = /^[A-Za-z0-9_-]{1,512}$/;
export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

export interface PageRequest {
  readonly limit: number;
  readonly cursor: string | null;
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
  /** Owner clock instant the page reflects. */
  readonly asOf: UtcTimestamp;
}

export function parsePageRequest(query: {
  readonly limit?: unknown;
  readonly cursor?: unknown;
}): PageRequest {
  const rawLimit = query.limit;
  const limit =
    rawLimit === undefined
      ? DEFAULT_PAGE_LIMIT
      : integer(
          typeof rawLimit === 'string' && /^[0-9]{1,3}$/.test(rawLimit)
            ? Number(rawLimit)
            : rawLimit,
          'query.limit',
          1,
          MAX_PAGE_LIMIT,
        );
  const cursor =
    query.cursor === undefined
      ? null
      : text(query.cursor, 'query.cursor', { max: 512, pattern: CURSOR });
  return { limit, cursor };
}

export function parsePage<T>(
  value: unknown,
  path: string,
  item: (entry: unknown, path: string) => T,
): Page<T> {
  const v = closed(value, path, ['items', 'nextCursor', 'asOf']);
  return {
    items: list(v.items, `${path}.items`, MAX_PAGE_LIMIT, item),
    nextCursor:
      v.nextCursor === null
        ? null
        : text(v.nextCursor, `${path}.nextCursor`, { max: 512, pattern: CURSOR }),
    asOf: parseUtc(v.asOf, `${path}.asOf`),
  };
}

// ---------------------------------------------------------------------------
// Correlation / trace headers
// ---------------------------------------------------------------------------

export const REQUEST_ID_HEADER = 'x-request-id' as const;
export const CORRELATION_ID_HEADER = 'x-correlation-id' as const;
/** W3C Trace Context. */
export const TRACEPARENT_HEADER = 'traceparent' as const;
const TRACEPARENT = /^00-(?!0{32})[0-9a-f]{32}-(?!0{16})[0-9a-f]{16}-[0-9a-f]{2}$/;

export function isTraceparent(value: unknown): value is string {
  return typeof value === 'string' && TRACEPARENT.test(value);
}
