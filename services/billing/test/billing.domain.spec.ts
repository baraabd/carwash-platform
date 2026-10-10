import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  MAX_ATTEMPTS_PER_OBLIGATION,
  Money,
  MoneyError,
  PaymentRuleError,
  assertBalancedJournal,
  financialStatus,
  maskProviderReference,
  normalizeProviderReference,
  obligationBilledJournal,
  obligationVoidedJournal,
  creditAllocatedJournal,
  creditReceivedJournal,
  refundPaidJournal,
  planAttemptSubmission,
  planMethodSelection,
  planReconciliation,
  planVoid,
  type ObligationState,
} from '../src/domain';
import {
  obligationCreatedEvent,
  obligationStatusChangedEvent,
  parseObligationStatusChangedData,
} from '../src/application';
import { canonicalJson } from '../src/application/canonical-json';
import { parseEnvelopeV2 } from '@carwash/event-contracts';

/* Pure domain invariants: no Nest, HTTP, Prisma or database. */

const syp = (minor: bigint) => Money.of('SYP', minor);
const open = (amount = 150_000n, verified = 0n): ObligationState => ({
  amount: syp(amount),
  verified: syp(verified),
  status: 'OPEN',
});
const rule = (code: string) => (error: unknown) =>
  error instanceof PaymentRuleError && error.code === code;
const moneyRule = (code: string) => (error: unknown) =>
  error instanceof MoneyError && error.code === code;

test('Money: exact bigint minor units beyond 2^53, strict published wire shape', () => {
  const big = Money.parse({ currency: 'SYP', amountMinor: '450000000000035001', scale: 2 });
  assert.equal(big.amountMinor, 450_000_000_000_035_001n);
  assert.deepEqual(big.toWire(), { currency: 'SYP', amountMinor: '450000000000035001', scale: 2 });
  assert.equal(big.plus(syp(1n)).amountMinor, 450_000_000_000_035_002n);
  assert.throws(
    () => Money.parse({ currency: 'SYP', amountMinor: 1500, scale: 2 }),
    moneyRule('MONEY_INVALID'),
    'JSON numbers are never accepted as amounts',
  );
  assert.throws(
    () => Money.parse({ currency: 'SYP', amountMinor: '1.5', scale: 2 }),
    moneyRule('MONEY_INVALID'),
  );
  assert.throws(
    () => Money.parse({ currency: 'SYP', amountMinor: '-1', scale: 2 }),
    moneyRule('MONEY_INVALID'),
  );
  assert.throws(
    () => Money.parse({ currency: 'SYP', amountMinor: '01', scale: 2 }),
    moneyRule('MONEY_INVALID'),
  );
  assert.throws(
    () => Money.parse({ currency: 'SYP', amountMinor: '100', scale: 0 }),
    moneyRule('CURRENCY_UNSUPPORTED'),
    'a different scale is rejected, never rescaled',
  );
  assert.throws(
    () => Money.parse({ currency: 'EUR', amountMinor: '100', scale: 2 }),
    moneyRule('CURRENCY_UNSUPPORTED'),
  );
  assert.throws(
    () => Money.parse({ currency: 'SYP', amountMinor: '100', scale: 2, extra: 1 }),
    moneyRule('MONEY_INVALID'),
  );
  assert.throws(() => Money.of('SYP', 10n ** 18n), moneyRule('MONEY_OUT_OF_RANGE'));
  assert.throws(() => syp(1n).plus(Money.of('USD', 1n)), moneyRule('CURRENCY_MISMATCH'));
  assert.throws(() => syp(1n).minus(syp(2n)), moneyRule('MONEY_INVALID'));
});

