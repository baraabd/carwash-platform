/** Exact source API clients with explicit transport doubles; not browser or live owner evidence. */
/* global Response */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
const sourceRoot = new URL('../src/', import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      context.parentURL?.startsWith(sourceRoot) &&
      /^\.\.?\//.test(specifier) &&
      !/\.[a-z]+$/i.test(specifier)
    )
      return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  },
});
after(() => hooks.deregister());
const {
  publishedCatalog,
  currentCatalog,
  publishCatalog,
  serviceZones,
  checkServiceability,
  zoneAvailability,
  currentPriceBook,
  publishPriceBook,
} = await import('../src/api/catalog-coverage.ts');
const { handover, receiveHandover, reconcileHandover, custodyReconciliation } =
  await import('../src/api/custody.ts');
const { publishSubscriptionPlan, subscriptionById, decideSubscriptionChange } =
  await import('../src/api/subscriptions.ts');
const {
  supportCase,
  supportCases,
  supportCaseCurrent,
  openSupportCase,
  decideSupportCase,
  resendSupportDecision,
} = await import('../src/api/support-cases.ts');
const id = (n) => `${String(n).padStart(8, '0')}-1234-4123-8123-123456789012`;
const instant = '2026-11-27T08:00:00.000Z';
const key = 'test_domain_operation_00001';
const definition = () => ({
  definitionId: id(1),
  kind: 'PACKAGE',
  code: 'essential',
  name: { ar: 'أساسية', en: null },
  description: { ar: 'غسيل', en: null },
  durationMinutes: 30,
  vehicleTypes: ['sedan'],
  status: 'PUBLISHED',
  sortOrder: 1,
});
const catalog = (revision) => ({
  catalogRevision: revision,
  publishedAt: instant,
  items: [{ ...definition(), revision }],
});
const caseDetail = () => ({
  authority: [{ owner: 'support', reads: 'cases' }],
  case: {
    caseId: id(10),
    kind: 'BOOKING_CANCELLATION',
    status: 'OPEN',
    subject: { type: 'booking', id: id(11), parentId: null },
    summary: 'Requested booking cancellation',
    snapshot: { owner: 'booking', readAt: instant, state: { status: 'CONFIRMED' } },
    openedBy: id(12),
    openedAt: instant,
    revision: 1,
    updatedAt: instant,
  },
  decisions: [],
  events: [],
});
function csrf(t) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { cookie: 'wg_csrf=known_csrf' },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else delete globalThis.document;
  });
}

test('catalog read uses Gateway and rejects malformed owner data without demo fallback', async (t) => {
  let seen;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    seen = { url, options };
    return Response.json(catalog(4));
  });
  const result = await publishedCatalog();
  assert.equal(result.ok, true);
  assert.equal(result.value.catalogRevision, 4);
  assert.equal(seen.url, '/api/v1/admin/catalog');
  assert.equal(seen.options.credentials, 'same-origin');
  t.mock.method(globalThis, 'fetch', async () => Response.json({ items: [] }));
  assert.equal((await publishedCatalog()).failure, 'MALFORMED');
});

test('catalog bootstrap publishes only from the explicit owner unpublished state with expected revision zero', async (t) => {
  csrf(t);
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    return Response.json(
      options.method === 'POST'
        ? catalog(1)
        : { state: 'UNPUBLISHED', catalog: null, expectedCatalogRevision: 0, asOf: instant },
    );
  });
  const current = await currentCatalog();
  assert.equal(current.ok, true);
  assert.equal(current.value.catalog, null);
  assert.equal(calls[0].url, '/api/v1/admin/catalog/current');
  const result = await publishCatalog(
    {
      expectedCatalogRevision: current.value.expectedCatalogRevision,
      definitions: [definition()],
      reasonCode: 'INITIAL_PUBLICATION',
    },
    key,
  );
  assert.equal(result.ok, true);
  assert.equal(result.value.catalogRevision, 1);
  assert.equal(JSON.parse(calls[1].options.body).expectedCatalogRevision, 0);
});

