import {
  CHECK_CODES,
  COLLECTION_OUTCOMES,
  NOTE_KINDS,
  OBJECT_STATUSES,
  OFFER_STATUSES,
  TASK_STAGES,
  type ApiErrorBody,
  type AvailabilityView,
  type BookingTechView,
  type CollectionView,
  type EvidenceLink,
  type JobsView,
  type Money,
  type ObjectView,
  type OfferView,
  type PresignedRead,
  type PresignedUpload,
  type ReservedObject,
  type SessionView,
  type TaskSummary,
  type TaskView,
} from './types';

/**
 * Closed response parsing: every object must carry exactly the documented
 * fields. An unknown or missing field is a contract violation and the
 * response is refused, never partially trusted.
 */
export class ShapeError extends Error {
  constructor(readonly path: string) {
    super(`UNEXPECTED_SHAPE:${path}`);
    this.name = 'ShapeError';
  }
}

type Rec = Record<string, unknown>;

function obj(value: unknown, path: string, keys: readonly string[]): Rec {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new ShapeError(path);
  const record = value as Rec;
  const actual = Object.keys(record);
  if (actual.length !== keys.length) throw new ShapeError(path);
  for (const key of actual) if (!keys.includes(key)) throw new ShapeError(`${path}.${key}`);
  return record;
}

const str = (v: unknown, p: string, max = 2000): string => {
  if (typeof v !== 'string' || v.length > max) throw new ShapeError(p);
  return v;
};
const id = (v: unknown, p: string): string => {
  const s = str(v, p, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(s)) throw new ShapeError(p);
  return s;
};
const nstr = (v: unknown, p: string, max = 2000): string | null =>
  v === null ? null : str(v, p, max);
const int = (v: unknown, p: string): number => {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) throw new ShapeError(p);
  return v;
};
const bool = (v: unknown, p: string): boolean => {
  if (typeof v !== 'boolean') throw new ShapeError(p);
  return v;
};
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
const instant = (v: unknown, p: string): string => {
  const s = str(v, p, 40);
  if (!ISO.test(s) || !Number.isFinite(Date.parse(s))) throw new ShapeError(p);
  return s;
};
const ninstant = (v: unknown, p: string): string | null => (v === null ? null : instant(v, p));
function oneOf<T extends string>(v: unknown, p: string, values: readonly T[]): T {
  if (typeof v !== 'string' || !(values as readonly string[]).includes(v)) throw new ShapeError(p);
  return v as T;
}
function arr(v: unknown, p: string, max = 500): unknown[] {
  if (!Array.isArray(v) || v.length > max) throw new ShapeError(p);
  return v;
}

export function parseMoney(v: unknown, p: string): Money {
  const m = obj(v, p, ['currency', 'amountMinor', 'scale']);
  const currency = oneOf(m.currency, `${p}.currency`, ['SYP', 'USD'] as const);
  const amountMinor = str(m.amountMinor, `${p}.amountMinor`, 20);
  if (!/^(0|-?[1-9][0-9]{0,17})$/.test(amountMinor)) throw new ShapeError(`${p}.amountMinor`);
  if (m.scale !== 2) throw new ShapeError(`${p}.scale`);
  return { currency, amountMinor, scale: 2 };
}
const nmoney = (v: unknown, p: string): Money | null => (v === null ? null : parseMoney(v, p));

export function parseSession(v: unknown): SessionView {
  const s = obj(v, 'session', [
    'subject',
    'sessionId',
    'authVersion',
    'principalKind',
    'roles',
    'permissions',
  ]);
  return {
    subject: id(s.subject, 'session.subject'),
    sessionId: id(s.sessionId, 'session.sessionId'),
    authVersion: int(s.authVersion, 'session.authVersion'),
    principalKind: oneOf(s.principalKind, 'session.principalKind', ['account', 'guest'] as const),
    roles: arr(s.roles, 'session.roles', 20).map((r, i) => str(r, `session.roles[${i}]`, 64)),
    permissions: arr(s.permissions, 'session.permissions', 64).map((r, i) =>
      str(r, `session.permissions[${i}]`, 64),
    ),
  };
}

export function parseAvailability(v: unknown): AvailabilityView {
  const a = obj(v, 'availability', ['status', 'revision', 'updatedAt']);
  return {
    status: oneOf(a.status, 'availability.status', ['AVAILABLE', 'ON_BREAK'] as const),
    revision: int(a.revision, 'availability.revision'),
    updatedAt: a.updatedAt === null ? null : instant(a.updatedAt, 'availability.updatedAt'),
  };
}

