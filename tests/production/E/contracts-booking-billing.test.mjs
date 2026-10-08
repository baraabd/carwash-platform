// P02 booking/billing contracts. Executes the BUILT packages (dist), i.e. what
// providers and consumers import. The client test uses a real node:http server
// and Node's real fetch.
import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const contracts = require('../../../packages/contracts/dist/index.js');
const { ContractViolation } = require('../../../packages/contracts/dist/common/wire.js');
const b = require('../../../packages/contracts/dist/booking/v1.js');
const p = require('../../../packages/contracts/dist/billing/v1.js');
const events = require('../../../packages/event-contracts/dist/index.js');
const clients = await import('../../../packages/api-clients/dist/index.js');

const throwsCode = (fn, code) =>
  assert.throws(fn, (error) => error instanceof ContractViolation && error.code === code, code);
const clone = (value) => JSON.parse(JSON.stringify(value));

const ID = (n) =>
  `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const SUBJECT = ID(1);
const QUOTE = ID(2);
const HOLD = ID(3);
const BOOKING = ID(4);
const ZONE = ID(5);
const DECISION = ID(6);
const VEHICLE = ID(7);
const PAYMENT = ID(8);
const DEF = ID(9);
const LINE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LINE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DEF_B = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const syp = (amountMinor) => ({ currency: 'SYP', amountMinor, scale: 2 });
const point = { latitude: '36.202100', longitude: '37.134300' };

const request = {
  quoteRef: { quoteId: QUOTE, revision: 1 },
  holdRef: { holdId: HOLD, revision: 1 },
  serviceability: { decisionId: DECISION, expectedZoneRevision: 3, point },
  vehicle: {
    source: 'inline',
    vehicle: { type: 'suv', make: null, model: null, color: 'أبيض', nickname: null, plate: null },
  },
  address: {
    source: 'inline',
    location: { mode: 'coordinates', point, description: 'قرب الحديقة' },
    details: 'الطابق الثاني',
  },
  contact: { displayName: 'سامر', phone: '+963912345678' },
  notes: null,
  paymentMethod: 'SHAM_CASH',
  customerConfirmed: true,
};

const booking = {
  bookingId: BOOKING,
  reference: 'WG-7K3M9Q2X',
  revision: 2,
  state: 'CONFIRMED',
  beneficiary: { kind: 'guest', subjectId: SUBJECT },
  schedule: {
    holdId: HOLD,
    zoneId: ZONE,
    startsAt: '2026-10-09T06:00:00.000Z',
    endsAt: '2026-10-09T07:00:00.000Z',
    timezone: 'Asia/Damascus',
  },
  serviceability: { decisionId: DECISION, zoneRevision: 3 },
  vehicle: {
    snapshotSchemaVersion: 1,
    source: 'inline',
    vehicleId: null,
    vehicleRevision: null,
    type: 'suv',
    make: null,
    model: null,
    color: 'أبيض',
    plate: null,
    capturedAt: '2026-10-08T10:00:00.000Z',
  },
  address: {
    snapshotSchemaVersion: 1,
    source: 'inline',
    addressId: null,
    addressRevision: null,
    location: { mode: 'coordinates', point, description: 'قرب الحديقة' },
    details: 'الطابق الثاني',
    capturedAt: '2026-10-08T10:00:00.000Z',
  },
  contact: { displayName: 'سامر', phone: '+963912345678' },
  notes: null,
  price: {
    quoteId: QUOTE,
    quoteRevision: 1,
    catalogRevision: 4,
    priceBookRevision: 7,
    vehicleType: 'suv',
    currency: 'SYP',
    lines: [
      {
        lineId: LINE_A,
        kind: 'PACKAGE',
        definitionId: DEF,
        quantity: 1,
        unitPrice: syp('5000000'),
        amount: syp('5000000'),
      },
      {
        lineId: LINE_B,
        kind: 'EXTRA',
        definitionId: DEF_B,
        quantity: 2,
        unitPrice: syp('150050'),
        amount: syp('300100'),
      },
    ],
    total: syp('5300100'),
  },
  paymentMethod: 'SHAM_CASH',
  rejectionReason: null,
  cancellation: null,
  confirmedAt: '2026-10-08T10:00:01.000Z',
  createdAt: '2026-10-08T10:00:00.000Z',
  updatedAt: '2026-10-08T10:00:01.000Z',
};

const payment = {
  paymentId: PAYMENT,
  bookingId: BOOKING,
  revision: 1,
  method: 'SHAM_CASH',
  state: 'AWAITING_TRANSFER',
  amount: syp('5300100'),
  beneficiary: { kind: 'guest', subjectId: SUBJECT },
  transfer: { availability: 'MERCHANT_NOT_CONFIGURED', instructions: null },
  proof: null,
  lastRejection: null,
  paidAt: null,
  createdAt: '2026-10-08T10:00:02.000Z',
  updatedAt: '2026-10-08T10:00:02.000Z',
};

test('descriptors are registered, linted and owned by the right services', () => {
  assert.equal(b.BOOKING_V1.prefix, '/internal/v1/booking');
  assert.equal(p.BILLING_V1.prefix, '/internal/v1/billing');
  for (const c of [b.BOOKING_V1, p.BILLING_V1]) {
    assert.deepEqual(contracts.contractProblems(c), []);
    assert.ok(contracts.OWNER_CONTRACTS.includes(c));
    assert.equal(contracts.httpContract(c.id).status, 'published-provider-pending');
  }
  // Every customer-facing booking/billing route acts on the caller's own records;
  // payment verification is a staff permission, never a customer action.
  for (const route of Object.values(b.BOOKING_V1.routes)) assert.equal(route.access, 'principal');
  assert.equal(p.BILLING_V1.routes.reviewTransfer.access, 'permission:billing.payments.verify');
  assert.equal(p.BILLING_V1.routes.submitTransferProof.idempotent, true);
  assert.equal(b.BOOKING_V1.routes.createBooking.idempotent, true);
});

test('create request: valid inline guest booking parses; beneficiary is never accepted from the body', () => {
  const parsed = b.parseCreateBookingRequestV1(request);
  assert.equal(parsed.paymentMethod, 'SHAM_CASH');
  assert.equal(parsed.vehicle.vehicle.plate, null, 'plate stays optional');
  throwsCode(
    () => b.parseCreateBookingRequestV1({ ...request, beneficiary: booking.beneficiary }),
    'UNEXPECTED_FIELD',
  );
});

test('create request: explicit confirmation, contact, method and references are enforced', () => {
  throwsCode(
    () => b.parseCreateBookingRequestV1({ ...request, customerConfirmed: false }),
    'CONFIRMATION_REQUIRED',
  );
  throwsCode(
    () => b.parseCreateBookingRequestV1({ ...request, customerConfirmed: 'true' }),
    'CONFIRMATION_REQUIRED',
  );
  throwsCode(
    () =>
      b.parseCreateBookingRequestV1({
        ...request,
        contact: { displayName: 'سامر', phone: '0912345678' },
      }),
    'INVALID_FORMAT',
  );
  throwsCode(
    () => b.parseCreateBookingRequestV1({ ...request, paymentMethod: 'CARD' }),
    'INVALID_ENUM',
  );
  throwsCode(
    () => b.parseCreateBookingRequestV1({ ...request, holdRef: { holdId: HOLD } }),
    'MISSING_FIELD',
  );
  throwsCode(
    () => b.parseCreateBookingRequestV1({ ...request, notes: 'x'.repeat(501) }),
    'INVALID_LENGTH',
  );
  throwsCode(
    () =>
      b.parseCreateBookingRequestV1({
        ...request,
        serviceability: { ...request.serviceability, point: { latitude: 'NaN', longitude: '1' } },
      }),
    'INVALID_COORDINATE',
  );
});

test('create request: saved references carry an expected revision; mixed shapes are refused', () => {
  const saved = b.parseCreateBookingRequestV1({
    ...request,
    vehicle: { source: 'saved', vehicleId: VEHICLE, expectedRevision: 2 },
    address: { source: 'saved', addressId: ID(1), expectedRevision: 1 },
  });
  assert.equal(saved.vehicle.expectedRevision, 2);
  throwsCode(
    () =>
      b.parseCreateBookingRequestV1({
        ...request,
        vehicle: { source: 'saved', vehicleId: VEHICLE },
      }),
    'MISSING_FIELD',
  );
  throwsCode(
    () =>
      b.parseCreateBookingRequestV1({
        ...request,
        vehicle: { source: 'saved', vehicleId: VEHICLE, expectedRevision: 1, vehicle: {} },
      }),
    'UNEXPECTED_FIELD',
  );
  throwsCode(
    () => b.parseCreateBookingRequestV1({ ...request, vehicle: { source: 'garage' } }),
    'INVALID_ENUM',
  );
});

test('booking: confirmed booking round-trips with exact money', () => {
  const parsed = b.parseBookingV1(booking);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed)), booking);
  assert.equal(parsed.price.total.amountMinor, '5300100');
});

test('booking: state invariants are enforced by the wire parser', () => {
  const pending = { ...clone(booking), state: 'PENDING' };
  throwsCode(() => b.parseBookingV1(pending), 'INCONSISTENT_BOOKING_STATE');
  b.parseBookingV1({ ...pending, confirmedAt: null });

  throwsCode(
    () => b.parseBookingV1({ ...clone(booking), state: 'REJECTED', confirmedAt: null }),
    'INCONSISTENT_BOOKING_STATE',
  );
  b.parseBookingV1({
    ...clone(booking),
    state: 'REJECTED',
    confirmedAt: null,
    rejectionReason: 'HOLD_EXPIRED',
  });
  const cancelled = {
    ...clone(booking),
    state: 'CANCELLED',
    cancellation: { reason: 'CUSTOMER_REQUEST', cancelledAt: '2026-10-08T11:00:00.000Z' },
  };
  b.parseBookingV1(cancelled);
  throwsCode(
    () => b.parseBookingV1({ ...cancelled, confirmedAt: null }),
    'INCONSISTENT_BOOKING_STATE',
  );
  throwsCode(
    () => b.parseBookingV1({ ...clone(booking), cancellation: cancelled.cancellation }),
    'INCONSISTENT_BOOKING_STATE',
  );
});

test('booking: price copy must add up and match the vehicle snapshot', () => {
  const wrongTotal = clone(booking);
  wrongTotal.price.total = syp('5300101');
  throwsCode(() => b.parseBookingV1(wrongTotal), 'TOTAL_MISMATCH');
  const wrongLine = clone(booking);
  wrongLine.price.lines[1].amount = syp('300000');
  throwsCode(() => b.parseBookingV1(wrongLine), 'LINE_AMOUNT_MISMATCH');
  const usd = clone(booking);
  usd.price.lines[0].amount = { currency: 'USD', amountMinor: '5000000', scale: 2 };
  usd.price.lines[0].unitPrice = { currency: 'USD', amountMinor: '5000000', scale: 2 };
  throwsCode(() => b.parseBookingV1(usd), 'CURRENCY_MISMATCH');
  const float = clone(booking);
  float.price.total = { currency: 'SYP', amountMinor: 53001.0, scale: 2 };
  throwsCode(() => b.parseBookingV1(float), 'INVALID_MONEY_AMOUNT');
  const type = clone(booking);
  type.price.vehicleType = 'sedan';
  throwsCode(() => b.parseBookingV1(type), 'VEHICLE_TYPE_MISMATCH');
});

test('booking: snapshots are closed, inline snapshots carry no saved ids, intervals are positive', () => {
  const inlineWithId = clone(booking);
  inlineWithId.address.addressId = ID(1);
  throwsCode(() => b.parseBookingV1(inlineWithId), 'INLINE_SNAPSHOT_HAS_ADDRESS');
  const saved = clone(booking);
  saved.address = { ...saved.address, source: 'saved', addressId: ID(1), addressRevision: 2 };
  b.parseBookingV1(saved);
  const empty = clone(booking);
  empty.schedule.endsAt = empty.schedule.startsAt;
  throwsCode(() => b.parseBookingV1(empty), 'INVALID_INTERVAL');
  throwsCode(
    () => b.parseBookingV1({ ...clone(booking), reference: 'WG-ILOU0000' }),
    'INVALID_FORMAT',
  );
  throwsCode(() => b.parseBookingV1({ ...clone(booking), extra: 1 }), 'UNEXPECTED_FIELD');
});

test('booking: summary list never carries contact, address or notes', () => {
  const summary = {
    bookingId: BOOKING,
    reference: booking.reference,
    revision: 2,
    state: 'CONFIRMED',
    startsAt: booking.schedule.startsAt,
    endsAt: booking.schedule.endsAt,
    total: booking.price.total,
    paymentMethod: 'SHAM_CASH',
    createdAt: booking.createdAt,
  };
  const page = b.parseBookingPageV1({
    items: [summary],
    nextCursor: null,
    asOf: booking.updatedAt,
  });
  assert.equal(page.items.length, 1);
  throwsCode(
    () => b.parseBookingSummaryV1({ ...summary, contact: booking.contact }),
    'UNEXPECTED_FIELD',
  );
});

test('cancel and repeat draft: no time, hold or quote is ever repeated', () => {
  assert.equal(
    b.parseCancelBookingRequestV1({ expectedRevision: 2, reason: 'CUSTOMER_REQUEST' }).reason,
    'CUSTOMER_REQUEST',
  );
  throwsCode(
    () => b.parseCancelBookingRequestV1({ expectedRevision: 2, reason: 'OPERATIONS' }),
    'INVALID_ENUM',
  );
  const draft = {
    sourceBookingId: BOOKING,
    vehicle: { source: 'saved', vehicleId: VEHICLE },
    address: request.address,
    vehicleType: 'suv',
    selections: [{ definitionId: DEF, quantity: 1 }],
    paymentMethod: 'CASH_AFTER_SERVICE',
    contact: booking.contact,
  };
  b.parseRepeatDraftV1(draft);
  for (const field of ['startsAt', 'holdRef', 'quoteRef'])
    throwsCode(() => b.parseRepeatDraftV1({ ...draft, [field]: null }), 'UNEXPECTED_FIELD');
  throwsCode(
    () =>
      b.parseRepeatDraftV1({ ...draft, selections: [draft.selections[0], draft.selections[0]] }),
    'DUPLICATE_ITEM',
  );
  throwsCode(
    () =>
      b.parseRepeatDraftV1({
        ...draft,
        vehicle: request.vehicle,
        vehicleType: 'sedan',
      }),
    'VEHICLE_TYPE_MISMATCH',
  );
});

test('payment: wallet awaiting transfer without merchant has no invented instructions', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(p.parsePaymentV1(payment))), payment);
  throwsCode(
    () =>
      p.parsePaymentV1({
        ...payment,
        transfer: { availability: 'MERCHANT_NOT_CONFIGURED', instructions: {} },
      }),
    'INCONSISTENT_TRANSFER',
  );
  throwsCode(
    () =>
      p.parsePaymentV1({ ...payment, transfer: { availability: 'AVAILABLE', instructions: null } }),
    'INCONSISTENT_TRANSFER',
  );
  const available = {
    ...payment,
    transfer: {
      availability: 'AVAILABLE',
      instructions: {
        payeeName: 'WashGo',
        payeeAccount: 'merchant-account',
        paymentReference: 'WGP-7K3M9Q2XAB',
        qrPayload: 'opaque-wallet-payload',
        expiresAt: '2026-10-08T12:00:00.000Z',
      },
    },
  };
  p.parsePaymentV1(available);
});

test('payment: PAID needs a proof and a server paid time; cash never has transfer or proof', () => {
  const proof = { transactionReference: 'TX-123456', submittedAt: '2026-10-08T10:30:00.000Z' };
  throwsCode(() => p.parsePaymentV1({ ...payment, state: 'AWAITING_REVIEW' }), 'PROOF_REQUIRED');
  p.parsePaymentV1({ ...payment, state: 'AWAITING_REVIEW', proof });
  throwsCode(() => p.parsePaymentV1({ ...payment, state: 'PAID', proof }), 'INCONSISTENT_PAID_AT');
  p.parsePaymentV1({ ...payment, state: 'PAID', proof, paidAt: '2026-10-08T11:00:00.000Z' });
  throwsCode(
    () => p.parsePaymentV1({ ...payment, state: 'PAID', paidAt: '2026-10-08T11:00:00.000Z' }),
    'PROOF_REQUIRED',
  );

  const cash = { ...payment, method: 'CASH_AFTER_SERVICE', state: 'CASH_DUE', transfer: null };
  p.parsePaymentV1(cash);
  throwsCode(() => p.parsePaymentV1({ ...cash, state: 'PAID' }), 'STATE_NOT_ALLOWED_FOR_METHOD');
  throwsCode(
    () => p.parsePaymentV1({ ...cash, transfer: payment.transfer }),
    'INCONSISTENT_TRANSFER',
  );
  throwsCode(() => p.parsePaymentV1({ ...cash, proof }), 'CASH_HAS_PROOF');
  throwsCode(
    () => p.parsePaymentV1({ ...payment, state: 'CASH_COLLECTED' }),
    'STATE_NOT_ALLOWED_FOR_METHOD',
  );
});

test('proof and review requests: closed shapes, statement evidence required to confirm', () => {
  p.parseSubmitTransferProofRequestV1({ expectedRevision: 1, transactionReference: 'TX-123456' });
  throwsCode(
    () => p.parseSubmitTransferProofRequestV1({ expectedRevision: 1, transactionReference: 'a b' }),
    'INVALID_FORMAT',
  );
  throwsCode(
    () =>
      p.parseSubmitTransferProofRequestV1({
        expectedRevision: 1,
        transactionReference: 'TX-1234',
        paid: true,
      }),
    'UNEXPECTED_FIELD',
  );
  p.parseReviewTransferRequestV1({
    expectedRevision: 2,
    decision: 'CONFIRM_RECEIVED',
    statementReference: 'stmt:2026-10-08:42',
  });
  throwsCode(
    () => p.parseReviewTransferRequestV1({ expectedRevision: 2, decision: 'CONFIRM_RECEIVED' }),
    'MISSING_FIELD',
  );
  throwsCode(
    () =>
      p.parseReviewTransferRequestV1({
        expectedRevision: 2,
        decision: 'REJECT',
        rejectionReason: 'AMOUNT_MISMATCH',
        statementReference: 'stmt:1',
      }),
    'UNEXPECTED_FIELD',
  );
  throwsCode(
    () => p.parseReviewTransferRequestV1({ expectedRevision: 2, decision: 'APPROVE' }),
    'INVALID_ENUM',
  );
  throwsCode(
    () =>
      p.parseReviewQueueItemV1({
        paymentId: PAYMENT,
        bookingId: BOOKING,
        revision: 2,
        method: 'CASH_AFTER_SERVICE',
        amount: syp('1'),
        transactionReference: 'TX-1234',
        submittedAt: '2026-10-08T10:30:00.000Z',
      }),
    'INVALID_ENUM',
  );
});

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

const envelope = (spec, aggregateId, data, actor = { kind: 'guest', id: SUBJECT }) => ({
  eventId: ID(1),
  eventType: spec.eventType,
  envelopeVersion: 2,
  producer: spec.producer,
  occurredAt: '2026-10-08T10:00:01.000Z',
  correlationId: ID(2),
  causationId: null,
  traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
  aggregate: { type: spec.aggregateType, id: aggregateId, version: 2 },
  actor,
  data,
});

const confirmedData = {
  beneficiary: { kind: 'guest', subjectId: SUBJECT },
  holdId: HOLD,
  zoneId: ZONE,
  startsAt: booking.schedule.startsAt,
  endsAt: booking.schedule.endsAt,
  quoteId: QUOTE,
  quoteRevision: 1,
  paymentMethod: 'SHAM_CASH',
  currency: 'SYP',
  totalMinor: '5300100',
};

test('events: registered as envelope v2 with versions taken from the event type', () => {
  const ids = events.EVENT_CONTRACTS.map((e) => e.id);
  for (const id of [
    'booking.confirmed.v2',
    'booking.cancelled.v1',
    'billing.payment-state-changed.v1',
  ])
    assert.ok(ids.includes(id), id);
  assert.equal(events.eventContract('booking.confirmed.v2').schemaVersion, 2);
  assert.equal(events.eventContract('booking.confirmed.v2').envelopeVersion, 2);
  assert.equal(events.eventContract('booking.confirmed.v1').envelopeVersion, 1, 'v1 unchanged');
  assert.equal(events.BUSINESS_EVENTS.length, events.BUSINESS_EVENTS_V1.length + 3);
});

test('events: booking.confirmed.v2 is PII-free and exact', () => {
  const spec = events.BOOKING_CONFIRMED_V2;
  const parsed = spec.parse(envelope(spec, BOOKING, confirmedData));
  assert.equal(parsed.data.totalMinor, '5300100');
  for (const leak of [{ phone: '+963912345678' }, { plate: 'حلب 1234' }, { address: 'x' }]) {
    assert.throws(
      () => spec.parse(envelope(spec, BOOKING, { ...confirmedData, ...leak })),
      /UNEXPECTED_EVENT_FIELDS/,
    );
  }
  assert.throws(
    () => spec.parse(envelope(spec, BOOKING, { ...confirmedData, totalMinor: 53001 })),
    /INVALID_EVENT_DATA/,
  );
  assert.throws(
    () => spec.parse(envelope(spec, BOOKING, { ...confirmedData, endsAt: confirmedData.startsAt })),
    /INVALID_EVENT_DATA/,
  );
  assert.throws(
    () => spec.parse({ ...envelope(spec, BOOKING, confirmedData), producer: 'billing' }),
    /UNSUPPORTED_EVENT/,
  );
});

test('events: cancelled and payment-state-changed enforce their closed vocabularies', () => {
  const cancelled = events.BOOKING_CANCELLED_V1;
  cancelled.parse(
    envelope(cancelled, BOOKING, {
      beneficiary: confirmedData.beneficiary,
      holdId: HOLD,
      reason: 'CUSTOMER_REQUEST',
      cancelledAt: '2026-10-08T11:00:00.000Z',
    }),
  );
  const changed = events.BILLING_PAYMENT_STATE_CHANGED_V1;
  const data = {
    bookingId: BOOKING,
    method: 'SHAM_CASH',
    state: 'PAID',
    currency: 'SYP',
    amountMinor: '5300100',
  };
  changed.parse(envelope(changed, PAYMENT, data, { kind: 'account', id: ID(3) }));
  assert.throws(
    () => changed.parse(envelope(changed, PAYMENT, { ...data, state: 'CASH_DUE' })),
    /INVALID_EVENT_DATA/,
  );
  assert.throws(
    () =>
      changed.parse(
        envelope(changed, PAYMENT, { ...data, method: 'CASH_AFTER_SERVICE', state: 'PAID' }),
      ),
    /INVALID_EVENT_DATA/,
  );
  changed.parse(envelope(changed, PAYMENT, { ...data, state: 'CANCELLED' }));
});

test('events and HTTP contracts share one vocabulary (no drift between packages)', () => {
  const wallet = events.BILLING_PAYMENT_STATE_CHANGED_V1;
  for (const method of contracts.PAYMENT_METHODS) {
    const state = method === 'CASH_AFTER_SERVICE' ? 'CASH_DUE' : 'AWAITING_TRANSFER';
    wallet.parse(
      envelope(wallet, PAYMENT, {
        bookingId: BOOKING,
        method,
        state,
        currency: 'SYP',
        amountMinor: '1',
      }),
    );
  }
  for (const state of p.PAYMENT_STATES) {
    const method = ['CASH_DUE', 'CASH_COLLECTED'].includes(state)
      ? 'CASH_AFTER_SERVICE'
      : 'SHAM_CASH';
    wallet.parse(
      envelope(wallet, PAYMENT, {
        bookingId: BOOKING,
        method,
        state,
        currency: 'SYP',
        amountMinor: '1',
      }),
    );
  }
  for (const currency of Object.keys(contracts.CURRENCIES)) {
    events.BOOKING_CONFIRMED_V2.parse(
      envelope(events.BOOKING_CONFIRMED_V2, BOOKING, { ...confirmedData, currency }),
    );
  }
});

// ---------------------------------------------------------------------------
// Typed client over a real HTTP server
// ---------------------------------------------------------------------------

async function server(t, handler) {
  const seen = [];
  const s = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      handler(req, res, body);
    });
  });
  await new Promise((resolve) => s.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => (s.closeAllConnections(), s.close(resolve))));
  return { seen, baseUrl: `http://127.0.0.1:${s.address().port}` };
}

