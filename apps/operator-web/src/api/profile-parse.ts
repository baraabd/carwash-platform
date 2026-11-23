import { ShapeError, parseAvailability, parseMoney } from './parse';
import {
  EQUIPMENT_ISSUES,
  EQUIPMENT_KINDS,
  EQUIPMENT_STATUSES,
  EXCEPTION_REASONS,
  READINESS_REASONS,
  type AvailabilityException,
  type CustodyView,
  type EquipmentView,
  type Money,
  type ProfileView,
  type ScheduleApplication,
  type ShiftSlot,
  type WeeklySchedule,
} from './types';

/**
 * Closed parsers for the P05-C2 reads (requested Workforce profile routes,
 * CR-P05-C1; published Billing getMyCustody). Same rule as parse.ts: an
 * unknown or missing field refuses the whole response.
 */
type Rec = Record<string, unknown>;

function obj(value: unknown, path: string, keys: readonly string[]): Rec {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ShapeError(path);
  }
  const record = value as Rec;
  const actual = Object.keys(record);
  if (actual.length !== keys.length) throw new ShapeError(path);
  for (const key of actual) if (!keys.includes(key)) throw new ShapeError(`${path}.${key}`);
  return record;
}
const str = (v: unknown, p: string, max = 200): string => {
  if (typeof v !== 'string' || v.length === 0 || v.length > max) throw new ShapeError(p);
  return v;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (v: unknown, p: string): string => {
  const s = str(v, p, 36);
  if (!UUID.test(s)) throw new ShapeError(p);
  return s;
};
const int = (v: unknown, p: string, min = 0, max = Number.MAX_SAFE_INTEGER): number => {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max) {
    throw new ShapeError(p);
  }
  return v;
};
const bool = (v: unknown, p: string): boolean => {
  if (typeof v !== 'boolean') throw new ShapeError(p);
  return v;
};
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const instant = (v: unknown, p: string): string => {
  const s = str(v, p, 30);
  if (!ISO.test(s) || !Number.isFinite(Date.parse(s))) throw new ShapeError(p);
  return s;
};
const ninstant = (v: unknown, p: string): string | null => (v === null ? null : instant(v, p));
function oneOf<T extends string>(v: unknown, p: string, values: readonly T[]): T {
  const found = values.find((candidate) => candidate === v);
  if (found === undefined) throw new ShapeError(p);
  return found;
}
function arr(v: unknown, p: string, max: number): unknown[] {
  if (!Array.isArray(v) || v.length > max) throw new ShapeError(p);
  return v;
}

function parseSchedule(v: unknown, p: string): WeeklySchedule {
  const s = obj(v, p, ['timeZone', 'windows', 'revision', 'updatedAt']);
  return {
    timeZone: str(s.timeZone, `${p}.timeZone`, 64),
    windows: arr(s.windows, `${p}.windows`, 28).map((w, i) => {
      const at = `${p}.windows[${i}]`;
      const x = obj(w, at, ['weekday', 'startMinute', 'endMinute', 'zoneId']);
      const startMinute = int(x.startMinute, `${at}.startMinute`, 0, 1439);
      const endMinute = int(x.endMinute, `${at}.endMinute`, 1, 1440);
      if (endMinute <= startMinute) throw new ShapeError(at);
      return {
        weekday: int(x.weekday, `${at}.weekday`, 1, 7),
        startMinute,
        endMinute,
        zoneId: uuid(x.zoneId, `${at}.zoneId`),
      };
    }),
    revision: int(s.revision, `${p}.revision`),
    updatedAt: ninstant(s.updatedAt, `${p}.updatedAt`),
  };
}

function parseException(v: unknown, p: string): AvailabilityException {
  const e = obj(v, p, ['exceptionId', 'startsAt', 'endsAt', 'reason', 'status', 'version']);
  return {
    exceptionId: uuid(e.exceptionId, `${p}.exceptionId`),
    startsAt: instant(e.startsAt, `${p}.startsAt`),
    endsAt: instant(e.endsAt, `${p}.endsAt`),
    reason: oneOf(e.reason, `${p}.reason`, EXCEPTION_REASONS),
    status: oneOf(e.status, `${p}.status`, ['ACTIVE', 'CANCELLED'] as const),
    version: int(e.version, `${p}.version`, 1),
  };
}