test('method selection fixes the outstanding amount and never verifies money', () => {
  const plan = planMethodSelection({ obligation: open(), current: null, method: 'SHAM_CASH' });
  assert.deepEqual(
    { supersede: plan.supersedeCurrent, status: plan.status, amount: plan.amount.amountMinor },
    { supersede: false, status: 'AWAITING_CUSTOMER_PAYMENT', amount: 150_000n },
  );
  const cash = planMethodSelection({
    obligation: open(),
    current: { method: 'SHAM_CASH', status: 'AWAITING_CUSTOMER_PAYMENT' },
    method: 'CASH_ON_COMPLETION',
  });
  assert.equal(cash.status, 'AWAITING_CASH_COLLECTION');
  assert.equal(cash.supersedeCurrent, true);
  assert.throws(
    () =>
      planMethodSelection({
        obligation: open(),
        current: { method: 'SHAM_CASH', status: 'UNDER_REVIEW' },
        method: 'SYRIATEL_CASH',
      }),
    rule('PAYMENT_IN_REVIEW'),
  );
  assert.throws(
    () =>
      planMethodSelection({
        obligation: open(),
        current: { method: 'SHAM_CASH', status: 'AWAITING_CUSTOMER_PAYMENT' },
        method: 'SHAM_CASH',
      }),
    rule('METHOD_UNCHANGED'),
  );
  assert.throws(
    () =>
      planMethodSelection({
        obligation: { ...open(), verified: syp(150_000n), status: 'SETTLED' },
        current: null,
        method: 'SHAM_CASH',
      }),
    rule('OBLIGATION_SETTLED'),
  );
  assert.throws(
    () =>
      planMethodSelection({
        obligation: { ...open(), status: 'VOIDED' },
        current: null,
        method: 'SHAM_CASH',
      }),
    rule('OBLIGATION_VOIDED'),
  );
});

test('attempts are accepted only for an electronic intent awaiting payment, bounded', () => {
  const intent = { method: 'SYRIATEL_CASH' as const, status: 'AWAITING_CUSTOMER_PAYMENT' as const };
  planAttemptSubmission({ obligation: open(), intent, attemptsSoFar: 0 });
  assert.throws(
    () => planAttemptSubmission({ obligation: open(), intent: null, attemptsSoFar: 0 }),
    rule('NO_ACTIVE_INTENT'),
  );
  assert.throws(
    () =>
      planAttemptSubmission({
        obligation: open(),
        intent: { method: 'CASH_ON_COMPLETION', status: 'AWAITING_CASH_COLLECTION' },
        attemptsSoFar: 0,
      }),
    rule('INTENT_NOT_ACCEPTING_ATTEMPTS'),
  );
  assert.throws(
    () =>
      planAttemptSubmission({
        obligation: open(),
        intent: { ...intent, status: 'UNDER_REVIEW' },
        attemptsSoFar: 1,
      }),
    rule('INTENT_NOT_ACCEPTING_ATTEMPTS'),
  );
  assert.throws(
    () =>
      planAttemptSubmission({
        obligation: open(),
        intent,
        attemptsSoFar: MAX_ATTEMPTS_PER_OBLIGATION,
      }),
    rule('ATTEMPT_LIMIT_REACHED'),
  );
});

test('reconciliation: a reviewer can never MATCH; UNKNOWN is never success', () => {
  // Money is recognised only by allocating a confirmed provider credit
  // (planCreditAllocation, billing.provider.domain.spec.ts).
  for (const attemptStatus of ['PENDING_REVIEW', 'UNKNOWN'] as const)
    assert.throws(
      () =>
        planReconciliation({
          obligation: open(),
          attemptStatus,
          outcome: 'MATCHED',
          observed: syp(150_000n),
        }),
      rule('PROVIDER_CREDIT_REQUIRED'),
    );

  const unknown = planReconciliation({
    obligation: open(),
    attemptStatus: 'PENDING_REVIEW',
    outcome: 'UNKNOWN',
    observed: null,
  });
  assert.deepEqual(
    [unknown.attemptStatus, unknown.intentStatus, unknown.obligationStatus],
    ['UNKNOWN', 'UNDER_REVIEW', 'OPEN'],
  );

  const mismatched = planReconciliation({
    obligation: open(),
    attemptStatus: 'UNKNOWN',
    outcome: 'MISMATCHED',
    observed: syp(100n),
  });
  assert.deepEqual(
    [mismatched.attemptStatus, mismatched.intentStatus, mismatched.obligationStatus],
    ['MISMATCHED', 'AWAITING_CUSTOMER_PAYMENT', 'OPEN'],
  );

  assert.throws(
    () =>
      planReconciliation({
        obligation: open(),
        attemptStatus: 'PENDING_REVIEW',
        outcome: 'UNKNOWN',
        observed: syp(1n),
      }),
    rule('OBSERVED_AMOUNT_NOT_ALLOWED'),
  );
  assert.throws(
    () =>
      planReconciliation({
        obligation: open(),
        attemptStatus: 'UNKNOWN',
        outcome: 'UNKNOWN',
        observed: null,
      }),
    rule('ALREADY_UNKNOWN'),
  );
  for (const attemptStatus of ['MATCHED', 'MISMATCHED'] as const)
    assert.throws(
      () =>
        planReconciliation({
          obligation: open(),
          attemptStatus,
          outcome: 'MISMATCHED',
          observed: null,
        }),
      rule('ATTEMPT_NOT_OPEN'),
    );
});

