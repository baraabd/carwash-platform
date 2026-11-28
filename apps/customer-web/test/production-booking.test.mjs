import test from 'node:test';
import assert from 'node:assert/strict';
import { ProductionBookingClient, normalizeContact } from '../src/data/productionBooking.ts';
import {
  parseProductionBooking,
  parseProductionBookings,
  parseBookingChange,
  formatMoney,
} from '../src/data/productionBookingContracts.ts';

import {
  id,
  instant,
  later,
  startsAt,
  endsAt,
  money,
  session,
  principal,
  address,
  booking,
  quote,
  hold,
  response,
  error,
  harness,
  ready,
} from './support/journey-fixture.mjs';

test('published catalog uses anonymous credentials; owner failure has no fixture fallback', async () => {
  const h = harness();
  await h.client.loadCatalog();
  assert.equal(h.requests[0].credentials, 'omit');
  assert.equal(h.requests[0].headers['x-wg-session-binding'], undefined);
  assert.equal(h.client.getSnapshot().catalog.items[0].definitionId, id(20));
  h.state.override = () => error(503, 'DEPENDENCY_UNAVAILABLE');
  await h.client.loadCatalog();
  assert.equal(h.client.getSnapshot().catalog, null);
  assert.equal(h.client.getSnapshot().catalogStatus, 'unavailable');
});

test('private booking reads stay bound to the session shown by the customer UI', async () => {
  const h = harness();
  await h.client.loadBookings();
  const read = h.requests.find((entry) => entry.path.endsWith('/bookings'));
  assert.ok(read);
  assert.equal(
    read.headers['x-wg-session-binding'],
    `${session.principalKind}:${session.subject}:${session.sessionId}:${session.authVersion}`,
  );
});

function accountHarness() {
  const h = harness();
  const owner = { ...principal, kind: 'account' };
  h.state.eligibility = {
    subscriptionId: id(94),
    revision: 9,
    eligible: true,
    reason: null,
    checkedAt: instant,
  };
  h.state.subscription = {
    subscriptionId: id(94),
    revision: 7,
    status: 'ACTIVE',
    beneficiary: owner,
    planId: id(90),
    planVersion: 2,
    purchaseId: id(93),
    units: { total: 4, reserved: 1, consumed: 0, available: 3 },
    startsAt: instant,
    expiresAt: '2026-12-27T08:00:00.000Z',
    frozenAt: null,
    cancelledAt: null,
    updatedAt: instant,
  };
  h.state.override = (request) => {
    if (request.path.endsWith('/subscriptions'))
      return response({ items: [h.state.subscription], nextCursor: null, asOf: instant });
    if (request.path.endsWith('/eligibility')) return response(h.state.eligibility);
    return null;
  };
  const original = h.options.fetch;
  const options = {
    ...h.options,
    fetch: async (url, init) => {
      const result = await original(url, init);
      const value = JSON.parse(await result.text());
      if (value?.beneficiary?.subjectId === owner.subjectId) value.beneficiary = owner;
      return response(value, result.status);
    },
  };
  h.client = new ProductionBookingClient(options);
  h.client.bindSession({ ...session, principalKind: 'account' });
  return h;
}

test('covered booking uses the owner eligibility revision, omits payment choice and never creates direct debt', async () => {
  const h = accountHarness();
  await ready(h);
  await h.client.loadSubscriptions();
  assert.equal(await h.client.selectSubscription(id(94)), true);
  assert.deepEqual(
    h.client.getSnapshot().draft.subscription,
    { subscriptionId: id(94), expectedRevision: 9 },
    'not the stale list revision',
  );
  assert.equal(h.client.getSnapshot().draft.paymentMethod, null);
  const eligibility = h.requests.find((r) => r.path.endsWith('/eligibility'));
  assert.deepEqual(eligibility.body, {
    packageId: id(20),
    vehicleType: 'sedan',
    scheduledFor: startsAt,
  });
  assert.equal(
    eligibility.headers['idempotency-key'],
    undefined,
    'eligibility is a read-only owner decision',
  );
  h.state.order = {
    ...booking(),
    financialSource: 'SUBSCRIPTION',
    obligationId: null,
    entitlementReservationId: null,
  };
  const result = await h.client.confirm();
  assert.equal(result.financialSource, 'SUBSCRIPTION');
  assert.equal(result.confirmation, 'PENDING');
  const create = h.requests.find((r) => r.path.endsWith('/bookings') && r.method === 'POST');
  assert.deepEqual(create.body.subscription, { subscriptionId: id(94), expectedRevision: 9 });
  assert.equal(Object.hasOwn(create.body, 'paymentMethod'), false);
  assert.equal(
    h.requests.some((r) => r.path.includes('/payments')),
    false,
  );
});

