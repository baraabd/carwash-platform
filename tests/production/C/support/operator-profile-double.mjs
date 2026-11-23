/**
 * TEST FIXTURE DOUBLE — NOT A SERVICE. In-memory stand-in for the P05-C1
 * Workforce profile routes (requested, CR-P05-C1 §1) and the published Billing
 * `GET /custody/holders/me`, used by the operator-web browser suites. Shapes
 * and refusals follow the provider (services/workforce, P05-C1); the provider
 * itself is proven on real PostgreSQL by its own suites. Plugged into
 * operator-api-fixture.mjs.
 */
export const HOME_ZONE = '6a0e0000-0000-4000-8000-00000000d001';
export const EXTRA_ZONE = '6a0e0000-0000-4000-8000-00000000d002';
export const OPERATOR_ID = '0be7a702-0000-4000-8000-000000000001';
const KINDS = [
  'SERVICE_VEHICLE',
  'PRESSURE_WASHER',
  'WATER_SUPPLY',
  'POWER_SUPPLY',
  'VACUUM',
  'CLEANING_KIT',
];
const ISSUES = ['BREAKDOWN', 'MAINTENANCE', 'MISSING', 'SUPPLIES_EMPTY', 'OTHER'];
const REASONS = ['LEAVE', 'SICKNESS', 'EQUIPMENT', 'PERSONAL', 'OTHER'];
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DAY = 86_400_000;
/** The doubles place local windows at a fixed UTC+3 (Asia/Damascus has no DST since 2022). */
const OFFSET_MS = 3 * 3_600_000;

