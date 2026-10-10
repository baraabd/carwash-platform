/**
 * P04-D2 pure rules for exception cases (which controls to offer, the
 * decision form, exact amounts, Damascus service windows, priority and age),
 * executed on the TypeScript sources with Node's built-in type stripping.
 * Support and the owners enforce every rule again; browser behaviour is in
 * tests/production/D/admin-exceptions.browser.mjs.
 */
/* global crypto -- Node 24 web global */
import test from 'node:test';
import assert from 'node:assert/strict';
import { capabilities, canOpen, defaultScreen, isStaff } from '../src/domain/access.ts';
import {
  age,
  canApprove,
  canOpenKind,
  damascusWindow,
  decidableActions,
  isResendable,
  priority,
  readableKinds,
  validateDecision,
} from '../src/domain/cases.ts';
import { parseAmount } from '../src/domain/finance.ts';

const FINANCE = ['billing.read', 'billing.refund', 'billing.reconcile'];
const OPERATIONS = ['operations.dispatch'];
const SUPPORT = ['support.cases.read', 'support.cases.write'];
const session = (permissions) => ({
  subject: crypto.randomUUID(),
  principalKind: 'account',
  roles: [],
  permissions,
});

test('desks: finance and operations see their own kinds; the support desk reads all, decides none', () => {
  assert.deepEqual(readableKinds(FINANCE), ['PAYMENT_REVIEW', 'REFUND', 'LATE_PAYMENT']);
  assert.deepEqual(readableKinds(OPERATIONS), ['BOOKING_CANCELLATION', 'BOOKING_RESCHEDULE']);
  assert.equal(readableKinds(SUPPORT).length, 5);
  assert.deepEqual(decidableActions('PAYMENT_REVIEW', 'OPEN', SUPPORT), []);
  assert.deepEqual(decidableActions('PAYMENT_REVIEW', 'OPEN', OPERATIONS), []);
  assert.deepEqual(decidableActions('BOOKING_CANCELLATION', 'OPEN', FINANCE), []);
  assert.equal(canOpenKind('REFUND', FINANCE), true);
  assert.equal(canOpenKind('BOOKING_RESCHEDULE', FINANCE), false);
  // The support desk gets a console with only the disputes screen.
  const desk = capabilities(session(SUPPORT));
  assert.equal(isStaff(desk), true);
  assert.equal(defaultScreen(desk), 'disputes');
  assert.equal(canOpen('payments', desk), false);
  assert.equal(canOpen('disputes', capabilities(session(OPERATIONS))), true);
});

test('decisions are offered only when nothing is in flight with the owner', () => {
  assert.deepEqual(decidableActions('PAYMENT_REVIEW', 'OPEN', FINANCE), [
    'APPROVE_MATCH',
    'REJECT_MISMATCH',
    'MARK_UNKNOWN',
    'DISMISS',
  ]);
  assert.deepEqual(decidableActions('PAYMENT_REVIEW', 'OUTCOME_UNKNOWN', FINANCE), []);
  assert.deepEqual(decidableActions('REFUND', 'AWAITING_APPROVAL', FINANCE), []);
  // Without the reconcile grant only closing remains.
  assert.deepEqual(decidableActions('PAYMENT_REVIEW', 'OPEN', ['billing.read', 'billing.refund']), [
    'DISMISS',
  ]);
  assert.equal(isResendable('OUTCOME_UNKNOWN'), true);
  assert.equal(isResendable('APPLIED'), false);
});

test('four-eyes: the proposer never sees an approve control', () => {
  const proposer = crypto.randomUUID();
  const base = { caseStatus: 'AWAITING_APPROVAL', decisionStatus: 'AWAITING_APPROVAL', proposer };
  assert.equal(canApprove({ ...base, viewer: proposer, permissions: FINANCE }), false);
  assert.equal(canApprove({ ...base, viewer: crypto.randomUUID(), permissions: FINANCE }), true);
  assert.equal(
    canApprove({ ...base, viewer: crypto.randomUUID(), permissions: ['billing.read'] }),
    false,
  );
});

