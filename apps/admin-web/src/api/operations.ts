import { ASSIGNMENT_STATUSES, type AssignmentStatus } from '../domain/assignment';
import { DERIVED_STATUSES, type DerivedStatus } from '../domain/bookings';
import {
  INSTANT,
  UUID,
  bool,
  integer,
  list,
  nullableText,
  object,
  oneOf,
  request,
  text,
  type Result,
} from './http';

/**
 * Reporting operations projections, read through the Gateway routes requested
 * in CR-D-P02-01. The wire shape is Reporting's `reporting.operations` read API
 * (P02-D1). Until Lane E publishes it in `@carwash/contracts`, this reader is a
 * strict local parser of that documented shape, not a second contract: any
 * deviation is MALFORMED and rendered as an error, never guessed around.
 */
const OPERATIONS = '/admin/operations';

export type FreshnessStatus = 'NO_DATA' | 'FRESH' | 'STALE';
export type HoldState = 'HELD' | 'COMMITTED' | 'RELEASED' | 'EXPIRED';
export type Eligibility = 'ELIGIBLE' | 'INELIGIBLE';

export interface Freshness {
  readonly source: string;
  readonly status: FreshnessStatus;
  readonly lastEventOccurredAt: string | null;
  readonly lastAppliedAt: string | null;
}

export interface Authority {
  readonly owner: string;
  readonly reads: string;
}

export interface Projection {
  readonly derived: true;
  readonly authority: readonly Authority[];
  readonly freshness: readonly Freshness[];
}

export interface Slot {
  readonly holdId: string;
  readonly state: HoldState;
  readonly zoneId: string;
  readonly startsAt: string;
  readonly endsAt: string;
}

export interface BookingOperation {
  readonly bookingId: string;
  readonly customerRef: string | null;
  readonly confirmedAt: string | null;
  readonly derivedStatus: DerivedStatus | null;
  readonly slot: Slot | null;
  readonly sourceUpdatedAt: string;
}

export interface LinkedHold extends Slot {
  readonly version: number;
  readonly occurredAt: string;
}

export interface Resource {
  readonly resourceId: string;
  readonly eligibility: Eligibility;
  readonly version: number;
  readonly changedAt: string;
}

const HOLD_STATES = ['HELD', 'COMMITTED', 'RELEASED', 'EXPIRED'] as const;
const instant = (v: unknown, p: string): string => text(v, p, INSTANT);
const id = (v: unknown, p: string): string => text(v, p, UUID);

export function projection(body: Record<string, unknown>): Projection {
  if (body.derived !== true) throw new Error('NOT_A_PROJECTION');
  return {
    derived: true,
    authority: list(body.authority, 'authority', (v, p) => {
      const a = object(v, p);
      return { owner: text(a.owner, `${p}.owner`), reads: text(a.reads, `${p}.reads`) };
    }),
    freshness: list(body.freshness, 'freshness', (v, p) => {
      const f = object(v, p);
      return {
        source: text(f.source, `${p}.source`, /^[a-z]{2,32}$/),
        status: oneOf(f.status, ['NO_DATA', 'FRESH', 'STALE'] as const, `${p}.status`),
        lastEventOccurredAt: nullableText(
          f.lastEventOccurredAt,
          `${p}.lastEventOccurredAt`,
          INSTANT,
        ),
        lastAppliedAt: nullableText(f.lastAppliedAt, `${p}.lastAppliedAt`, INSTANT),
      };
    }),
  };
}

function slot(value: unknown, path: string): Slot {
  const s = object(value, path);
  return {
    holdId: id(s.holdId, `${path}.holdId`),
    state: oneOf(s.state, HOLD_STATES, `${path}.state`),
    zoneId: id(s.zoneId, `${path}.zoneId`),
    startsAt: instant(s.startsAt, `${path}.startsAt`),
    endsAt: instant(s.endsAt, `${path}.endsAt`),
  };
}

function booking(value: unknown, path: string): BookingOperation {
  const b = object(value, path);
  return {
    bookingId: id(b.bookingId, `${path}.bookingId`),
    customerRef: nullableText(b.customerRef, `${path}.customerRef`, UUID),
    confirmedAt: nullableText(b.confirmedAt, `${path}.confirmedAt`, INSTANT),
    derivedStatus:
      b.derivedStatus === null
        ? null
        : oneOf(b.derivedStatus, DERIVED_STATUSES, `${path}.derivedStatus`),
    slot: b.slot === null ? null : slot(b.slot, `${path}.slot`),
    sourceUpdatedAt: instant(b.sourceUpdatedAt, `${path}.sourceUpdatedAt`),
  };
}