test('void is compensation only before any payment was reported', () => {
  planVoid({ obligation: open(), attemptsSoFar: 0 });
  assert.throws(() => planVoid({ obligation: open(), attemptsSoFar: 1 }), rule('VOID_NOT_ALLOWED'));
  assert.throws(
    () => planVoid({ obligation: { ...open(), status: 'VOIDED' }, attemptsSoFar: 0 }),
    rule('OBLIGATION_VOIDED'),
  );
});

test('financial status is derived from server facts only', () => {
  const awaiting = { method: 'SHAM_CASH' as const, status: 'AWAITING_CUSTOMER_PAYMENT' as const };
  const review = { method: 'SHAM_CASH' as const, status: 'UNDER_REVIEW' as const };
  const cash = {
    method: 'CASH_ON_COMPLETION' as const,
    status: 'AWAITING_CASH_COLLECTION' as const,
  };
  const cases: [Parameters<typeof financialStatus>[0], string][] = [
    [
      {
        obligation: open(),
        activeIntent: null,
        hasUnknownAttempt: false,
        settledByCash: false,
        refunded: null,
      },
      'UNPAID',
    ],
    [
      {
        obligation: open(),
        activeIntent: cash,
        hasUnknownAttempt: false,
        settledByCash: false,
        refunded: null,
      },
      'AWAITING_CASH',
    ],
    [
      {
        obligation: open(),
        activeIntent: awaiting,
        hasUnknownAttempt: false,
        settledByCash: false,
        refunded: null,
      },
      'AWAITING_PAYMENT',
    ],
    [
      {
        obligation: open(),
        activeIntent: review,
        hasUnknownAttempt: false,
        settledByCash: false,
        refunded: null,
      },
      'UNDER_REVIEW',
    ],
    [
      {
        obligation: open(),
        activeIntent: review,
        hasUnknownAttempt: true,
        settledByCash: false,
        refunded: null,
      },
      'OUTCOME_UNKNOWN',
    ],
    [
      {
        obligation: { ...open(), verified: syp(150_000n), status: 'SETTLED' },
        activeIntent: null,
        hasUnknownAttempt: false,
        settledByCash: false,
        refunded: null,
      },
      'PAID',
    ],
    [
      {
        obligation: { ...open(), verified: syp(150_000n), status: 'SETTLED' },
        activeIntent: null,
        hasUnknownAttempt: false,
        settledByCash: true,
        refunded: null,
      },
      'CASH_COLLECTED',
    ],
    [
      {
        obligation: { ...open(), verified: syp(150_000n), status: 'SETTLED' },
        activeIntent: null,
        hasUnknownAttempt: false,
        settledByCash: false,
        refunded: syp(0n),
      },
      'PAID',
    ],
    [
      {
        obligation: { ...open(), verified: syp(150_000n), status: 'SETTLED' },
        activeIntent: null,
        hasUnknownAttempt: false,
        settledByCash: false,
        refunded: syp(50_000n),
      },
      'PARTIALLY_REFUNDED',
    ],
    [
      {
        obligation: { ...open(), verified: syp(150_000n), status: 'SETTLED' },
        activeIntent: null,
        hasUnknownAttempt: false,
        settledByCash: false,
        refunded: syp(150_000n),
      },
      'REFUNDED',
    ],
    [
      {
        obligation: { ...open(), status: 'VOIDED' },
        activeIntent: null,
        hasUnknownAttempt: false,
        settledByCash: false,
        refunded: null,
      },
      'VOIDED',
    ],
  ];
  for (const [input, expected] of cases) assert.equal(financialStatus(input), expected);
});

test('provider references normalise case/separators and are only ever shown masked', () => {
  assert.equal(normalizeProviderReference('ab-12cd-99'), 'AB12CD99');
  assert.equal(normalizeProviderReference('AB12CD99'), 'AB12CD99');
  for (const bad of ['abc', 'a b c d', '----', 'x'.repeat(65), 12345678, null, 'تحويل123'])
    assert.equal(normalizeProviderReference(bad), null, String(bad));
  assert.equal(maskProviderReference('AB12CD99'), '…CD99');
});

