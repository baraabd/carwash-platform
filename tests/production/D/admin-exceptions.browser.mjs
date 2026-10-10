/**
 * P04-D2 browser journeys: payment verification, mismatch, refunds and
 * booking exceptions in the admin console, on real services (see
 * `_admin-stack.mjs`).
 *
 *   X1 finance approves a match and rejects a mismatch through a Support case;
 *      Billing (the owner) records the staff actor and the console's
 *      correlation id; Support's audit carries the same id.
 *   X2 a lost answer: the form locks to the same request; the resend replays
 *      the same Idempotency-Key; a refresh shows Support's authoritative state;
 *      Billing acted exactly once.
 *   X3 refund four-eyes: the proposer cannot approve (UI and server); a second
 *      finance reviewer approves; Billing's refund command is unpublished, so
 *      the case shows "waiting for owner" and Billing still holds the money.
 *   X4 operations opens cancellation and reschedule cases from the booking
 *      detail; Booking's state is read live and stays unchanged (owner command
 *      unpublished, CR-D-P04-03).
 *   X5 denials: operations cannot reach finance cases, the support desk reads
 *      but cannot decide, customers/technicians/anonymous are refused, and
 *      Billing itself refuses a super-admin deciding its own payment.
 *   A11Y the disputes screen and the case dialog; V1 reference / candidate /
 *      diff screenshots of the disputes screen at three widths.
 *
 *   node scripts/production/D/run-real-infra.mjs --browser --suite admin-exceptions
 */
/* global document, crypto -- page.evaluate callbacks run in the browser */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { ROOT, appDsn, context } from '../../integration/_support.mjs';
import { STAFF_PASSWORD, account, staff } from './_identity.mjs';
import {
  commandKey,
  createBooking,
  dist,
  listen,
  obligationUnderReview,
  ok2xx,
  owned,
  ownerCall,
  ownerRows,
  startStack,
} from './_admin-stack.mjs';
import { comparePngBuffers } from '../../../scripts/f010/pixel-compare.mjs';

const require = createRequire(path.join(ROOT, 'package.json'));
const EVIDENCE = path.join(ROOT, 'docs', 'production', 'D', 'evidence', 'p04-d2');
const REFERENCE = path.join(ROOT, 'design', 'reference', 'approved', 'washgo-admin-prototype.html');
const TIMEZONE = 'Asia/Damascus';
const MIN = 60_000;
const DISABLE_MOTION = `*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}`;

let stack;
let browser;
let reportingDb;
const principals = {};
const sessions = new Map();
const report = {
  journeys: {},
  accessibility: {},
  visual: [],
  audit: {},
  billingLedgerGrant: null,
};

/* ------------------------------- fixtures ------------------------------- */

/** Reporting rows through Reporting's own projector, so the booking is listed. */
async function projectBooking(booking, customerId) {
  const { OperationsProjector, parseOperationsEvent } = dist(
    'reporting',
    'application/operations.service.js',
  );
  const { PrismaOperationsWriter } = dist(
    'reporting',
    'infrastructure/persistence/prisma-operations.store.js',
  );
  const { sha256Hex } = dist('reporting', 'infrastructure/persistence/prisma-projection.store.js');
  const projector = new OperationsProjector(sha256Hex, { now: () => new Date() });
  const facts = [
    parseOperationsEvent({
      eventId: randomUUID(),
      eventType: 'booking.confirmed.v1',
      schemaVersion: 1,
      producer: 'booking',
      occurredAt: new Date(Date.now() - 2 * MIN).toISOString(),
      correlationId: randomUUID(),
      aggregateVersion: 1,
      data: { bookingId: booking.bookingId, customerId },
    }).fact,
    parseOperationsEvent({
      eventId: randomUUID(),
      eventType: 'scheduling.hold-changed.v1',
      envelopeVersion: 2,
      producer: 'scheduling',
      occurredAt: new Date(Date.now() - MIN).toISOString(),
      correlationId: randomUUID(),
      causationId: null,
      traceparent: null,
      aggregate: { type: 'hold', id: booking.holdId, version: 2 },
      actor: { kind: 'service', id: 'scheduling' },
      data: {
        state: 'COMMITTED',
        zoneId: booking.zoneId,
        startsAt: new Date(booking.startsAt).toISOString(),
        endsAt: new Date(booking.endsAt).toISOString(),
        bookingId: booking.bookingId,
      },
    }).fact,
  ];
  for (const fact of facts)
    await reportingDb.$transaction((tx) => projector.apply(new PrismaOperationsWriter(tx), fact));
}