const json = (res, status, value) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
};

test('client: createBooking sends the parsed body with the idempotency key to the owner path', async (t) => {
  const { seen, baseUrl } = await server(t, (_req, res) => json(res, 201, booking));
  const client = new clients.HttpClient({ baseUrl, fetch });
  const key = 'booking-create-key-0001';
  const result = await clients.createBooking(client, request, key, { correlationId: ID(2) });
  assert.equal(result.ok, true);
  assert.equal(result.value.state, 'CONFIRMED');
  assert.equal(seen[0].method, 'POST');
  assert.equal(seen[0].url, '/internal/v1/booking/bookings');
  assert.equal(seen[0].headers['idempotency-key'], key);
  assert.deepEqual(JSON.parse(seen[0].body), request);
});

test('client: a malformed booking never leaves the client; a bad payment response is never success', async (t) => {
  const { seen, baseUrl } = await server(t, (_req, res) =>
    json(res, 200, { ...payment, state: 'PAID' }),
  );
  const client = new clients.HttpClient({ baseUrl, fetch });
  assert.throws(
    () =>
      clients.createBooking(
        client,
        { ...request, customerConfirmed: false },
        'booking-create-key-0002',
      ),
    (error) => error instanceof ContractViolation,
  );
  assert.equal(seen.length, 0);
  const result = await clients.getBookingPayment(client, BOOKING);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'UPSTREAM_INVALID');
  assert.equal(seen[0].url, `/internal/v1/billing/bookings/${BOOKING}/payment`);
});

