import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  TECHNICIAN_VIEW_AUDIT_ACTION,
  TechnicianViewQuery,
  decideAssignment,
} from '../../src/application';
import {
  BookingError,
  confirmBooking,
  createBooking,
  type Booking,
  type BookingStatus,
} from '../../src/domain';
import {
  AssignmentUnavailable,
  type AssignmentVerifier,
  type AuditFact,
  type BookingRecord,
  type CurrentAssignee,
  type RequestMeta,
} from '../../src/ports';
import { mapError } from '../../src/transport/http/http-errors';
import { technicianBookingView } from '../../src/transport/http/technician-view';
import {
  CONTACT,
  addressSnapshot,
  committedSlot,
  principal,
  quoteSnapshot,
  requestedSlot,
  vehicleSnapshot,
} from '../support/fixtures';

/**
 * Authorization matrix and wire mapping of the technician view (P03-C3).
 * Pure: in-memory store and Dispatch verifier stubs, no I/O.
 */
const NOW = new Date('2026-10-09T08:00:00.000Z');
const TECH = randomUUID();

function booking(status: BookingStatus = 'CONFIRMED'): Booking {
  const beneficiary = principal();
  const created = createBooking({
    id: randomUUID(),
    beneficiary,
    paymentMethod: 'CASH_ON_COMPLETION',
    contact: CONTACT,
    vehicle: vehicleSnapshot(NOW),
    address: addressSnapshot(NOW),
    quote: quoteSnapshot(beneficiary, NOW),
    requestedSlot: requestedSlot(NOW),
    now: NOW,
  });
  const confirmed = confirmBooking(created, committedSlot(created), NOW);
  if (status === 'PENDING_CONFIRMATION') return created;
  if (status === 'CONFIRMED') return confirmed;
  return { ...confirmed, status };
}

function meta(permissions: string[] = ['work.read:assigned'], subject = TECH): RequestMeta {
  return {
    actor: { kind: 'USER', principalKind: 'account', subject, permissions },
    correlationId: randomUUID(),
    credential: null,
  };
}

function harness(record: Booking | null, answer: () => Promise<CurrentAssignee | 'NOT_FOUND'>) {
  const audits: AuditFact[] = [];
  const events: { event: string; fields: Record<string, unknown> }[] = [];
  let finds = 0;
  let verifierCalls = 0;
  const assignments: AssignmentVerifier = {
    currentAssignee: () => {
      verifierCalls += 1;
      return answer();
    },
  };
  const query = new TechnicianViewQuery({
    store: {
      find: (): Promise<BookingRecord | null> => {
        finds += 1;
        return Promise.resolve(
          record === null
            ? null
            : {
                booking: record,
                saga: {
                  bookingId: record.id,
                  step: 'DONE',
                  outcome: 'CONFIRMED',
                  pendingRejection: null,
                  obligationId: null,
                  pivotAttempted: true,
                  attempts: 0,
                  nextAttemptAt: NOW,
                  deadlineAt: NOW,
                  lastError: null,
                  fence: 1,
                  version: 1,
                  updatedAt: NOW,
                },
                correlationId: randomUUID(),
              },
        );
      },
      recordAudit: (fact) => {
        audits.push(fact);
        return Promise.resolve();
      },
    },
    assignments,
    observer: { record: (event, fields) => events.push({ event, fields }) },
  });
  return {
    query,
    audits,
    events,
    finds: () => finds,
    verifierCalls: () => verifierCalls,
  };
}

const assigned = (subject: string | null = TECH, status: CurrentAssignee['status'] = 'ASSIGNED') =>
  Promise.resolve<CurrentAssignee>({ status, technicianSubjectId: subject, revision: 3 });

async function outcome(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'ALLOWED';
  } catch (error) {
    if (!(error instanceof BookingError)) throw error;
    const mapped = mapError(error);
    return `${mapped.status} ${mapped.code}${mapped.reason ? `/${mapped.reason}` : ''}`;
  }
}