/** A finance-side MATCH through Support's HTTP API (fixture for the refund journey). */
async function paidThroughSupport(finance, payer, amountMinor) {
  const due = await obligationUnderReview(stack, payer, amountMinor);
  const support = (route, init) =>
    ownerCall(stack.services.support.origin, '/internal/v1/support/cases', finance, route, init);
  const opened = await support('', {
    method: 'POST',
    key: commandKey(),
    body: {
      kind: 'PAYMENT_REVIEW',
      subject: { type: 'billing.payment-attempt', id: due.attemptId, parentId: due.obligationId },
      summary: 'Fixture payment review',
    },
  });
  assert.equal(opened.status, 201, JSON.stringify(opened.body));
  const decided = await support(`/${opened.body.case.caseId}/decisions`, {
    method: 'POST',
    key: commandKey(),
    body: {
      action: 'APPROVE_MATCH',
      reason: { code: 'PROVIDER_CONFIRMED', note: 'Fixture statement line matches' },
      evidence: [{ kind: 'PROVIDER_STATEMENT', reference: 'STMT-FIXTURE-0001' }],
      amount: { currency: 'SYP', amountMinor, scale: 2 },
    },
  });
  assert.equal(decided.body.case.status, 'RESOLVED', JSON.stringify(decided.body));
  return due;
}

/* ---------------------------- browser helpers ---------------------------- */

async function signInUi(page, principal) {
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('البريد الإلكتروني').fill(principal.email);
  await dialog.getByLabel('كلمة المرور').fill(STAFF_PASSWORD);
  const login = page.waitForResponse((r) => r.url().endsWith('/api/v1/auth/login'));
  await dialog.getByRole('button', { name: 'متابعة' }).click();
  const { challengeId } = await (await login).json();
  await dialog.getByLabel('رمز التحقق').fill(stack.identity.delivered.get(challengeId).code);
  await dialog.getByRole('button', { name: 'تأكيد' }).click();
  await dialog.waitFor({ state: 'hidden' });
}

/** Each principal signs in through the UI once (Identity's OTP budget is per IP). */
async function asUser(principal, options = {}) {
  const state = sessions.get(principal.subject);
  const browserContext = await browser.newContext({
    viewport: { width: options.width ?? 1440, height: options.height ?? 900 },
    deviceScaleFactor: 1,
    locale: 'ar-SY',
    timezoneId: TIMEZONE,
    ...(state ? { storageState: state } : {}),
  });
  const page = await browserContext.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(stack.origin);
  if (!state) {
    await signInUi(page, principal);
    sessions.set(principal.subject, await browserContext.storageState());
  }
  return { page, browserContext, errors };
}

async function axe(page, scope = null) {
  const source = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
  await page.evaluate(source);
  return page.evaluate(async (selector) => {
    const result = await globalThis.axe.run(
      selector ? document.querySelector(selector) : document,
      { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } },
    );
    return result.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.length,
      targets: v.nodes.slice(0, 5).map((n) => n.target.join(' ')),
    }));
  }, scope);
}

const serious = (violations) =>
  violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');

/** The request the console sends for a POST matching `match`. */
function capture(page, match) {
  return page.waitForRequest((r) => r.method() === 'POST' && match.test(r.url()));
}

/** A hand-made same-origin call with the signed-in cookies and CSRF token. */
function tamper(page, url, body) {
  return page.evaluate(
    async ({ url: u, body: b }) => {
      const csrf = document.cookie
        .split(';')
        .map((c) => c.trim().split('='))
        .find(([n]) => n === 'wg_csrf' || n === '__Host-wg_csrf')?.[1];
      const r = await fetch(u, {
        method: b === undefined ? 'GET' : 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrf ?? '',
          'idempotency-key': crypto.randomUUID().replaceAll('-', ''),
        },
        ...(b === undefined ? {} : { body: JSON.stringify(b) }),
      });
      return r.status;
    },
    { url, body },
  );
}