export function parseOffer(v: unknown, p = 'offer'): OfferView {
  const o = obj(v, p, ['offerId', 'revision', 'status', 'expiresAt', 'taskId', 'job']);
  const j = obj(o.job, `${p}.job`, [
    'assignmentId',
    'bookingId',
    'zoneId',
    'startsAt',
    'endsAt',
    'status',
  ]);
  return {
    offerId: id(o.offerId, `${p}.offerId`),
    revision: int(o.revision, `${p}.revision`),
    status: oneOf(o.status, `${p}.status`, OFFER_STATUSES),
    expiresAt: instant(o.expiresAt, `${p}.expiresAt`),
    taskId: o.taskId === null ? null : id(o.taskId, `${p}.taskId`),
    job: {
      assignmentId: id(j.assignmentId, `${p}.job.assignmentId`),
      bookingId: id(j.bookingId, `${p}.job.bookingId`),
      zoneId: id(j.zoneId, `${p}.job.zoneId`),
      startsAt: instant(j.startsAt, `${p}.job.startsAt`),
      endsAt: instant(j.endsAt, `${p}.job.endsAt`),
      status: oneOf(j.status, `${p}.job.status`, [
        'UNASSIGNED',
        'OFFERED',
        'ASSIGNED',
        'CANCELLED',
      ] as const),
    },
  };
}

function evidenceSlots(v: unknown, p: string): readonly [EvidenceLink | null, EvidenceLink | null] {
  const list = arr(v, p, 2);
  if (list.length !== 2) throw new ShapeError(p);
  const slot = (x: unknown, i: number): EvidenceLink | null => {
    if (x === null) return null;
    const e = obj(x, `${p}[${i}]`, ['mediaObjectId', 'attachedAt']);
    return {
      mediaObjectId: id(e.mediaObjectId, `${p}[${i}].mediaObjectId`),
      attachedAt: instant(e.attachedAt, `${p}[${i}].attachedAt`),
    };
  };
  return [slot(list[0], 0), slot(list[1], 1)];
}

function parseCollection(v: unknown, p: string): CollectionView | null {
  if (v === null) return null;
  const c = obj(v, p, [
    'outcome',
    'amount',
    'reason',
    'declaredAt',
    'lateAmount',
    'lateDeclaredAt',
  ]);
  return {
    outcome: oneOf(c.outcome, `${p}.outcome`, COLLECTION_OUTCOMES),
    amount: nmoney(c.amount, `${p}.amount`),
    reason: nstr(c.reason, `${p}.reason`, 500),
    declaredAt: instant(c.declaredAt, `${p}.declaredAt`),
    lateAmount: nmoney(c.lateAmount, `${p}.lateAmount`),
    lateDeclaredAt: ninstant(c.lateDeclaredAt, `${p}.lateDeclaredAt`),
  };
}

const TASK_KEYS = [
  'taskId',
  'revision',
  'stage',
  'assignmentId',
  'bookingId',
  'zoneId',
  'startsAt',
  'endsAt',
  'acceptedAt',
  'departedAt',
  'arrivedAt',
  'arrivalMethod',
  'startedAt',
  'documentedAt',
  'finishedAt',
  'closedAt',
  'conditionNote',
  'checklist',
  'evidence',
  'collection',
  'notes',
  'history',
  'releaseReason',
  // Provider additions in P03-C4 (#112): why a task ended and the eligibility flag.
  'endedAt',
  'endReason',
  'attentionReason',
] as const;

