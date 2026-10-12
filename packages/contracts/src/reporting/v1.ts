import type { OwnerContract } from '../common/route';
import { parseNonNegativeMoney, type Money } from '../common/money';
import { parseUtc, type UtcTimestamp } from '../common/time';
import {
  ContractViolation,
  closed,
  integer,
  list,
  oneOf,
  record,
  text,
  uuid,
} from '../common/wire';
import { FINANCIAL_STATUSES, type FinancialStatus } from '../billing/v1';

/**
 * reporting.v1 — owner: Reporting service (Lane D). Conformed to the MERGED
 * operations projections provider (P02-D/P03-D, `operations.controller.ts`).
 *
 * Every response is DERIVED: it says so (`derived: true`), names the owners
 * holding the authoritative record and the per-source freshness. A projection
 * never authorizes an action (refund, cancel, dispatch) and is never a payment
 * or booking fact; stale or incomplete sources are reported, never hidden.
 * Reads are rate-limited per subject (429) and audited without row content.
 */
export const REPORTING_V1 = {
  id: 'reporting.v1',
  owner: 'reporting',
  prefix: '/internal/v1/reporting',
  routes: {
    listBookingOperations: {
      method: 'GET',
      path: '/operations/bookings',
      access: 'permission:operations.dispatch',
      paged: true,
    },
    getBookingOperation: {
      method: 'GET',
      path: '/operations/bookings/:bookingId',
      access: 'permission:operations.dispatch',
    },
    listResources: {
      method: 'GET',
      path: '/operations/resources',
      access: 'permission:verification.review|operations.dispatch',
      paged: true,
    },
    getOperationsKpis: {
      method: 'GET',
      path: '/operations/kpis/operations',
      access: 'permission:operations.dispatch',
    },
    getCashKpis: {
      method: 'GET',
      path: '/operations/kpis/cash',
      access: 'permission:billing.read',
    },
    getFreshness: {
      method: 'GET',
      path: '/operations/freshness',
      access: 'permission:verification.review|operations.dispatch|billing.read',
    },
  },
  reasons: ['NOT_PROJECTED', 'INVALID_WINDOW', 'WINDOW_TOO_LARGE'],
} as const satisfies OwnerContract;

export const REPORTING_SOURCES = [
  'booking',
  'scheduling',
  'workforce',
  'dispatch',
  'billing',
] as const;
export type ReportingSource = (typeof REPORTING_SOURCES)[number];
export const FRESHNESS_STATUSES = ['NO_DATA', 'FRESH', 'STALE'] as const;
export const DERIVED_OPERATIONS_STATUSES = [
  'SCHEDULED',
  'CONFIRMED_UNSCHEDULED',
  'SLOT_COMMITTED_UNCONFIRMED',
  'SLOT_RELEASED',
] as const;
export type DerivedOperationsStatus = (typeof DERIVED_OPERATIONS_STATUSES)[number];
export const HOLD_STATES = ['HELD', 'COMMITTED', 'RELEASED', 'EXPIRED'] as const;
export const ASSIGNMENT_STATUSES = ['UNASSIGNED', 'OFFERED', 'ASSIGNED', 'CANCELLED'] as const;
export const ELIGIBILITIES = ['ELIGIBLE', 'INELIGIBLE'] as const;
/** The provider's maximum KPI window (MAX_WINDOW_DAYS). */
export const MAX_KPI_WINDOW_DAYS = 31;

const OPAQUE_REF = /^[A-Za-z0-9-]{1,64}$/;
const CURSOR = /^[A-Za-z0-9_-]{1,512}$/;
const COUNT = /^(0|[1-9][0-9]{0,18})$/;
const nullableUtc = (value: unknown, path: string): UtcTimestamp | null =>
  value === null ? null : parseUtc(value, path);