test('uncovered and foreign eligibility never select an entitlement; payment changes clear a selection', async () => {
  const h = accountHarness();
  await ready(h);
  await h.client.loadSubscriptions();
  h.state.eligibility = { ...h.state.eligibility, eligible: false, reason: 'PACKAGE_NOT_COVERED' };
  assert.equal(await h.client.selectSubscription(id(94)), false);
  assert.equal(h.client.getSnapshot().draft.subscription, null);
  h.state.eligibility = {
    ...h.state.eligibility,
    subscriptionId: id(99),
    eligible: true,
    reason: null,
  };
  assert.equal(await h.client.selectSubscription(id(94)), false);
  h.state.eligibility = { ...h.state.eligibility, subscriptionId: id(94) };
  assert.equal(await h.client.selectSubscription(id(94)), true);
  h.client.setPaymentMethod('CASH_ON_COMPLETION');
  assert.equal(h.client.getSnapshot().draft.subscription, null);
});

test('global earliest selection uses owner horizon and the Booking hold façade, not the selected day first slot', async () => {
  const h = harness();
  await ready(h);
  const futureStart = '2026-11-29T11:00:00.000Z',
    futureEnd = '2026-11-29T11:30:00.000Z';
  h.state.override = (request) => {
    if (request.path.endsWith('/availability/earliest'))
      return response({
        zoneId: id(50),
        date: '2026-11-29',
        timezone: 'Asia/Damascus',
        durationMinutes: 30,
        slots: [{ startsAt: futureStart, endsAt: futureEnd, availability: 'AVAILABLE' }],
        earliest: { startsAt: futureStart, endsAt: futureEnd },
        asOf: instant,
      });
    if (request.path.endsWith('/booking-holds'))
      return response({ ...hold, startsAt: request.body.startsAt, endsAt: futureEnd }, 201);
    return null;
  };
  await h.client.loadEarliest();
  assert.equal(h.client.getSnapshot().earliestAvailability.date, '2026-11-29');
  const selected = await h.client.chooseEarliest();
  assert.equal(selected.startsAt, futureStart);
  const reads = h.requests.filter((r) => r.path.endsWith('/availability/earliest'));
  assert.equal(reads[0].credentials, 'omit');
  assert.equal(reads[0].query.has('date'), false);
  assert.equal(h.client.getSnapshot().availability.date, '2026-11-29');
});

test('foreign earliest context and mismatched hold duration are never presented as selected capacity', async () => {
  const h = harness();
  await ready(h);
  h.state.override = (request) =>
    request.path.endsWith('/availability/earliest')
      ? response({
          zoneId: id(99),
          date: '2026-11-27',
          timezone: 'Asia/Damascus',
          durationMinutes: 30,
          slots: [{ startsAt, endsAt, availability: 'AVAILABLE' }],
          earliest: { startsAt, endsAt },
          asOf: instant,
        })
      : null;
  await h.client.loadEarliest();
  assert.equal(h.client.getSnapshot().earliestStatus, 'unavailable');
  assert.equal(await h.client.chooseEarliest(), null);
  h.state.override = (request) =>
    request.path.endsWith('/booking-holds')
      ? response({ ...hold, endsAt: '2026-11-27T12:00:00.000Z' }, 201)
      : null;
  assert.equal(await h.client.chooseSlot(startsAt), null);
  assert.equal(h.client.getSnapshot().hold, null);
  assert.equal(h.client.getSnapshot().pending, 'hold');
});