export function parseTask(v: unknown, p = 'task'): TaskView {
  const t = obj(v, p, TASK_KEYS);
  const checklist = obj(t.checklist, `${p}.checklist`, ['version', 'items']);
  const evidence = obj(t.evidence, `${p}.evidence`, ['BEFORE', 'AFTER']);
  const items = arr(checklist.items, `${p}.checklist.items`, 20).map((x, i) => {
    const item = obj(x, `${p}.checklist.items[${i}]`, ['code', 'required', 'checked']);
    return {
      code: oneOf(item.code, `${p}.checklist.items[${i}].code`, CHECK_CODES),
      required: bool(item.required, `${p}.checklist.items[${i}].required`),
      checked: bool(item.checked, `${p}.checklist.items[${i}].checked`),
    };
  });
  if (new Set(items.map((x) => x.code)).size !== items.length)
    throw new ShapeError(`${p}.checklist.items`);
  return {
    taskId: id(t.taskId, `${p}.taskId`),
    revision: int(t.revision, `${p}.revision`),
    stage: oneOf(t.stage, `${p}.stage`, TASK_STAGES),
    assignmentId: id(t.assignmentId, `${p}.assignmentId`),
    bookingId: id(t.bookingId, `${p}.bookingId`),
    zoneId: id(t.zoneId, `${p}.zoneId`),
    startsAt: instant(t.startsAt, `${p}.startsAt`),
    endsAt: instant(t.endsAt, `${p}.endsAt`),
    acceptedAt: instant(t.acceptedAt, `${p}.acceptedAt`),
    departedAt: ninstant(t.departedAt, `${p}.departedAt`),
    arrivedAt: ninstant(t.arrivedAt, `${p}.arrivedAt`),
    arrivalMethod:
      t.arrivalMethod === null
        ? null
        : oneOf(t.arrivalMethod, `${p}.arrivalMethod`, ['MANUAL_CONFIRMATION'] as const),
    startedAt: ninstant(t.startedAt, `${p}.startedAt`),
    documentedAt: ninstant(t.documentedAt, `${p}.documentedAt`),
    finishedAt: ninstant(t.finishedAt, `${p}.finishedAt`),
    closedAt: ninstant(t.closedAt, `${p}.closedAt`),
    conditionNote: nstr(t.conditionNote, `${p}.conditionNote`, 800),
    checklist: { version: str(checklist.version, `${p}.checklist.version`, 64), items },
    evidence: {
      BEFORE: evidenceSlots(evidence.BEFORE, `${p}.evidence.BEFORE`),
      AFTER: evidenceSlots(evidence.AFTER, `${p}.evidence.AFTER`),
    },
    collection: parseCollection(t.collection, `${p}.collection`),
    notes: arr(t.notes, `${p}.notes`, 200).map((x, i) => {
      const n = obj(x, `${p}.notes[${i}]`, ['noteId', 'kind', 'text', 'createdAt']);
      return {
        noteId: id(n.noteId, `${p}.notes[${i}].noteId`),
        kind: oneOf(n.kind, `${p}.notes[${i}].kind`, NOTE_KINDS),
        text: str(n.text, `${p}.notes[${i}].text`, 500),
        createdAt: instant(n.createdAt, `${p}.notes[${i}].createdAt`),
      };
    }),
    history: arr(t.history, `${p}.history`, 500).map((x, i) => {
      const h = obj(x, `${p}.history[${i}]`, ['at', 'action']);
      const action = str(h.action, `${p}.history[${i}].action`, 64);
      if (!/^[a-z][a-z0-9.-]{0,63}$/.test(action))
        throw new ShapeError(`${p}.history[${i}].action`);
      return { at: instant(h.at, `${p}.history[${i}].at`), action };
    }),
    releaseReason: nstr(t.releaseReason, `${p}.releaseReason`, 500),
    endedAt: ninstant(t.endedAt, `${p}.endedAt`),
    endReason: nstr(t.endReason, `${p}.endReason`, 64),
    attentionReason: nstr(t.attentionReason, `${p}.attentionReason`, 64),
  };
}

const SUMMARY_KEYS = [
  'taskId',
  'revision',
  'stage',
  'assignmentId',
  'bookingId',
  'acceptedAt',
  'closedAt',
  'endedAt',
  'endReason',
  'attentionReason',
  'collection',
  'updatedAt',
  'zoneId',
  'startsAt',
  'endsAt',
] as const;

export function parseTaskSummary(v: unknown, p = 'summary'): TaskSummary {
  const t = obj(v, p, SUMMARY_KEYS);
  return {
    taskId: id(t.taskId, `${p}.taskId`),
    revision: int(t.revision, `${p}.revision`),
    stage: oneOf(t.stage, `${p}.stage`, TASK_STAGES),
    assignmentId: id(t.assignmentId, `${p}.assignmentId`),
    bookingId: id(t.bookingId, `${p}.bookingId`),
    acceptedAt: instant(t.acceptedAt, `${p}.acceptedAt`),
    closedAt: ninstant(t.closedAt, `${p}.closedAt`),
    endedAt: ninstant(t.endedAt, `${p}.endedAt`),
    endReason: nstr(t.endReason, `${p}.endReason`, 64),
    attentionReason: nstr(t.attentionReason, `${p}.attentionReason`, 64),
    collection: parseCollection(t.collection, `${p}.collection`),
    updatedAt: instant(t.updatedAt, `${p}.updatedAt`),
    zoneId: id(t.zoneId, `${p}.zoneId`),
    startsAt: instant(t.startsAt, `${p}.startsAt`),
    endsAt: instant(t.endsAt, `${p}.endsAt`),
  };
}