test('decision form: reason note, evidence and an exact amount, never rounded', () => {
  const amount = (raw) => parseAmount(raw, 'SYP', 2);
  const base = {
    kind: 'PAYMENT_REVIEW',
    action: 'APPROVE_MATCH',
    reasonCode: 'PROVIDER_CONFIRMED',
    note: 'Statement line 42 matches exactly',
    evidence: [{ kind: 'PROVIDER_STATEMENT', reference: 'STMT-2026-10-11-0042' }],
    amount: amount('1,500.50'),
    window: null,
  };
  assert.deepEqual(validateDecision(base), {
    ok: true,
    value: {
      action: 'APPROVE_MATCH',
      reason: { code: 'PROVIDER_CONFIRMED', note: 'Statement line 42 matches exactly' },
      evidence: [{ kind: 'PROVIDER_STATEMENT', reference: 'STMT-2026-10-11-0042' }],
      amount: { currency: 'SYP', amountMinor: '150050', scale: 2 },
    },
  });
  assert.equal(validateDecision({ ...base, action: '' }).problem, 'ACTION_REQUIRED');
  assert.equal(validateDecision({ ...base, action: 'CANCEL_BOOKING' }).problem, 'ACTION_REQUIRED');
  assert.equal(
    validateDecision({ ...base, reasonCode: 'CUSTOMER_REQUEST' }).problem,
    'REASON_REQUIRED',
  );
  assert.equal(validateDecision({ ...base, note: '  ok  ' }).problem, 'NOTE_TOO_SHORT');
  assert.equal(validateDecision({ ...base, evidence: [] }).problem, 'EVIDENCE_REQUIRED');
  assert.equal(
    validateDecision({ ...base, evidence: [{ kind: 'CALL_NOTE', reference: '+963 912 345 678' }] })
      .problem,
    'EVIDENCE_INVALID',
  );
  assert.equal(
    validateDecision({ ...base, amount: amount('1500.505') }).problem,
    'AMOUNT_TOO_PRECISE',
  );
  assert.equal(validateDecision({ ...base, amount: null }).problem, 'AMOUNT_REQUIRED');
  // UNKNOWN carries no amount and needs no evidence.
  const unknown = validateDecision({ ...base, action: 'MARK_UNKNOWN', evidence: [], amount: null });
  assert.equal(unknown.ok, true);
  assert.equal('amount' in unknown.value, false);
  // A refund of nothing is refused.
  assert.equal(
    validateDecision({
      ...base,
      kind: 'REFUND',
      action: 'REFUND',
      reasonCode: 'DUPLICATE_PAYMENT',
      amount: amount('0'),
    }).problem,
    'AMOUNT_INVALID',
  );
});

test('reschedule window: Damascus wall time to exact UTC, future, ordered, at most 12 hours', () => {
  const now = Date.parse('2026-10-11T06:00:00Z');
  assert.deepEqual(damascusWindow('2026-10-12', '09:00', '10:30', now), {
    startsAt: '2026-10-12T06:00:00.000Z',
    endsAt: '2026-10-12T07:30:00.000Z',
  });
  assert.equal(damascusWindow('2026-10-11', '08:00', '10:00', now), null);
  assert.equal(damascusWindow('2026-10-12', '10:00', '09:00', now), null);
  assert.equal(damascusWindow('2026-10-12', '06:00', '19:00', now), null);
  assert.equal(damascusWindow('2026-13-12', '06:00', '07:00', now), null);
  const draft = validateDecision({
    kind: 'BOOKING_RESCHEDULE',
    action: 'RESCHEDULE_BOOKING',
    reasonCode: 'TECHNICIAN_UNAVAILABLE',
    note: 'No technician free in the slot',
    evidence: [],
    amount: null,
    window: null,
  });
  assert.equal(draft.problem, 'WINDOW_INVALID');
});

test('priority and age are derived from Support status and time only', () => {
  assert.equal(priority('OUTCOME_UNKNOWN'), 'HIGH');
  assert.equal(priority('OWNER_REJECTED'), 'HIGH');
  assert.equal(priority('OPEN'), 'MEDIUM');
  assert.equal(priority('RESOLVED'), 'LOW');
  const now = Date.parse('2026-10-11T12:00:00Z');
  assert.equal(age('2026-10-11T11:15:00Z', now), '45m');
  assert.equal(age('2026-10-11T06:00:00Z', now), '6h');
  assert.equal(age('2026-10-08T12:00:00Z', now), '3d');
});
