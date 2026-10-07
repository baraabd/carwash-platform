import type { OwnerContract } from '../common/route';
import { parsePrincipalRef, type PrincipalRef } from '../common/principal';
import { parseRevision } from '../common/protocol';
import {
  BUSINESS_TIME_ZONES,
  parseLocalDate,
  parseUtc,
  type BusinessTimeZone,
  type LocalDate,
  type UtcTimestamp,
} from '../common/time';
import { ContractViolation, closed, integer, list, oneOf, uuid } from '../common/wire';

/**
 * scheduling.v1 — owner: Scheduling service (Lane C).
 * Bookable time and temporary capacity holds. Every interval is half-open
 * [startsAt, endsAt) in UTC; `date` is the civil day in `timezone`.
 * A hold reserves capacity only; it is never a booking, payment or assignment.
 */
export const SCHEDULING_V1 = {
  id: 'scheduling.v1',
  owner: 'scheduling',
  prefix: '/internal/v1/scheduling',
  routes: {
    getAvailability: { method: 'GET', path: '/availability', access: 'public' },
    getEarliest: { method: 'GET', path: '/availability/earliest', access: 'public' },
    createHold: { method: 'POST', path: '/holds', access: 'principal', idempotent: true },
    getHold: { method: 'GET', path: '/holds/:holdId', access: 'principal' },
    commitHold: {
      method: 'POST',
      path: '/holds/:holdId/commit',
      access: 'service:scheduling.hold.commit',
      idempotent: true,
    },
    releaseHold: {
      method: 'POST',
      path: '/holds/:holdId/release',
      access: 'principal',
      idempotent: true,
    },
  },
  reasons: ['SLOT_UNAVAILABLE', 'HOLD_EXPIRED', 'HOLD_NOT_ACTIVE', 'OUTSIDE_HORIZON'],
} as const satisfies OwnerContract;

export const MIN_DURATION_MINUTES = 5;
export const MAX_DURATION_MINUTES = 480;
export const MAX_SLOTS = 200;

export const SLOT_AVAILABILITY = ['AVAILABLE', 'LIMITED'] as const;
export type SlotAvailability = (typeof SLOT_AVAILABILITY)[number];

export const HOLD_STATES = ['HELD', 'COMMITTED', 'RELEASED', 'EXPIRED'] as const;
export type HoldState = (typeof HOLD_STATES)[number];

export const RELEASE_REASONS = ['CUSTOMER_CHANGED', 'BOOKING_FAILED', 'EXPIRED_BY_CLIENT'] as const;
export type ReleaseReason = (typeof RELEASE_REASONS)[number];

export interface IntervalV1 {
  readonly startsAt: UtcTimestamp;
  readonly endsAt: UtcTimestamp;
}

export interface SlotV1 extends IntervalV1 {
  readonly availability: SlotAvailability;
}

export interface AvailabilityQueryV1 {
  readonly zoneId: string;
  readonly date: LocalDate;
  readonly durationMinutes: number;
}

export interface AvailabilityV1 {
  readonly zoneId: string;
  readonly date: LocalDate;
  readonly timezone: BusinessTimeZone;
  readonly durationMinutes: number;
  readonly slots: readonly SlotV1[];
  readonly earliest: IntervalV1 | null;
  readonly asOf: UtcTimestamp;
}

export interface QuoteRefV1 {
  readonly quoteId: string;
  readonly revision: number;
}

export interface HoldRequestV1 {
  readonly beneficiary: PrincipalRef;
  readonly zoneId: string;
  readonly startsAt: UtcTimestamp;
  readonly durationMinutes: number;
  readonly quoteRef: QuoteRefV1;
}

export interface HoldV1 {
  readonly holdId: string;
  readonly revision: number;
  readonly state: HoldState;
  readonly beneficiary: PrincipalRef;
  readonly zoneId: string;
  readonly startsAt: UtcTimestamp;
  readonly endsAt: UtcTimestamp;
  readonly expiresAt: UtcTimestamp;
  /** Non-null exactly when state is COMMITTED. */
  readonly bookingId: string | null;
  readonly createdAt: UtcTimestamp;
  readonly updatedAt: UtcTimestamp;
}

export interface CommitHoldRequestV1 {
  readonly expectedRevision: number;
  readonly bookingId: string;
}

export interface ReleaseHoldRequestV1 {
  readonly expectedRevision: number;
  readonly reason: ReleaseReason;
}

const MINUTE_MS = 60_000;

function duration(value: unknown, path: string): number {
  return integer(value, path, MIN_DURATION_MINUTES, MAX_DURATION_MINUTES);
}

/** Positive half-open interval; optionally of an exact length. */
export function parseIntervalV1(value: unknown, path: string, exactMinutes?: number): IntervalV1 {
  const v = closed(value, path, ['startsAt', 'endsAt']);
  return interval(v, path, exactMinutes);
}

function interval(v: Record<string, unknown>, path: string, exactMinutes?: number): IntervalV1 {
  const startsAt = parseUtc(v.startsAt, `${path}.startsAt`);
  const endsAt = parseUtc(v.endsAt, `${path}.endsAt`);
  const length = Date.parse(endsAt) - Date.parse(startsAt);
  if (length <= 0) throw new ContractViolation('INVALID_INTERVAL', path);
  if (exactMinutes !== undefined && length !== exactMinutes * MINUTE_MS) {
    throw new ContractViolation('INVALID_SLOT_DURATION', path);
  }
  return { startsAt, endsAt };
}