export function parseJobs(v: unknown): JobsView {
  const j = obj(v, 'jobs', ['offers', 'tasks']);
  return {
    offers: arr(j.offers, 'jobs.offers', 200).map((x, i) => parseOffer(x, `jobs.offers[${i}]`)),
    tasks: arr(j.tasks, 'jobs.tasks', 200).map((x, i) => parseTaskSummary(x, `jobs.tasks[${i}]`)),
  };
}

export function parseBooking(v: unknown): BookingTechView {
  const b = obj(v, 'booking', [
    'bookingId',
    'revision',
    'status',
    'slot',
    'vehicle',
    'address',
    'contact',
    'lines',
    'total',
    'paymentMethod',
  ]);
  const slot = obj(b.slot, 'booking.slot', ['zoneId', 'startsAt', 'endsAt']);
  const vehicle = obj(b.vehicle, 'booking.vehicle', ['type', 'make', 'model', 'color', 'plate']);
  const address = obj(b.address, 'booking.address', ['location', 'details']);
  const contact = obj(b.contact, 'booking.contact', ['name', 'phone', 'notes']);
  const rawLocation = address.location as Rec | null;
  let location: BookingTechView['address']['location'];
  if (rawLocation && typeof rawLocation === 'object' && rawLocation.mode === 'manual') {
    const l = obj(rawLocation, 'booking.address.location', ['mode', 'description']);
    location = {
      mode: 'manual',
      description: str(l.description, 'booking.address.location.description', 500),
    };
  } else {
    const l = obj(rawLocation, 'booking.address.location', ['mode', 'point', 'description']);
    if (l.mode !== 'coordinates') throw new ShapeError('booking.address.location.mode');
    const point = obj(l.point, 'booking.address.location.point', ['latitude', 'longitude']);
    location = {
      mode: 'coordinates',
      point: {
        latitude: str(point.latitude, 'booking.address.location.point.latitude', 32),
        longitude: str(point.longitude, 'booking.address.location.point.longitude', 32),
      },
      description: nstr(l.description, 'booking.address.location.description', 500),
    };
  }
  let plate: BookingTechView['vehicle']['plate'] = null;
  if (vehicle.plate !== null) {
    const pl = obj(vehicle.plate, 'booking.vehicle.plate', ['text', 'region']);
    plate = {
      text: str(pl.text, 'booking.vehicle.plate.text', 32),
      region: nstr(pl.region, 'booking.vehicle.plate.region', 64),
    };
  }
  const total = parseMoney(b.total, 'booking.total');
  return {
    bookingId: id(b.bookingId, 'booking.bookingId'),
    revision: int(b.revision, 'booking.revision'),
    status: str(b.status, 'booking.status', 64),
    slot: {
      zoneId: id(slot.zoneId, 'booking.slot.zoneId'),
      startsAt: instant(slot.startsAt, 'booking.slot.startsAt'),
      endsAt: instant(slot.endsAt, 'booking.slot.endsAt'),
    },
    vehicle: {
      type: oneOf(vehicle.type, 'booking.vehicle.type', [
        'sedan',
        'suv',
        'large',
        'pickup',
      ] as const),
      make: nstr(vehicle.make, 'booking.vehicle.make', 80),
      model: nstr(vehicle.model, 'booking.vehicle.model', 80),
      color: nstr(vehicle.color, 'booking.vehicle.color', 80),
      plate,
    },
    address: { location, details: nstr(address.details, 'booking.address.details', 500) },
    contact: {
      name: str(contact.name, 'booking.contact.name', 120),
      phone: str(contact.phone, 'booking.contact.phone', 32),
      notes: nstr(contact.notes, 'booking.contact.notes', 500),
    },
    lines: arr(b.lines, 'booking.lines', 50).map((x, i) => {
      const l = obj(x, `booking.lines[${i}]`, [
        'lineId',
        'kind',
        'definitionId',
        'quantity',
        'amount',
      ]);
      return {
        lineId: id(l.lineId, `booking.lines[${i}].lineId`),
        kind: str(l.kind, `booking.lines[${i}].kind`, 40),
        definitionId:
          l.definitionId === null ? null : id(l.definitionId, `booking.lines[${i}].definitionId`),
        quantity: int(l.quantity, `booking.lines[${i}].quantity`),
        amount: parseMoney(l.amount, `booking.lines[${i}].amount`),
      };
    }),
    total,
    paymentMethod: oneOf(b.paymentMethod, 'booking.paymentMethod', [
      'CASH_ON_COMPLETION',
      'SHAM_CASH',
      'SYRIATEL_CASH',
    ] as const),
  };
}