async function lookupObligation(page, obligationId) {
  await page.locator('#obligationRef').fill(obligationId);
  await page.locator('#obligationLookup button[type="submit"]').click();
}

/** Opens the case from the subject's button and waits for Support's record. */
async function openCaseFrom(page, buttonSelector) {
  const dialog = page.getByRole('dialog');
  await dialog.locator(buttonSelector).click();
  await dialog.locator('#caseOpenSubmit').click();
  await page.locator('#modalBody[data-case-status]').waitFor();
  return page.locator('#modalBody').getAttribute('data-case');
}

async function fillDecision(page, { action, reason, note, evidence, amount }) {
  const dialog = page.getByRole('dialog');
  await dialog.locator('#caseAction').selectOption(action);
  await dialog.locator('#caseReason').selectOption(reason);
  await dialog.locator('#caseNote').fill(note);
  if (evidence) await dialog.locator('#evidenceRef-0').fill(evidence);
  if (amount !== undefined) await dialog.locator('#caseAmount').fill(amount);
}

const caseStatus = (page, status) =>
  page.locator(`#modalBody[data-case-status="${status}"]`).waitFor();

/* --------------------------------- suite --------------------------------- */

test.before(async () => {
  stack = await startStack();
  report.billingLedgerGrant = stack.billingGrant;
  browser = await chromium.launch({ args: ['--font-render-hinting=none', '--disable-lcd-text'] });
  const { PrismaClient } = dist('reporting', 'generated/prisma/client.js');
  const { PrismaPg } = owned('reporting')('@prisma/adapter-pg');
  reportingDb = new PrismaClient({
    adapter: new PrismaPg({ connectionString: appDsn(context, 'reporting') }, { schema: 'app' }),
  });
  mkdirSync(EVIDENCE, { recursive: true });
  const probe = await fetch(`${stack.origin}/api/v1/admin/cases`);
  assert.notEqual(probe.status, 404, 'GATEWAY_ROUTES_MISSING: apply P04_CANDIDATE_GATEWAY.patch');
  principals.finance = await staff(stack.identity, ['finance']);
  principals.reviewer = await staff(stack.identity, ['finance']);
  principals.operations = await staff(stack.identity, ['operations']);
  principals.supportDesk = await staff(stack.identity, ['support']);
  principals.superAdmin = await staff(stack.identity, ['super-admin']);
  principals.technician = await staff(stack.identity, ['technician']);
  principals.customer = await account(stack.identity);
});