export interface FreshnessV1 {
  readonly source: ReportingSource;
  readonly status: (typeof FRESHNESS_STATUSES)[number];
  readonly lastEventOccurredAt: UtcTimestamp | null;
  readonly lastAppliedAt: UtcTimestamp | null;
  readonly ingestionLagMs: number | null;
  /** Decimal string: an unbounded counter is never a JS number on the wire. */
  readonly appliedCount: string;
}

export function parseFreshnessV1(value: unknown, path = '$'): FreshnessV1 {
  const v = closed(value, path, [
    'source',
    'status',
    'lastEventOccurredAt',
    'lastAppliedAt',
    'ingestionLagMs',
    'appliedCount',
  ]);
  const status = oneOf(v.status, `${path}.status`, FRESHNESS_STATUSES);
  const lastAppliedAt = nullableUtc(v.lastAppliedAt, `${path}.lastAppliedAt`);
  const appliedCount = text(v.appliedCount, `${path}.appliedCount`, { max: 19, pattern: COUNT });
  // NO_DATA is exactly "no checkpoint": nothing applied, no instants.
  if ((status === 'NO_DATA') !== (lastAppliedAt === null))
    throw new ContractViolation('INCONSISTENT_FRESHNESS', `${path}.lastAppliedAt`);
  if (status === 'NO_DATA' && appliedCount !== '0')
    throw new ContractViolation('INCONSISTENT_FRESHNESS', `${path}.appliedCount`);
  return {
    source: oneOf(v.source, `${path}.source`, REPORTING_SOURCES),
    status,
    lastEventOccurredAt: nullableUtc(v.lastEventOccurredAt, `${path}.lastEventOccurredAt`),
    lastAppliedAt,
    ingestionLagMs:
      v.ingestionLagMs === null
        ? null
        : integer(v.ingestionLagMs, `${path}.ingestionLagMs`, 0, Number.MAX_SAFE_INTEGER),
    appliedCount,
  };
}

export interface AuthorityV1 {
  readonly owner: string;
  readonly reads: string;
}

interface DerivedMeta {
  readonly derived: true;
  readonly authority: readonly AuthorityV1[];
  readonly freshness: readonly FreshnessV1[];
}

function parseMeta(v: Record<string, unknown>, path: string): DerivedMeta {
  if (v.derived !== true) throw new ContractViolation('NOT_DERIVED', `${path}.derived`);
  return {
    derived: true,
    authority: list(v.authority, `${path}.authority`, 10, (item, at) => {
      const a = closed(item, at, ['owner', 'reads']);
      return {
        owner: text(a.owner, `${at}.owner`, { max: 32, pattern: /^[a-z][a-z-]{1,31}$/ }),
        reads: text(a.reads, `${at}.reads`, { max: 200 }),
      };
    }),
    freshness: list(v.freshness, `${path}.freshness`, REPORTING_SOURCES.length, (f, at) =>
      parseFreshnessV1(f, at),
    ),
  };
}

export interface SlotV1 {
  readonly holdId: string;
  readonly state: (typeof HOLD_STATES)[number];
  readonly zoneId: string;
  readonly startsAt: UtcTimestamp;
  readonly endsAt: UtcTimestamp;
}

function parseInterval(v: Record<string, unknown>, path: string) {
  const startsAt = parseUtc(v.startsAt, `${path}.startsAt`);
  const endsAt = parseUtc(v.endsAt, `${path}.endsAt`);
  if (endsAt <= startsAt) throw new ContractViolation('INVALID_INTERVAL', path);
  return { startsAt, endsAt };
}

export interface BookingOperationV1 {
  readonly bookingId: string;
  /** Opaque Identity/Customer reference; never a name, phone or address. */
  readonly customerRef: string | null;
  readonly confirmedAt: UtcTimestamp | null;
  readonly derivedStatus: DerivedOperationsStatus | null;
  readonly slot: SlotV1 | null;
  readonly sourceUpdatedAt: UtcTimestamp;
}