test('journals are balanced double entry; unbalanced input is refused', () => {
  const id = randomUUID();
  for (const journal of [
    obligationBilledJournal(id, syp(150_000n)),
    obligationVoidedJournal(id, syp(150_000n)),
    creditReceivedJournal(id, 'SHAM_CASH', syp(150_000n)),
    creditReceivedJournal(id, 'SYRIATEL_CASH', syp(150_000n)),
    creditAllocatedJournal(id, syp(150_000n)),
    refundPaidJournal(id, 'SHAM_CASH', syp(50_000n), true),
    refundPaidJournal(id, 'SYRIATEL_CASH', syp(50_000n), false),
  ]) {
    let net = 0n;
    for (const line of journal.lines)
      net += line.side === 'DEBIT' ? line.amount.amountMinor : -line.amount.amountMinor;
    assert.equal(net, 0n, journal.kind);
    assert.match(journal.businessRef, /^[a-z]+:[0-9a-f-]{36}:[a-z]+$/);
  }
  assert.throws(() => creditReceivedJournal(id, 'CASH_ON_COMPLETION', syp(1n)));
  assert.throws(
    () =>
      assertBalancedJournal([
        { accountId: 'A', currency: 'SYP', side: 'DEBIT', amountMinor: '100' },
        { accountId: 'B', currency: 'SYP', side: 'CREDIT', amountMinor: '99' },
      ]),
    /UNBALANCED_JOURNAL/,
  );
  assert.throws(
    () =>
      assertBalancedJournal([
        { accountId: 'A', currency: 'SYP', side: 'DEBIT', amountMinor: '100' },
        { accountId: 'B', currency: 'USD', side: 'CREDIT', amountMinor: '100' },
      ]),
    /UNBALANCED_JOURNAL/,
    'balance is per currency',
  );
});

test('outbox events are valid envelope v2 and carry no provider reference or PII', () => {
  const obligationId = randomUUID();
  const context = {
    eventId: randomUUID(),
    occurredAt: new Date('2026-10-08T10:00:00.000Z'),
    correlationId: randomUUID(),
    actor: { kind: 'guest' as const, subjectId: randomUUID() },
    obligationId,
    revision: 1,
  };
  const created = obligationCreatedEvent(
    { quoteId: randomUUID(), amount: syp(150_000n).toWire(), financialStatus: 'UNPAID' },
    context,
  );
  const envelope = parseEnvelopeV2(
    JSON.parse(created.payload),
    {
      eventType: 'billing.obligation-created.v1',
      producer: 'billing',
      aggregateType: 'billing-obligation',
    },
    (data) => data,
  );
  assert.equal(envelope.aggregate.id, obligationId);
  assert.equal(created.routingKey, 'billing.obligation-created.v1');
  const changed = obligationStatusChangedEvent(
    {
      previousFinancialStatus: 'UNDER_REVIEW',
      financialStatus: 'PAID',
      verified: syp(150_000n).toWire(),
      outstanding: syp(0n).toWire(),
    },
    { ...context, eventId: randomUUID(), revision: 4 },
  );
  assert.equal(
    (JSON.parse(changed.payload) as { aggregate: { version: number } }).aggregate.version,
    4,
  );
  assert.throws(
    () =>
      parseObligationStatusChangedData({
        previousFinancialStatus: 'PAID',
        financialStatus: 'PAID',
        verified: syp(1n).toWire(),
        outstanding: syp(0n).toWire(),
      }),
    'a status-changed event must change the status',
  );
  assert.throws(() =>
    obligationCreatedEvent(
      { quoteId: 'not-a-uuid', amount: syp(1n).toWire(), financialStatus: 'UNPAID' },
      context,
    ),
  );
});

test('request fingerprints ignore key order but not values', () => {
  assert.equal(canonicalJson({ b: 1, a: [2, 1] }), canonicalJson({ a: [2, 1], b: 1 }));
  assert.notEqual(canonicalJson({ a: [1, 2] }), canonicalJson({ a: [2, 1] }));
  assert.throws(() => canonicalJson({ a: Number.NaN }), /NON_FINITE_NUMBER/);
});
