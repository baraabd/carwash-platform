import { WorkforceError, invalid } from './errors';
import { assertUuid } from './operator';

/**
 * A dated period in which the operator does not take work (P05-C1): leave,
 * sickness, equipment downtime. ACTIVE exceptions of one operator never
 * overlap (database exclusion constraint) and are removed from the published
 * capacity shifts at read time, so a new offer can never land inside one.
 *
 * Work already assigned inside a new exception is not moved automatically:
 * Dispatch re-checks capacity on acceptance, and assigned work stays an
 * operations decision (documented limitation, P05-C1 §4).
 */
export const EXCEPTION_REASONS = ['LEAVE', 'SICKNESS', 'EQUIPMENT', 'PERSONAL', 'OTHER'] as const;
export type ExceptionReason = (typeof EXCEPTION_REASONS)[number];
export type ExceptionStatus = 'ACTIVE' | 'CANCELLED';

export const MAX_EXCEPTION_MS = 31 * 24 * 60 * 60 * 1000;
/** Tolerated client clock skew for a period starting "now". */
export const EXCEPTION_START_SKEW_MS = 5 * 60 * 1000;
export const MAX_EXCEPTION_AHEAD_MS = 180 * 24 * 60 * 60 * 1000;

export interface AvailabilityExceptionState {
  readonly id: string;
  readonly operatorId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly reason: ExceptionReason;
  readonly status: ExceptionStatus;
  readonly requester: string;
  readonly idempotencyKey: string;
  readonly requestFingerprint: string;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ExceptionCommand {
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly reason: ExceptionReason;
}

const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function instant(value: unknown, field: string): Date {
  if (typeof value !== 'string' || !UTC.test(value)) invalid(`${field} must be a UTC instant.`);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== value) {
    invalid(`${field} must be a UTC instant.`);
  }
  return new Date(ms);
}

/** Closed body {startsAt, endsAt, reason}. */
export function parseExceptionCommand(body: unknown): ExceptionCommand {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    invalid('Body must be a JSON object.');
  }
  const keys = Object.keys(body).sort();
  if (keys.join(',') !== 'endsAt,reason,startsAt') {
    invalid('Body must be exactly {startsAt, endsAt, reason}.');
  }
  const reason: unknown = Reflect.get(body, 'reason');
  if (!EXCEPTION_REASONS.some((candidate) => candidate === reason)) {
    invalid('Unknown exception reason.');
  }
  return {
    startsAt: instant(Reflect.get(body, 'startsAt'), 'startsAt'),
    endsAt: instant(Reflect.get(body, 'endsAt'), 'endsAt'),
    reason: reason as ExceptionReason,
  };
}

export function createException(input: {
  readonly id: string;
  readonly operatorId: string;
  readonly command: ExceptionCommand;
  readonly requester: string;
  readonly idempotencyKey: string;
  readonly requestFingerprint: string;
  readonly now: Date;
}): AvailabilityExceptionState {
  assertUuid(input.id);
  assertUuid(input.operatorId, 'operatorId');
  const { startsAt, endsAt, reason } = input.command;
  const now = input.now.getTime();
  if (endsAt.getTime() <= startsAt.getTime()) invalid('endsAt must be after startsAt.');
  if (endsAt.getTime() - startsAt.getTime() > MAX_EXCEPTION_MS) {
    invalid('An exception may not exceed 31 days.');
  }
  if (startsAt.getTime() < now - EXCEPTION_START_SKEW_MS) invalid('startsAt is in the past.');
  if (startsAt.getTime() > now + MAX_EXCEPTION_AHEAD_MS) {
    invalid('startsAt is more than 180 days ahead.');
  }
  return {
    id: input.id.toLowerCase(),
    operatorId: input.operatorId.toLowerCase(),
    startsAt,
    endsAt,
    reason,
    status: 'ACTIVE',
    requester: input.requester,
    idempotencyKey: input.idempotencyKey,
    requestFingerprint: input.requestFingerprint,
    version: 1,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

/** Only an ACTIVE exception that has not ended yet can be cancelled. */
export function cancelException(
  state: AvailabilityExceptionState,
  now: Date,
): AvailabilityExceptionState {
  if (state.status !== 'ACTIVE') {
    throw new WorkforceError('EXCEPTION_NOT_ACTIVE', 'Exception is already cancelled.');
  }
  if (state.endsAt.getTime() <= now.getTime()) {
    throw new WorkforceError('EXCEPTION_NOT_ACTIVE', 'Exception has already ended.');
  }
  return { ...state, status: 'CANCELLED', version: state.version + 1, updatedAt: now };
}
