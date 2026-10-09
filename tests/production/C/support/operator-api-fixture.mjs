/**
 * TEST FIXTURE DOUBLES — NOT PRODUCTION SERVICES.
 *
 * In-memory doubles of the upstream endpoints operator-web consumes through
 * the requested gateway routes (docs/production/C/P03-C-interfaces.md):
 *   identity  GET  /internal/v1/identity/session
 *   workforce GET/PUT /internal/v1/workforce/me/availability            (C1)
 *   media     /internal/v1/media/uploads, /objects/:id/{upload-url,finalize,read-url} (C2)
 *   booking   GET  /internal/v1/booking/bookings/:id/technician-view     (C3)
 *   dispatch  GET  /internal/v1/dispatch/me/jobs, /me/tasks/:id; offer and task routes (C4)
 * plus a presigned object store on a SEPARATE origin.
 *
 * Shapes follow the interface file; where it is silent (the /me/jobs envelope,
 * task mutation responses, read-url body, history action vocabulary) the
 * ASSUMED shapes of apps/operator-web/src/api/types.ts are used and are listed
 * in docs/production/C/contract-requests/CR-P03-C5-operator-gateway.md.
 * Seeds mirror the approved technician reference (cash, pending ShamCash and
 * Syriatel scenarios) so reference and candidate can be compared. They are
 * fixtures, labelled as such, and prove nothing about the real services.
 */
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

export const FIXTURE_LABEL = 'operator-api-fixture (test double, not a service)';
export const TECHNICIAN_TOKEN = 'fixture-technician-token';
export const OTHER_TOKEN = 'fixture-customer-token';
export const TECHNICIAN_SUBJECT = 'f3b0c0de-0000-4000-8000-000000000001';
const CUSTOMER_SUBJECT = 'c0570e40-0000-4000-8000-000000000002';

const money = (amountMinor) => ({ currency: 'SYP', amountMinor: String(amountMinor), scale: 2 });

/** The three reference seeds (WG-2041 cash, WG-2042 ShamCash pending, WG-2043 Syriatel). */
export const SEEDS = Object.freeze([
  {
    key: 'WG-2041',
    bookingId: '20410000-0000-4000-8000-000000002041',
    time: '06:30',
    minutes: 70,
    vehicle: {
      type: 'sedan',
      make: 'تويوتا',
      model: 'كورولا',
      color: 'أبيض',
      plate: { text: '128450', region: null },
    },
    address: {
      location: { mode: 'manual', description: 'المزة' },
      details: 'دمشق · المزة · عنوان عرض رقم 12',
    },
    contact: {
      name: 'سامر · عميل تجريبي',
      phone: '+963900000001',
      notes: 'السيارة عند المدخل الجانبي. يرجى التواصل عند الوصول.',
    },
    lines: [
      { kind: 'PACKAGE', amount: 90000 },
      { kind: 'EXTRA', amount: 15000 },
    ],
    total: 105000,
    paymentMethod: 'CASH_ON_COMPLETION',
  },
  {
    key: 'WG-2042',
    bookingId: '20420000-0000-4000-8000-000000002042',
    time: '08:30',
    minutes: 80,
    vehicle: {
      type: 'suv',
      make: 'هيونداي',
      model: 'توسان',
      color: 'رمادي',
      plate: { text: '245670', region: null },
    },
    address: {
      location: { mode: 'manual', description: 'كفرسوسة' },
      details: 'دمشق · كفرسوسة · عنوان عرض رقم 8',
    },
    contact: {
      name: 'ريم · عميلة تجريبية',
      phone: '+963900000002',
      notes: 'الموقف المخصص بجانب بوابة المبنى. بيانات المكان للتوضيح.',
    },
    lines: [{ kind: 'PACKAGE', amount: 130000 }],
    total: 130000,
    paymentMethod: 'SHAM_CASH',
  },
  {
    key: 'WG-2043',
    bookingId: '20430000-0000-4000-8000-000000002043',
    time: '11:00',
    minutes: 35,
    vehicle: {
      type: 'sedan',
      make: 'كيا',
      model: 'سيراتو',
      color: 'فضي',
      plate: { text: '367810', region: null },
    },
    address: {
      location: { mode: 'manual', description: 'المالكي' },
      details: 'دمشق · المالكي · عنوان عرض رقم 5',
    },
    contact: {
      name: 'عمر · عميل تجريبي',
      phone: '+963900000003',
      notes: 'غسيل خارجي فقط؛ لا توجد حاجة إلى دخول المقصورة.',
    },
    lines: [{ kind: 'PACKAGE', amount: 65000 }],
    total: 65000,
    paymentMethod: 'SYRIATEL_CASH',
  },
]);

export const CHECK_CODES = ['exterior', 'wheels', 'interior', 'quality'];
const ACTIVE = ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_SERVICE', 'DOCUMENTING', 'FINISHED'];
const BUSY = ['EN_ROUTE', 'ARRIVED', 'IN_SERVICE', 'DOCUMENTING', 'FINISHED'];