test('catalog bootstrap never treats missing, unavailable or contradictory owner data as permission to publish first', async (t) => {
  for (const body of [
    { state: 'PUBLISHED', catalog: null, expectedCatalogRevision: 0, asOf: instant },
    { state: 'UNPUBLISHED', catalog: catalog(1), expectedCatalogRevision: 0, asOf: instant },
    { state: 'PUBLISHED', catalog: catalog(0), expectedCatalogRevision: 0, asOf: instant },
  ]) {
    t.mock.method(globalThis, 'fetch', async () => Response.json(body));
    assert.equal((await currentCatalog()).failure, 'MALFORMED');
  }
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 404 }));
  assert.equal((await currentCatalog()).ok, false);
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 503 }));
  assert.equal((await currentCatalog()).ok, false);
});

test('catalog publication preserves complete typed definitions and exact command key on explicit retry', async (t) => {
  csrf(t);
  const calls = [];
  let fail = true;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    if (fail) {
      fail = false;
      return new Response('unavailable', { status: 503 });
    }
    return Response.json(catalog(5));
  });
  const command = {
    expectedCatalogRevision: 4,
    definitions: [definition()],
    reasonCode: 'CATALOG_UPDATE',
  };
  assert.equal((await publishCatalog(command, key)).failure, 'UNKNOWN_OUTCOME');
  assert.equal((await publishCatalog(command, key)).ok, true);
  assert.equal(calls[0].options.body, calls[1].options.body);
  assert.equal(calls[0].options.headers['idempotency-key'], key);
  assert.equal(calls[1].options.headers['idempotency-key'], key);
  assert.equal(calls[0].options.headers['x-csrf-token'], 'known_csrf');
  assert.equal(calls[0].url, '/api/v1/admin/catalog/publications');
});

test('unrelated successful publication response is uncertain, never accepted', async (t) => {
  csrf(t);
  t.mock.method(globalThis, 'fetch', async () => Response.json(catalog(8)));
  const result = await publishCatalog(
    { expectedCatalogRevision: 4, definitions: [definition()], reasonCode: 'CATALOG_UPDATE' },
    key,
  );
  assert.equal(result.failure, 'UNKNOWN_OUTCOME');
});

test('coverage reads exact owner wrapper and rejects foreign coordinate or availability context', async (t) => {
  csrf(t);
  const point = { latitude: '33.500000', longitude: '36.300000' };
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (url.endsWith('/service-zones'))
      return Response.json({
        items: [{ zoneId: id(20), revision: 1, name: { ar: 'دمشق', en: null }, status: 'ACTIVE' }],
      });
    if (url.endsWith('/serviceability'))
      return Response.json({
        decisionId: id(21),
        decision: 'SERVICEABLE',
        zoneId: id(20),
        zoneRevision: 1,
        datasetRevision: 1,
        point: { ...point, latitude: '33.600000' },
        checkedAt: instant,
        expiresAt: '2026-11-27T09:00:00.000Z',
        reason: null,
      });
    return Response.json({
      zoneId: id(99),
      date: '2026-11-27',
      timezone: 'Asia/Damascus',
      durationMinutes: 30,
      slots: [],
      earliest: null,
      asOf: instant,
    });
  });
  assert.equal((await serviceZones()).value.length, 1);
  assert.equal((await checkServiceability(point)).ok, false);
  assert.equal((await zoneAvailability(id(20), '2026-11-27', 30)).failure, 'MALFORMED');
});

test('Support opening sends owner command subject shape and validates returned subject', async (t) => {
  csrf(t);
  let observed;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    observed = { url, options };
    return Response.json(caseDetail(), { status: 201 });
  });
  const request = {
    kind: 'BOOKING_CANCELLATION',
    subject: { type: 'booking', id: id(11), parentId: null },
    summary: 'Requested booking cancellation',
  };
  const result = await openSupportCase(request, key);
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(observed.options.body).subject, { type: 'booking', id: id(11) });
  assert.equal(observed.options.headers['idempotency-key'], key);
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({
      ...caseDetail(),
      case: { ...caseDetail().case, subject: { type: 'booking', id: id(99), parentId: null } },
    }),
  );
  assert.equal((await openSupportCase(request, key)).failure, 'UNKNOWN_OUTCOME');
});

test('Support rejects unrelated detail, current owner and duplicate page records', async (t) => {
  const record = caseDetail().case;
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (url.endsWith('/current'))
      return Response.json({
        authority: [],
        current: {
          owner: 'booking',
          readAt: instant,
          booking: {
            bookingId: id(99),
            revision: 1,
            status: 'CONFIRMED',
            confirmation: 'CONFIRMED',
            startsAt: instant,
            endsAt: '2026-11-27T09:00:00.000Z',
          },
        },
      });
    if (url.includes('?'))
      return Response.json({ authority: [], items: [record, record], nextCursor: null });
    return Response.json(caseDetail());
  });
  assert.equal((await supportCase(id(99))).failure, 'MALFORMED');
  assert.equal((await supportCaseCurrent(record)).failure, 'MALFORMED');
  assert.equal((await supportCases()).failure, 'MALFORMED');
});