export function createProfileDouble({ clock, refuse, closedBody, uuidFrom, availability }) {
  const iso = () => clock().toISOString();
  const state = {};

  function reset() {
    const now = clock();
    state.employmentStatus = 'ACTIVE';
    state.suspended = false;
    state.version = 7;
    state.schedule = {
      timeZone: 'Asia/Damascus',
      windows: [
        { weekday: 6, startMinute: 480, endMinute: 960, zoneId: HOME_ZONE },
        { weekday: 1, startMinute: 480, endMinute: 960, zoneId: HOME_ZONE },
        { weekday: 3, startMinute: 600, endMinute: 1080, zoneId: HOME_ZONE },
      ],
      revision: 1,
      updatedAt: new Date(now.getTime() - 3 * DAY).toISOString(),
    };
    state.shifts = [];
    state.exceptions = [];
    state.equipment = [
      equipmentItem('SERVICE_VEHICLE', true, now),
      equipmentItem('PRESSURE_WASHER', true, now),
      equipmentItem('VACUUM', false, now),
    ];
    state.custody = {
      holder: '0be7a702-0000-4000-8000-0000000000aa',
      balances: [
        {
          currency: 'SYP',
          ledgerCustody: money('4500000'),
          held: money('3000000'),
          heldCount: 2,
          inHandover: money('1500000'),
          inHandoverCount: 1,
          shortageOutstanding: money('0'),
        },
      ],
    };
  }
  const money = (amountMinor) => ({ currency: 'SYP', amountMinor, scale: 2 });
  function equipmentItem(kind, required, now) {
    return {
      kind,
      required,
      status: 'READY',
      issue: null,
      revision: 1,
      updatedAt: new Date(now.getTime() - DAY).toISOString(),
    };
  }

  const blocked = () => state.equipment.some((e) => e.required && e.status === 'UNAVAILABLE');
  const canWork = () => state.employmentStatus === 'ACTIVE' && !state.suspended;
  function reasons() {
    const out = [];
    if (state.employmentStatus !== 'ACTIVE') out.push('EMPLOYMENT_INACTIVE');
    if (state.suspended) out.push('SUSPENDED');
    if (blocked()) out.push('EQUIPMENT_UNAVAILABLE');
    return out;
  }
  const exceptionView = (e) => ({
    exceptionId: e.exceptionId,
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    reason: e.reason,
    status: e.status,
    version: e.version,
  });

  function profile() {
    const now = clock();
    const horizon = now.getTime() + 14 * DAY;
    const r = reasons();
    return {
      operatorId: OPERATOR_ID,
      displayName: 'أحمد',
      employmentStatus: state.employmentStatus,
      suspended: state.suspended,
      verification: {
        status: 'VERIFIED',
        verifiedUntil: new Date(now.getTime() + 300 * DAY).toISOString(),
        latestCase: {
          caseId: '0be7a702-0000-4000-8000-0000000000cc',
          status: 'APPROVED',
          submittedAt: new Date(now.getTime() - 60 * DAY).toISOString(),
          decidedAt: new Date(now.getTime() - 59 * DAY).toISOString(),
          decisionReason: null,
        },
      },
      skillCodes: ['exterior-wash', 'interior-care'],
      readiness: { ready: r.length === 0, reasons: r },
      availability: structuredClone(availability()),
      serviceArea: {
        homeZoneId: HOME_ZONE,
        zoneIds: [HOME_ZONE, EXTRA_ZONE].sort(),
        revision: 1,
        updatedAt: new Date(now.getTime() - 30 * DAY).toISOString(),
      },
      schedule: structuredClone(state.schedule),
      upcomingShifts: state.shifts
        .filter((s) => Date.parse(s.endsAt) > now.getTime() && Date.parse(s.startsAt) < horizon)
        .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
        .map((s) => ({ ...s })),
      exceptions: state.exceptions
        .filter((e) => e.status === 'ACTIVE' && Date.parse(e.endsAt) > now.getTime())
        .map(exceptionView),
      equipment: structuredClone(state.equipment),
      version: state.version,
      asOf: iso(),
    };
  }

  const integer = (v, min, max) => Number.isSafeInteger(v) && v >= min && v <= max;

  /** Returns a route result, or null when the path is not a profile route. */
  function route(method, path, technician, body) {
    let m;
    if (path === '/internal/v1/billing/custody/holders/me' && method === 'GET') {
      if (!technician) refuse(403, 'AUTH_FORBIDDEN');
      return [200, structuredClone(state.custody)];
    }
    if (!path.startsWith('/internal/v1/workforce/')) return null;
    const rest = path.slice('/internal/v1/workforce'.length);
    const known =
      rest === '/me/profile' ||
      rest === '/me/schedule' ||
      rest === '/me/schedule/apply' ||
      rest === '/me/availability-exceptions' ||
      /^\/availability-exceptions\/[^/]+\/cancel$/.test(rest) ||
      /^\/me\/equipment\/[^/]+\/status$/.test(rest);
    if (!known) return null;
    if (!technician) refuse(404, 'NOT_FOUND', 'OPERATOR_NOT_FOUND');

    if (rest === '/me/profile' && method === 'GET') return [200, profile()];

    if (rest === '/me/schedule' && method === 'PUT') {
      closedBody(body, ['timeZone', 'windows', 'expectedRevision']);
      if (body.expectedRevision !== state.schedule.revision) {
        refuse(409, 'CONFLICT', 'REVISION_CONFLICT');
      }
      if (!Array.isArray(body.windows) || body.windows.length > 28) refuse(400, 'REQUEST_INVALID');
      const windows = body.windows.map((w) => {
        closedBody(w, ['weekday', 'startMinute', 'endMinute', 'zoneId']);
        if (
          !integer(w.weekday, 1, 7) ||
          !integer(w.startMinute, 0, 1439) ||
          !integer(w.endMinute, 1, 1440) ||
          w.endMinute - w.startMinute < 15
        ) {
          refuse(400, 'REQUEST_INVALID');
        }
        if (w.zoneId !== HOME_ZONE && w.zoneId !== EXTRA_ZONE) {
          refuse(409, 'CONFLICT', 'ZONE_OUTSIDE_SERVICE_AREA');
        }
        return { ...w };
      });
      windows.sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute);
      for (let i = 1; i < windows.length; i += 1) {
        if (
          windows[i].weekday === windows[i - 1].weekday &&
          windows[i].startMinute < windows[i - 1].endMinute
        ) {
          refuse(400, 'REQUEST_INVALID');
        }
      }
      state.schedule = {
        timeZone: body.timeZone,
        windows,
        revision: state.schedule.revision + 1,
        updatedAt: iso(),
      };
      return [200, structuredClone(state.schedule), true];
    }

    if (rest === '/me/schedule/apply' && method === 'POST') {
      closedBody(body, ['startDate', 'expectedRevision']);
      if (!canWork()) refuse(409, 'CONFLICT', 'OPERATOR_NOT_ACTIVE');
      if (body.expectedRevision !== state.schedule.revision) {
        refuse(409, 'CONFLICT', 'REVISION_CONFLICT');
      }
      const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(body.startDate));
      if (!dm) refuse(400, 'REQUEST_INVALID');
      const base = Date.UTC(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]));
      const result = { created: [], existing: [], skipped: [] };
      for (let i = 0; i < 7; i += 1) {
        const day = base + i * DAY;
        const jsDay = new Date(day).getUTCDay();
        const weekday = jsDay === 0 ? 7 : jsDay;
        for (const w of state.schedule.windows.filter((x) => x.weekday === weekday)) {
          const startsAt = new Date(day + w.startMinute * 60_000 - OFFSET_MS).toISOString();
          const endsAt = new Date(day + w.endMinute * 60_000 - OFFSET_MS).toISOString();
          const key = `${body.startDate}:${state.schedule.revision}:${weekday}:${w.startMinute}`;
          const slot = {
            shiftId: uuidFrom(`shift:${key}`),
            zoneId: w.zoneId,
            startsAt,
            endsAt,
          };
          const skipped = (reason) =>
            result.skipped.push({
              weekday,
              startMinute: w.startMinute,
              zoneId: w.zoneId,
              startsAt,
              endsAt,
              reason,
            });
          if (state.shifts.some((s) => s.shiftId === slot.shiftId)) result.existing.push(slot);
          else if (Date.parse(startsAt) <= clock().getTime()) skipped('PAST');
          else if (
            state.exceptions.some(
              (e) =>
                e.status === 'ACTIVE' &&
                Date.parse(e.startsAt) < Date.parse(endsAt) &&
                Date.parse(startsAt) < Date.parse(e.endsAt),
            )
          )
            skipped('EXCEPTION');
          else {
            state.shifts.push(slot);
            result.created.push(slot);
          }
        }
      }
      return [200, result, true];
    }

    if (rest === '/me/availability-exceptions' && method === 'POST') {
      closedBody(body, ['startsAt', 'endsAt', 'reason']);
      if (!UTC.test(String(body.startsAt)) || !UTC.test(String(body.endsAt))) {
        refuse(400, 'REQUEST_INVALID');
      }
      if (!REASONS.includes(body.reason)) refuse(400, 'REQUEST_INVALID');
      const start = Date.parse(body.startsAt);
      const end = Date.parse(body.endsAt);
      if (end <= start || end - start > 31 * DAY || start < clock().getTime() - 300_000) {
        refuse(400, 'REQUEST_INVALID');
      }
      if (
        state.exceptions.some(
          (e) =>
            e.status === 'ACTIVE' && Date.parse(e.startsAt) < end && start < Date.parse(e.endsAt),
        )
      ) {
        refuse(409, 'CONFLICT', 'EXCEPTION_OVERLAPS');
      }
      const exception = {
        exceptionId: uuidFrom(
          `exception:${body.startsAt}:${body.endsAt}:${state.exceptions.length}`,
        ),
        startsAt: body.startsAt,
        endsAt: body.endsAt,
        reason: body.reason,
        status: 'ACTIVE',
        version: 1,
      };
      state.exceptions.push(exception);
      return [201, exceptionView(exception), true];
    }

    if ((m = /^\/availability-exceptions\/([^/]+)\/cancel$/.exec(rest)) && method === 'POST') {
      closedBody(body ?? {}, []);
      const exception = state.exceptions.find((e) => e.exceptionId === m[1]);
      if (!exception) refuse(404, 'NOT_FOUND', 'EXCEPTION_NOT_FOUND');
      if (exception.status !== 'ACTIVE') refuse(409, 'CONFLICT', 'EXCEPTION_NOT_ACTIVE');
      exception.status = 'CANCELLED';
      exception.version += 1;
      return [200, exceptionView(exception), true];
    }

    if ((m = /^\/me\/equipment\/([^/]+)\/status$/.exec(rest)) && method === 'PUT') {
      if (!KINDS.includes(m[1])) refuse(400, 'REQUEST_INVALID');
      closedBody(body, ['status', 'issue', 'expectedRevision']);
      const item = state.equipment.find((e) => e.kind === m[1]);
      if (!item) refuse(404, 'NOT_FOUND', 'EQUIPMENT_NOT_FOUND');
      const ok =
        (body.status === 'READY' && body.issue === null) ||
        (['DEGRADED', 'UNAVAILABLE'].includes(body.status) && ISSUES.includes(body.issue));
      if (!ok) refuse(400, 'REQUEST_INVALID');
      if (body.expectedRevision !== item.revision) refuse(409, 'CONFLICT', 'REVISION_CONFLICT');
      if (item.status !== body.status || item.issue !== body.issue) {
        const before = blocked();
        item.status = body.status;
        item.issue = body.issue;
        item.revision += 1;
        item.updatedAt = iso();
        if (before !== blocked()) state.version += 1;
      }
      return [200, structuredClone(item), true];
    }
    refuse(405, 'REQUEST_INVALID');
    return null;
  }

  reset();
  return {
    state,
    reset,
    route,
    canWork,
    /** Test controls for OTHER actors (operations): suspension, equipment, exceptions. */
    control: {
      suspend(value = true) {
        state.suspended = value;
        state.version += 1;
      },
      setEquipment(kind, status, issue = status === 'READY' ? null : 'BREAKDOWN') {
        const item = state.equipment.find((e) => e.kind === kind);
        item.status = status;
        item.issue = issue;
        item.revision += 1;
        item.updatedAt = iso();
      },
      bumpSchedule() {
        state.schedule = {
          ...state.schedule,
          revision: state.schedule.revision + 1,
          updatedAt: iso(),
        };
      },
      shifts: () => structuredClone(state.shifts),
      exceptions: () => structuredClone(state.exceptions),
    },
  };
}