function parseBookingOperation(value: unknown, path: string): BookingOperationV1 {
  const v = closed(value, path, [
    'bookingId',
    'customerRef',
    'confirmedAt',
    'derivedStatus',
    'slot',
    'sourceUpdatedAt',
  ]);
  let slot: SlotV1 | null = null;
  if (v.slot !== null) {
    const s = closed(v.slot, `${path}.slot`, ['holdId', 'state', 'zoneId', 'startsAt', 'endsAt']);
    slot = {
      holdId: uuid(s.holdId, `${path}.slot.holdId`),
      state: oneOf(s.state, `${path}.slot.state`, HOLD_STATES),
      zoneId: uuid(s.zoneId, `${path}.slot.zoneId`),
      ...parseInterval(s, `${path}.slot`),
    };
  }
  return {
    bookingId: uuid(v.bookingId, `${path}.bookingId`),
    customerRef:
      v.customerRef === null
        ? null
        : text(v.customerRef, `${path}.customerRef`, { max: 64, pattern: OPAQUE_REF }),
    confirmedAt: nullableUtc(v.confirmedAt, `${path}.confirmedAt`),
    derivedStatus:
      v.derivedStatus === null
        ? null
        : oneOf(v.derivedStatus, `${path}.derivedStatus`, DERIVED_OPERATIONS_STATUSES),
    slot,
    sourceUpdatedAt: parseUtc(v.sourceUpdatedAt, `${path}.sourceUpdatedAt`),
  };
}

const nextCursor = (value: unknown, path: string): string | null =>
  value === null ? null : text(value, path, { max: 512, pattern: CURSOR });

export interface BookingOperationsPageV1 extends DerivedMeta {
  readonly items: readonly BookingOperationV1[];
  readonly nextCursor: string | null;
}

export function parseBookingOperationsPageV1(value: unknown, path = '$'): BookingOperationsPageV1 {
  const v = closed(value, path, ['derived', 'authority', 'freshness', 'items', 'nextCursor']);
  return {
    ...parseMeta(v, path),
    items: list(v.items, `${path}.items`, 100, (item, at) => parseBookingOperation(item, at)),
    nextCursor: nextCursor(v.nextCursor, `${path}.nextCursor`),
  };
}

export interface HoldHistoryV1 extends SlotV1 {
  readonly version: number;
  readonly occurredAt: UtcTimestamp;
}

export interface AssignmentHistoryV1 {
  readonly assignmentId: string;
  readonly status: (typeof ASSIGNMENT_STATUSES)[number];
  readonly resourceId: string | null;
  readonly zoneId: string;
  readonly startsAt: UtcTimestamp;
  readonly endsAt: UtcTimestamp;
  readonly version: number;
  readonly occurredAt: UtcTimestamp;
  readonly firstObservedAt: UtcTimestamp;
  readonly firstOfferedAt: UtcTimestamp | null;
  readonly firstAssignedAt: UtcTimestamp | null;
  readonly reassigned: boolean;
}

export interface BookingOperationDetailV1 extends DerivedMeta {
  readonly item: BookingOperationV1;
  readonly holds: readonly HoldHistoryV1[];
  readonly assignments: readonly AssignmentHistoryV1[];
}