test('matrix: ASSIGNED to the caller is allowed and audited with opaque ids only', async () => {
  const b = booking();
  const h = harness(b, () => assigned());
  const m = meta();
  const result = await h.query.read(m, b.id.toUpperCase());
  assert.equal(result.id, b.id);
  assert.equal(h.audits.length, 1);
  const [audit] = h.audits;
  assert.equal(audit?.action, TECHNICIAN_VIEW_AUDIT_ACTION);
  assert.equal(audit?.bookingId, b.id);
  assert.equal(audit?.correlationId, m.correlationId);
  assert.deepEqual(audit?.actor, m.actor);
  assert.deepEqual(audit?.details, { assignmentRevision: 3, bookingRevision: b.version });
  const serialized = JSON.stringify(h.audits) + JSON.stringify(h.events);
  for (const personal of [CONTACT.name, CONTACT.phone, b.beneficiary.subjectId]) {
    assert.equal(serialized.includes(personal), false, 'no personal data in audit/log');
  }
});

test('matrix: subject comparison is case-insensitive on the UUID', () => {
  assert.deepEqual(
    decideAssignment(TECH, {
      status: 'ASSIGNED',
      technicianSubjectId: TECH.toUpperCase(),
      revision: 1,
    }),
    { kind: 'ALLOW' },
  );
});

test('matrix: other technician, OFFERED, UNASSIGNED, CANCELLED and no job are all the same 404', async () => {
  const cases: [string, () => Promise<CurrentAssignee | 'NOT_FOUND'>][] = [
    ['other technician', () => assigned(randomUUID())],
    ['offered to the caller', () => assigned(TECH, 'OFFERED')],
    ['unassigned', () => assigned(null, 'UNASSIGNED')],
    ['cancelled', () => assigned(TECH, 'CANCELLED')],
    ['no dispatch job', () => Promise.resolve('NOT_FOUND' as const)],
  ];
  for (const [name, answer] of cases) {
    const b = booking();
    const h = harness(b, answer);
    assert.equal(
      await outcome(h.query.read(meta(), b.id)),
      '404 NOT_FOUND/BOOKING_NOT_FOUND',
      name,
    );
    assert.equal(h.finds(), 0, `${name}: the booking is not even read`);
    assert.equal(h.audits.length, 0, `${name}: no audit of a denied read`);
  }
});

test('matrix: a booking that does not exist is the same 404', async () => {
  const h = harness(null, () => assigned());
  assert.equal(
    await outcome(h.query.read(meta(), randomUUID())),
    '404 NOT_FOUND/BOOKING_NOT_FOUND',
  );
  assert.equal(h.audits.length, 0);
});

test('matrix: booking statuses a technician works on are visible, others 404', async () => {
  const visible: BookingStatus[] = [
    'CONFIRMED',
    'ASSIGNED',
    'EN_ROUTE',
    'ARRIVED',
    'IN_PROGRESS',
    'COMPLETED',
  ];
  const hidden: BookingStatus[] = ['PENDING_CONFIRMATION', 'CANCELLED', 'EXPIRED', 'REJECTED'];
  for (const status of visible) {
    const b = booking(status);
    assert.equal(
      await outcome(harness(b, () => assigned()).query.read(meta(), b.id)),
      'ALLOWED',
      status,
    );
  }
  for (const status of hidden) {
    const b = booking(status);
    const h = harness(b, () => assigned());
    assert.equal(
      await outcome(h.query.read(meta(), b.id)),
      '404 NOT_FOUND/BOOKING_NOT_FOUND',
      status,
    );
    assert.equal(h.audits.length, 0);
  }
});

test('matrix: Dispatch unavailable (any failure) is 503 ASSIGNMENT_UNVERIFIED, never allowed', async () => {
  for (const failure of [
    () => Promise.reject(new AssignmentUnavailable('TIMEOUT')),
    () => Promise.reject(new AssignmentUnavailable('BAD_RESPONSE')),
    () => Promise.reject(new Error('unexpected bug')),
  ]) {
    const b = booking();
    const h = harness(b, failure);
    assert.equal(
      await outcome(h.query.read(meta(), b.id)),
      '503 DEPENDENCY_UNAVAILABLE/ASSIGNMENT_UNVERIFIED',
    );
    assert.equal(h.finds(), 0, 'nothing is read before the assignment is known');
    assert.equal(h.audits.length, 0);
  }
});