test('Support decision acceptance does not manufacture cancellation; resend asks Support for frozen owner command', async (t) => {
  csrf(t);
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options });
    return Response.json({ ...caseDetail(), case: { ...caseDetail().case, status: 'EXECUTING' } });
  });
  const result = await decideSupportCase(
    id(10),
    {
      action: 'CANCEL_BOOKING',
      reason: { code: 'CUSTOMER_REQUEST', note: 'A sufficiently detailed review note' },
    },
    key,
  );
  assert.equal(result.value.case.status, 'EXECUTING');
  await resendSupportDecision(id(10), 1, key);
  assert.equal(requests[1].url, `/api/v1/admin/support/${id(10)}/decisions/1/execution`);
  assert.equal(requests[1].options.body, '{}');
  assert.equal(requests[1].options.headers['idempotency-key'], key);
  assert.equal(
    requests.some(
      (request) => request.url.includes('/booking/') || request.url.includes('/billing/'),
    ),
    false,
  );
});

const money = (amountMinor = '10000') => ({ currency: 'SYP', amountMinor, scale: 2 });
const handoverRecord = () => ({
  handoverId: id(30),
  revision: 1,
  holder: id(31),
  status: 'PENDING',
  receiptCount: 1,
  receiptIds: [id(32)],
  declared: money(),
  counted: null,
  shortage: null,
  overage: null,
  treasuryReference: null,
  receivedBy: null,
  receivedAt: null,
  settlementReference: null,
  reconciledBy: null,
  reconciledAt: null,
  cancelledBy: null,
  cancelledAt: null,
  createdAt: instant,
  updatedAt: instant,
});

test('cash custody owner states keep physical receipt separate from reconciliation and use exact amount/key', async (t) => {
  csrf(t);
  const calls = [],
    original = handoverRecord();
  const received = {
    ...original,
    revision: 2,
    status: 'RECEIVED',
    counted: money('9900'),
    shortage: money('100'),
    overage: money('0'),
    treasuryReference: '…1234',
    receivedBy: id(33),
    receivedAt: instant,
  };
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    return Response.json(
      url.endsWith('/reconciliation')
        ? {
            ...received,
            revision: 3,
            status: 'RECONCILED',
            settlementReference: '…5678',
            reconciledBy: id(34),
            reconciledAt: instant,
          }
        : url.endsWith('/treasury-receipt')
          ? received
          : original,
    );
  });
  assert.equal((await handover(original.handoverId)).value.status, 'PENDING');
  const receipt = await receiveHandover(
    original,
    { expectedRevision: 1, countedAmount: money('9900'), treasuryReference: 'TR-1234' },
    key,
  );
  assert.equal(receipt.ok, true);
  assert.equal(receipt.value.status, 'RECEIVED');
  assert.equal(receipt.value.shortage.amountMinor, '100');
  assert.equal(calls[1].options.headers['idempotency-key'], key);
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    expectedRevision: 1,
    countedAmount: money('9900'),
    treasuryReference: 'TR-1234',
  });
  const settlement = await reconcileHandover(
    receipt.value,
    { expectedRevision: 2, settlementReference: 'SET-5678' },
    `${key}_settlement`,
  );
  assert.equal(settlement.value.status, 'RECONCILED');
});

test('cash receipt for another holder remains unknown and inconsistent custody report is rejected', async (t) => {
  csrf(t);
  const record = handoverRecord();
  t.mock.method(globalThis, 'fetch', async (url) =>
    url.endsWith('/treasury-receipt')
      ? Response.json({ ...record, holder: id(99) })
      : Response.json({
          evaluatedAt: instant,
          consistent: true,
          holdersChecked: 1,
          holderMismatches: [],
          receiptsWithoutSettledObligation: 1,
          cashSettlementsWithoutReceipt: 0,
          handoversPending: 1,
          handoversAwaitingReconciliation: 0,
          handoversWithDiscrepancy: 0,
          treasury: [],
        }),
  );
  assert.equal(
    (
      await receiveHandover(
        record,
        { expectedRevision: 1, countedAmount: money(), treasuryReference: 'TR-1234' },
        key,
      )
    ).failure,
    'UNKNOWN_OUTCOME',
  );
  assert.equal((await custodyReconciliation()).failure, 'MALFORMED');
});