test('seven-decision command uses owner prices and Booking façade; no amount or direct Scheduling hold mutation', async () => {
  const h = harness();
  await ready(h);
  const result = await h.client.confirm();
  assert.equal(result.confirmation, 'PENDING');
  assert.equal(result.status, 'PENDING_CONFIRMATION');
  assert.equal(
    h.client.getSnapshot().selectedBooking.confirmation,
    'PENDING',
    'never locally confirmed',
  );
  const create = h.requests.find(
    (r) => r.path === '/api/v1/customer/bookings' && r.method === 'POST',
  );
  assert.deepEqual(Object.keys(create.body).sort(), [
    'address',
    'contact',
    'hold',
    'paymentMethod',
    'quote',
    'vehicle',
  ]);
  assert.deepEqual(create.body.quote, { quoteId: id(30), revision: 1 });
  assert.deepEqual(create.body.hold, { holdId: id(40), revision: 2 });
  assert.equal(create.body.vehicle.inline.plate, null, 'plate stays optional');
  assert.equal(create.body.contact.phone, '+963912345678');
  assert.equal(
    h.requests.some((r) => r.path.includes('/scheduling/')),
    false,
  );
  assert.equal(
    h.requests.some((r) => r.path === '/api/v1/customer/payments' && r.method === 'POST'),
    false,
    'Booking owns obligation orchestration',
  );
  assert.equal(h.storage.size, 0, 'confirmed receipt clears the opaque recovery fence');
});

test('manual address cannot imply serviceability, zone, availability or hold', async () => {
  const h = harness();
  await h.client.loadCatalog();
  await h.client.selectCare(id(20));
  assert.equal(
    await h.client.selectAddress({
      ...address,
      location: { mode: 'manual', description: 'داخل دمشق' },
    }),
    false,
  );
  await h.client.loadAvailability('2026-11-27');
  assert.equal(h.client.getSnapshot().serviceability, null);
  assert.equal(
    h.requests.some((r) => /serviceability|availability|booking-holds/.test(r.path)),
    false,
  );
});

test('Geo decision for a different point is rejected before a zoned quote or hold', async () => {
  const h = harness();
  await h.client.loadCatalog();
  await h.client.selectCare(id(20));
  h.state.override = (r) =>
    r.path.endsWith('/serviceability')
      ? response({
          decisionId: id(51),
          decision: 'SERVICEABLE',
          zoneId: id(50),
          zoneRevision: 1,
          datasetRevision: 1,
          point: { latitude: '34.000000', longitude: '36.300000' },
          checkedAt: instant,
          expiresAt: later,
          reason: null,
        })
      : null;
  assert.equal(await h.client.selectAddress(address), false);
  assert.equal(h.client.getSnapshot().serviceability, null);
  assert.equal(h.requests.filter((r) => r.path.endsWith('/quotes')).length, 1);
});

test('quote total corruption and foreign beneficiary never become customer prices', async () => {
  for (const corrupt of [
    (q) => ({ ...q, total: money('125051') }),
    (q) => ({ ...q, beneficiary: { ...principal, subjectId: id(99) } }),
  ]) {
    const h = harness();
    await h.client.loadCatalog();
    h.state.override = (r) => (r.path.endsWith('/quotes') ? response(corrupt(quote())) : null);
    assert.equal(await h.client.selectCare(id(20)), false);
    assert.equal(h.client.getSnapshot().quote, null);
    assert.equal(h.client.getSnapshot().pending, 'quote');
  }
});

test('expired hold blocks create without making a new request or assuming a reservation', async () => {
  const h = harness();
  await ready(h);
  h.state.now = Date.parse(hold.expiresAt);
  assert.equal(await h.client.confirm(), null);
  assert.equal(h.client.prerequisites(), 3);
  assert.equal(
    h.requests.some((r) => r.path.endsWith('/bookings')),
    false,
  );
});