test('matrix: no allow is cached; a reassignment applies to the very next request', async () => {
  const b = booking();
  let holder: string = TECH;
  const h = harness(b, () => assigned(holder));
  assert.equal(await outcome(h.query.read(meta(), b.id)), 'ALLOWED');
  holder = randomUUID();
  assert.equal(await outcome(h.query.read(meta(), b.id)), '404 NOT_FOUND/BOOKING_NOT_FOUND');
  assert.equal(h.verifierCalls(), 2);
});

test('matrix: wrong permission or a non-user is 403 before Dispatch is asked; bad id is 404', async () => {
  const b = booking();
  const h = harness(b, () => assigned());
  assert.equal(
    await outcome(h.query.read(meta(['bookings.read:self', 'operations.dispatch']), b.id)),
    '403 AUTH_FORBIDDEN',
  );
  assert.equal(
    await outcome(
      h.query.read(
        {
          actor: { kind: 'SYSTEM', component: 'x' },
          correlationId: randomUUID(),
          credential: null,
        },
        b.id,
      ),
    ),
    '403 AUTH_FORBIDDEN',
  );
  assert.equal(
    await outcome(h.query.read(meta(), 'not-a-uuid')),
    '404 NOT_FOUND/BOOKING_NOT_FOUND',
  );
  assert.equal(h.verifierCalls(), 0);
});

test('view: exact field set, null plate, manual address, no customer or quote internals', () => {
  const b = booking();
  const view = technicianBookingView(b);
  assert.deepEqual(Object.keys(view).sort(), [
    'address',
    'bookingId',
    'contact',
    'lines',
    'paymentMethod',
    'revision',
    'slot',
    'status',
    'total',
    'vehicle',
  ]);
  assert.equal(view.vehicle.plate, null, 'the plate stays optional');
  assert.deepEqual(view.vehicle, {
    type: 'sedan',
    make: 'Kia',
    model: 'Rio',
    color: null,
    plate: null,
  });
  assert.deepEqual(view.address, {
    location: { mode: 'manual', description: 'حلب، الفرقان' },
    details: null,
  });
  assert.deepEqual(view.contact, { name: CONTACT.name, phone: CONTACT.phone, notes: null });
  assert.deepEqual(view.slot, {
    zoneId: b.requestedSlot.zoneId,
    startsAt: b.requestedSlot.startsAt.toISOString(),
    endsAt: b.requestedSlot.endsAt.toISOString(),
  });
  assert.deepEqual(view.total, { currency: 'SYP', amountMinor: '9000000', scale: 2 });
  assert.deepEqual(Object.keys(view.lines[0] ?? {}).sort(), [
    'amount',
    'definitionId',
    'kind',
    'lineId',
    'quantity',
  ]);
  const wire = JSON.stringify(view);
  for (const secret of [
    b.beneficiary.subjectId,
    b.quote.quoteId,
    b.requestedSlot.holdId,
    b.address.addressId,
    String(b.vehicle.vehicleId),
    'priceBookRevision',
    'catalogRevision',
    'beneficiary',
    'unitPrice',
  ]) {
    assert.equal(wire.includes(secret), false, `${secret} must not be exposed`);
  }
});

test('view: coordinates address and a plate with region are mapped exactly', () => {
  const base = booking();
  const b: Booking = {
    ...base,
    vehicle: { ...base.vehicle, plate: { text: '123456', region: 'حلب' } },
    address: {
      ...base.address,
      location: {
        mode: 'coordinates',
        point: { latitude: '36.202105', longitude: '37.134260' },
        description: null,
      },
      details: 'الطابق الثاني',
    },
  };
  const view = technicianBookingView(b);
  assert.deepEqual(view.vehicle.plate, { text: '123456', region: 'حلب' });
  assert.deepEqual(view.address, {
    location: {
      mode: 'coordinates',
      point: { latitude: '36.202105', longitude: '37.134260' },
      description: null,
    },
    details: 'الطابق الثاني',
  });
});
