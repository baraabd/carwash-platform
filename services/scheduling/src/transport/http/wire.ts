import { RELEASE_REASONS, type ReleaseReason } from '../../domain';
import type { HoldRequest } from '../../application';
import { RequestInvalid } from './http-errors';

/**
 * Edge parsing of scheduling.v1 requests. Mirrors the published parsers in
 * @carwash/contracts scheduling/v1 (closed objects, canonical UTC, revision
 * bounds); the provider test proves the two agree on real traffic. Values are
 * never reflected back; only the failing field path is.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_REVISION = 2_147_483_647;

/** Releases a principal may request; OPERATIONS_OVERRIDE is staff-only. */
const PRINCIPAL_REASONS = ['CUSTOMER_CHANGED', 'BOOKING_FAILED', 'EXPIRED_BY_CLIENT'] as const;

export function closed(
  value: unknown,
  path: string,
  keys: readonly string[],
): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new RequestInvalid(path);
  }
  const record = value as Record<string, unknown>;
  for (const key of keys)
    if (!Object.hasOwn(record, key)) throw new RequestInvalid(`${path}.${key}`);
  for (const key of Object.keys(record)) {
    if (!keys.includes(key)) throw new RequestInvalid(`${path}.${key.slice(0, 40)}`);
  }
  return record;
}

export function uuid(value: unknown, path: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new RequestInvalid(path);
  return value.toLowerCase();
}

export function integer(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new RequestInvalid(path);
  }
  return value;
}

export function revision(value: unknown, path: string): number {
  return integer(value, path, 1, MAX_REVISION);
}

/** Canonical UTC with milliseconds only; an offset or local time is refused, never guessed. */
export function utc(value: unknown, path: string): Date {
  if (typeof value !== 'string' || !UTC.test(value)) throw new RequestInvalid(path);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new RequestInvalid(path);
  }
  return date;
}

export function localDate(value: unknown, path: string): string {
  if (typeof value !== 'string' || !DATE.test(value)) throw new RequestInvalid(path);
  const ms = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== value) {
    throw new RequestInvalid(path);
  }
  return value;
}

/** Query-string integer: digits only, then the numeric bound. */
export function queryInteger(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== 'string' || !/^[0-9]{1,4}$/.test(value)) throw new RequestInvalid(path);
  return integer(Number(value), path, min, max);
}

export function holdRequest(body: unknown): HoldRequest {
  const v = closed(body, '$', ['beneficiary', 'zoneId', 'startsAt', 'durationMinutes', 'quoteRef']);
  const beneficiary = closed(v.beneficiary, '$.beneficiary', ['kind', 'subjectId']);
  if (beneficiary.kind !== 'account' && beneficiary.kind !== 'guest') {
    throw new RequestInvalid('$.beneficiary.kind');
  }
  const quoteRef = closed(v.quoteRef, '$.quoteRef', ['quoteId', 'revision']);
  return {
    beneficiary: {
      kind: beneficiary.kind,
      subjectId: uuid(beneficiary.subjectId, '$.beneficiary.subjectId'),
    },
    zoneId: uuid(v.zoneId, '$.zoneId'),
    startsAt: utc(v.startsAt, '$.startsAt'),
    durationMinutes: integer(v.durationMinutes, '$.durationMinutes', 5, 480),
    quoteRef: {
      quoteId: uuid(quoteRef.quoteId, '$.quoteRef.quoteId'),
      revision: revision(quoteRef.revision, '$.quoteRef.revision'),
    },
  };
}

export function commitRequest(body: unknown): {
  readonly expectedRevision: number;
  readonly bookingId: string;
} {
  const v = closed(body, '$', ['expectedRevision', 'bookingId']);
  return {
    expectedRevision: revision(v.expectedRevision, '$.expectedRevision'),
    bookingId: uuid(v.bookingId, '$.bookingId'),
  };
}

export function releaseRequest(body: unknown): {
  readonly expectedRevision: number;
  readonly reason: ReleaseReason;
} {
  const v = closed(body, '$', ['expectedRevision', 'reason']);
  const reason = v.reason;
  const allowed = PRINCIPAL_REASONS.find((r) => r === reason);
  if (allowed === undefined || !RELEASE_REASONS.includes(allowed)) {
    throw new RequestInvalid('$.reason');
  }
  return { expectedRevision: revision(v.expectedRevision, '$.expectedRevision'), reason: allowed };
}

/** REQUESTED scheduling.v1 `releaseCommitment` body (CR-P04-C1). */
export function releaseCommitmentRequest(body: unknown): { readonly holdId: string } {
  const v = closed(body, '$', ['holdId']);
  return { holdId: uuid(v.holdId, '$.holdId') };
}

/** REQUESTED scheduling.v1 `replaceCommitment` body (CR-P04-C1). */
export function replaceCommitmentRequest(body: unknown): {
  readonly fromHoldId: string;
  readonly toHoldId: string;
  readonly toExpectedRevision: number;
} {
  const v = closed(body, '$', ['fromHoldId', 'toHoldId', 'toExpectedRevision']);
  return {
    fromHoldId: uuid(v.fromHoldId, '$.fromHoldId'),
    toHoldId: uuid(v.toHoldId, '$.toHoldId'),
    toExpectedRevision: revision(v.toExpectedRevision, '$.toExpectedRevision'),
  };
}