export function parseEquipment(v: unknown, p = 'equipment'): EquipmentView {
  const e = obj(v, p, ['kind', 'required', 'status', 'issue', 'revision', 'updatedAt']);
  const status = oneOf(e.status, `${p}.status`, EQUIPMENT_STATUSES);
  const issue = e.issue === null ? null : oneOf(e.issue, `${p}.issue`, EQUIPMENT_ISSUES);
  if ((status === 'READY') !== (issue === null)) throw new ShapeError(`${p}.issue`);
  return {
    kind: oneOf(e.kind, `${p}.kind`, EQUIPMENT_KINDS),
    required: bool(e.required, `${p}.required`),
    status,
    issue,
    revision: int(e.revision, `${p}.revision`, 1),
    updatedAt: instant(e.updatedAt, `${p}.updatedAt`),
  };
}

function parseSlot(v: unknown, p: string): ShiftSlot {
  const s = obj(v, p, ['shiftId', 'zoneId', 'startsAt', 'endsAt']);
  return {
    shiftId: uuid(s.shiftId, `${p}.shiftId`),
    zoneId: uuid(s.zoneId, `${p}.zoneId`),
    startsAt: instant(s.startsAt, `${p}.startsAt`),
    endsAt: instant(s.endsAt, `${p}.endsAt`),
  };
}

function parseLatestCase(v: unknown, p: string): ProfileView['verification']['latestCase'] {
  if (v === null) return null;
  const c = obj(v, p, ['caseId', 'status', 'submittedAt', 'decidedAt', 'decisionReason']);
  return {
    caseId: uuid(c.caseId, `${p}.caseId`),
    status: oneOf(c.status, `${p}.status`, [
      'PENDING_REVIEW',
      'APPROVED',
      'REJECTED',
      'WITHDRAWN',
    ] as const),
    submittedAt: instant(c.submittedAt, `${p}.submittedAt`),
    decidedAt: ninstant(c.decidedAt, `${p}.decidedAt`),
    decisionReason:
      c.decisionReason === null ? null : str(c.decisionReason, `${p}.decisionReason`, 40),
  };
}

export function parseProfile(v: unknown): ProfileView {
  const p = 'profile';
  const r = obj(v, p, [
    'operatorId',
    'displayName',
    'employmentStatus',
    'suspended',
    'verification',
    'skillCodes',
    'readiness',
    'availability',
    'serviceArea',
    'schedule',
    'upcomingShifts',
    'exceptions',
    'equipment',
    'version',
    'asOf',
  ]);
  const ver = obj(r.verification, `${p}.verification`, ['status', 'verifiedUntil', 'latestCase']);
  const readiness = obj(r.readiness, `${p}.readiness`, ['ready', 'reasons']);
  const reasons = arr(readiness.reasons, `${p}.readiness.reasons`, READINESS_REASONS.length).map(
    (reason, i) => oneOf(reason, `${p}.readiness.reasons[${i}]`, READINESS_REASONS),
  );
  const ready = bool(readiness.ready, `${p}.readiness.ready`);
  if (ready !== (reasons.length === 0)) throw new ShapeError(`${p}.readiness`);
  const area = obj(r.serviceArea, `${p}.serviceArea`, [
    'homeZoneId',
    'zoneIds',
    'revision',
    'updatedAt',
  ]);
  const homeZoneId = uuid(area.homeZoneId, `${p}.serviceArea.homeZoneId`);
  const zoneIds = arr(area.zoneIds, `${p}.serviceArea.zoneIds`, 20).map((z, i) =>
    uuid(z, `${p}.serviceArea.zoneIds[${i}]`),
  );
  if (!zoneIds.includes(homeZoneId)) throw new ShapeError(`${p}.serviceArea.zoneIds`);
  return {
    operatorId: uuid(r.operatorId, `${p}.operatorId`),
    displayName: str(r.displayName, `${p}.displayName`, 80),
    employmentStatus: oneOf(r.employmentStatus, `${p}.employmentStatus`, [
      'ACTIVE',
      'INACTIVE',
    ] as const),
    suspended: bool(r.suspended, `${p}.suspended`),
    verification: {
      status: oneOf(ver.status, `${p}.verification.status`, [
        'UNVERIFIED',
        'PENDING',
        'VERIFIED',
        'REJECTED',
      ] as const),
      verifiedUntil: ninstant(ver.verifiedUntil, `${p}.verification.verifiedUntil`),
      latestCase: parseLatestCase(ver.latestCase, `${p}.verification.latestCase`),
    },
    skillCodes: arr(r.skillCodes, `${p}.skillCodes`, 50).map((s, i) =>
      str(s, `${p}.skillCodes[${i}]`, 40),
    ),
    readiness: { ready, reasons },
    availability: parseAvailability(r.availability),
    serviceArea: {
      homeZoneId,
      zoneIds,
      revision: int(area.revision, `${p}.serviceArea.revision`),
      updatedAt: ninstant(area.updatedAt, `${p}.serviceArea.updatedAt`),
    },
    schedule: parseSchedule(r.schedule, `${p}.schedule`),
    upcomingShifts: arr(r.upcomingShifts, `${p}.upcomingShifts`, 500).map((s, i) =>
      parseSlot(s, `${p}.upcomingShifts[${i}]`),
    ),
    exceptions: arr(r.exceptions, `${p}.exceptions`, 100).map((e, i) =>
      parseException(e, `${p}.exceptions[${i}]`),
    ),
    equipment: arr(r.equipment, `${p}.equipment`, EQUIPMENT_KINDS.length).map((e, i) =>
      parseEquipment(e, `${p}.equipment[${i}]`),
    ),
    version: int(r.version, `${p}.version`, 1),
    asOf: instant(r.asOf, `${p}.asOf`),
  };
}