test('ambiguous hold retries exact key and payload, then selection change releases through Booking', async () => {
  const h = harness();
  await h.client.loadCatalog();
  await h.client.selectCare(id(20));
  await h.client.selectAddress(address);
  await h.client.loadAvailability('2026-11-27');
  let lost = true;
  h.state.override = (r) => {
    if (r.path.endsWith('/booking-holds') && lost) {
      lost = false;
      throw new Error('lost response');
    }
    return null;
  };
  assert.equal(await h.client.chooseSlot(startsAt), null);
  assert.equal(h.client.getSnapshot().pending, 'hold');
  assert.equal(
    await h.client.selectCare(id(20)),
    false,
    'uncertain reservation blocks replacement',
  );
  await h.client.retryPending();
  assert.ok(h.client.getSnapshot().hold);
  const calls = h.requests.filter((r) => r.path.endsWith('/booking-holds'));
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].body, calls[1].body);
  assert.match(calls[0].headers['idempotency-key'], /^operation_key_/);
  assert.equal(calls[0].headers['idempotency-key'], calls[1].headers['idempotency-key']);
  await h.client.selectCare(id(20));
  assert.equal(h.client.getSnapshot().hold, null);
  assert.deepEqual(h.requests.find((r) => r.path.endsWith('/release')).body, {
    expectedRevision: 2,
    reason: 'CUSTOMER_CHANGED',
  });
});

test('lost create response persists only opaque key, reload recovers owner record without replaying POST', async () => {
  const h = harness();
  await ready(h);
  h.state.override = (r) => {
    if (r.path.endsWith('/bookings') && r.method === 'POST') {
      h.state.bookingKeys.set(r.headers['idempotency-key'], booking());
      throw new Error('socket closed after persistence');
    }
    return null;
  };
  assert.equal(await h.client.confirm(), null);
  assert.equal(h.client.getSnapshot().pending, 'booking');
  const persisted = [...h.storage.values()];
  assert.equal(persisted.length, 1);
  assert.match(persisted[0], /^operation_key_[0-9]+$/);
  assert.equal(JSON.stringify(persisted).includes('عميل'), false);
  assert.equal(JSON.stringify(persisted).includes('+963'), false);
  const reloaded = new ProductionBookingClient(h.options);
  reloaded.bindSession(session);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(reloaded.getSnapshot().selectedBooking.bookingId, id(60));
  assert.equal(reloaded.getSnapshot().selectedBooking.confirmation, 'PENDING');
  assert.equal(
    h.requests.filter((r) => r.path.endsWith('/bookings') && r.method === 'POST').length,
    1,
  );
  assert.equal(h.storage.size, 0);
});

test('not-found recovery keeps the ambiguous-create fence; new confirmation stays blocked', async () => {
  const h = harness();
  await ready(h);
  h.state.override = (r) => {
    if (r.path.endsWith('/bookings') && r.method === 'POST')
      throw new Error('unknown before response');
    return null;
  };
  await h.client.confirm();
  await h.client.recoverCreate();
  assert.ok(h.client.getSnapshot().unknownCreateKey);
  assert.equal(await h.client.confirm(), null);
  assert.equal(
    h.requests.filter((r) => r.path.endsWith('/bookings') && r.method === 'POST').length,
    1,
  );
});

test('unreadable 5xx to create is ambiguous and replays exact body/key; no false failed or paid state', async () => {
  const h = harness();
  await ready(h);
  let fail = true;
  h.state.override = (r) => {
    if (r.path.endsWith('/bookings') && r.method === 'POST' && fail) {
      fail = false;
      return error(503, 'DEPENDENCY_UNAVAILABLE');
    }
    return null;
  };
  await h.client.confirm();
  assert.equal(h.client.getSnapshot().pending, 'booking');
  await h.client.retryPending();
  const calls = h.requests.filter((r) => r.path.endsWith('/bookings') && r.method === 'POST');
  assert.deepEqual(calls[0].body, calls[1].body);
  assert.match(calls[0].headers['idempotency-key'], /^operation_key_/);
  assert.equal(calls[0].headers['idempotency-key'], calls[1].headers['idempotency-key']);
  assert.equal(h.client.getSnapshot().selectedBooking.confirmation, 'PENDING');
});

test('foreign persisted bookings and malformed owner lists are refused and not rendered', async () => {
  const h = harness();
  h.state.order = { ...booking(), beneficiary: { ...principal, subjectId: id(99) } };
  await h.client.loadBookings();
  assert.equal(h.client.getSnapshot().bookingsStatus, 'unavailable');
  assert.deepEqual(h.client.getSnapshot().bookings, []);
  await h.client.loadBooking(id(60));
  assert.equal(h.client.getSnapshot().selectedBooking, null);
  assert.throws(() => parseProductionBookings({ items: [booking(), booking()], nextCursor: null }));
  assert.throws(() => parseProductionBooking({ ...booking(), total: money('1') }));
});