/** Copy of a record without internal fields. */
const omit = (record, keys) =>
  Object.fromEntries(Object.entries(record).filter(([k]) => !keys.includes(k)));

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const uuidFrom = (text) => {
  const h = sha256(text);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

function envelope(code, reason = null, retryable = false) {
  return {
    error: {
      code,
      reason,
      message: 'fixture',
      requestId: randomUUID(),
      correlationId: randomUUID(),
      retryable,
      retryAfterMs: null,
      issues: [],
    },
  };
}

class Refusal extends Error {
  constructor(status, code, reason = null) {
    super(code);
    this.status = status;
    this.code = code;
    this.reason = reason;
  }
}
const refuse = (status, code, reason = null) => {
  throw new Refusal(status, code, reason);
};

function closedBody(body, allowed, required = allowed) {
  if (typeof body !== 'object' || body === null || Array.isArray(body))
    refuse(400, 'REQUEST_INVALID');
  for (const key of Object.keys(body))
    if (!allowed.includes(key)) refuse(400, 'REQUEST_INVALID', null);
  for (const key of required) if (!(key in body)) refuse(400, 'REQUEST_INVALID', null);
  return body;
}

function isMoney(value) {
  return (
    value &&
    typeof value === 'object' &&
    Object.keys(value).sort().join() === 'amountMinor,currency,scale' &&
    value.currency === 'SYP' &&
    value.scale === 2 &&
    /^(0|[1-9][0-9]{0,17})$/.test(value.amountMinor)
  );
}

function magicOk(bytes, contentType) {
  if (contentType === 'image/jpeg')
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (contentType === 'image/png')
    return bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  if (contentType === 'image/webp')
    return (
      bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP'
    );
  return false;
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}

/**
 * Start the fixture. `clock()` drives every server timestamp; `day` (UTC
 * YYYY-MM-DD) places the seed slots. `exposeOfferBooking` is a NON-DEFAULT,
 * CR-requested behaviour (Booking view for a live offer) used only to show
 * render parity of the assigned stage; the default follows C3 (404).
 */
export async function startOperatorFixture({
  clock = () => new Date(),
  day = null,
  exposeOfferBooking: exposeInitially = false,
} = {}) {
  let exposeOfferBooking = exposeInitially;
  const iso = () => clock().toISOString();
  const baseDay = day ?? iso().slice(0, 10);
  const requests = [];
  const effects = [];
  const idempotency = new Map();
  const objects = new Map();
  const stored = new Map();
  const state = {
    availability: { status: 'AVAILABLE', revision: 1, updatedAt: iso() },
    bookings: new Map(),
    offers: new Map(),
    tasks: new Map(),
    assignments: new Map(),
  };
  let storeOrigin = '';
  let allowedOrigins = [];

  function seedBookings() {
    for (const seed of SEEDS) {
      const startsAt = new Date(`${baseDay}T${seed.time}:00.000Z`);
      const endsAt = new Date(startsAt.getTime() + seed.minutes * 60_000);
      state.bookings.set(seed.bookingId, {
        bookingId: seed.bookingId,
        revision: 3,
        status: 'CONFIRMED',
        slot: {
          zoneId: 'zone-damascus-1',
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
        },
        vehicle: structuredClone(seed.vehicle),
        address: structuredClone(seed.address),
        contact: structuredClone(seed.contact),
        lines: seed.lines.map((line, index) => ({
          lineId: uuidFrom(`${seed.bookingId}:line:${index}`),
          kind: line.kind,
          definitionId: uuidFrom(`${seed.bookingId}:def:${index}`),
          quantity: 1,
          amount: money(line.amount),
        })),
        total: money(seed.total),
        paymentMethod: seed.paymentMethod,
      });
      state.assignments.set(seed.bookingId, {
        assignmentId: uuidFrom(`${seed.bookingId}:assignment`),
        status: 'OFFERED',
        technician: TECHNICIAN_SUBJECT,
      });
    }
  }

  function newTask(seedBookingId, at) {
    const booking = state.bookings.get(seedBookingId);
    const assignment = state.assignments.get(seedBookingId);
    return {
      taskId: uuidFrom(`${seedBookingId}:task:${state.tasks.size}:${at}`),
      revision: 1,
      stage: 'ACCEPTED',
      assignmentId: assignment.assignmentId,
      bookingId: seedBookingId,
      zoneId: booking.slot.zoneId,
      startsAt: booking.slot.startsAt,
      endsAt: booking.slot.endsAt,
      acceptedAt: at,
      departedAt: null,
      arrivedAt: null,
      arrivalMethod: null,
      startedAt: null,
      documentedAt: null,
      finishedAt: null,
      closedAt: null,
      conditionNote: null,
      checklist: {
        version: 'washgo.checklist.v1',
        items: CHECK_CODES.map((code) => ({ code, required: true, checked: false })),
      },
      evidence: { BEFORE: [null, null], AFTER: [null, null] },
      collection: null,
      notes: [],
      history: [{ at, action: 'accepted' }],
      releaseReason: null,
      owner: TECHNICIAN_SUBJECT,
      updatedAt: at,
    };
  }

  function offerFor(bookingId) {
    const booking = state.bookings.get(bookingId);
    const assignment = state.assignments.get(bookingId);
    return {
      offerId: uuidFrom(`${bookingId}:offer:${state.offers.size}`),
      revision: 1,
      status: 'OFFERED',
      expiresAt: new Date(Date.parse(booking.slot.startsAt) + 86_400_000).toISOString(),
      taskId: null,
      job: {
        assignmentId: assignment.assignmentId,
        bookingId,
        zoneId: booking.slot.zoneId,
        startsAt: booking.slot.startsAt,
        endsAt: booking.slot.endsAt,
        status: 'OFFERED',
      },
      owner: TECHNICIAN_SUBJECT,
    };
  }

  function reset() {
    state.bookings.clear();
    state.offers.clear();
    state.tasks.clear();
    state.assignments.clear();
    objects.clear();
    stored.clear();
    idempotency.clear();
    requests.length = 0;
    effects.length = 0;
    state.availability = { status: 'AVAILABLE', revision: 1, updatedAt: iso() };
    seedBookings();
    for (const seed of SEEDS) {
      const offer = offerFor(seed.bookingId);
      state.offers.set(offer.offerId, offer);
    }
  }
  reset();

  const publicTask = (task) => {
    return structuredClone(omit(task, ['owner', 'updatedAt']));
  };
  /** Provider fact (P03-C4): /me/jobs lists task summaries, details come from /me/tasks/:id. */
  const summaryOf = (task) => ({
    taskId: task.taskId,
    revision: task.revision,
    stage: task.stage,
    assignmentId: task.assignmentId,
    bookingId: task.bookingId,
    acceptedAt: task.acceptedAt,
    closedAt: task.closedAt,
    endedAt: ['CLOSED', 'RELEASED', 'WITHDRAWN', 'CANCELLED'].includes(task.stage)
      ? (task.closedAt ?? task.updatedAt)
      : null,
    endReason: task.stage === 'RELEASED' ? 'RELEASED_BY_TECHNICIAN' : null,
    attentionReason: null,
    collection: structuredClone(task.collection),
    updatedAt: task.updatedAt,
    zoneId: task.zoneId,
    startsAt: task.startsAt,
    endsAt: task.endsAt,
  });
  const publicOffer = (offer) => {
    return structuredClone(omit(offer, ['owner', 'declineNote']));
  };
  const objectView = (o) => {
    return structuredClone(omit(o, ['tokens']));
  };
  const bump = (task) => {
    task.revision += 1;
    task.updatedAt = iso();
  };

  function taskOf(id, subject) {
    const task = state.tasks.get(id);
    if (!task || task.owner !== subject) refuse(404, 'NOT_FOUND', 'TASK_NOT_FOUND');
    if (['WITHDRAWN', 'CANCELLED'].includes(task.stage)) refuse(409, 'CONFLICT', 'TASK_CLOSED');
    return task;
  }
  function fence(task, body) {
    if (!Number.isSafeInteger(body.expectedRevision)) refuse(400, 'REQUEST_INVALID');
    if (body.expectedRevision !== task.revision) refuse(412, 'REVISION_CONFLICT');
  }
  function stageIs(task, ...stages) {
    if (!stages.includes(task.stage)) refuse(409, 'CONFLICT', 'TASK_STAGE_INVALID');
  }
  function presign(objectId, method, ttlMs) {
    const expiresAt = new Date(clock().getTime() + ttlMs).toISOString();
    const token = sha256(`${objectId}:${method}:${expiresAt}:${randomUUID()}`).slice(0, 32);
    const object = objects.get(objectId);
    object.tokens = object.tokens ?? new Map();
    object.tokens.set(token, { method, expiresAt });
    return { url: `${storeOrigin}/objects/${objectId}?token=${token}`, expiresAt };
  }
  function uploadTicket(object) {
    const { url, expiresAt } = presign(object.objectId, 'PUT', 900_000);
    return {
      method: 'PUT',
      url,
      headers: {
        'content-type': object.contentType,
        'x-amz-checksum-sha256': Buffer.from(object.sha256, 'hex').toString('base64'),
      },
      expiresAt,
    };
  }

  /** Dispatch + booking + workforce + identity + media routes. */
  async function route(method, path, subject, body) {
    let m;
    // identity
    if (method === 'GET' && path === '/internal/v1/identity/session') {
      return [
        200,
        {
          subject,
          sessionId: uuidFrom(`${subject}:session`),
          authVersion: 1,
          principalKind: 'account',
          roles: subject === TECHNICIAN_SUBJECT ? ['technician'] : ['customer'],
          permissions:
            subject === TECHNICIAN_SUBJECT
              ? ['work.read:assigned', 'work.execute:assigned']
              : ['profile.read:self', 'bookings.read:self'],
        },
      ];
    }
    const technician = subject === TECHNICIAN_SUBJECT;
    // workforce C1
    if (path === '/internal/v1/workforce/me/availability') {
      if (!technician) refuse(404, 'NOT_FOUND', 'OPERATOR_NOT_FOUND');
      if (method === 'GET') return [200, structuredClone(state.availability)];
      if (method === 'PUT') {
        closedBody(body, ['status', 'expectedRevision']);
        if (!['AVAILABLE', 'ON_BREAK'].includes(body.status)) refuse(400, 'REQUEST_INVALID');
        if (body.expectedRevision !== state.availability.revision)
          refuse(409, 'CONFLICT', 'REVISION_CONFLICT');
        state.availability = {
          status: body.status,
          revision: state.availability.revision + 1,
          updatedAt: iso(),
        };
        return [200, structuredClone(state.availability), true];
      }
    }
    // booking C3
    if (
      method === 'GET' &&
      (m = /^\/internal\/v1\/booking\/bookings\/([^/]+)\/technician-view$/.exec(path))
    ) {
      const booking = state.bookings.get(m[1]);
      const assignment = state.assignments.get(m[1]);
      const visible =
        booking &&
        assignment &&
        assignment.technician === subject &&
        (assignment.status === 'ASSIGNED' ||
          (exposeOfferBooking && assignment.status === 'OFFERED'));
      if (!visible) refuse(404, 'NOT_FOUND', 'BOOKING_NOT_FOUND');
      return [200, structuredClone(booking)];
    }
    if (!technician) refuse(403, 'AUTH_FORBIDDEN');
    // dispatch C4 reads
    if (method === 'GET' && path === '/internal/v1/dispatch/me/jobs') {
      const horizon = clock().getTime() - 7 * 86_400_000;
      return [
        200,
        {
          offers: [...state.offers.values()]
            .filter((o) => o.owner === subject && o.status === 'OFFERED')
            .map(publicOffer),
          tasks: [...state.tasks.values()]
            .filter(
              (t) =>
                t.owner === subject &&
                (ACTIVE.includes(t.stage) ||
                  (['CLOSED', 'RELEASED'].includes(t.stage) &&
                    Date.parse(t.closedAt ?? t.history.at(-1)?.at ?? iso()) >= horizon)),
            )
            .map(summaryOf),
        },
      ];
    }
    if (method === 'GET' && (m = /^\/internal\/v1\/dispatch\/me\/tasks\/([^/]+)$/.exec(path))) {
      return [200, publicTask(taskOf(m[1], subject))];
    }
    // dispatch offers
    if (
      method === 'POST' &&
      (m = /^\/internal\/v1\/dispatch\/offers\/([^/]+)\/(accept|decline)$/.exec(path))
    ) {
      const offer = state.offers.get(m[1]);
      if (!offer || offer.owner !== subject) refuse(404, 'NOT_FOUND', 'OFFER_NOT_FOUND');
      if (offer.status !== 'OFFERED') refuse(409, 'CONFLICT', 'OFFER_NOT_LIVE');
      const at = iso();
      if (m[2] === 'accept') {
        closedBody(body ?? {}, []);
        if (state.availability.status !== 'AVAILABLE')
          refuse(422, 'BUSINESS_RULE_VIOLATION', 'RESOURCE_INELIGIBLE');
        offer.status = 'ACCEPTED';
        offer.revision += 1;
        offer.job.status = 'ASSIGNED';
        state.assignments.get(offer.job.bookingId).status = 'ASSIGNED';
        const task = newTask(offer.job.bookingId, at);
        state.tasks.set(task.taskId, task);
        offer.taskId = task.taskId;
      } else {
        closedBody(body, ['reason', 'note'], ['reason']);
        if (!['UNAVAILABLE', 'TOO_FAR', 'OTHER'].includes(body.reason))
          refuse(400, 'REQUEST_INVALID');
        if (
          body.note !== undefined &&
          (typeof body.note !== 'string' || body.note.length < 3 || body.note.length > 500)
        ) {
          refuse(400, 'REQUEST_INVALID');
        }
        offer.status = 'DECLINED';
        offer.revision += 1;
        offer.declineNote = body.note ?? null;
        offer.job.status = 'UNASSIGNED';
        state.assignments.get(offer.job.bookingId).status = 'UNASSIGNED';
      }
      return [200, publicOffer(offer), true];
    }
    // dispatch task mutations
    if ((m = /^\/internal\/v1\/dispatch\/tasks\/([^/]+)\/(.+)$/.exec(path))) {
      const task = taskOf(m[1], subject);
      const op = m[2];
      const at = iso();
      let e;
      if (method === 'POST' && op === 'notes') {
        closedBody(body, ['kind', 'text']);
        if (!['HELP', 'CASH_ISSUE', 'PAYMENT_FOLLOW_UP'].includes(body.kind))
          refuse(400, 'REQUEST_INVALID');
        if (typeof body.text !== 'string' || body.text.trim().length < 3 || body.text.length > 500)
          refuse(400, 'REQUEST_INVALID');
        const terminal = ['CLOSED', 'RELEASED', 'WITHDRAWN', 'CANCELLED'].includes(task.stage);
        if (terminal && !(task.stage === 'CLOSED' && body.kind !== 'HELP'))
          refuse(409, 'CONFLICT', 'TASK_STAGE_INVALID');
        task.notes.push({ noteId: randomUUID(), kind: body.kind, text: body.text, createdAt: at });
        task.history.push({ at, action: `note.${body.kind.toLowerCase().replaceAll('_', '-')}` });
      } else if (method === 'POST' && op === 'depart') {
        closedBody(body, ['expectedRevision']);
        fence(task, body);
        stageIs(task, 'ACCEPTED');
        const other = [...state.tasks.values()].find(
          (t) => t !== task && t.owner === subject && BUSY.includes(t.stage),
        );
        if (other) refuse(409, 'CONFLICT', 'TECHNICIAN_BUSY');
        Object.assign(task, { stage: 'EN_ROUTE', departedAt: at });
        task.history.push({ at, action: 'departed' });
      } else if (method === 'POST' && op === 'arrive') {
        closedBody(body, ['expectedRevision']);
        fence(task, body);
        stageIs(task, 'EN_ROUTE');
        Object.assign(task, {
          stage: 'ARRIVED',
          arrivedAt: at,
          arrivalMethod: 'MANUAL_CONFIRMATION',
        });
        task.history.push({ at, action: 'arrived' });
      } else if (
        (e = /^evidence\/(BEFORE|AFTER)\/([01])$/.exec(op)) &&
        (method === 'PUT' || method === 'DELETE')
      ) {
        const phase = e[1];
        const slot = Number(e[2]);
        closedBody(
          body,
          method === 'PUT' ? ['expectedRevision', 'mediaObjectId'] : ['expectedRevision'],
        );
        fence(task, body);
        stageIs(task, phase === 'BEFORE' ? 'ARRIVED' : 'DOCUMENTING');
        if (method === 'PUT') {
          const object = objects.get(body.mediaObjectId);
          if (
            !object ||
            object.ownerSubjectId !== subject ||
            object.status !== 'AVAILABLE' ||
            object.purpose !== 'WORK_EVIDENCE'
          ) {
            refuse(422, 'BUSINESS_RULE_VIOLATION', 'EVIDENCE_INVALID');
          }
          object.claimed = true;
          task.evidence[phase][slot] = { mediaObjectId: object.objectId, attachedAt: at };
          task.history.push({ at, action: `evidence.${phase.toLowerCase()}.attached` });
        } else {
          task.evidence[phase][slot] = null;
          task.history.push({ at, action: `evidence.${phase.toLowerCase()}.removed` });
        }
      } else if (method === 'PUT' && op === 'condition-note') {
        closedBody(body, ['expectedRevision', 'text']);
        fence(task, body);
        stageIs(task, 'ARRIVED', 'IN_SERVICE');
        if (typeof body.text !== 'string' || body.text.length > 800) refuse(400, 'REQUEST_INVALID');
        task.conditionNote = body.text === '' ? null : body.text;
      } else if (method === 'POST' && op === 'start') {
        closedBody(body, ['expectedRevision']);
        fence(task, body);
        stageIs(task, 'ARRIVED');
        if (!task.evidence.BEFORE.some(Boolean))
          refuse(422, 'BUSINESS_RULE_VIOLATION', 'EVIDENCE_REQUIRED');
        Object.assign(task, { stage: 'IN_SERVICE', startedAt: at });
        task.history.push({ at, action: 'started' });
      } else if (method === 'PUT' && (e = /^checklist\/([a-z]+)$/.exec(op))) {
        closedBody(body, ['expectedRevision', 'checked']);
        fence(task, body);
        stageIs(task, 'IN_SERVICE');
        const item = task.checklist.items.find((x) => x.code === e[1]);
        if (!item || typeof body.checked !== 'boolean') refuse(400, 'REQUEST_INVALID');
        item.checked = body.checked;
        if (body.checked) task.history.push({ at, action: 'check.done' });
      } else if (method === 'POST' && op === 'document') {
        closedBody(body, ['expectedRevision']);
        fence(task, body);
        stageIs(task, 'IN_SERVICE');
        if (task.checklist.items.some((x) => x.required && !x.checked))
          refuse(422, 'BUSINESS_RULE_VIOLATION', 'CHECKLIST_INCOMPLETE');
        Object.assign(task, { stage: 'DOCUMENTING', documentedAt: at });
        task.history.push({ at, action: 'documented' });
      } else if (method === 'POST' && op === 'finish') {
        closedBody(body, ['expectedRevision']);
        fence(task, body);
        stageIs(task, 'DOCUMENTING');
        if (!task.evidence.AFTER.some(Boolean))
          refuse(422, 'BUSINESS_RULE_VIOLATION', 'EVIDENCE_REQUIRED');
        Object.assign(task, { stage: 'FINISHED', finishedAt: at });
        task.history.push({ at, action: 'finished' });
      } else if (method === 'POST' && op === 'close') {
        closedBody(body, ['expectedRevision', 'collection']);
        fence(task, body);
        stageIs(task, 'FINISHED');
        const c = body.collection;
        let collection;
        if (c?.outcome === 'CASH_COLLECTED') {
          closedBody(c, ['outcome', 'amount']);
          if (!isMoney(c.amount)) refuse(400, 'REQUEST_INVALID');
          collection = { outcome: c.outcome, amount: structuredClone(c.amount), reason: null };
        } else if (c?.outcome === 'CASH_NOT_COLLECTED') {
          closedBody(c, ['outcome', 'reason']);
          if (typeof c.reason !== 'string' || c.reason.trim().length < 3 || c.reason.length > 500)
            refuse(400, 'REQUEST_INVALID');
          collection = { outcome: c.outcome, amount: null, reason: c.reason };
        } else if (c?.outcome === 'NOT_CASH') {
          closedBody(c, ['outcome']);
          collection = { outcome: c.outcome, amount: null, reason: null };
        } else refuse(400, 'REQUEST_INVALID');
        task.collection = { ...collection, declaredAt: at, lateAmount: null, lateDeclaredAt: null };
        Object.assign(task, { stage: 'CLOSED', closedAt: at });
        task.history.push({ at, action: 'closed' });
      } else if (method === 'POST' && op === 'cash-collection') {
        closedBody(body, ['expectedRevision', 'amount']);
        fence(task, body);
        stageIs(task, 'CLOSED');
        if (task.collection?.outcome !== 'CASH_NOT_COLLECTED' || task.collection.lateAmount) {
          refuse(409, 'CONFLICT', 'COLLECTION_NOT_OPEN');
        }
        if (!isMoney(body.amount)) refuse(400, 'REQUEST_INVALID');
        task.collection.lateAmount = structuredClone(body.amount);
        task.collection.lateDeclaredAt = at;
        task.history.push({ at, action: 'cash.late-declared' });
      } else if (method === 'POST' && op === 'release') {
        closedBody(body, ['expectedRevision', 'reason']);
        fence(task, body);
        stageIs(task, 'ACCEPTED');
        if (
          typeof body.reason !== 'string' ||
          body.reason.trim().length < 3 ||
          body.reason.length > 500
        )
          refuse(400, 'REQUEST_INVALID');
        Object.assign(task, { stage: 'RELEASED', releaseReason: body.reason, closedAt: at });
        state.assignments.get(task.bookingId).status = 'UNASSIGNED';
        task.history.push({ at, action: 'released' });
      } else {
        refuse(404, 'NOT_FOUND');
      }
      bump(task);
      return [200, publicTask(task), true];
    }
    // media C2
    if (method === 'POST' && path === '/internal/v1/media/uploads') {
      closedBody(body, ['purpose', 'contentType', 'byteLength', 'sha256']);
      if (body.purpose !== 'WORK_EVIDENCE') refuse(400, 'REQUEST_INVALID');
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(body.contentType))
        refuse(415, 'REQUEST_INVALID', 'UNSUPPORTED_MEDIA');
      if (
        !Number.isSafeInteger(body.byteLength) ||
        body.byteLength < 20 ||
        body.byteLength > 10485760
      )
        refuse(400, 'REQUEST_INVALID');
      if (typeof body.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(body.sha256))
        refuse(400, 'REQUEST_INVALID');
      const objectId = randomUUID();
      const object = {
        objectId,
        revision: 1,
        status: 'RESERVED',
        purpose: 'WORK_EVIDENCE',
        contentType: body.contentType,
        byteLength: body.byteLength,
        sha256: body.sha256,
        ownerSubjectId: subject,
        rejectReason: null,
        claimed: false,
        createdAt: iso(),
        finalizedAt: null,
        expiresAt: new Date(clock().getTime() + 3_600_000).toISOString(),
      };
      objects.set(objectId, object);
      return [
        201,
        { ...structuredClone(omit(object, ['tokens'])), upload: uploadTicket(object) },
        true,
      ];
    }
    if (
      method === 'POST' &&
      (m = /^\/internal\/v1\/media\/objects\/([^/]+)\/(upload-url|finalize|read-url)$/.exec(path))
    ) {
      const object = objects.get(m[1]);
      if (!object || object.ownerSubjectId !== subject)
        refuse(404, 'NOT_FOUND', 'OBJECT_NOT_FOUND');
      closedBody(body ?? {}, []);
      const view = () => {
        return structuredClone(omit(object, ['tokens']));
      };
      if (m[2] === 'upload-url') {
        if (object.status !== 'RESERVED') refuse(409, 'CONFLICT', 'OBJECT_NOT_AVAILABLE');
        return [200, { ...view(), upload: uploadTicket(object) }];
      }
      if (m[2] === 'finalize') {
        if (object.status === 'RESERVED') {
          const bytes = stored.get(object.objectId);
          if (!bytes) refuse(409, 'CONFLICT', 'UPLOAD_MISSING');
          const ok =
            bytes.length === object.byteLength &&
            sha256(bytes) === object.sha256 &&
            magicOk(bytes, object.contentType);
          Object.assign(object, {
            status: ok ? 'AVAILABLE' : 'REJECTED',
            rejectReason: ok ? null : 'UPLOAD_MISMATCH',
            finalizedAt: iso(),
            revision: object.revision + 1,
          });
        }
        return [200, view(), true];
      }
      if (object.status !== 'AVAILABLE') refuse(409, 'CONFLICT', 'OBJECT_NOT_AVAILABLE');
      const { url, expiresAt } = presign(object.objectId, 'GET', 120_000);
      return [200, { method: 'GET', url, expiresAt }];
    }
    refuse(404, 'NOT_FOUND');
  }

  const SUBJECTS = new Map([
    [TECHNICIAN_TOKEN, TECHNICIAN_SUBJECT],
    [OTHER_TOKEN, CUSTOMER_SUBJECT],
  ]);

  const api = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const method = request.method ?? 'GET';
    const raw = await readBody(request);
    let body;
    if (raw.length) {
      try {
        body = JSON.parse(raw.toString('utf8'));
      } catch {
        body = Symbol.for('invalid');
      }
    }
    const key = request.headers['idempotency-key'] ?? null;
    const entry = { method, path: url.pathname, key, body, at: iso() };
    requests.push(entry);
    const reply = (status, payload) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(payload));
    };
    const auth = /^Bearer (.+)$/.exec(request.headers.authorization ?? '');
    const subject = auth ? SUBJECTS.get(auth[1]) : undefined;
    if (!subject) return reply(401, envelope('AUTH_REQUIRED'));
    if (typeof body === 'symbol') return reply(400, envelope('REQUEST_INVALID'));
    const mutation = method !== 'GET';
    const idemScoped = mutation && !/\/(upload-url|read-url)$/.test(url.pathname);
    if (idemScoped && (typeof key !== 'string' || !/^[A-Za-z0-9-]{8,128}$/.test(key))) {
      return reply(428, envelope('IDEMPOTENCY_KEY_REQUIRED'));
    }
    const fingerprint = `${method} ${url.pathname} ${JSON.stringify(body ?? null)}`;
    const scope = `${subject}:${key}`;
    if (idemScoped && idempotency.has(scope)) {
      const saved = idempotency.get(scope);
      if (saved.fingerprint !== fingerprint) return reply(409, envelope('IDEMPOTENCY_CONFLICT'));
      entry.replayed = true;
      return reply(saved.status, saved.payload);
    }
    try {
      const [status, payload, effect] = await route(method, url.pathname, subject, body);
      if (idemScoped) idempotency.set(scope, { fingerprint, status, payload });
      if (effect) effects.push({ method, path: url.pathname, key, at: iso() });
      reply(status, payload);
    } catch (error) {
      if (!(error instanceof Refusal)) {
        reply(500, envelope('INTERNAL_ERROR'));
        throw error;
      }
      reply(error.status, envelope(error.code, error.reason, error.status >= 500));
    }
  });

  /** Presigned object store (separate origin, CORS for the operator origin only). */
  const store = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const origin = request.headers.origin;
    const cors =
      origin && allowedOrigins.includes(origin)
        ? {
            'access-control-allow-origin': origin,
            'access-control-allow-methods': 'PUT, GET',
            'access-control-allow-headers': 'content-type, x-amz-checksum-sha256',
            vary: 'origin',
          }
        : {};
    if (request.method === 'OPTIONS') {
      response.writeHead(origin && allowedOrigins.includes(origin) ? 204 : 403, cors);
      response.end();
      return;
    }
    const m = /^\/objects\/([^/]+)$/.exec(url.pathname);
    const object = m ? objects.get(m[1]) : undefined;
    const grant = object?.tokens?.get(url.searchParams.get('token') ?? '');
    const live =
      grant && Date.parse(grant.expiresAt) > clock().getTime() && grant.method === request.method;
    if (!object || !live) {
      response.writeHead(403, cors);
      response.end();
      return;
    }
    if (request.method === 'PUT') {
      const bytes = await readBody(request);
      const checksum = request.headers['x-amz-checksum-sha256'];
      if (
        request.headers['content-type'] !== object.contentType ||
        checksum !== Buffer.from(createHash('sha256').update(bytes).digest()).toString('base64')
      ) {
        response.writeHead(400, cors);
        response.end();
        return;
      }
      stored.set(object.objectId, bytes);
      response.writeHead(200, cors);
      response.end();
      return;
    }
    const bytes = stored.get(object.objectId);
    response.writeHead(200, {
      ...cors,
      'content-type': object.contentType,
      'cache-control': 'private, max-age=60',
    });
    response.end(bytes);
  });

  const origin = await listen(api);
  storeOrigin = await listen(store);

  /** Test controls (fixture-only; they model actions of OTHER actors such as operations). */
  const control = {
    reset,
    /** NON-DEFAULT, CR-requested: Booking technician view for a live offer (render-parity only). */
    setExposeOfferBooking(value) {
      exposeOfferBooking = value === true;
    },
    allowStoreOrigin(value) {
      allowedOrigins = [value];
    },
    bookingIdOf(seedKey) {
      return SEEDS.find((s) => s.key === seedKey).bookingId;
    },
    taskOf(seedKey) {
      const bookingId = control.bookingIdOf(seedKey);
      return [...state.tasks.values()].find(
        (t) => t.bookingId === bookingId && !['WITHDRAWN', 'CANCELLED'].includes(t.stage),
      );
    },
    offerOf(seedKey) {
      const bookingId = control.bookingIdOf(seedKey);
      return [...state.offers.values()].find(
        (o) => o.job.bookingId === bookingId && o.status === 'OFFERED',
      );
    },
    setAvailability(status) {
      state.availability = { status, revision: state.availability.revision + 1, updatedAt: iso() };
    },
    /** Store AVAILABLE evidence bytes directly (fixture seeding for visual states). */
    putObject(bytes, contentType = 'image/jpeg') {
      const objectId = uuidFrom(`object:${sha256(bytes)}:${objects.size}`);
      objects.set(objectId, {
        objectId,
        revision: 2,
        status: 'AVAILABLE',
        purpose: 'WORK_EVIDENCE',
        contentType,
        byteLength: bytes.length,
        sha256: sha256(bytes),
        ownerSubjectId: TECHNICIAN_SUBJECT,
        rejectReason: null,
        claimed: true,
        createdAt: iso(),
        finalizedAt: iso(),
        expiresAt: null,
      });
      stored.set(objectId, Buffer.from(bytes));
      return objectId;
    },
    /**
     * Put a seed job directly into a task stage (fixture seeding). `history`
     * entries are `{at, action}`; evidence values are object ids or null.
     */
    seedTask(
      seedKey,
      {
        stage,
        checked = [],
        evidence = {},
        collection = null,
        notes = [],
        history = null,
        conditionNote = null,
      } = {},
    ) {
      const bookingId = control.bookingIdOf(seedKey);
      for (const [id, offer] of state.offers)
        if (offer.job.bookingId === bookingId) state.offers.delete(id);
      const at = iso();
      const task = newTask(bookingId, at);
      task.stage = stage;
      task.checklist.items.forEach((item) => (item.checked = checked.includes(item.code)));
      const link = (objectId) => (objectId ? { mediaObjectId: objectId, attachedAt: at } : null);
      task.evidence = {
        BEFORE: (evidence.BEFORE ?? [null, null]).map(link),
        AFTER: (evidence.AFTER ?? [null, null]).map(link),
      };
      task.collection = collection;
      task.notes = notes;
      task.conditionNote = conditionNote;
      if (history) task.history = history;
      if (
        ['EN_ROUTE', 'ARRIVED', 'IN_SERVICE', 'DOCUMENTING', 'FINISHED', 'CLOSED'].includes(stage)
      )
        task.departedAt = at;
      if (['ARRIVED', 'IN_SERVICE', 'DOCUMENTING', 'FINISHED', 'CLOSED'].includes(stage)) {
        task.arrivedAt = at;
        task.arrivalMethod = 'MANUAL_CONFIRMATION';
      }
      if (['IN_SERVICE', 'DOCUMENTING', 'FINISHED', 'CLOSED'].includes(stage)) task.startedAt = at;
      if (['DOCUMENTING', 'FINISHED', 'CLOSED'].includes(stage)) task.documentedAt = at;
      if (['FINISHED', 'CLOSED'].includes(stage)) task.finishedAt = at;
      if (['CLOSED', 'RELEASED'].includes(stage)) task.closedAt = at;
      state.assignments.get(bookingId).status = stage === 'RELEASED' ? 'UNASSIGNED' : 'ASSIGNED';
      state.tasks.set(task.taskId, task);
      return task;
    },
    /** Operations-side change of a task: only its revision moves. */
    touchTask(taskId) {
      const task = state.tasks.get(taskId);
      task.revision += 1;
    },
    /** Operations reassigns the job to someone else (task WITHDRAWN). */
    withdrawTask(taskId) {
      const task = state.tasks.get(taskId);
      task.stage = 'WITHDRAWN';
      task.revision += 1;
      task.updatedAt = iso();
      state.assignments.get(task.bookingId).technician = 'someone-else';
    },
    storedBytes(objectId) {
      return stored.get(objectId) ?? null;
    },
    object(objectId) {
      const object = objects.get(objectId);
      return object ? objectView(object) : null;
    },
  };

  return {
    label: FIXTURE_LABEL,
    origin,
    storeOrigin,
    upstreams: {
      identity: origin,
      workforce: origin,
      dispatch: origin,
      booking: origin,
      media: origin,
    },
    requests,
    effects,
    state,
    control,
    async close() {
      api.closeAllConnections?.();
      store.closeAllConnections?.();
      await Promise.all([new Promise((r) => api.close(r)), new Promise((r) => store.close(r))]);
    },
  };
}