test('price publication uses owner next revision and preserves untouched exact entries', async (t) => {
  csrf(t);
  let sent;
  const entries = [
    { definitionId: id(1), vehicleType: null, unitPrice: money('999999999999999999') },
    { definitionId: id(2), vehicleType: 'suv', unitPrice: money('15000') },
  ];
  const head = {
    state: 'PUBLISHED',
    priceBook: {
      priceBookRevision: 4,
      currency: 'SYP',
      catalogRevision: 1,
      policyRevision: 'SYP-V1',
      entriesFingerprint: 'a'.repeat(64),
      publishedAt: instant,
      entries,
    },
    nextExpectedPriceBookRevision: 5,
    policyCurrency: 'SYP',
    asOf: instant,
  };
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (options.method === 'GET') return Response.json(head);
    sent = { url, options };
    return Response.json({
      priceBookRevision: 5,
      currency: 'SYP',
      catalogRevision: 1,
      policyRevision: 'SYP-V1',
      entryCount: 2,
      entriesFingerprint: 'b'.repeat(64),
      publishedAt: instant,
    });
  });
  const current = await currentPriceBook();
  assert.equal(current.ok, true);
  const body = {
    expectedPriceBookRevision: current.value.nextExpectedPriceBookRevision,
    currency: current.value.policyCurrency,
    entries: [
      ...current.value.priceBook.entries.slice(0, 1),
      { ...entries[1], unitPrice: money('16000') },
    ],
  };
  assert.equal((await publishPriceBook(body, key)).ok, true);
  assert.equal(JSON.parse(sent.options.body).expectedPriceBookRevision, 5);
  assert.equal(
    JSON.parse(sent.options.body).entries[0].unitPrice.amountMinor,
    '999999999999999999',
  );
});

const subscription = () => ({
  subscriptionId: id(40),
  revision: 3,
  status: 'ACTIVE',
  beneficiary: { kind: 'account', subjectId: id(41) },
  planId: id(42),
  planVersion: 1,
  purchaseId: id(43),
  units: { total: 4, reserved: 0, consumed: 0, available: 4 },
  startsAt: instant,
  expiresAt: '2026-12-27T08:00:00.000Z',
  frozenAt: null,
  cancelledAt: null,
  updatedAt: instant,
});

test('published subscription plan is a versioned owner fact and cannot accept changed coverage', async (t) => {
  csrf(t);
  const body = {
    expectedRevision: 0,
    status: 'PUBLISHED',
    name: 'خطة شهرية',
    units: 4,
    validityDays: 30,
    price: money(),
    packageIds: [id(1)],
    vehicleTypes: ['sedan'],
  };
  const view = {
    planId: id(42),
    version: 1,
    status: body.status,
    name: body.name,
    units: body.units,
    validityDays: body.validityDays,
    price: body.price,
    packageIds: body.packageIds,
    vehicleTypes: body.vehicleTypes,
    publishedAt: instant,
    contentHash: 'a'.repeat(64),
  };
  t.mock.method(globalThis, 'fetch', async () => Response.json(view));
  assert.equal((await publishSubscriptionPlan(id(42), body, key)).ok, true);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ ...view, packageIds: [id(99)] }));
  assert.equal((await publishSubscriptionPlan(id(42), body, key)).failure, 'UNKNOWN_OUTCOME');
});

test('subscription change decision never invents a new paid period or activates an unverified purchase', async (t) => {
  csrf(t);
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    if (options.method === 'GET') return Response.json(subscription());
    return Response.json({
      changeId: id(44),
      action: 'FREEZE',
      status: 'APPLIED',
      effectiveAt: instant,
      subscription: { ...subscription(), revision: 4, status: 'FROZEN', frozenAt: instant },
    });
  });
  const current = await subscriptionById(id(40));
  const changed = await decideSubscriptionChange(id(40), id(44), true, key);
  assert.equal(changed.value.subscription.status, 'FROZEN');
  assert.equal(changed.value.subscription.expiresAt, current.value.expiresAt);
  assert.deepEqual(JSON.parse(calls[1].options.body), { approve: true });
  assert.equal(calls[1].options.headers['idempotency-key'], key);
});