export function parseBookingOperationDetailV1(
  value: unknown,
  path = '$',
): BookingOperationDetailV1 {
  const v = closed(value, path, [
    'derived',
    'authority',
    'freshness',
    'item',
    'holds',
    'assignments',
  ]);
  return {
    ...parseMeta(v, path),
    item: parseBookingOperation(v.item, `${path}.item`),
    holds: list(v.holds, `${path}.holds`, 200, (item, at) => {
      const h = closed(item, at, [
        'holdId',
        'state',
        'zoneId',
        'startsAt',
        'endsAt',
        'version',
        'occurredAt',
      ]);
      return {
        holdId: uuid(h.holdId, `${at}.holdId`),
        state: oneOf(h.state, `${at}.state`, HOLD_STATES),
        zoneId: uuid(h.zoneId, `${at}.zoneId`),
        ...parseInterval(h, at),
        version: integer(h.version, `${at}.version`, 1, Number.MAX_SAFE_INTEGER),
        occurredAt: parseUtc(h.occurredAt, `${at}.occurredAt`),
      };
    }),
    assignments: list(v.assignments, `${path}.assignments`, 200, (item, at) => {
      const a = closed(item, at, [
        'assignmentId',
        'status',
        'resourceId',
        'zoneId',
        'startsAt',
        'endsAt',
        'version',
        'occurredAt',
        'firstObservedAt',
        'firstOfferedAt',
        'firstAssignedAt',
        'reassigned',
      ]);
      if (typeof a.reassigned !== 'boolean')
        throw new ContractViolation('EXPECTED_BOOLEAN', `${at}.reassigned`);
      return {
        assignmentId: uuid(a.assignmentId, `${at}.assignmentId`),
        status: oneOf(a.status, `${at}.status`, ASSIGNMENT_STATUSES),
        resourceId: a.resourceId === null ? null : uuid(a.resourceId, `${at}.resourceId`),
        zoneId: uuid(a.zoneId, `${at}.zoneId`),
        ...parseInterval(a, at),
        version: integer(a.version, `${at}.version`, 1, Number.MAX_SAFE_INTEGER),
        occurredAt: parseUtc(a.occurredAt, `${at}.occurredAt`),
        firstObservedAt: parseUtc(a.firstObservedAt, `${at}.firstObservedAt`),
        firstOfferedAt: nullableUtc(a.firstOfferedAt, `${at}.firstOfferedAt`),
        firstAssignedAt: nullableUtc(a.firstAssignedAt, `${at}.firstAssignedAt`),
        reassigned: a.reassigned,
      };
    }),
  };
}

export interface ResourcesPageV1 extends DerivedMeta {
  readonly summary: { readonly eligible: number; readonly ineligible: number };
  readonly items: readonly {
    readonly resourceId: string;
    readonly eligibility: (typeof ELIGIBILITIES)[number];
    readonly version: number;
    readonly changedAt: UtcTimestamp;
  }[];
  readonly nextCursor: string | null;
}

export function parseResourcesPageV1(value: unknown, path = '$'): ResourcesPageV1 {
  const v = closed(value, path, [
    'derived',
    'authority',
    'freshness',
    'summary',
    'items',
    'nextCursor',
  ]);
  const s = closed(v.summary, `${path}.summary`, ['eligible', 'ineligible']);
  return {
    ...parseMeta(v, path),
    summary: {
      eligible: integer(s.eligible, `${path}.summary.eligible`, 0, Number.MAX_SAFE_INTEGER),
      ineligible: integer(s.ineligible, `${path}.summary.ineligible`, 0, Number.MAX_SAFE_INTEGER),
    },
    items: list(v.items, `${path}.items`, 100, (item, at) => {
      const r = closed(item, at, ['resourceId', 'eligibility', 'version', 'changedAt']);
      return {
        resourceId: uuid(r.resourceId, `${at}.resourceId`),
        eligibility: oneOf(r.eligibility, `${at}.eligibility`, ELIGIBILITIES),
        version: integer(r.version, `${at}.version`, 1, Number.MAX_SAFE_INTEGER),
        changedAt: parseUtc(r.changedAt, `${at}.changedAt`),
      };
    }),
    nextCursor: nextCursor(v.nextCursor, `${path}.nextCursor`),
  };
}

export interface DurationSummaryV1 {
  readonly count: number;
  readonly p50Ms: number | null;
  readonly p90Ms: number | null;
  readonly maxMs: number | null;
}