test('reload reads persisted order and canonical list without requiring in-memory draft or Page.asOf', async () => {
  const h = harness();
  await h.client.loadBooking(id(60));
  await h.client.loadBookings();
  assert.equal(h.client.getSnapshot().selectedBooking.bookingId, id(60));
  assert.equal(h.client.getSnapshot().bookingsStatus, 'available');
  assert.equal(h.client.getSnapshot().bookings.length, 1);
  assert.equal(
    h.requests.every((r) => r.method === 'GET'),
    true,
  );
});

test('reporting a wallet reference keeps payment UNDER_REVIEW and never marks booking or money paid', async () => {
  const h = harness();
  await h.client.loadBooking(id(60));
  await h.client.loadPayment(id(60));
  assert.equal(await h.client.submitPaymentReference('ABC-1234'), true);
  assert.equal(h.client.getSnapshot().obligation.financialStatus, 'UNDER_REVIEW');
  assert.equal(h.client.getSnapshot().obligation.verified.amountMinor, '0');
  assert.equal(h.client.getSnapshot().selectedBooking.confirmation, 'PENDING');
  const command = h.requests.find((r) => r.path.endsWith('/transaction-reference'));
  assert.deepEqual(command.body, { expectedRevision: 2, providerReference: 'ABC-1234' });
  assert.equal(h.client.getSnapshot().obligation.attempts[0].reference, '…1234');
});

test('logout or identity replacement discards an in-flight response and private draft', async () => {
  const h = harness();
  await h.client.loadCatalog();
  let resolve;
  h.state.override = (r) =>
    r.path.endsWith('/quotes')
      ? new Promise((done) => {
          resolve = done;
        })
      : null;
  const pending = h.client.selectCare(id(20));
  await new Promise((done) => setTimeout(done, 0));
  h.client.bindSession(null);
  resolve(response(quote()));
  await pending;
  assert.equal(h.client.getSnapshot().principal, null);
  assert.equal(h.client.getSnapshot().quote, null);
  assert.equal(h.client.getSnapshot().draft.packageId, null);
});

test('booking selections cannot continue under a replacement session after releasing no hold', async () => {
  const selections = [
    (client) =>
      client.selectVehicle({
        source: 'inline',
        type: 'suv',
        model: 'Private model',
        color: null,
        plate: '',
      }),
    (client) => client.selectCare(id(20)),
    (client) => client.selectAddress(address),
    (client) => client.chooseSlot(startsAt),
    (client) => client.repeat(booking()),
  ];
  for (const select of selections) {
    const h = harness();
    await ready(h);
    await h.client.releaseHold();
    const before = h.requests.length;
    const pending = select(h.client);
    h.client.bindSession({ ...session, subject: id(99), sessionId: id(98) });
    const replacement = h.client.getSnapshot();
    assert.ok(!(await pending));
    assert.deepEqual(
      h.client.getSnapshot(),
      replacement,
      'old selection cannot alter the new draft',
    );
    assert.equal(
      h.requests.length,
      before,
      'old selection cannot issue a request with new credentials',
    );
  }
});

test('late booking confirmation preserves a replacement session pending recovery key', async () => {
  for (const sameAccount of [false, true]) {
    for (const receipt of [() => response(booking(), 201), () => error(409, 'CONFLICT')]) {
      const h = harness();
      await ready(h);
      const deferred = Promise.withResolvers();
      const entered = Promise.withResolvers();
      h.state.override = (request) => {
        if (request.path.endsWith('/bookings') && request.method === 'POST') {
          entered.resolve();
          return deferred.promise;
        }
        return null;
      };
      const pending = h.client.confirm();
      await entered.promise;
      const replacement = {
        ...session,
        subject: sameAccount ? session.subject : id(99),
        sessionId: id(98),
      };
      const recoveryKey = 'replacement_booking_request_1234';
      const storageKey = `${replacement.principalKind}:${replacement.subject}`;
      h.storage.set(storageKey, recoveryKey);
      h.client.bindSession(replacement);
      await h.client.recoverCreate();
      deferred.resolve(receipt());
      assert.equal(await pending, null);
      assert.equal(h.storage.get(storageKey), recoveryKey);
      assert.equal(h.client.getSnapshot().unknownCreateKey, recoveryKey);
      assert.equal(h.client.getSnapshot().selectedBooking, null);
      assert.equal(h.client.getSnapshot().principal.subjectId, replacement.subject);
      assert.equal(
        h.requests.filter(
          (request) => request.method === 'POST' && request.path.endsWith('/bookings'),
        ).length,
        1,
      );
      const reloaded = new ProductionBookingClient(h.options);
      reloaded.bindSession(replacement);
      await reloaded.recoverCreate();
      assert.equal(
        reloaded.getSnapshot().unknownCreateKey,
        recoveryKey,
        'reload preserves the replacement operation fence',
      );
    }
  }
});