function cursor(value: unknown): string | null {
  return nullableText(value, 'nextCursor', /^[A-Za-z0-9_-]{8,200}$/);
}

export interface BookingPage extends Projection {
  readonly items: readonly BookingOperation[];
  readonly nextCursor: string | null;
}

export function listBookings(input: {
  readonly from: string;
  readonly to: string;
  readonly status?: DerivedStatus;
  readonly cursor?: string;
}): Promise<Result<BookingPage>> {
  return request(`${OPERATIONS}/bookings`, {
    query: {
      from: input.from,
      to: input.to,
      status: input.status,
      cursor: input.cursor,
      limit: '25',
    },
    read: (raw) => {
      const body = object(raw, '$');
      return {
        ...projection(body),
        items: list(body.items, 'items', booking),
        nextCursor: cursor(body.nextCursor),
      };
    },
  });
}

/** A derived Dispatch assignment with first-occurrence milestones (P03-D1). */
export interface DerivedAssignment {
  readonly assignmentId: string;
  readonly status: AssignmentStatus;
  readonly resourceId: string | null;
  readonly firstObservedAt: string;
  readonly firstOfferedAt: string | null;
  readonly firstAssignedAt: string | null;
  readonly reassigned: boolean;
}

export interface BookingDetail extends Projection {
  readonly item: BookingOperation;
  readonly holds: readonly LinkedHold[];
  readonly assignments: readonly DerivedAssignment[];
}

export function bookingDetail(bookingId: string): Promise<Result<BookingDetail>> {
  return request(`${OPERATIONS}/bookings/${encodeURIComponent(bookingId)}`, {
    read: (raw) => {
      const body = object(raw, '$');
      return {
        ...projection(body),
        item: booking(body.item, 'item'),
        holds: list(body.holds, 'holds', (v, p) => {
          const h = object(v, p);
          return {
            ...slot(h, p),
            version: integer(h.version, `${p}.version`),
            occurredAt: instant(h.occurredAt, `${p}.occurredAt`),
          };
        }),
        assignments: list(body.assignments, 'assignments', (v, p) => {
          const a = object(v, p);
          return {
            assignmentId: id(a.assignmentId, `${p}.assignmentId`),
            status: oneOf(a.status, ASSIGNMENT_STATUSES, `${p}.status`),
            resourceId: nullableText(a.resourceId, `${p}.resourceId`, UUID),
            firstObservedAt: instant(a.firstObservedAt, `${p}.firstObservedAt`),
            firstOfferedAt: nullableText(a.firstOfferedAt, `${p}.firstOfferedAt`, INSTANT),
            firstAssignedAt: nullableText(a.firstAssignedAt, `${p}.firstAssignedAt`, INSTANT),
            reassigned: bool(a.reassigned, `${p}.reassigned`),
          };
        }),
      };
    },
  });
}

export interface ResourcePage extends Projection {
  readonly summary: { readonly eligible: number; readonly ineligible: number };
  readonly items: readonly Resource[];
  readonly nextCursor: string | null;
}

export function listResources(input: { readonly cursor?: string }): Promise<Result<ResourcePage>> {
  return request(`${OPERATIONS}/resources`, {
    query: { cursor: input.cursor, limit: '25' },
    read: (raw) => {
      const body = object(raw, '$');
      const summary = object(body.summary, 'summary');
      return {
        ...projection(body),
        summary: {
          eligible: integer(summary.eligible, 'summary.eligible'),
          ineligible: integer(summary.ineligible, 'summary.ineligible'),
        },
        items: list(body.items, 'items', (v, p) => {
          const r = object(v, p);
          return {
            resourceId: id(r.resourceId, `${p}.resourceId`),
            eligibility: oneOf(
              r.eligibility,
              ['ELIGIBLE', 'INELIGIBLE'] as const,
              `${p}.eligibility`,
            ),
            version: integer(r.version, `${p}.version`),
            changedAt: instant(r.changedAt, `${p}.changedAt`),
          };
        }),
        nextCursor: cursor(body.nextCursor),
      };
    },
  });
}
