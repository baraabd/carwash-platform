import { createHash } from 'node:crypto';

export type SupportErrorCode =
  | 'REQUEST_INVALID'
  | 'IDEMPOTENCY_KEY_INVALID'
  | 'IDEMPOTENCY_CONFLICT'
  | 'NOT_FOUND'
  | 'SUBJECT_NOT_FOUND'
  | 'SUBJECT_NOT_ELIGIBLE'
  | 'CASE_ALREADY_OPEN'
  | 'CASE_CHANGED'
  | 'EXECUTION_IN_PROGRESS'
  | 'OWNER_UNAVAILABLE'
  | 'OWNER_FORBIDDEN';

const STATUS: Readonly<Record<SupportErrorCode, number>> = {
  REQUEST_INVALID: 400,
  IDEMPOTENCY_KEY_INVALID: 400,
  IDEMPOTENCY_CONFLICT: 409,
  NOT_FOUND: 404,
  SUBJECT_NOT_FOUND: 404,
  SUBJECT_NOT_ELIGIBLE: 409,
  CASE_ALREADY_OPEN: 409,
  CASE_CHANGED: 409,
  EXECUTION_IN_PROGRESS: 409,
  OWNER_UNAVAILABLE: 503,
  OWNER_FORBIDDEN: 403,
};

export class SupportApplicationError extends Error {
  readonly status: number;

  constructor(
    readonly code: SupportErrorCode,
    readonly details?: Readonly<Record<string, string>>,
  ) {
    super(code);
    this.name = 'SupportApplicationError';
    this.status = STATUS[code];
  }
}

export const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function idempotencyKey(value: unknown): string {
  if (typeof value !== 'string' || !IDEMPOTENCY_KEY.test(value))
    throw new SupportApplicationError('IDEMPOTENCY_KEY_INVALID');
  return value;
}

export function uuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value))
    throw new SupportApplicationError('NOT_FOUND');
  return value.toLowerCase();
}

export function object(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new SupportApplicationError('REQUEST_INVALID');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !allowed.includes(key)))
    throw new SupportApplicationError('REQUEST_INVALID');
  return record;
}

/**
 * Deterministic JSON for request fingerprints: object keys sorted
 * recursively, array order preserved.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string')
    return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('NON_FINITE_NUMBER');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
  }
  throw new Error('UNSUPPORTED_JSON_VALUE');
}

export function fingerprint(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}