function parseDuration(value: unknown, path: string): DurationSummaryV1 {
  const v = closed(value, path, ['count', 'p50Ms', 'p90Ms', 'maxMs']);
  const count = integer(v.count, `${path}.count`, 0, Number.MAX_SAFE_INTEGER);
  const ms = (x: unknown, at: string) =>
    x === null ? null : integer(x, at, 0, Number.MAX_SAFE_INTEGER);
  const p50Ms = ms(v.p50Ms, `${path}.p50Ms`);
  const p90Ms = ms(v.p90Ms, `${path}.p90Ms`);
  const maxMs = ms(v.maxMs, `${path}.maxMs`);
  const empty = count === 0;
  if ([p50Ms, p90Ms, maxMs].some((x) => (x === null) !== empty))
    throw new ContractViolation('INCONSISTENT_DURATION', path);
  if (p50Ms !== null && p90Ms !== null && maxMs !== null && !(p50Ms <= p90Ms && p90Ms <= maxMs))
    throw new ContractViolation('INCONSISTENT_DURATION', path);
  return { count, p50Ms, p90Ms, maxMs };
}

function counts<T extends string>(value: unknown, path: string, keys: readonly T[]) {
  const v = record(value, path);
  const out: Partial<Record<T, number>> = {};
  for (const [key, n] of Object.entries(v)) {
    const k = oneOf(key, `${path}.${key}`, keys);
    out[k] = integer(n, `${path}.${key}`, 0, Number.MAX_SAFE_INTEGER);
  }
  return out;
}

export interface OperationsKpisV1 extends DerivedMeta {
  readonly incompleteSources: readonly ReportingSource[];
  readonly window: { readonly from: UtcTimestamp; readonly to: UtcTimestamp };
  readonly bookings: { readonly byDerivedStatus: Partial<Record<DerivedOperationsStatus, number>> };
  readonly assignments: {
    readonly byStatus: Partial<Record<(typeof ASSIGNMENT_STATUSES)[number], number>>;
    readonly reassigned: number;
    readonly assignedAfterStart: number;
    readonly timeToFirstOffer: DurationSummaryV1;
    readonly timeToAssign: DurationSummaryV1;
    readonly offerToAssign: DurationSummaryV1;
  };
  /** No owner publishes field progress yet; the KPI says so instead of inventing stages. */
  readonly fieldStages: { readonly available: false; readonly reason: 'NO_PUBLISHED_SOURCE' };
}

function incomplete(value: unknown, path: string): ReportingSource[] {
  return list(value, path, REPORTING_SOURCES.length, (s, at) => oneOf(s, at, REPORTING_SOURCES));
}

export function parseOperationsKpisV1(value: unknown, path = '$'): OperationsKpisV1 {
  const v = closed(value, path, [
    'derived',
    'authority',
    'freshness',
    'incompleteSources',
    'window',
    'bookings',
    'assignments',
    'fieldStages',
  ]);
  const w = closed(v.window, `${path}.window`, ['from', 'to']);
  const from = parseUtc(w.from, `${path}.window.from`);
  const to = parseUtc(w.to, `${path}.window.to`);
  if (to <= from || Date.parse(to) - Date.parse(from) > MAX_KPI_WINDOW_DAYS * 86_400_000)
    throw new ContractViolation('INVALID_WINDOW', `${path}.window`);
  const b = closed(v.bookings, `${path}.bookings`, ['byDerivedStatus']);
  const a = closed(v.assignments, `${path}.assignments`, [
    'byStatus',
    'reassigned',
    'assignedAfterStart',
    'timeToFirstOffer',
    'timeToAssign',
    'offerToAssign',
  ]);
  const f = closed(v.fieldStages, `${path}.fieldStages`, ['available', 'reason']);
  if (f.available !== false || f.reason !== 'NO_PUBLISHED_SOURCE')
    throw new ContractViolation('UNPUBLISHED_FIELD_STAGES', `${path}.fieldStages`);
  return {
    ...parseMeta(v, path),
    incompleteSources: incomplete(v.incompleteSources, `${path}.incompleteSources`),
    window: { from, to },
    bookings: {
      byDerivedStatus: counts(
        b.byDerivedStatus,
        `${path}.bookings.byDerivedStatus`,
        DERIVED_OPERATIONS_STATUSES,
      ),
    },
    assignments: {
      byStatus: counts(a.byStatus, `${path}.assignments.byStatus`, ASSIGNMENT_STATUSES),
      reassigned: integer(
        a.reassigned,
        `${path}.assignments.reassigned`,
        0,
        Number.MAX_SAFE_INTEGER,
      ),
      assignedAfterStart: integer(
        a.assignedAfterStart,
        `${path}.assignments.assignedAfterStart`,
        0,
        Number.MAX_SAFE_INTEGER,
      ),
      timeToFirstOffer: parseDuration(a.timeToFirstOffer, `${path}.assignments.timeToFirstOffer`),
      timeToAssign: parseDuration(a.timeToAssign, `${path}.assignments.timeToAssign`),
      offerToAssign: parseDuration(a.offerToAssign, `${path}.assignments.offerToAssign`),
    },
    fieldStages: { available: false, reason: 'NO_PUBLISHED_SOURCE' },
  };
}