export const parseScheduleView = (v: unknown): WeeklySchedule => parseSchedule(v, 'schedule');
export const parseExceptionView = (v: unknown): AvailabilityException =>
  parseException(v, 'exception');

const SKIP_REASONS = ['PAST', 'EXCEPTION', 'OVERLAPS', 'ZONE_OUTSIDE_SERVICE_AREA'] as const;

export function parseScheduleApplication(v: unknown): ScheduleApplication {
  const a = obj(v, 'application', ['created', 'existing', 'skipped']);
  return {
    created: arr(a.created, 'application.created', 28).map((s, i) =>
      parseSlot(s, `application.created[${i}]`),
    ),
    existing: arr(a.existing, 'application.existing', 28).map((s, i) =>
      parseSlot(s, `application.existing[${i}]`),
    ),
    skipped: arr(a.skipped, 'application.skipped', 28).map((s, i) => {
      const at = `application.skipped[${i}]`;
      const x = obj(s, at, ['weekday', 'startMinute', 'zoneId', 'startsAt', 'endsAt', 'reason']);
      return {
        weekday: int(x.weekday, `${at}.weekday`, 1, 7),
        startMinute: int(x.startMinute, `${at}.startMinute`, 0, 1439),
        zoneId: uuid(x.zoneId, `${at}.zoneId`),
        startsAt: instant(x.startsAt, `${at}.startsAt`),
        endsAt: instant(x.endsAt, `${at}.endsAt`),
        reason: oneOf(x.reason, `${at}.reason`, SKIP_REASONS),
      };
    }),
  };
}

export function parseCustody(v: unknown): CustodyView {
  const c = obj(v, 'custody', ['holder', 'balances']);
  const balances = arr(c.balances, 'custody.balances', 2).map((b, i) => {
    const at = `custody.balances[${i}]`;
    const x = obj(b, at, [
      'currency',
      'ledgerCustody',
      'held',
      'heldCount',
      'inHandover',
      'inHandoverCount',
      'shortageOutstanding',
    ]);
    const currency = oneOf(x.currency, `${at}.currency`, ['SYP', 'USD'] as const);
    const money = (value: unknown, path: string): Money => {
      const parsed = parseMoney(value, path);
      if (parsed.currency !== currency) throw new ShapeError(path);
      return parsed;
    };
    return {
      currency,
      ledgerCustody: money(x.ledgerCustody, `${at}.ledgerCustody`),
      held: money(x.held, `${at}.held`),
      heldCount: int(x.heldCount, `${at}.heldCount`),
      inHandover: money(x.inHandover, `${at}.inHandover`),
      inHandoverCount: int(x.inHandoverCount, `${at}.inHandoverCount`),
      shortageOutstanding: money(x.shortageOutstanding, `${at}.shortageOutstanding`),
    };
  });
  if (new Set(balances.map((b) => b.currency)).size !== balances.length) {
    throw new ShapeError('custody.balances');
  }
  return { holder: uuid(c.holder, 'custody.holder'), balances };
}
