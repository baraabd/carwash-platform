import assert from 'node:assert/strict';
import { apiError } from '@carwash/contracts/common';
import { parseQuoteRequestV1 } from '@carwash/contracts/pricing-v1';
import { parseHoldRequestV1, parseReleaseHoldRequestV1 } from '@carwash/contracts/scheduling-v1';
import { ProductionBookingClient } from '../../src/data/productionBooking.ts';
// Contract-level transport double; real owner/database/browser evidence is separate.
const id = (n) => `${String(n).padStart(8, '0')}-1234-4123-8123-123456789012`;
const instant = '2026-11-27T08:00:00.000Z';
const later = '2026-11-27T09:00:00.000Z';
const startsAt = '2026-11-27T11:00:00.000Z';
const endsAt = '2026-11-27T11:30:00.000Z';
const money = (amountMinor = '125050') => ({ currency: 'SYP', amountMinor, scale: 2 });
const session = {
  subject: id(1),
  sessionId: id(2),
  authVersion: 1,
  principalKind: 'guest',
  roles: [],
  permissions: ['bookings.read:self', 'bookings.create:self'],
};
const principal = { kind: 'guest', subjectId: id(1) };
const address = {
  addressId: id(10),
  revision: 3,
  label: 'المنزل',
  archived: false,
  location: {
    mode: 'coordinates',
    point: { latitude: '33.500000', longitude: '36.300000' },
    description: 'شارع الاختبار',
  },
  details: 'عند البوابة',
  createdAt: instant,
  updatedAt: instant,
};
const catalog = {
  catalogRevision: 1,
  publishedAt: instant,
  items: [
    {
      definitionId: id(20),
      kind: 'PACKAGE',
      code: 'essential',
      name: { ar: 'أساسية', en: null },
      description: { ar: 'غسيل خارجي', en: null },
      durationMinutes: 30,
      vehicleTypes: ['sedan', 'suv'],
      status: 'PUBLISHED',
      sortOrder: 0,
      revision: 1,
    },
  ],
};
const line = {
  lineId: id(22),
  kind: 'PACKAGE',
  definitionId: id(20),
  quantity: 1,
  unitPrice: money(),
  amount: money(),
};
const quote = (zoneId = null) => ({
  quoteId: id(30),
  revision: 1,
  status: 'USABLE',
  beneficiary: principal,
  vehicleType: 'sedan',
  zoneId,
  currency: 'SYP',
  lines: [line],
  total: money(),
  durationMinutes: 30,
  catalogRevision: 1,
  priceBookRevision: 7,
  issuedAt: instant,
  expiresAt: later,
});
const hold = {
  holdId: id(40),
  revision: 2,
  state: 'HELD',
  quoteRef: { quoteId: id(30), revision: 1 },
  beneficiary: principal,
  zoneId: id(50),
  startsAt,
  endsAt,
  expiresAt: '2026-11-27T08:10:00.000Z',
  bookingId: null,
  createdAt: instant,
  updatedAt: instant,
};
const booking = () => ({
  bookingId: id(60),
  revision: 1,
  status: 'PENDING_CONFIRMATION',
  confirmation: 'PENDING',
  rejectionReason: null,
  beneficiary: principal,
  paymentMethod: 'SHAM_CASH',
  financialSource: 'DIRECT',
  entitlementReservationId: null,
  obligationId: null,
  slot: { holdId: id(40), zoneId: id(50), startsAt, endsAt, committed: false },
  quote: {
    quoteId: id(30),
    revision: 1,
    catalogRevision: 1,
    priceBookRevision: 7,
    durationMinutes: 30,
    lines: [line],
  },
  total: money(),
  vehicle: {
    snapshotSchemaVersion: 1,
    source: 'inline',
    vehicleId: null,
    vehicleRevision: null,
    type: 'sedan',
    make: null,
    model: null,
    color: null,
    plate: null,
    capturedAt: instant,
  },
  address: {
    snapshotSchemaVersion: 1,
    addressId: address.addressId,
    addressRevision: address.revision,
    location: address.location,
    details: address.details,
    capturedAt: instant,
  },
  contact: { name: 'عميل اختبار', phone: '+963912345678', notes: null },
  createdAt: instant,
  updatedAt: instant,
  confirmedAt: null,
  schedule: null,
  cancellation: null,
  pendingChange: null,
});
const obligation = () => ({
  obligationId: id(70),
  revision: 2,
  status: 'OPEN',
  financialStatus: 'AWAITING_PAYMENT',
  quoteId: id(30),
  amount: money(),
  verified: money('0'),
  outstanding: money(),
  activeIntent: {
    intentId: id(71),
    method: 'SHAM_CASH',
    status: 'AWAITING_CUSTOMER_PAYMENT',
    amount: money(),
    createdAt: instant,
    updatedAt: instant,
  },
  attempts: [],
  cashReceipt: null,
  createdAt: instant,
  updatedAt: instant,
});
const response = (body, status = 200) => ({
  status,
  headers: { get: () => null },
  text: async () => JSON.stringify(body),
});
const error = (status, code) =>
  response(apiError(code, code, { requestId: 'test', correlationId: 'test' }), status);