test('client: proof submission and cancellation are keyed and target the owner paths', async (t) => {
  const { seen, baseUrl } = await server(t, (req, res) =>
    req.url.includes('/billing/')
      ? json(res, 200, {
          ...payment,
          revision: 2,
          state: 'AWAITING_REVIEW',
          proof: { transactionReference: 'TX-123456', submittedAt: '2026-10-08T10:30:00.000Z' },
        })
      : json(res, 200, {
          ...booking,
          revision: 3,
          state: 'CANCELLED',
          cancellation: { reason: 'CUSTOMER_REQUEST', cancelledAt: '2026-10-08T11:00:00.000Z' },
        }),
  );
  const client = new clients.HttpClient({ baseUrl, fetch });
  const proof = await clients.submitTransferProof(
    client,
    PAYMENT,
    { expectedRevision: 1, transactionReference: 'TX-123456' },
    'payment-proof-key-0001',
  );
  assert.equal(proof.value.state, 'AWAITING_REVIEW');
  const cancelled = await clients.cancelBooking(
    client,
    BOOKING,
    { expectedRevision: 2, reason: 'CUSTOMER_REQUEST' },
    'booking-cancel-key-0001',
  );
  assert.equal(cancelled.value.state, 'CANCELLED');
  assert.equal(seen[0].url, `/internal/v1/billing/payments/${PAYMENT}/transfer-proofs`);
  assert.equal(seen[1].url, `/internal/v1/booking/bookings/${BOOKING}/cancel`);
  assert.ok(seen.every((s) => s.headers['idempotency-key']));
});