export interface CashStateV1 {
  /** Billing's financial status vocabulary; Billing remains the authority. */
  readonly cashState: FinancialStatus;
  readonly count: number;
  /** Outstanding per currency, exact minor units; never a cross-currency sum. */
  readonly outstanding: readonly Money[];
  readonly oldestSince: UtcTimestamp | null;
}

export interface CashKpisV1 extends DerivedMeta {
  readonly incompleteSources: readonly ReportingSource[];
  readonly asOf: UtcTimestamp;
  readonly states: readonly CashStateV1[];
}

export function parseCashKpisV1(value: unknown, path = '$'): CashKpisV1 {
  const v = closed(value, path, [
    'derived',
    'authority',
    'freshness',
    'incompleteSources',
    'asOf',
    'states',
  ]);
  const states = list(v.states, `${path}.states`, FINANCIAL_STATUSES.length, (item, at) => {
    const s = closed(item, at, ['cashState', 'count', 'outstanding', 'oldestSince']);
    const outstanding = list(s.outstanding, `${at}.outstanding`, 4, (m, mAt) =>
      parseNonNegativeMoney(m, mAt),
    );
    if (new Set(outstanding.map((m) => m.currency)).size !== outstanding.length)
      throw new ContractViolation('DUPLICATE_CURRENCY', `${at}.outstanding`);
    return {
      cashState: oneOf(s.cashState, `${at}.cashState`, FINANCIAL_STATUSES),
      count: integer(s.count, `${at}.count`, 0, Number.MAX_SAFE_INTEGER),
      outstanding,
      oldestSince: nullableUtc(s.oldestSince, `${at}.oldestSince`),
    };
  });
  if (new Set(states.map((s) => s.cashState)).size !== states.length)
    throw new ContractViolation('DUPLICATE_STATE', `${path}.states`);
  return {
    ...parseMeta(v, path),
    incompleteSources: incomplete(v.incompleteSources, `${path}.incompleteSources`),
    asOf: parseUtc(v.asOf, `${path}.asOf`),
    states,
  };
}

export interface FreshnessReportV1 {
  readonly derived: true;
  readonly freshness: readonly FreshnessV1[];
}

export function parseFreshnessReportV1(value: unknown, path = '$'): FreshnessReportV1 {
  const v = closed(value, path, ['derived', 'freshness']);
  if (v.derived !== true) throw new ContractViolation('NOT_DERIVED', `${path}.derived`);
  return {
    derived: true,
    freshness: list(v.freshness, `${path}.freshness`, REPORTING_SOURCES.length, (f, at) =>
      parseFreshnessV1(f, at),
    ),
  };
}
