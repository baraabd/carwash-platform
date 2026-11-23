/**
 * P03-D3 pure rules (three staff roles, Dispatch commands, exact money and
 * reconciliation), executed on the TypeScript sources with Node's built-in
 * type stripping. Browser behaviour is covered by
 * tests/production/D/admin-live-finance.browser.mjs.
 */
/* global crypto -- Node 24 web global */
import test from 'node:test';
import assert from 'node:assert/strict';
import { capabilities, canOpen, defaultScreen, isStaff } from '../src/domain/access.ts';
import { allowedCommands, validateOffer } from '../src/domain/assignment.ts';
import {
  formatMoney,
  isOpenAttempt,
  parseAmount,
  validateReconciliation,
} from '../src/domain/finance.ts';

const session = (permissions, principalKind = 'account') => ({
  subject: crypto.randomUUID(),
  principalKind,
  roles: [],
  permissions,
});

/* The exact Identity role -> permission mapping (ROLE_PERMISSIONS, with P03-E1). */
const OPERATIONS = ['operations.dispatch'];
const FINANCE = ['billing.read', 'billing.refund', 'billing.reconcile'];
const SUPER_ADMIN = [
  'operations.dispatch',
  'billing.read',
  'billing.refund',
  'billing.reconcile',
  'verification.review',
  'support.cases.read',
];

test('three roles: operations, finance and super-admin each open exactly their screens', () => {
  const ops = capabilities(session(OPERATIONS));
  const fin = capabilities(session(FINANCE));
  const sup = capabilities(session(SUPER_ADMIN));
  const screens = (caps) =>
    ['dashboard', 'bookings', 'technicians', 'payments'].filter((s) => canOpen(s, caps));
  assert.deepEqual(screens(ops), ['dashboard', 'bookings', 'technicians']);
  assert.deepEqual(screens(fin), ['payments']);
  assert.deepEqual(screens(sup), ['dashboard', 'bookings', 'technicians', 'payments']);
  assert.equal(defaultScreen(fin), 'payments');
  assert.equal(ops.assignmentActions, true);
  assert.equal(ops.reconcile, false);
  assert.equal(fin.assignmentActions, false);
  assert.equal(fin.reconcile, true);
  assert.equal(sup.assignmentActions && sup.reconcile, true);
  // Finance without the reconcile permission (main before P03-E1) reads only.
  const readOnly = capabilities(session(['billing.read', 'billing.refund']));
  assert.equal(readOnly.payments && !readOnly.reconcile, true);
  assert.equal(isStaff(capabilities(session(['billing.read'], 'guest'))), false);
});

test('assignment commands follow Dispatch transitions; cancelled jobs offer none', () => {
  assert.deepEqual(allowedCommands('UNASSIGNED'), ['offer']);
  assert.deepEqual(allowedCommands('OFFERED'), ['reassign', 'unassign']);
  assert.deepEqual(allowedCommands('ASSIGNED'), ['reassign', 'unassign']);
  assert.deepEqual(allowedCommands('CANCELLED'), []);
});

test('offer target: full ids only, normalised; both problems reported at once', () => {
  const resource = crypto.randomUUID();
  const technician = crypto.randomUUID();
  assert.deepEqual(
    validateOffer({ resourceId: ` ${resource.toUpperCase()} `, technicianSubjectId: technician }),
    { ok: true, value: { resourceId: resource, technicianSubjectId: technician } },
  );
  assert.deepEqual(validateOffer({ resourceId: 'abc', technicianSubjectId: '' }), {
    ok: false,
    problems: ['RESOURCE_REQUIRED', 'TECHNICIAN_REQUIRED'],
  });
});

test('money: exact minor units both ways, no float, no rounding', () => {
  assert.equal(formatMoney({ currency: 'SYP', amountMinor: '150050', scale: 2 }), '1,500.50 SYP');
  assert.equal(formatMoney({ currency: 'SYP', amountMinor: '5', scale: 2 }), '0.05 SYP');
  assert.equal(
    formatMoney({ currency: 'USD', amountMinor: '900719925474099312', scale: 2 }),
    '9,007,199,254,740,993.12 USD',
  );
  assert.equal(formatMoney({ currency: 'SYP', amountMinor: '1.5', scale: 2 }), '—');
  assert.deepEqual(parseAmount('1,500.5', 'SYP', 2), {
    ok: true,
    value: { currency: 'SYP', amountMinor: '150050', scale: 2 },
  });
  assert.deepEqual(parseAmount('0.07', 'SYP', 2).value.amountMinor, '7');
  assert.deepEqual(parseAmount('0', 'SYP', 2).value.amountMinor, '0');
  assert.equal(parseAmount('1.234', 'SYP', 2).problem, 'AMOUNT_TOO_PRECISE');
  assert.equal(parseAmount('', 'SYP', 2).problem, 'AMOUNT_REQUIRED');
  for (const bad of ['-1', '1e3', '١٠', '01', '1.', '.5', '12a'])
    assert.equal(parseAmount(bad, 'SYP', 2).problem, 'AMOUNT_INVALID', bad);
});

test('reconciliation: MATCHED/MISMATCHED need the statement amount; UNKNOWN records none', () => {
  const base = { currency: 'SYP', scale: 2 };
  assert.deepEqual(validateReconciliation({ ...base, outcome: 'MATCHED', observed: '2500' }), {
    ok: true,
    value: {
      outcome: 'MATCHED',
      observedAmount: { currency: 'SYP', amountMinor: '250000', scale: 2 },
    },
  });
  assert.deepEqual(validateReconciliation({ ...base, outcome: 'UNKNOWN', observed: 'ignored' }), {
    ok: true,
    value: { outcome: 'UNKNOWN', observedAmount: null },
  });
  assert.equal(
    validateReconciliation({ ...base, outcome: 'MISMATCHED', observed: '' }).problem,
    'AMOUNT_REQUIRED',
  );
  assert.equal(
    validateReconciliation({ ...base, outcome: 'PAID', observed: '1' }).problem,
    'OUTCOME_REQUIRED',
  );
  assert.equal(isOpenAttempt('PENDING_REVIEW'), true);
  assert.equal(isOpenAttempt('UNKNOWN'), true);
  assert.equal(isOpenAttempt('MATCHED'), false);
});
