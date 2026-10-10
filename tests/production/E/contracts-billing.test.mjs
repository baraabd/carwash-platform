/**
 * P04-E1 — billing.v1 and billing events.
 *
 * Two kinds of evidence:
 *  1. Consumer rules: the published parsers refuse fabricated success, drift,
 *     inconsistent money and leaked references.
 *  2. Provider conformance: the MERGED Billing provider's own view and outbox
 *     functions (services/billing/src, transpiled from the exact source of this
 *     tree, no copy) render states that the published parsers must accept.
 *
 * Requires: pnpm build:packages (contracts, event-contracts).
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(import.meta.url);
const contracts = require(path.join(root, 'packages/contracts/dist/index.js'));
const events = require(path.join(root, 'packages/event-contracts/dist/index.js'));
const ts = require(path.join(root, 'node_modules/typescript'));
const b = contracts.billingV1;

const SYP = (minor) => ({ currency: 'SYP', amountMinor: String(minor), scale: 2 });
const T0 = '2026-10-10T08:00:00.000Z';
const T1 = '2026-10-10T08:05:00.000Z';
const id = () => randomUUID();

// ---------------------------------------------------------------- descriptor

test('billing.v1 descriptor passes the shared contract lint and is registered', () => {
  assert.deepEqual(contracts.contractProblems(b.BILLING_V1), []);
  assert.equal(contracts.httpContract('billing.v1').status, 'published-provider-pending');
  const r = b.BILLING_V1.routes;
  // Separation of duties is in the contract: the obligation owner never reconciles.
  assert.equal(r.reconcileAttempt.access, 'permission:billing.reconcile');
  assert.equal(r.requestRefund.access, 'permission:billing.refund');
  assert.equal(r.recordRefundOutcome.access, 'permission:billing.reconcile');
  assert.equal(r.createBookingObligation.access, 'service:billing.obligation.write');
  assert.equal(r.receiveProviderNotification.access, 'provider-signed');
  for (const [name, route] of Object.entries(r)) {
    if (route.method === 'GET' || route.access === 'provider-signed') continue;
    assert.equal(route.idempotent, true, `${name} must require an Idempotency-Key`);
  }
});

test('provider-signed access is a plain POST de-duplicated by the owner', () => {
  const base = { id: 'x.v1', owner: 'x', prefix: '/internal/v1/x', reasons: [] };
  const lint = (route) => contracts.contractProblems({ ...base, routes: { n: route } });
  assert.deepEqual(lint({ method: 'POST', path: '/n', access: 'provider-signed' }), []);
  assert.equal(lint({ method: 'GET', path: '/n', access: 'provider-signed' }).length, 1);
  assert.equal(
    lint({ method: 'POST', path: '/n', access: 'provider-signed', idempotent: true }).length,
    1,
  );
  // Any other unauthenticated mutation is still refused.
  assert.ok(lint({ method: 'POST', path: '/n', access: 'public' }).length > 0);
});

// ---------------------------------------------------------------- consumer rules

function obligation(overrides = {}) {
  return {
    obligationId: id(),
    revision: 1,
    status: 'OPEN',
    financialStatus: 'UNPAID',
    quoteId: id(),
    amount: SYP(150000),
    verified: SYP(0),
    outstanding: SYP(150000),
    activeIntent: null,
    attempts: [],
    cashReceipt: null,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

test('a client cannot derive PAID: financial status must match the server facts', () => {
  assert.equal(b.parseObligationV1(obligation()).financialStatus, 'UNPAID');
  // Claiming PAID while money is outstanding.
  assert.throws(() => b.parseObligationV1(obligation({ financialStatus: 'PAID' })), /INCONSISTENT/);
  // Claiming PAID on an OPEN obligation even with consistent amounts.
  assert.throws(
    () =>
      b.parseObligationV1(
        obligation({ financialStatus: 'PAID', verified: SYP(150000), outstanding: SYP(0) }),
      ),
    /INCONSISTENT_FINANCIAL_STATUS/,
  );
  // CASH_COLLECTED requires a cash receipt; PAID must not carry one.
  const settled = {
    status: 'SETTLED',
    verified: SYP(150000),
    outstanding: SYP(0),
  };
  assert.throws(
    () => b.parseObligationV1(obligation({ ...settled, financialStatus: 'CASH_COLLECTED' })),
    /INCONSISTENT_FINANCIAL_STATUS/,
  );
  assert.equal(
    b.parseObligationV1(obligation({ ...settled, financialStatus: 'PAID' })).financialStatus,
    'PAID',
  );
});

test('money is exact: amounts add up, one currency, no float, no foreign scale', () => {
  assert.throws(
    () => b.parseObligationV1(obligation({ outstanding: SYP(149999) })),
    /AMOUNTS_DO_NOT_ADD_UP/,
  );
  assert.throws(
    () =>
      b.parseObligationV1(
        obligation({ verified: { currency: 'USD', amountMinor: '0', scale: 2 } }),
      ),
    /CURRENCY_MISMATCH/,
  );
  assert.throws(
    () =>
      b.parseObligationV1(obligation({ amount: { currency: 'SYP', amountMinor: 1500, scale: 2 } })),
    /INVALID_MONEY_AMOUNT/,
  );
  assert.throws(
    () =>
      b.parseObligationV1(
        obligation({ amount: { currency: 'SYP', amountMinor: '1500', scale: 0 } }),
      ),
    /UNSUPPORTED_MONEY_SCALE/,
  );
});

test('attempt references are masked on the wire; a full reference is refused', () => {
  const intentId = id();
  const attempt = (reference) => ({
    attemptId: id(),
    intentId,
    method: 'SHAM_CASH',
    status: 'PENDING_REVIEW',
    reference,
    claimed: SYP(150000),
    submittedAt: T1,
    reconciledAt: null,
  });
  const view = (reference) =>
    obligation({
      financialStatus: 'UNDER_REVIEW',
      activeIntent: {
        intentId,
        method: 'SHAM_CASH',
        status: 'UNDER_REVIEW',
        amount: SYP(150000),
        createdAt: T0,
        updatedAt: T1,
      },
      attempts: [attempt(reference)],
    });
  assert.equal(b.parseObligationV1(view('…AB12')).attempts[0].reference, '…AB12');
  assert.throws(
    () => b.parseObligationV1(view('TX-99887766AB12')),
    /INVALID_LENGTH|INVALID_FORMAT/,
  );
});

test('reconciliation and refund outcome requests: UNKNOWN never carries an amount or reference', () => {
  assert.throws(
    () =>
      b.parseReconcileAttemptRequestV1({
        expectedRevision: 3,
        outcome: 'UNKNOWN',
        observedAmount: SYP(1),
      }),
    /OBSERVED_AMOUNT_NOT_ALLOWED/,
  );
  assert.throws(
    () =>
      b.parseReconcileAttemptRequestV1({
        expectedRevision: 3,
        outcome: 'MATCHED',
        observedAmount: null,
      }),
    /OBSERVED_AMOUNT_REQUIRED/,
  );
  assert.throws(
    () =>
      b.parseRecordRefundOutcomeRequestV1({
        expectedRevision: 1,
        outcome: 'SUCCEEDED',
        reference: null,
      }),
    /REFUND_REFERENCE_REQUIRED/,
  );
  assert.throws(
    () =>
      b.parseRecordRefundOutcomeRequestV1({
        expectedRevision: 1,
        outcome: 'UNKNOWN',
        reference: 'RF-1234',
      }),
    /REFUND_REFERENCE_NOT_ALLOWED/,
  );
  assert.throws(
    () =>
      b.parseRequestRefundRequestV1({ expectedRevision: 2, amount: SYP(0), reason: 'GOODWILL' }),
    /ZERO_REFUND|INVALID_ENUM/,
  );
  assert.throws(
    () =>
      b.parseRequestRefundRequestV1({
        expectedRevision: 2,
        amount: SYP(10),
        reason: 'BOOKING_CANCELLED',
        note: 'customer phone 0933…',
      }),
    /UNEXPECTED_FIELD/,
  );
});

test('refund list totals are derived from items; in-flight refunds never count as refunded', () => {
  const obligationId = id();
  const refund = (status, minor, requestedAt, reference = null) => ({
    refundId: id(),
    obligationId,
    revision: status === 'REQUESTED' ? 1 : 2,
    status,
    reason: 'BOOKING_CANCELLED',
    method: 'SYRIATEL_CASH',
    amount: SYP(minor),
    reference,
    requestedAt,
    decidedAt: status === 'REQUESTED' ? null : T1,
    updatedAt: T1,
  });
  const items = [
    refund('OUTCOME_UNKNOWN', 30000, '2026-10-10T09:00:00.000Z'),
    refund('SUCCEEDED', 50000, '2026-10-10T08:30:00.000Z', '…9F01'),
    refund('FAILED', 20000, '2026-10-10T08:10:00.000Z'),
  ];
  const ok = {
    obligationId,
    refunded: SYP(50000),
    inFlight: SYP(30000),
    refundable: SYP(70000),
    items,
  };
  assert.equal(b.parseObligationRefundsV1(ok).refundable.amountMinor, '70000');
  // Counting an UNKNOWN refund as refunded is a provider defect.
  assert.throws(
    () => b.parseObligationRefundsV1({ ...ok, refunded: SYP(80000), inFlight: SYP(0) }),
    /INCONSISTENT_REFUNDED/,
  );
  // SUCCEEDED requires a reference; others must not carry one.
  assert.throws(
    () => b.parseRefundV1({ ...items[1], reference: null }),
    /INCONSISTENT_REFUND_REFERENCE/,
  );
  assert.throws(
    () => b.parseRefundV1({ ...items[0], decidedAt: null }),
    /INCONSISTENT_REFUND_DECISION/,
  );
});

test('billing events: closed data, legal refund transitions, no references or PII', () => {
  const envelope = (spec, aggregateType, data) => ({
    eventId: id(),
    eventType: spec.eventType,
    envelopeVersion: 2,
    producer: 'billing',
    occurredAt: T0,
    correlationId: id(),
    causationId: null,
    traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
    aggregate: { type: aggregateType, id: id(), version: 2 },
    actor: { kind: 'account', id: id() },
    data,
  });
  const refund = (previousStatus, status) =>
    envelope(events.BILLING_REFUND_STATUS_CHANGED_V1, 'billing-refund', {
      obligationId: id(),
      previousStatus,
      status,
      reason: 'BOOKING_CANCELLED',
      amount: SYP(500),
    });
  const parse = (e) => events.BILLING_REFUND_STATUS_CHANGED_V1.parse(e);
  parse(refund(null, 'REQUESTED'));
  parse(refund('REQUESTED', 'OUTCOME_UNKNOWN'));
  parse(refund('OUTCOME_UNKNOWN', 'SUCCEEDED'));
  assert.throws(() => parse(refund('SUCCEEDED', 'FAILED')), /INVALID_EVENT_DATA/);
  assert.throws(() => parse(refund('OUTCOME_UNKNOWN', 'OUTCOME_UNKNOWN')), /INVALID_EVENT_DATA/);
  assert.throws(() => parse(refund(null, 'SUCCEEDED')), /INVALID_EVENT_DATA/);
  const status = envelope(events.BILLING_OBLIGATION_STATUS_CHANGED_V1, 'billing-obligation', {
    previousFinancialStatus: 'UNDER_REVIEW',
    financialStatus: 'PAID',
    verified: SYP(150000),
    outstanding: SYP(0),
    providerReference: 'TX-99887766',
  });
  assert.throws(() => events.BILLING_OBLIGATION_STATUS_CHANGED_V1.parse(status), /UNEXPECTED/);
  for (const spec of events.BILLING_EVENTS_V1) {
    assert.equal(events.eventContract(spec.eventType).status, 'published-producer-pending');
  }
});

// ---------------------------------------------------------------- provider conformance

let provider;
let scratch;

/** Transpile the exact provider modules (no type check, no copy-edit) into a scratch tree. */
function loadProvider() {
  scratch = mkdtempSync(path.join(tmpdir(), 'p04e1-billing-provider-'));
  const src = path.join(root, 'services/billing/src');
  for (const dir of ['domain', 'ports', 'application']) {
    mkdirSync(path.join(scratch, dir), { recursive: true });
  }
  const files = [
    ...readdirSync(path.join(src, 'domain')).map((f) => `domain/${f}`),
    ...readdirSync(path.join(src, 'ports')).map((f) => `ports/${f}`),
    'application/views.ts',
    'application/custody-views.ts',
    'application/events.ts',
    'application/custody-events.ts',
  ].filter((f) => f.endsWith('.ts'));
  for (const file of files) {
    const out = ts.transpileModule(readFileSync(path.join(src, file), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    writeFileSync(path.join(scratch, file.replace(/\.ts$/, '.js')), out);
  }
  const scope = path.join(scratch, 'node_modules/@carwash');
  mkdirSync(scope, { recursive: true });
  symlinkSync(
    path.join(root, 'packages/event-contracts'),
    path.join(scope, 'event-contracts'),
    'junction',
  );
  const load = (m) => require(path.join(scratch, m));
  return {
    domain: load('domain/index.js'),
    views: load('application/views.js'),
    custodyViews: load('application/custody-views.js'),
    events: load('application/events.js'),
    custodyEvents: load('application/custody-events.js'),
  };
}

before(() => {
  provider = loadProvider();
});
after(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

const at = (iso) => new Date(iso);

function snapshot({ status = 'OPEN', verified = 0n, intent = null, attempts = [], cash = null }) {
  const { Money } = provider.domain;
  const obligationId = id();
  return {
    obligation: {
      id: obligationId,
      owner: { kind: 'account', subjectId: id() },
      quoteId: id(),
      amount: Money.of('SYP', 150000n),
      verified: Money.of('SYP', verified),
      status,
      revision: 3,
      createdAt: at(T0),
      updatedAt: at(T1),
    },
    activeIntent: intent && {
      id: id(),
      obligationId,
      method: intent.method,
      status: intent.status,
      amount: Money.of('SYP', 150000n),
      createdAt: at(T0),
      updatedAt: at(T1),
    },
    attempts: attempts.map((s, i) => ({
      id: id(),
      intentId: id(),
      obligationId,
      method: 'SHAM_CASH',
      providerReference: `TX${9000 + i}ABCD`,
      status: s,
      claimed: Money.of('SYP', 150000n),
      submittedAt: at(`2026-10-10T08:0${4 - i}:00.000Z`),
      reconciledAt: s === 'PENDING_REVIEW' ? null : at(T1),
      reconciledBy: s === 'PENDING_REVIEW' ? null : { kind: 'account', subjectId: id() },
      observed: null,
    })),
    cashReceipt: cash && {
      id: id(),
      obligationId,
      intentId: id(),
      bookingId: id(),
      assignmentId: id(),
      assignmentRevision: 2,
      collector: id(),
      amount: Money.of('SYP', 150000n),
      custodyStatus: 'HELD',
      handoverId: null,
      revision: 1,
      collectedAt: at(T1),
      updatedAt: at(T1),
    },
  };
}

test('provider conformance: every financial state the merged provider renders parses', () => {
  const cases = {
    UNPAID: snapshot({}),
    AWAITING_CASH: snapshot({
      intent: { method: 'CASH_ON_COMPLETION', status: 'AWAITING_CASH_COLLECTION' },
    }),
    AWAITING_PAYMENT: snapshot({
      intent: { method: 'SHAM_CASH', status: 'AWAITING_CUSTOMER_PAYMENT' },
    }),
    UNDER_REVIEW: snapshot({
      intent: { method: 'SHAM_CASH', status: 'UNDER_REVIEW' },
      attempts: ['PENDING_REVIEW', 'MISMATCHED'],
    }),
    OUTCOME_UNKNOWN: snapshot({
      intent: { method: 'SHAM_CASH', status: 'UNDER_REVIEW' },
      attempts: ['UNKNOWN'],
    }),
    PAID: snapshot({
      status: 'SETTLED',
      verified: 150000n,
      intent: { method: 'SYRIATEL_CASH', status: 'SUCCEEDED' },
      attempts: ['MATCHED'],
    }),
    CASH_COLLECTED: snapshot({
      status: 'SETTLED',
      verified: 150000n,
      intent: { method: 'CASH_ON_COMPLETION', status: 'SUCCEEDED' },
      cash: true,
    }),
    VOIDED: snapshot({ status: 'VOIDED' }),
  };
  for (const [expected, state] of Object.entries(cases)) {
    const view = JSON.parse(JSON.stringify(provider.views.obligationView(state)));
    assert.equal(b.parseObligationV1(view).financialStatus, expected, expected);
    const lean = JSON.parse(JSON.stringify(provider.views.financialStatusView(state)));
    assert.equal(b.parseFinancialStatusViewV1(lean).financialStatus, expected, expected);
    // The full provider reference never appears on the wire.
    assert.doesNotMatch(JSON.stringify(view), /TX9\d{3}ABCD/);
  }
});

test('provider conformance: custody views and the reconciliation report parse', () => {
  const { Money } = provider.domain;
  const holder = id();
  const receipt = {
    id: id(),
    obligationId: id(),
    intentId: id(),
    bookingId: id(),
    assignmentId: id(),
    assignmentRevision: 4,
    collector: holder,
    amount: Money.of('SYP', 150000n),
    custodyStatus: 'REVERSED',
    handoverId: null,
    revision: 2,
    collectedAt: at(T0),
    updatedAt: at(T1),
  };
  const reversal = {
    id: id(),
    receiptId: receipt.id,
    obligationId: receipt.obligationId,
    reason: 'WRONG_BOOKING',
    reversedBy: id(),
    reversedAt: at(T1),
  };
  const wire = (v) => JSON.parse(JSON.stringify(v));
  b.parseCashReceiptV1(wire(provider.custodyViews.receiptView(receipt, reversal)));
  const handover = {
    id: id(),
    holder,
    declared: Money.of('SYP', 300000n),
    receiptCount: 2,
    status: 'RECONCILED',
    counted: Money.of('SYP', 290000n),
    shortage: Money.of('SYP', 10000n),
    overage: null,
    treasuryReference: 'TRS20261010A',
    receivedBy: id(),
    receivedAt: at(T1),
    settlementReference: 'STL7788',
    reconciledBy: id(),
    reconciledAt: at(T1),
    cancelledBy: null,
    cancelledAt: null,
    revision: 3,
    createdAt: at(T0),
    updatedAt: at(T1),
  };
  const parsed = b.parseHandoverV1(
    wire(provider.custodyViews.handoverView({ handover, receiptIds: [id(), id()] })),
  );
  assert.equal(parsed.treasuryReference, '…010A');
  b.parseHolderPositionV1(
    wire(
      provider.custodyViews.holderPositionView({
        holder,
        balances: [
          {
            currency: 'SYP',
            ledgerCustody: Money.of('SYP', 150000n),
            held: Money.of('SYP', 150000n),
            heldCount: 1,
            inHandover: Money.zero('SYP'),
            inHandoverCount: 0,
            shortageOutstanding: Money.zero('SYP'),
          },
        ],
      }),
    ),
  );
  const report = (mismatches) =>
    wire(
      provider.custodyViews.reconciliationView({
        evaluatedAt: at(T1),
        holderMismatches: mismatches,
        holdersChecked: 3,
        receiptsWithoutSettledObligation: 0,
        cashSettlementsWithoutReceipt: 0,
        handoversPending: 1,
        handoversAwaitingReconciliation: 0,
        handoversWithDiscrepancy: 1,
        treasury: [
          {
            currency: 'SYP',
            unreconciled: Money.zero('SYP'),
            reconciled: Money.of('SYP', 290000n),
            shortageOutstanding: Money.of('SYP', 10000n),
            overageSuspense: Money.zero('SYP'),
          },
        ],
      }),
    );
  assert.equal(b.parseCustodyReconciliationReportV1(report([])).consistent, true);
  const mismatch = b.parseCustodyReconciliationReportV1(
    report([{ holder, currency: 'SYP', ledgerCustodyMinor: '-500', receiptsInCustodyMinor: '0' }]),
  );
  assert.equal(mismatch.consistent, false);
});

test('provider conformance: outbox envelopes parse with the published event contracts', () => {
  const { Money } = provider.domain;
  const actor = { kind: 'account', subjectId: id() };
  const context = {
    eventId: id(),
    occurredAt: at(T1),
    correlationId: id(),
    actor,
    obligationId: id(),
    revision: 4,
  };
  const rows = [
    [
      provider.events.obligationCreatedEvent(
        { quoteId: id(), amount: Money.of('SYP', 150000n).toWire(), financialStatus: 'UNPAID' },
        context,
      ),
      events.BILLING_OBLIGATION_CREATED_V1,
    ],
    [
      provider.events.obligationStatusChangedEvent(
        {
          previousFinancialStatus: 'AWAITING_CASH',
          financialStatus: 'CASH_COLLECTED',
          verified: Money.of('SYP', 150000n).toWire(),
          outstanding: Money.zero('SYP').toWire(),
        },
        context,
      ),
      events.BILLING_OBLIGATION_STATUS_CHANGED_V1,
    ],
  ];
  const custodyContext = { ...context, aggregateId: id(), eventId: id() };
  rows.push(
    [
      provider.custodyEvents.cashCollectedEvent(
        {
          obligationId: id(),
          bookingId: id(),
          assignmentId: id(),
          amount: Money.of('SYP', 150000n).toWire(),
          custodyStatus: 'HELD',
        },
        custodyContext,
      ),
      events.BILLING_CASH_COLLECTED_V1,
    ],
    [
      provider.custodyEvents.cashCollectionReversedEvent(
        {
          obligationId: id(),
          bookingId: id(),
          amount: Money.of('SYP', 150000n).toWire(),
          reason: 'DUPLICATE_RECORD',
        },
        custodyContext,
      ),
      events.BILLING_CASH_COLLECTION_REVERSED_V1,
    ],
    [
      provider.custodyEvents.custodyHandoverChangedEvent(
        {
          holder: id(),
          previousStatus: 'PENDING',
          status: 'RECEIVED',
          receiptCount: 2,
          declared: Money.of('SYP', 300000n).toWire(),
          counted: Money.of('SYP', 300000n).toWire(),
          shortage: null,
          overage: null,
        },
        custodyContext,
      ),
      events.BILLING_CUSTODY_HANDOVER_CHANGED_V1,
    ],
  );
  for (const [row, spec] of rows) {
    assert.equal(row.exchange, events.BILLING_EVENTS_EXCHANGE);
    assert.equal(row.routingKey, spec.eventType);
    spec.parse(JSON.parse(row.payload));
  }
});