function harness() {
  const requests = [],
    storage = new Map();
  let key = 0;
  const state = {
    now: Date.parse(instant),
    override: null,
    order: booking(),
    obligation: obligation(),
    bookingKeys: new Map(),
  };
  const recovery = {
    read: (p) => storage.get(`${p.kind}:${p.subjectId}`) ?? null,
    write: (p, value) => storage.set(`${p.kind}:${p.subjectId}`, value),
    clear: (p) => storage.delete(`${p.kind}:${p.subjectId}`),
  };
  const fetch = async (url, init) => {
    const parsed = new URL(url);
    const request = {
      url,
      path: parsed.pathname,
      query: parsed.searchParams,
      method: init.method,
      body: init.body ? JSON.parse(init.body) : null,
      headers: init.headers,
      credentials: init.credentials,
    };
    requests.push(request);
    const override = await state.override?.(request);
    if (override) return override;
    if (request.path === '/api/v1/customer/packages') return response(catalog);
    if (request.path === '/api/v1/customer/quotes') {
      const body = parseQuoteRequestV1(request.body);
      return response(quote(body.zoneId), 201);
    }
    if (request.path === '/api/v1/customer/serviceability')
      return response({
        decisionId: id(51),
        decision: 'SERVICEABLE',
        zoneId: id(50),
        zoneRevision: 2,
        datasetRevision: 9,
        point: request.body.point,
        checkedAt: instant,
        expiresAt: later,
        reason: null,
      });
    if (
      request.path === '/api/v1/customer/availability' ||
      request.path === '/api/v1/customer/availability/earliest'
    )
      return response({
        zoneId: id(50),
        date: request.query.get('date') ?? '2026-11-27',
        timezone: 'Asia/Damascus',
        durationMinutes: 30,
        slots: [{ startsAt, endsAt, availability: 'AVAILABLE' }],
        earliest: { startsAt, endsAt },
        asOf: instant,
      });
    if (request.path === '/api/v1/customer/booking-holds') {
      parseHoldRequestV1(request.body);
      return response(hold, 201);
    }
    if (request.path === `/api/v1/customer/booking-holds/${hold.holdId}/release`) {
      parseReleaseHoldRequestV1(request.body);
      return response({ ...hold, revision: 3, state: 'RELEASED' });
    }
    if (request.path === '/api/v1/customer/bookings' && request.method === 'POST') {
      state.order = {
        ...state.order,
        contact: structuredClone(request.body.contact),
        vehicle:
          request.body.vehicle.source === 'inline'
            ? { ...state.order.vehicle, ...request.body.vehicle.inline }
            : {
                ...state.order.vehicle,
                source: 'saved',
                vehicleId: request.body.vehicle.vehicleId,
                vehicleRevision: request.body.vehicle.revision,
              },
      };
      state.bookingKeys.set(request.headers['idempotency-key'], structuredClone(state.order));
      return response(state.order, 201);
    }
    if (request.path === '/api/v1/customer/bookings')
      return response({ items: [state.order], nextCursor: null });
    if (request.path.startsWith('/api/v1/customer/bookings/by-request/')) {
      const found = state.bookingKeys.get(request.path.split('/').at(-1));
      return found ? response(found) : error(404, 'NOT_FOUND');
    }
    if (request.path === `/api/v1/customer/bookings/${id(60)}`) return response(state.order);
    if (request.path.endsWith('/changes')) return response({ items: [] });
    if (request.path.endsWith('/obligation')) return response(state.obligation);
    if (request.path.endsWith('/refunds'))
      return response({
        obligationId: id(70),
        refunded: money('0'),
        inFlight: money('0'),
        refundable: money('0'),
        items: [],
      });
    if (request.path.endsWith('/transaction-reference')) {
      state.obligation = {
        ...state.obligation,
        revision: state.obligation.revision + 1,
        financialStatus: 'UNDER_REVIEW',
        activeIntent: { ...state.obligation.activeIntent, status: 'UNDER_REVIEW' },
        attempts: [
          {
            attemptId: id(72),
            intentId: id(71),
            method: 'SHAM_CASH',
            status: 'PENDING_REVIEW',
            reference: `…${request.body.providerReference.slice(-4)}`,
            claimed: money(),
            submittedAt: instant,
            reconciledAt: null,
          },
        ],
      };
      return response(state.obligation, 201);
    }
    throw new Error(`Unexpected transport request: ${request.method} ${request.path}`);
  };
  const options = {
    origin: 'https://customer.example',
    fetch,
    csrf: () => 'csrf-test-value',
    newKey: () => `operation_key_${String(++key).padStart(10, '0')}`,
    now: () => state.now,
    recovery,
  };
  const client = new ProductionBookingClient(options);
  client.bindSession(session);
  return { client, options, state, requests, storage };
}
async function ready(h) {
  await h.client.loadCatalog();
  assert.equal(await h.client.selectCare(id(20)), true);
  assert.equal(await h.client.selectAddress(address), true);
  await h.client.loadAvailability('2026-11-27');
  assert.ok(await h.client.chooseSlot(startsAt));
  h.client.setContact({ name: 'عميل اختبار', phone: '0912345678', notes: '' });
  h.client.setPaymentMethod('SHAM_CASH');
  assert.equal(h.client.prerequisites(), 6);
}

export {
  id,
  instant,
  later,
  startsAt,
  endsAt,
  money,
  session,
  principal,
  address,
  catalog,
  line,
  quote,
  hold,
  booking,
  obligation,
  response,
  error,
  harness,
  ready,
};