/** Sorted by start and pairwise non-overlapping (touching edges are allowed). */
export function assertOrderedIntervals(items: readonly IntervalV1[], path: string): void {
  for (let i = 1; i < items.length; i += 1) {
    const previous = items[i - 1];
    const current = items[i];
    if (!previous || !current) continue;
    if (Date.parse(current.startsAt) < Date.parse(previous.endsAt)) {
      throw new ContractViolation('OVERLAPPING_OR_UNSORTED_INTERVALS', `${path}[${i}]`);
    }
  }
}

export function parseAvailabilityQueryV1(query: {
  readonly zoneId?: unknown;
  readonly date?: unknown;
  readonly durationMinutes?: unknown;
}): AvailabilityQueryV1 {
  const raw = query.durationMinutes;
  return {
    zoneId: uuid(query.zoneId, 'query.zoneId'),
    date: parseLocalDate(query.date, 'query.date'),
    durationMinutes: duration(
      typeof raw === 'string' && /^[0-9]{1,3}$/.test(raw) ? Number(raw) : raw,
      'query.durationMinutes',
    ),
  };
}

export function parseAvailabilityV1(value: unknown, path = '$'): AvailabilityV1 {
  const v = closed(value, path, [
    'zoneId',
    'date',
    'timezone',
    'durationMinutes',
    'slots',
    'earliest',
    'asOf',
  ]);
  const durationMinutes = duration(v.durationMinutes, `${path}.durationMinutes`);
  const slots = list(v.slots, `${path}.slots`, MAX_SLOTS, (entry, at) => {
    const s = closed(entry, at, ['startsAt', 'endsAt', 'availability']);
    return {
      ...interval(s, at, durationMinutes),
      availability: oneOf(s.availability, `${at}.availability`, SLOT_AVAILABILITY),
    };
  });
  assertOrderedIntervals(slots, `${path}.slots`);
  return {
    zoneId: uuid(v.zoneId, `${path}.zoneId`),
    date: parseLocalDate(v.date, `${path}.date`),
    timezone: oneOf(v.timezone, `${path}.timezone`, BUSINESS_TIME_ZONES),
    durationMinutes,
    slots,
    earliest:
      v.earliest === null ? null : parseIntervalV1(v.earliest, `${path}.earliest`, durationMinutes),
    asOf: parseUtc(v.asOf, `${path}.asOf`),
  };
}

function quoteRef(value: unknown, path: string): QuoteRefV1 {
  const v = closed(value, path, ['quoteId', 'revision']);
  return {
    quoteId: uuid(v.quoteId, `${path}.quoteId`),
    revision: parseRevision(v.revision, `${path}.revision`),
  };
}

export function parseHoldRequestV1(value: unknown): HoldRequestV1 {
  const v = closed(value, '$', [
    'beneficiary',
    'zoneId',
    'startsAt',
    'durationMinutes',
    'quoteRef',
  ]);
  return {
    beneficiary: parsePrincipalRef(v.beneficiary, '$.beneficiary'),
    zoneId: uuid(v.zoneId, '$.zoneId'),
    startsAt: parseUtc(v.startsAt, '$.startsAt'),
    durationMinutes: duration(v.durationMinutes, '$.durationMinutes'),
    quoteRef: quoteRef(v.quoteRef, '$.quoteRef'),
  };
}

export function parseHoldV1(value: unknown, path = '$'): HoldV1 {
  const v = closed(value, path, [
    'holdId',
    'revision',
    'state',
    'beneficiary',
    'zoneId',
    'startsAt',
    'endsAt',
    'expiresAt',
    'bookingId',
    'createdAt',
    'updatedAt',
  ]);
  const state = oneOf(v.state, `${path}.state`, HOLD_STATES);
  const bookingId = v.bookingId === null ? null : uuid(v.bookingId, `${path}.bookingId`);
  if ((state === 'COMMITTED') !== (bookingId !== null)) {
    throw new ContractViolation('INCONSISTENT_HOLD_BOOKING', `${path}.bookingId`);
  }
  const span = interval(v, path);
  const length = Date.parse(span.endsAt) - Date.parse(span.startsAt);
  if (length < MIN_DURATION_MINUTES * MINUTE_MS || length > MAX_DURATION_MINUTES * MINUTE_MS) {
    throw new ContractViolation('INVALID_SLOT_DURATION', path);
  }
  return {
    holdId: uuid(v.holdId, `${path}.holdId`),
    revision: parseRevision(v.revision, `${path}.revision`),
    state,
    beneficiary: parsePrincipalRef(v.beneficiary, `${path}.beneficiary`),
    zoneId: uuid(v.zoneId, `${path}.zoneId`),
    ...span,
    expiresAt: parseUtc(v.expiresAt, `${path}.expiresAt`),
    bookingId,
    createdAt: parseUtc(v.createdAt, `${path}.createdAt`),
    updatedAt: parseUtc(v.updatedAt, `${path}.updatedAt`),
  };
}

export function parseCommitHoldRequestV1(value: unknown): CommitHoldRequestV1 {
  const v = closed(value, '$', ['expectedRevision', 'bookingId']);
  return {
    expectedRevision: parseRevision(v.expectedRevision, '$.expectedRevision'),
    bookingId: uuid(v.bookingId, '$.bookingId'),
  };
}

export function parseReleaseHoldRequestV1(value: unknown): ReleaseHoldRequestV1 {
  const v = closed(value, '$', ['expectedRevision', 'reason']);
  return {
    expectedRevision: parseRevision(v.expectedRevision, '$.expectedRevision'),
    reason: oneOf(v.reason, '$.reason', RELEASE_REASONS),
  };
}