test('repeat rejects a saved booking owned by a different customer', async () => {
  const h = harness();
  await h.client.loadCatalog();
  const before = h.client.getSnapshot();
  assert.equal(
    await h.client.repeat({ ...booking(), beneficiary: { ...principal, subjectId: id(99) } }),
    false,
  );
  assert.deepEqual(h.client.getSnapshot(), before);
});

test('exact money and contact presentation never round through floating-point or require a plate', () => {
  assert.equal(formatMoney(money('999999999999999999')), '9,999,999,999,999,999.99 ل.س');
  assert.equal(formatMoney(money('125050')), '1,250.5 ل.س');
  assert.equal(
    normalizeContact({ name: ' سامر  حسن ', phone: '09 1234 5678', notes: '' }).phone,
    '+963912345678',
  );
  assert.equal(normalizeContact({ name: 'س', phone: '123', notes: '' }), null);
});

test('subscription funding is separate from money and requires a confirmed entitlement, never an obligation', async () => {
  const h = harness();
  h.state.order = {
    ...booking(),
    financialSource: 'SUBSCRIPTION',
    obligationId: null,
    entitlementReservationId: null,
  };
  await h.client.loadBooking(id(60));
  await h.client.loadPayment(id(60));
  assert.equal(h.client.getSnapshot().selectedBooking.confirmation, 'PENDING');
  assert.equal(h.client.getSnapshot().obligation, null);
  assert.equal(
    h.requests.some((request) => request.path.endsWith('/obligation')),
    false,
  );
  assert.throws(() => parseProductionBooking({ ...h.state.order, confirmation: 'CONFIRMED' }));
  assert.throws(() => parseProductionBooking({ ...h.state.order, obligationId: id(70) }));
  assert.equal(
    parseProductionBooking({
      ...h.state.order,
      confirmation: 'CONFIRMED',
      entitlementReservationId: id(80),
    }).financialSource,
    'SUBSCRIPTION',
  );
  const change = parseBookingChange({
    changeId: id(81),
    bookingId: id(60),
    kind: 'CANCELLATION',
    state: 'COMPLETED',
    reason: 'CUSTOMER_REQUEST',
    refusal: null,
    attention: false,
    requestedAt: instant,
    completedAt: later,
    from: {
      holdId: hold.holdId,
      zoneId: hold.zoneId,
      startsAt: hold.startsAt,
      endsAt: hold.endsAt,
    },
    to: null,
    settlement: 'ENTITLEMENT_RELEASED',
  });
  assert.equal(change.settlement, 'ENTITLEMENT_RELEASED');
});

test('a create receipt with a different contact or address revision remains unknown instead of being accepted', async () => {
  for (const corrupt of [
    (value) => ({ ...value, contact: { ...value.contact, phone: '+963999999999' } }),
    (value) => ({ ...value, address: { ...value.address, addressRevision: 2 } }),
  ]) {
    const h = harness();
    await ready(h);
    h.state.override = (request) =>
      request.path.endsWith('/bookings') && request.method === 'POST'
        ? response(corrupt(booking()), 201)
        : null;
    assert.equal(await h.client.confirm(), null);
    assert.equal(h.client.getSnapshot().selectedBooking, null);
    assert.equal(h.client.getSnapshot().pending, 'booking');
    assert.equal(h.storage.size, 1);
  }
});