const OBJECT_KEYS = [
  'objectId',
  'revision',
  'status',
  'purpose',
  'contentType',
  'byteLength',
  'sha256',
  'ownerSubjectId',
  'rejectReason',
  'claimed',
  'createdAt',
  'finalizedAt',
  'expiresAt',
] as const;

function objectFields(o: Rec, p: string): ObjectView {
  const sha256 = str(o.sha256, `${p}.sha256`, 64);
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new ShapeError(`${p}.sha256`);
  return {
    objectId: id(o.objectId, `${p}.objectId`),
    revision: int(o.revision, `${p}.revision`),
    status: oneOf(o.status, `${p}.status`, OBJECT_STATUSES),
    purpose: oneOf(o.purpose, `${p}.purpose`, ['WORK_EVIDENCE'] as const),
    contentType: oneOf(o.contentType, `${p}.contentType`, [
      'image/jpeg',
      'image/png',
      'image/webp',
    ] as const),
    byteLength: int(o.byteLength, `${p}.byteLength`),
    sha256,
    ownerSubjectId: id(o.ownerSubjectId, `${p}.ownerSubjectId`),
    rejectReason: nstr(o.rejectReason, `${p}.rejectReason`, 64),
    claimed: bool(o.claimed, `${p}.claimed`),
    createdAt: instant(o.createdAt, `${p}.createdAt`),
    finalizedAt: ninstant(o.finalizedAt, `${p}.finalizedAt`),
    expiresAt: ninstant(o.expiresAt, `${p}.expiresAt`),
  };
}

export function parseObject(v: unknown): ObjectView {
  return objectFields(obj(v, 'object', OBJECT_KEYS), 'object');
}

function parseUpload(v: unknown, p: string): PresignedUpload {
  const u = obj(v, p, ['method', 'url', 'headers', 'expiresAt']);
  const url = str(u.url, `${p}.url`, 4096);
  if (!/^https?:\/\//.test(url)) throw new ShapeError(`${p}.url`);
  const headersIn = u.headers;
  if (typeof headersIn !== 'object' || headersIn === null || Array.isArray(headersIn))
    throw new ShapeError(`${p}.headers`);
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(headersIn as Rec)) {
    if (!/^[a-z0-9-]{1,64}$/.test(key)) throw new ShapeError(`${p}.headers`);
    headers[key] = str(value, `${p}.headers.${key}`, 512);
  }
  return {
    method: oneOf(u.method, `${p}.method`, ['PUT'] as const),
    url,
    headers,
    expiresAt: instant(u.expiresAt, `${p}.expiresAt`),
  };
}

export function parseReserved(v: unknown): ReservedObject {
  const o = obj(v, 'reserved', [...OBJECT_KEYS, 'upload']);
  return { ...objectFields(o, 'reserved'), upload: parseUpload(o.upload, 'reserved.upload') };
}

export function parseReadUrl(v: unknown): PresignedRead {
  const r = obj(v, 'readUrl', ['method', 'url', 'headers', 'expiresAt']);
  // C2 returns the signed headers of every presigned request. An <img> cannot
  // send headers, so only a read URL that needs none is usable.
  obj(r.headers, 'readUrl.headers', []);
  const url = str(r.url, 'readUrl.url', 4096);
  if (!/^https?:\/\//.test(url)) throw new ShapeError('readUrl.url');
  return {
    method: oneOf(r.method, 'readUrl.method', ['GET'] as const),
    url,
    expiresAt: instant(r.expiresAt, 'readUrl.expiresAt'),
  };
}

/** The shared error envelope; anything else is treated as an opaque failure. */
export function parseError(v: unknown): ApiErrorBody | null {
  if (typeof v !== 'object' || v === null) return null;
  const e = (v as Rec).error;
  if (typeof e !== 'object' || e === null) return null;
  const r = e as Rec;
  if (typeof r.code !== 'string' || !/^[A-Z_]{1,64}$/.test(r.code)) return null;
  return {
    code: r.code,
    reason: typeof r.reason === 'string' && /^[A-Z_]{1,64}$/.test(r.reason) ? r.reason : null,
    retryable: r.retryable === true,
  };
}