test.after(async () => {
  writeFileSync(path.join(EVIDENCE, 'browser-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  await reportingDb?.$disconnect();
  await browser?.close();
  await stack?.stop();
});

test('X1: finance approves a match and rejects a mismatch through cases; Billing audits the human and the console id', async () => {
  const { finance, customer } = principals;
  const paid = await obligationUnderReview(stack, customer, '250000');
  const mismatched = await obligationUnderReview(stack, customer, '120000');
  const { page, browserContext, errors } = await asUser(finance);
  try {
    await page.waitForURL(/#\/payments$/);
    await lookupObligation(page, paid.obligationId);
    const dialog = page.getByRole('dialog');
    // No reconciliation without a case: the attempt offers a review case only.
    await dialog.locator(`#review-${paid.attemptId}`).waitFor();
    assert.equal(await dialog.locator(`#reconcile-${paid.attemptId}`).count(), 0);
    const caseId = await openCaseFrom(page, `#review-${paid.attemptId}`);
    await caseStatus(page, 'OPEN');
    assert.match(await dialog.locator('#caseSnapshot').innerText(), /PENDING_REVIEW/);
    await dialog.locator('#caseCurrent [data-current-status]').waitFor();

    // The console refuses an incomplete decision before anything is sent.
    await dialog.locator('#caseDecide').click();
    await dialog.locator('#caseProblem').getByText('اختر القرار.').waitFor();
    await fillDecision(page, {
      action: 'APPROVE_MATCH',
      reason: 'PROVIDER_CONFIRMED',
      note: 'قصير',
    });
    await dialog.locator('#caseDecide').click();
    await dialog.locator('#caseProblem').getByText('اكتب شرحًا لا يقل عن 10 أحرف.').waitFor();
    await dialog.locator('#caseNote').fill('سطر كشف شام كاش رقم 42 يطابق المبلغ تمامًا');
    await dialog.locator('#caseDecide').click();
    await dialog
      .locator('#caseProblem')
      .getByText('هذا القرار يحتاج دليلًا واحدًا على الأقل.')
      .waitFor();
    await dialog.locator('#evidenceRef-0').fill('STMT-2026-10-11-0042');
    await dialog.locator('#caseAmount').fill('2500.001');
    await dialog.locator('#caseDecide').click();
    await dialog.locator('#caseProblem').getByText('كسور أكثر مما تسمح به العملة.').waitFor();
    await dialog.locator('#caseAmount').fill('2,500');
    report.accessibility.caseDialog = await axe(page, '.modal');
    const sent = capture(page, /\/admin\/cases\/[^/]+\/decisions$/);
    await dialog.locator('#caseDecide').click();
    const request = await sent;
    await caseStatus(page, 'RESOLVED');
    await dialog.locator('#decision-1[data-owner-state="MATCHED"]').waitFor();
    const correlationId = request.headers()['x-correlation-id'];
    assert.deepEqual(request.postDataJSON().amount, {
      currency: 'SYP',
      amountMinor: '250000',
      scale: 2,
    });

    // Billing, the owner, recorded the human and the console's correlation id.
    const billing = await ownerRows(
      'billing',
      `SELECT action, actor_subject::text AS actor, outcome FROM app.billing_audit_event WHERE correlation_id = '${correlationId}'`,
    );
    assert.deepEqual(billing, [
      { action: 'billing.attempt.reconciled', actor: finance.subject, outcome: 'MATCHED' },
    ]);
    const supportAudit = await ownerRows(
      'support',
      `SELECT action, actor_subject::text AS actor FROM app.case_event WHERE case_id = '${caseId}' AND correlation_id = '${correlationId}' ORDER BY seq`,
    );
    assert.deepEqual(
      supportAudit.map((r) => r.action),
      ['decision.recorded', 'execution.started', 'execution.finished'],
    );
    assert.ok(supportAudit.every((r) => r.actor === finance.subject));
    report.audit.X1 = {
      billing: { action: billing[0].action, actorIsFinance: true, outcome: 'MATCHED' },
      support: supportAudit.map((r) => r.action),
      correlationId,
    };

    // Mismatch: Billing keeps the money unrecognised.
    await page.keyboard.press('Escape');
    await lookupObligation(page, mismatched.obligationId);
    await openCaseFrom(page, `#review-${mismatched.attemptId}`);
    await fillDecision(page, {
      action: 'REJECT_MISMATCH',
      reason: 'PROVIDER_AMOUNT_DIFFERS',
      note: 'الكشف يظهر 1,000 وليس 1,200',
      evidence: 'STMT-2026-10-11-0077',
      amount: '1000',
    });
    await dialog.locator('#caseDecide').click();
    await caseStatus(page, 'RESOLVED');
    await dialog.locator('#decision-1[data-owner-state="MISMATCHED"]').waitFor();
    const after = await ownerCall(
      stack.services.billing.origin,
      '/internal/v1/billing',
      finance,
      `/obligations/${mismatched.obligationId}`,
    );
    assert.equal(after.body.attempts[0].status, 'MISMATCHED');
    assert.equal(after.body.verified.amountMinor, '0');
    assert.deepEqual(errors, []);
    report.journeys.X1 = 'PASSED';
  } finally {
    await browserContext.close();
  }
});

test('X2: a lost answer locks the form; the same key is resent; refresh shows Support; Billing acted once', async () => {
  const { finance, customer } = principals;
  const due = await obligationUnderReview(stack, customer, '90000');
  const { page, browserContext, errors } = await asUser(finance);
  try {
    await page.waitForURL(/#\/payments$/);
    await lookupObligation(page, due.obligationId);
    const caseId = await openCaseFrom(page, `#review-${due.attemptId}`);
    const dialog = page.getByRole('dialog');
    await fillDecision(page, {
      action: 'APPROVE_MATCH',
      reason: 'PROVIDER_CONFIRMED',
      note: 'سطر الكشف 91 يطابق المبلغ',
      evidence: 'STMT-2026-10-11-0091',
      amount: '900',
    });
    // The server answers, then the connection drops before the browser hears it.
    const keys = [];
    await page.route('**/api/v1/admin/cases/*/decisions', async (route) => {
      keys.push(route.request().headers()['idempotency-key']);
      await route.fetch();
      await route.abort('connectionreset');
    });
    await dialog.locator('#caseDecide').click();
    await dialog
      .locator('#caseStatusLine')
      .getByText(/أعد إرسال الطلب نفسه/)
      .waitFor();
    assert.equal(await dialog.locator('#caseNote').isDisabled(), true);
    assert.equal(await dialog.locator('#caseAmount').isDisabled(), true);
    assert.equal(
      (await dialog.locator('#caseDecide').innerText()).trim(),
      'إعادة إرسال الأمر نفسه للمالك',
    );
    await page.unroute('**/api/v1/admin/cases/*/decisions');

    // Resend: the same key reaches Support, which replays its record.
    const resent = capture(page, /\/admin\/cases\/[^/]+\/decisions$/);
    await dialog.locator('#caseDecide').click();
    keys.push((await resent).headers()['idempotency-key']);
    await caseStatus(page, 'RESOLVED');
    assert.equal(keys.length, 2);
    assert.equal(keys[0], keys[1]);

    // Refresh: the queue shows Support's authoritative state.
    await page.goto(`${stack.origin}/#/disputes`);
    await page.reload();
    await page.locator('#caseStatusFilter').selectOption('all');
    await page
      .locator(`#caseRows tr[data-case="${caseId}"][data-case-status="RESOLVED"]`)
      .waitFor();

    const decisions = await ownerRows(
      'support',
      `SELECT count(*)::int AS n FROM app.resolution_request WHERE case_id = '${caseId}'`,
    );
    assert.equal(decisions[0].n, 1);
    const reconciled = await ownerRows(
      'billing',
      `SELECT count(*)::int AS n FROM app.billing_audit_event WHERE attempt_id = '${due.attemptId}' AND action = 'billing.attempt.reconciled'`,
    );
    assert.equal(reconciled[0].n, 1);
    assert.deepEqual(errors, []);
    report.journeys.X2 = 'PASSED';
  } finally {
    await browserContext.close();
  }
});

test('X3: refund four-eyes — the proposer cannot approve; a second reviewer does; Billing still holds the money', async () => {
  const { finance, reviewer, customer } = principals;
  const due = await paidThroughSupport(finance, customer, '150000');
  let caseId;
  {
    const { page, browserContext, errors } = await asUser(finance);
    try {
      await page.waitForURL(/#\/payments$/);
      await lookupObligation(page, due.obligationId);
      caseId = await openCaseFrom(page, `#refund-${due.obligationId}`);
      await fillDecision(page, {
        action: 'REFUND',
        reason: 'SERVICE_NOT_DELIVERED',
        note: 'لم يصل الفني والزبون دفع مسبقًا',
        evidence: `booking:${randomUUID()}`,
        amount: '1500',
      });
      const dialog = page.getByRole('dialog');
      await dialog.locator('#evidenceKind-0').selectOption('OWNER_RECORD');
      await dialog.locator('#caseDecide').click();
      await caseStatus(page, 'AWAITING_APPROVAL');
      // The proposer sees no approve control, and the server refuses a hand-made one.
      assert.equal(await dialog.locator('#approveDecision').count(), 0);
      await dialog.locator('#ownProposal').waitFor();
      assert.equal(
        await tamper(page, `/api/v1/admin/cases/${caseId}/decisions/1/approval`, {
          approve: true,
          note: 'Approving my own proposal',
        }),
        409,
      );
      assert.deepEqual(errors, []);
    } finally {
      await browserContext.close();
    }
  }
  const { page, browserContext, errors } = await asUser(reviewer);
  try {
    await page.waitForURL(/#\/payments$/);
    await page.locator('.nav button[data-screen="disputes"]').click();
    await page.locator('#caseKindFilter').selectOption('REFUND');
    const row = page.locator(`#caseRows tr[data-case="${caseId}"]`);
    await row.click();
    await caseStatus(page, 'AWAITING_APPROVAL');
    const dialog = page.getByRole('dialog');
    await dialog.locator('#approveDecision').click();
    await dialog.locator('#approvalProblem').getByText('اكتب شرحًا لا يقل عن 10 أحرف.').waitFor();
    await dialog.locator('#approvalNote').fill('راجعت سجل الحجز وكشف الدفع');
    await dialog.locator('#approveDecision').click();
    await caseStatus(page, 'BLOCKED_ON_OWNER');
    await dialog.locator('#decision-1[data-decision-status="BLOCKED_ON_OWNER"]').waitFor();
    assert.match(await dialog.locator('#decision-1').innerText(), /OWNER_CAPABILITY_UNPUBLISHED/);
    const billing = await ownerCall(
      stack.services.billing.origin,
      '/internal/v1/billing',
      finance,
      `/obligations/${due.obligationId}`,
    );
    assert.equal(billing.body.verified.amountMinor, '150000');
    const approval = await ownerRows(
      'support',
      `SELECT decided_by::text AS proposer, approved_by::text AS approver FROM app.resolution_request WHERE case_id = '${caseId}'`,
    );
    assert.deepEqual(approval, [{ proposer: finance.subject, approver: reviewer.subject }]);
    assert.deepEqual(errors, []);
    report.journeys.X3 = 'PASSED';
  } finally {
    await browserContext.close();
  }
});

test('X4: operations opens cancellation and reschedule cases from the booking; Booking is read live and unchanged', async () => {
  const { operations, customer } = principals;
  const booking = await createBooking(stack, customer);
  await projectBooking(booking, customer.subject);
  const { page, browserContext, errors } = await asUser(operations);
  try {
    await page.waitForURL(/#\/dashboard$/);
    await page.locator('.nav button[data-screen="bookings"]').click();
    // The doubles' slot may fall on tomorrow in Damascus; widen the period.
    await page.locator('#periodFilter').selectOption('month');
    const row = page.locator(`#bookingRows tr[data-booking="${booking.bookingId}"]`);
    await row.click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('#caseCancelBooking').waitFor();
    await openCaseFrom(page, '#caseCancelBooking');
    assert.match(await dialog.locator('#caseSnapshot').innerText(), new RegExp(booking.status));
    await dialog.locator('#caseCurrent [data-current-status]').waitFor();
    // Operations sees only booking decisions.
    const options = await dialog.locator('#caseAction option').allTextContents();
    assert.deepEqual(options.slice(1), ['إلغاء الحجز', 'إغلاق دون إجراء']);
    await fillDecision(page, {
      action: 'CANCEL_BOOKING',
      reason: 'CUSTOMER_REQUEST',
      note: 'اتصل الزبون وطلب الإلغاء',
    });
    await dialog.locator('#caseDecide').click();
    await caseStatus(page, 'BLOCKED_ON_OWNER');
    report.accessibility.bookingCaseDialog = await axe(page, '.modal');

    // Reschedule: a Damascus window becomes exact UTC in the decision.
    await page.keyboard.press('Escape');
    await row.click();
    await openCaseFrom(page, '#caseRescheduleBooking');
    await fillDecision(page, {
      action: 'RESCHEDULE_BOOKING',
      reason: 'TECHNICIAN_UNAVAILABLE',
      note: 'لا يوجد فني متاح في الموعد',
    });
    const tomorrow = new Date(Date.now() + 3 * 3_600_000 + 86_400_000).toISOString().slice(0, 10);
    await dialog.locator('#windowDate').fill(tomorrow);
    await dialog.locator('#windowStart').fill('09:00');
    await dialog.locator('#windowEnd').fill('10:00');
    const sent = capture(page, /\/admin\/cases\/[^/]+\/decisions$/);
    await dialog.locator('#caseDecide').click();
    assert.deepEqual((await sent).postDataJSON().window, {
      startsAt: `${tomorrow}T06:00:00.000Z`,
      endsAt: `${tomorrow}T07:00:00.000Z`,
    });
    await caseStatus(page, 'BLOCKED_ON_OWNER');

    const after = await ownerCall(
      stack.services.booking.origin,
      '/internal/v1/booking',
      customer,
      `/bookings/${booking.bookingId}`,
    );
    assert.equal(after.body.status, booking.status);
    assert.equal(after.body.revision, booking.revision);
    const stored = await ownerRows(
      'support',
      `SELECT snapshot::text AS s FROM app.support_case WHERE subject_id = '${booking.bookingId}'`,
    );
    for (const row_ of stored) assert.doesNotMatch(row_.s, /0912345678|زبون اختبار/);
    assert.deepEqual(errors, []);
    report.journeys.X4 = 'PASSED';
  } finally {
    await browserContext.close();
  }
});

test('X5: denials — desks, the support desk, customers, technicians, anonymous; Billing refuses self-decisions', async () => {
  const { operations, supportDesk, superAdmin, customer, technician, finance } = principals;
  const financeCase = await (async () => {
    const due = await obligationUnderReview(stack, customer, '30000');
    const opened = await ownerCall(
      stack.services.support.origin,
      '/internal/v1/support/cases',
      finance,
      '',
      {
        method: 'POST',
        key: commandKey(),
        body: {
          kind: 'PAYMENT_REVIEW',
          subject: {
            type: 'billing.payment-attempt',
            id: due.attemptId,
            parentId: due.obligationId,
          },
          summary: 'Denial fixture',
        },
      },
    );
    assert.ok(ok2xx(opened.status), JSON.stringify(opened.body));
    return opened.body.case.caseId;
  })();
  const decision = {
    action: 'MARK_UNKNOWN',
    reason: { code: 'PROVIDER_UNREACHABLE', note: 'Trying from the wrong desk' },
  };

  {
    const { page, browserContext } = await asUser(operations);
    try {
      await page.waitForURL(/#\/dashboard$/);
      await page.goto(`${stack.origin}/#/disputes`);
      const kinds = await page.locator('#caseKindFilter option').allTextContents();
      assert.deepEqual(kinds.slice(1), ['إلغاء حجز', 'إعادة جدولة']);
      assert.equal(await tamper(page, `/api/v1/admin/cases/${financeCase}`), 404);
      assert.equal(
        await tamper(page, `/api/v1/admin/cases/${financeCase}/decisions`, decision),
        403,
      );
      assert.equal(await tamper(page, '/api/v1/admin/cases?kind=PAYMENT_REVIEW'), 403);
    } finally {
      await browserContext.close();
    }
  }
  {
    const { page, browserContext, errors } = await asUser(supportDesk);
    try {
      await page.waitForURL(/#\/disputes$/);
      for (const screen of ['dashboard', 'bookings', 'payments'])
        assert.equal(await page.locator(`.nav button[data-screen="${screen}"]`).isDisabled(), true);
      await page.locator(`#caseRows tr[data-case="${financeCase}"]`).click();
      await caseStatus(page, 'OPEN');
      assert.equal(await page.locator('#caseDecisionForm').count(), 0);
      // The Gateway refuses: the support desk holds none of the decision grants.
      assert.equal(
        await tamper(page, `/api/v1/admin/cases/${financeCase}/decisions`, decision),
        403,
      );
      report.accessibility.disputes = await axe(page);
      assert.deepEqual(errors, []);
    } finally {
      await browserContext.close();
    }
  }
  for (const who of [customer, technician]) {
    const { page, browserContext } = await asUser(who);
    try {
      await page.getByText('هذا الحساب لا يملك صلاحية لوحة الإدارة.').waitFor();
      assert.equal(await tamper(page, '/api/v1/admin/cases'), 403);
      assert.equal(await tamper(page, `/api/v1/admin/cases/${financeCase}`), 403);
    } finally {
      await browserContext.close();
    }
  }
  assert.equal((await fetch(`${stack.origin}/api/v1/admin/cases`)).status, 401);

  // Billing itself refuses a super-admin deciding its own payment.
  const own = await obligationUnderReview(stack, superAdmin, '50000');
  const { page, browserContext, errors } = await asUser(superAdmin);
  try {
    await page.waitForURL(/#\/dashboard$/);
    await page.locator('.nav button[data-screen="payments"]').click();
    await lookupObligation(page, own.obligationId);
    await openCaseFrom(page, `#review-${own.attemptId}`);
    await fillDecision(page, {
      action: 'APPROVE_MATCH',
      reason: 'PROVIDER_CONFIRMED',
      note: 'Approving my own payment as super-admin',
      evidence: 'STMT-SELF-0001',
      amount: '500',
    });
    await page.getByRole('dialog').locator('#caseDecide').click();
    await caseStatus(page, 'OWNER_REJECTED');
    assert.match(await page.locator('#decision-1').innerText(), /AUTH_FORBIDDEN/);
    assert.deepEqual(errors, []);
  } finally {
    await browserContext.close();
  }
  report.journeys.X5 = 'PASSED';
});

test('A11Y: the disputes screen and the case dialogs have no serious or critical violations', () => {
  for (const [surface, violations] of Object.entries(report.accessibility))
    assert.deepEqual(serious(violations), [], surface);
  assert.deepEqual(Object.keys(report.accessibility).sort(), [
    'bookingCaseDialog',
    'caseDialog',
    'disputes',
  ]);
  report.journeys.A11Y = 'PASSED';
});

test('V1: reference / candidate / diff screenshots of the disputes screen at three widths', async () => {
  const { finance } = principals;
  const referenceServer = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(readFileSync(REFERENCE));
  });
  const referencePort = await listen(referenceServer);
  try {
    for (const width of [390, 768, 1440]) {
      const shot = async (url, prepare, storageState = undefined) => {
        const c = await browser.newContext({
          viewport: { width, height: 900 },
          deviceScaleFactor: 1,
          locale: 'ar-SY',
          timezoneId: TIMEZONE,
          reducedMotion: 'reduce',
          ...(storageState ? { storageState } : {}),
        });
        const page = await c.newPage();
        await page.goto(url);
        await prepare(page);
        await page.addStyleTag({ content: DISABLE_MOTION }).catch(() => {});
        await page.evaluate(() => document.fonts.ready);
        const png = await page.screenshot({ fullPage: false });
        await c.close();
        return png;
      };
      const reference = await shot(`http://127.0.0.1:${referencePort}/`, async (page) => {
        await page.evaluate(() => {
          document
            .querySelectorAll('.screen')
            .forEach((x) => x.classList.toggle('active', x.id === 'disputes'));
          document
            .querySelectorAll('.nav button[data-screen]')
            .forEach((x) => x.classList.toggle('active', x.dataset.screen === 'disputes'));
        });
      });
      const candidate = await shot(
        stack.origin,
        async (page) => {
          await page.goto(`${stack.origin}/#/disputes`);
          await page.locator('#disputes.active').waitFor();
          await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
        },
        sessions.get(finance.subject),
      );
      const result = await comparePngBuffers(browser, reference, candidate);
      const base = `disputes-${width}`;
      writeFileSync(path.join(EVIDENCE, `${base}-reference.png`), reference);
      writeFileSync(path.join(EVIDENCE, `${base}-candidate.png`), candidate);
      if (result.diffBase64)
        writeFileSync(
          path.join(EVIDENCE, `${base}-diff.png`),
          Buffer.from(result.diffBase64, 'base64'),
        );
      report.visual.push({
        screen: 'disputes',
        width,
        sameDimensions: result.sameDimensions,
        diffRatio: result.diffRatio,
      });
    }
  } finally {
    referenceServer.close();
  }
  report.journeys.V1 = 'PASSED';
});
