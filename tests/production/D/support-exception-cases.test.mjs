/**
 * P04-D1 Support exception cases on real infrastructure.
 *
 * Real: PostgreSQL 16 (Support, Billing, Booking databases, each with its own
 * runtime identity), the REAL Identity service (Argon2, RS256 sessions, role
 * grants), the REAL Billing and Booking HTTP adapters, and Support's own HTTP
 * adapter. Support calls Billing and Booking over HTTP with the staff
 * member's own credential.
 *
 * Declared doubles: Billing's Pricing quote upstream and Booking's upstream
 * owners (Booking's own test doubles), exactly as in the P03-D3 journeys.
 * A small HTTP relay sits between Support and Billing; it can drop ONE
 * response after Billing answered, which is how a lost answer is produced.
 *
 * Part S: database invariants with the runtime identity.
 * Part H: HTTP journeys (finance approve/reject, lost answer + resend, four-
 *         eyes refund, operations cancel/reschedule, role denial).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { ROOT, appDsn, context, sql } from '../../integration/_support.mjs';
import { hardenPrivileges, migrateDeploy } from '../../../scripts/acceptance/lib/migrations.mjs';
import { account, bearer, staff, startIdentity } from './_identity.mjs';

const owned = (service) => createRequire(path.join(ROOT, 'services', service, 'package.json'));
const SUPPORT = '/internal/v1/support/cases';
const STATEMENT_MERCHANT = 'acceptance-support-sham';

/* --------------------------------- stack --------------------------------- */

function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server.address().port));
  });
}

async function nestService(service, env) {
  for (const [name, value] of Object.entries(env)) process.env[name] = value;
  const own = owned(service);
  own('reflect-metadata');
  const { createHttpApplication } = own('./dist/transport/http/create-app.js');
  const app = await createHttpApplication();
  await app.listen(0, '127.0.0.1');
  const port = Number(new URL(await app.getUrl()).port);
  return { app, origin: `http://127.0.0.1:${port}` };
}

/** Billing's Pricing upstream: answers the published quote shape for known quotes. */
async function startQuoteDouble() {
  const quotes = new Map();
  const server = createServer((req, res) => {
    const prefix = '/internal/v1/pricing/quotes/';
    const quote = req.url?.startsWith(prefix) ? quotes.get(req.url.slice(prefix.length)) : null;
    if (req.method !== 'GET' || !quote || !/^Bearer .{20,}/.test(req.headers.authorization ?? '')) {
      res
        .writeHead(404, { 'content-type': 'application/json' })
        .end('{"error":{"code":"NOT_FOUND"}}');
      return;
    }
    const money = { currency: 'SYP', amountMinor: quote.amountMinor, scale: 2 };
    res.writeHead(200, { 'content-type': 'application/json' }).end(
      JSON.stringify({
        quoteId: quote.quoteId,
        revision: 1,
        status: 'USABLE',
        beneficiary: { kind: 'account', subjectId: quote.owner },
        vehicleType: 'SEDAN',
        zoneId: null,
        currency: 'SYP',
        lines: [
          {
            lineId: randomUUID(),
            kind: 'PACKAGE',
            definitionId: randomUUID(),
            quantity: 1,
            unitPrice: money,
            amount: money,
          },
        ],
        total: money,
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      }),
    );
  });
  const port = await listen(server);
  return {
    quotes,
    origin: `http://127.0.0.1:${port}`,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}

/**
 * Forwards everything to Billing. When armed, the NEXT reconciliation is
 * forwarded and fully answered by Billing, and then the answer is dropped:
 * Support sees a reset connection although Billing acted.
 */
async function startBillingRelay(target) {
  const owner = new URL(target);
  assert.equal(owner.protocol, 'http:');
  assert.equal(owner.hostname, '127.0.0.1');
  const ownerPort = Number(owner.port);
  assert.ok(Number.isSafeInteger(ownerPort) && ownerPort > 0);
  const state = { dropNextReconciliation: false, reconciliations: 0 };
  const server = createServer((req, res) => {
    const path = relayBillingPath(req.url);
    if (!path) {
      res.writeHead(400).end();
      return;
    }
    const reconciliation =
      req.method === 'POST' && /\/(reconciliation|statement-credit-allocation)$/.test(path);
    if (reconciliation) state.reconciliations += 1;
    const drop = reconciliation && state.dropNextReconciliation;
    if (drop) state.dropNextReconciliation = false;
    const upstream = httpRequest(
      {
        protocol: 'http:',
        hostname: '127.0.0.1',
        port: ownerPort,
        path,
        method: req.method,
        headers: req.headers,
      },
      (reply) => {
        const chunks = [];
        reply.on('data', (c) => chunks.push(c));
        reply.on('end', () => {
          if (drop) {
            req.socket.destroy();
            return;
          }
          res.writeHead(reply.statusCode ?? 502, reply.headers).end(Buffer.concat(chunks));
        });
      },
    );
    upstream.on('error', () => res.destroy());
    req.pipe(upstream);
  });
  const port = await listen(server);
  return {
    state,
    origin: `http://127.0.0.1:${port}`,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}

function relayBillingPath(requestUrl) {
  if (!requestUrl || !requestUrl.startsWith('/internal/v1/billing/')) return null;
  if (requestUrl.startsWith('//') || requestUrl.includes('://') || /[\r\n]/.test(requestUrl))
    return null;
  return requestUrl;
}

async function migrateOwners() {
  const ctx = { ...context, root: ROOT };
  for (const service of ['booking', 'billing']) {
    const migrated = await migrateDeploy(ctx, service);
    assert.equal(migrated.code, 0, `${service} migrate deploy: ${migrated.stderr}`);
    const hardened = await hardenPrivileges(ctx, service);
    assert.equal(hardened.code, 0, `${service} hardening: ${hardened.stderr}`);
  }
}

/**
 * The current Billing migration uses owner-rights constraint triggers with a
 * pinned search_path. Its internal ledger helpers must remain private; normal
 * commands below prove that the runtime role can write valid financial facts
 * without receiving an extra test-only grant.
 */
const BILLING_LEDGER_HELPERS = [
  'app.billing_assert_obligation_ledger(uuid)',
  'app.billing_assert_custody_holder(uuid, char(3))',
  'app.billing_assert_handover(uuid)',
];

async function assertBillingLedgerHelpersPrivate() {
  for (const helper of BILLING_LEDGER_HELPERS) {
    const result = await sql(
      appDsn(context, 'billing'),
      `SELECT has_function_privilege(current_user, '${helper}', 'EXECUTE') AS allowed`,
    );
    assert.equal(result.ok, true, 'Billing helper privilege query failed');
    assert.equal(result.rows[0].allowed, false, `${helper} must remain private`);
  }
}

let stack;

test.before(async () => {
  stack = {};
  await migrateOwners();
  await assertBillingLedgerHelpersPrivate();
  const identity = (stack.identity = await startIdentity());
  const quotes = (stack.quotes = await startQuoteDouble());
  const { startOwnerDoubles, bookingEnv } = owned('booking')(
    path.join(ROOT, 'services', 'booking', 'dist-tests', 'test', 'support', 'owner-doubles.js'),
  );
  const doubles = (stack.doubles = await startOwnerDoubles());
  const billing = (stack.billing = await nestService('billing', {
    DATABASE_URL: appDsn(context, 'billing'),
    IDENTITY_SESSION_ORIGIN: identity.base,
    PRICING_ORIGIN: quotes.origin,
    BILLING_SHAM_CASH_MERCHANT_ACCOUNTS: STATEMENT_MERCHANT,
  }));
  const booking = (stack.booking = await nestService('booking', {
    ...bookingEnv(doubles, appDsn(context, 'booking')),
    IDENTITY_URL: identity.base,
    BOOKING_USER_REQUESTS_PER_MINUTE: '600',
    BOOKING_INLINE_SAGA_BUDGET_MS: '15000',
  }));
  const relay = (stack.relay = await startBillingRelay(billing.origin));
  const support = (stack.support = await nestService('support', {
    DATABASE_URL: appDsn(context, 'support'),
    IDENTITY_ORIGIN: identity.base,
    BILLING_ORIGIN: `${relay.origin}/`,
    BOOKING_ORIGIN: `${booking.origin}/`,
    BILLING_TIMEOUT_MS: '5000',
    BOOKING_TIMEOUT_MS: '5000',
    SUPPORT_REQUESTS_PER_MINUTE: '600',
    SUPPORT_EXECUTION_LEASE_MS: '1000',
  }));
  const [finance, reviewer, operations, supportDesk, technician, customer] = [
    await staff(identity, ['finance']),
    await staff(identity, ['finance']),
    await staff(identity, ['operations']),
    await staff(identity, ['support']),
    await staff(identity, ['technician']),
    await account(identity),
  ];
  stack = {
    identity,
    quotes,
    doubles,
    billing,
    booking,
    relay,
    support,
    people: { finance, reviewer, operations, supportDesk, technician, customer },
  };
});

test.after(async () => {
  if (!stack) return;
  stack.relay?.close();
  stack.quotes?.close();
  const closed = await Promise.allSettled([
    stack.doubles?.close(),
    ...[stack.support, stack.billing, stack.booking, stack.identity].map((owner) =>
      owner?.app.close(),
    ),
  ]);
  assert.equal(
    closed.filter((result) => result.status === 'rejected').length,
    0,
    'Every started owner must shut down',
  );
});

/* ------------------------------- helpers ------------------------------- */

const commandKey = () => randomUUID().replaceAll('-', '');
const ok2xx = (status) => status >= 200 && status < 300;

async function call(origin, principal, route, { method = 'GET', body, key, correlationId } = {}) {
  const response = await fetch(`${origin}${route}`, {
    method,
    headers: {
      ...(principal ? { authorization: bearer(principal) } : {}),
      'x-correlation-id': correlationId ?? randomUUID(),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(key ? { 'idempotency-key': key } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

const support = (principal, route, init) =>
  call(stack.support.origin, principal, `${SUPPORT}${route}`, init);
const billingCall = (principal, route, init) =>
  call(stack.billing.origin, principal, `/internal/v1/billing${route}`, init);

/** A real Billing obligation with one electronic attempt awaiting review, by the customer. */
async function attemptUnderReview(amountMinor = '150000') {
  const customer = stack.people.customer;
  const quoteId = randomUUID();
  stack.quotes.quotes.set(quoteId, { quoteId, owner: customer.subject, amountMinor });
  const created = await billingCall(customer, '/obligations', {
    method: 'POST',
    key: commandKey(),
    body: { quoteId },
  });
  assert.ok(ok2xx(created.status), JSON.stringify(created.body));
  const obligationId = created.body.obligationId;
  const intent = await billingCall(customer, `/obligations/${obligationId}/payment-intents`, {
    method: 'POST',
    key: commandKey(),
    body: { expectedRevision: created.body.revision, method: 'SHAM_CASH' },
  });
  assert.ok(ok2xx(intent.status), JSON.stringify(intent.body));
  const providerReference = `SC-${randomUUID()}`;
  const attempt = await billingCall(customer, `/obligations/${obligationId}/payment-attempts`, {
    method: 'POST',
    key: commandKey(),
    body: {
      expectedRevision: intent.body.revision,
      providerReference,
    },
  });
  assert.ok(ok2xx(attempt.status), JSON.stringify(attempt.body));
  return {
    obligationId,
    attemptId: attempt.body.attempts[0].attemptId,
    providerReference,
    amountMinor,
  };
}

/** Record an independent statement fact through Billing; it is still unpaid.
 * The Support decision is made by the other Finance account, never this recorder.
 */
async function statementFor(subject, recorder = stack.people.reviewer) {
  const recorded = await billingCall(recorder, '/provider-credits', {
    method: 'POST',
    key: commandKey(),
    body: {
      provider: 'SHAM_CASH',
      merchantAccount: STATEMENT_MERCHANT,
      providerReference: subject.providerReference,
      amount: SYP(subject.amountMinor),
      occurredAt: new Date().toISOString(),
      evidenceDigest: createHash('sha256')
        .update(`acceptance-statement:${subject.providerReference}`)
        .digest('hex'),
    },
  });
  assert.equal(recorded.status, 201, JSON.stringify(recorded.body));
  assert.equal(recorded.body.status, 'PENDING_APPROVAL');
  const pending = await billingCall(recorder, `/obligations/${subject.obligationId}`);
  assert.equal(pending.body.verified.amountMinor, '0');
  return { creditId: recorded.body.creditId, revision: recorded.body.revision };
}

/** A real Booking record, created by the customer through Booking's own API. */
async function createBooking() {
  const customer = stack.people.customer;
  stack.doubles.sessions.set(customer.token, {
    subject: customer.subject,
    principalKind: 'account',
    permissions: ['bookings.create:self', 'bookings.read:self'],
  });
  const issued = stack.doubles.issue({ kind: 'account', subjectId: customer.subject });
  const created = await call(stack.booking.origin, customer, '/internal/v1/booking/bookings', {
    method: 'POST',
    key: commandKey(),
    body: {
      quote: { quoteId: issued.quoteId, revision: 1 },
      hold: { holdId: issued.holdId, revision: 1 },
      vehicle: { source: 'saved', vehicleId: randomUUID(), revision: 2 },
      address: { addressId: randomUUID(), revision: 1 },
      contact: { name: 'زبون اختبار', phone: '0912345678', notes: null },
      paymentMethod: 'SHAM_CASH',
    },
  });
  assert.ok(ok2xx(created.status), JSON.stringify(created.body));
  return created.body;
}

function openReview(principal, { obligationId, attemptId }, key = commandKey()) {
  return support(principal, '', {
    method: 'POST',
    key,
    body: {
      kind: 'PAYMENT_REVIEW',
      subject: { type: 'billing.payment-attempt', id: attemptId, parentId: obligationId },
      summary: 'Customer reported a Sham Cash transfer',
    },
  });
}

const SYP = (amountMinor) => ({ currency: 'SYP', amountMinor, scale: 2 });
const EVIDENCE = [{ kind: 'PROVIDER_STATEMENT', reference: 'STMT-2026-10-11-0042' }];
const supportDb = () => appDsn(context, 'support');

async function rows(statement) {
  const result = await sql(supportDb(), statement);
  assert.ok(result.ok, result.message ?? 'query failed');
  return result.rows;
}

async function billingAudit(correlationId) {
  const result = await sql(
    appDsn(context, 'billing'),
    `SELECT action, actor_subject::text AS actor, outcome FROM app.billing_audit_event WHERE correlation_id = '${correlationId}' ORDER BY action`,
  );
  assert.ok(result.ok, result.message);
  return result.rows;
}

/* --------------------------------- Part H -------------------------------- */

test('H1: finance allocates the explicitly selected independent statement credit through REAL Billing; owner audit identifies the approver', async () => {
  const { finance } = stack.people;
  const subject = await attemptUnderReview();
  const statementCredit = await statementFor(subject);
  const opened = await openReview(finance, subject);
  assert.equal(opened.status, 201, JSON.stringify(opened.body));
  const caseId = opened.body.case.caseId;
  assert.equal(opened.body.case.snapshot.owner, 'billing');
  assert.equal(opened.body.case.snapshot.state.attemptStatus, 'PENDING_REVIEW');
  assert.equal(opened.body.case.snapshot.state.amountMinor, '150000');

  const correlationId = randomUUID();
  const decided = await support(finance, `/${caseId}/decisions`, {
    method: 'POST',
    key: commandKey(),
    correlationId,
    body: {
      action: 'APPROVE_MATCH',
      reason: { code: 'PROVIDER_CONFIRMED', note: 'Statement line 42 matches exactly' },
      evidence: EVIDENCE,
      amount: SYP('150000'),
      statementCredit,
    },
  });
  assert.equal(decided.status, 200, JSON.stringify(decided.body));
  assert.equal(decided.body.case.status, 'RESOLVED');
  assert.equal(decided.body.decisions[0].status, 'APPLIED');
  assert.equal(decided.body.decisions[0].owner.state, 'MATCHED');

  // Billing, the owner, decided "paid" — and audited the human, not Support.
  const obligation = await billingCall(finance, `/obligations/${subject.obligationId}`);
  assert.equal(obligation.body.attempts[0].status, 'MATCHED');
  assert.equal(obligation.body.status, 'SETTLED');
  const audit = await billingAudit(correlationId);
  assert.deepEqual(audit, [
    { action: 'billing.credit.allocated', actor: finance.subject, outcome: 'MATCHED' },
    { action: 'billing.credit.approved', actor: finance.subject, outcome: 'ALLOCATED' },
  ]);
  // Support's own append-only audit, same actor and correlation id.
  const events = await rows(
    `SELECT action, actor_subject::text AS actor, correlation_id::text AS correlation FROM app.case_event WHERE case_id = '${caseId}' ORDER BY seq`,
  );
  assert.deepEqual(
    events.map((e) => e.action),
    ['case.opened', 'decision.recorded', 'execution.started', 'execution.finished'],
  );
  assert.ok(
    events.slice(1).every((e) => e.actor === finance.subject && e.correlation === correlationId),
  );
  // Outbox rows were written in the same transactions; free text never leaves.
  const outbox = await rows(
    `SELECT event_type, payload, published_at FROM app.outbox_message WHERE payload LIKE '%${caseId}%'`,
  );
  assert.ok(outbox.length >= 3);
  for (const row of outbox) {
    assert.equal(row.published_at, null);
    assert.doesNotMatch(row.payload, /Statement line|STMT-|150000|Sham Cash/);
  }
});

test('H2: finance rejects a mismatch with the observed amount; Billing records MISMATCHED, nothing is paid', async () => {
  const { finance } = stack.people;
  const subject = await attemptUnderReview();
  const caseId = (await openReview(finance, subject)).body.case.caseId;
  const decided = await support(finance, `/${caseId}/decisions`, {
    method: 'POST',
    key: commandKey(),
    body: {
      action: 'REJECT_MISMATCH',
      reason: { code: 'PROVIDER_AMOUNT_DIFFERS', note: 'Statement shows 1,000.00 not 1,500.00' },
      evidence: EVIDENCE,
      amount: SYP('100000'),
    },
  });
  assert.equal(decided.body.case.status, 'RESOLVED');
  assert.equal(decided.body.decisions[0].owner.state, 'MISMATCHED');
  const obligation = await billingCall(finance, `/obligations/${subject.obligationId}`);
  assert.equal(obligation.body.attempts[0].status, 'MISMATCHED');
  assert.equal(obligation.body.verified.amountMinor, '0');
  assert.equal(obligation.body.status, 'OPEN');
});

test('H3: a lost Billing answer is OUTCOME_UNKNOWN; refresh shows it; resend replays the SAME command once', async () => {
  const { finance } = stack.people;
  const subject = await attemptUnderReview();
  const statementCredit = await statementFor(subject);
  const caseId = (await openReview(finance, subject)).body.case.caseId;
  const before = stack.relay.state.reconciliations;
  stack.relay.state.dropNextReconciliation = true;
  const correlationId = randomUUID();
  const decisionKey = commandKey();
  const body = {
    action: 'APPROVE_MATCH',
    reason: { code: 'PROVIDER_CONFIRMED', note: 'Statement line 77 matches exactly' },
    evidence: EVIDENCE,
    amount: SYP('150000'),
    statementCredit,
  };
  const lost = await support(finance, `/${caseId}/decisions`, {
    method: 'POST',
    key: decisionKey,
    correlationId,
    body,
  });
  assert.equal(lost.status, 200, JSON.stringify(lost.body));
  assert.equal(lost.body.case.status, 'OUTCOME_UNKNOWN');
  assert.equal(lost.body.decisions[0].status, 'OUTCOME_UNKNOWN');
  // Billing really acted although Support never heard it.
  assert.equal((await billingAudit(correlationId)).length, 2);

  // Refresh: the authoritative state is still OUTCOME_UNKNOWN, never success.
  const refreshed = await support(finance, `/${caseId}`);
  assert.equal(refreshed.body.case.status, 'OUTCOME_UNKNOWN');
  // Retrying the SAME request inside the lease neither duplicates nor resolves.
  const retried = await support(finance, `/${caseId}/decisions`, {
    method: 'POST',
    key: decisionKey,
    body,
  });
  assert.equal(retried.body.decisions.length, 1);
  // A different decision cannot be taken over an unknown outcome.
  const other = await support(finance, `/${caseId}/decisions`, {
    method: 'POST',
    key: commandKey(),
    body: {
      action: 'DISMISS',
      reason: { code: 'ALREADY_HANDLED', note: 'Close it instead please' },
    },
  });
  assert.equal(other.status, 409);
  assert.equal(other.body.error.code, 'CASE_NOT_DECIDABLE');

  await new Promise((resolve) => setTimeout(resolve, 1_100));
  const otherReviewer = await support(stack.people.reviewer, `/${caseId}/decisions/1/execution`, {
    method: 'POST',
  });
  assert.equal(otherReviewer.status, 403);
  assert.equal(otherReviewer.body.error.code, 'AUTH_FORBIDDEN');
  assert.equal((await support(finance, `/${caseId}`)).body.case.status, 'OUTCOME_UNKNOWN');
  assert.equal(
    stack.relay.state.reconciliations - before,
    1,
    'actor change must not send a new owner command',
  );
  const resent = await support(finance, `/${caseId}/decisions/1/execution`, {
    method: 'POST',
    correlationId: randomUUID(),
  });
  assert.equal(resent.status, 200, JSON.stringify(resent.body));
  assert.equal(resent.body.case.status, 'RESOLVED');
  assert.equal(resent.body.decisions[0].owner.attempts, 2);
  // Billing replayed the same key: exactly one allocation fact exists.
  assert.equal(stack.relay.state.reconciliations - before, 2);
  const audited = await sql(
    appDsn(context, 'billing'),
    `SELECT count(*)::int AS n FROM app.billing_audit_event WHERE attempt_id = '${subject.attemptId}' AND action = 'billing.credit.allocated'`,
  );
  assert.equal(audited.rows[0].n, 1);
  // Resending a finished decision is refused.
  const again = await support(finance, `/${caseId}/decisions/1/execution`, { method: 'POST' });
  assert.equal(again.status, 409);
  assert.equal(again.body.error.code, 'NOTHING_TO_EXECUTE');
});

test('H4: four-eyes refund remains EXECUTING until Billing records the independent financial outcome', async () => {
  const { finance, reviewer } = stack.people;
  const subject = await attemptUnderReview();
  const statementCredit = await statementFor(subject);
  const reviewCase = (await openReview(finance, subject)).body.case.caseId;
  const paid = await support(finance, `/${reviewCase}/decisions`, {
    method: 'POST',
    key: commandKey(),
    body: {
      action: 'APPROVE_MATCH',
      reason: { code: 'PROVIDER_CONFIRMED', note: 'Statement line 90 matches exactly' },
      evidence: EVIDENCE,
      amount: SYP('150000'),
      statementCredit,
    },
  });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  assert.equal(paid.body.case.status, 'RESOLVED');
  const opened = await support(finance, '', {
    method: 'POST',
    key: commandKey(),
    body: {
      kind: 'REFUND',
      subject: { type: 'billing.obligation', id: subject.obligationId },
      summary: 'Wash cancelled after payment',
    },
  });
  assert.equal(opened.status, 201, JSON.stringify(opened.body));
  const caseId = opened.body.case.caseId;
  assert.equal(opened.body.case.snapshot.state.verifiedMinor, '150000');
  const proposed = await support(finance, `/${caseId}/decisions`, {
    method: 'POST',
    key: commandKey(),
    body: {
      action: 'REFUND',
      reason: { code: 'SERVICE_NOT_DELIVERED', note: 'Technician never arrived, customer paid' },
      evidence: [{ kind: 'OWNER_RECORD', reference: `booking:${randomUUID()}` }],
      amount: SYP('150000'),
    },
  });
  assert.equal(proposed.body.case.status, 'AWAITING_APPROVAL');
  const self = await support(finance, `/${caseId}/decisions/1/approval`, {
    method: 'POST',
    key: commandKey(),
    body: { approve: true, note: 'Approving my own proposal' },
  });
  assert.equal(self.status, 409);
  assert.equal(self.body.error.code, 'SAME_PERSON_APPROVAL');
  const approved = await support(reviewer, `/${caseId}/decisions/1/approval`, {
    method: 'POST',
    key: commandKey(),
    body: { approve: true, note: 'Checked the booking record' },
  });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.case.status, 'EXECUTING');
  assert.equal(approved.body.decisions[0].owner.code, 'REFUND_PENDING');
  assert.equal(approved.body.decisions[0].owner.state, 'REQUESTED');
  assert.equal(approved.body.decisions[0].approval.by, reviewer.subject);
  // A requested refund reserves money but has not returned it.
  const obligation = await billingCall(finance, `/obligations/${subject.obligationId}`);
  assert.equal(obligation.body.verified.amountMinor, '150000');
  const refunds = await billingCall(finance, `/obligations/${subject.obligationId}/refunds`);
  assert.equal(refunds.status, 200, JSON.stringify(refunds.body));
  assert.equal(refunds.body.items.length, 1);
  const refund = refunds.body.items[0];
  const returned = await billingCall(finance, `/refunds/${refund.refundId}/outcome`, {
    method: 'POST',
    key: commandKey(),
    body: {
      expectedRevision: refund.revision,
      outcome: 'SUCCEEDED',
      reference: `Support-return-${randomUUID()}`,
    },
  });
  assert.equal(returned.status, 200, JSON.stringify(returned.body));
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const wrongActor = await support(finance, `/${caseId}/decisions/1/execution`, { method: 'POST' });
  assert.equal(wrongActor.status, 403, 'a resend preserves the original execution actor');
  const resolved = await support(reviewer, `/${caseId}/decisions/1/execution`, { method: 'POST' });
  assert.equal(resolved.status, 200, JSON.stringify(resolved.body));
  assert.equal(resolved.body.case.status, 'RESOLVED');
  assert.equal(resolved.body.decisions[0].owner.state, 'SUCCEEDED');
  assert.equal(
    (await billingCall(finance, `/obligations/${subject.obligationId}/refunds`)).body.items.length,
    1,
  );
  // The database refuses a self-approval even if the application were bypassed.
  const bypass = await sql(
    supportDb(),
    `UPDATE app.resolution_request SET approved_by = decided_by WHERE case_id = '${caseId}'`,
  );
  assert.equal(bypass.ok, false);
});

test('H7: Support cannot approve a statement recorded by the same real Finance account or select another claim credit', async () => {
  const { finance, reviewer } = stack.people;
  const subject = await attemptUnderReview();
  const statementCredit = await statementFor(subject, finance);
  const caseId = (await openReview(finance, subject)).body.case.caseId;
  const rejected = await support(finance, `/${caseId}/decisions`, {
    method: 'POST',
    key: commandKey(),
    body: {
      action: 'APPROVE_MATCH',
      reason: {
        code: 'PROVIDER_CONFIRMED',
        note: 'This statement was recorded by the same reviewer',
      },
      evidence: EVIDENCE,
      amount: SYP('150000'),
      statementCredit,
    },
  });
  assert.equal(rejected.status, 200, JSON.stringify(rejected.body));
  assert.equal(rejected.body.case.status, 'OWNER_REJECTED');
  assert.equal(rejected.body.decisions[0].owner.code, 'SEPARATION_OF_DUTIES');
  const other = await attemptUnderReview();
  const otherCase = (await openReview(reviewer, other)).body.case.caseId;
  const wrong = await support(reviewer, `/${otherCase}/decisions`, {
    method: 'POST',
    key: commandKey(),
    body: {
      action: 'APPROVE_MATCH',
      reason: {
        code: 'PROVIDER_CONFIRMED',
        note: 'This credit belongs to a different customer claim',
      },
      evidence: EVIDENCE,
      amount: SYP('150000'),
      statementCredit,
    },
  });
  assert.equal(wrong.status, 200, JSON.stringify(wrong.body));
  assert.equal(wrong.body.case.status, 'OWNER_REJECTED');
  assert.equal(wrong.body.decisions[0].owner.code, 'PROVIDER_CREDIT_CONFLICT');
  for (const claim of [subject, other]) {
    const unchanged = await billingCall(finance, `/obligations/${claim.obligationId}`);
    assert.equal(unchanged.body.status, 'OPEN');
    assert.equal(unchanged.body.verified.amountMinor, '0');
    assert.equal(unchanged.body.attempts[0].status, 'PENDING_REVIEW');
  }
  const credit = await billingCall(finance, `/provider-credits/${statementCredit.creditId}`);
  assert.equal(credit.body.status, 'PENDING_APPROVAL');
  assert.equal(credit.body.revision, statementCredit.revision);
});

test('H5: operations cancel and reschedule cases execute real Booking commands with explicit owner holds', async () => {
  const { operations } = stack.people;
  const booking = await createBooking();
  const cancel = await support(operations, '', {
    method: 'POST',
    key: commandKey(),
    body: {
      kind: 'BOOKING_CANCELLATION',
      subject: { type: 'booking', id: booking.bookingId },
      summary: 'Customer asked to cancel by phone',
    },
  });
  assert.equal(cancel.status, 201, JSON.stringify(cancel.body));
  assert.equal(cancel.body.case.snapshot.owner, 'booking');
  assert.equal(cancel.body.case.snapshot.state.bookingStatus, booking.status);
  assert.equal(cancel.body.case.snapshot.state.bookingRevision, booking.revision);
  // Contact and address never reach Support.
  assert.doesNotMatch(JSON.stringify(cancel.body), /0912345678|زبون اختبار/);
  const caseId = cancel.body.case.caseId;
  const current = await support(operations, `/${caseId}/current`);
  assert.equal(current.body.current.owner, 'booking');
  assert.equal(current.body.current.booking.status, booking.status);
  const decided = await support(operations, `/${caseId}/decisions`, {
    method: 'POST',
    key: commandKey(),
    body: {
      action: 'CANCEL_BOOKING',
      reason: { code: 'CUSTOMER_REQUEST', note: 'Customer called the hotline to cancel' },
    },
  });
  assert.equal(decided.body.case.status, 'RESOLVED', JSON.stringify(decided.body));
  assert.equal(decided.body.decisions[0].owner.operation, 'booking.cancel');
  const after = await call(
    stack.booking.origin,
    stack.people.customer,
    `/internal/v1/booking/bookings/${booking.bookingId}`,
  );
  assert.equal(after.body.status, 'CANCELLED');

  const movable = await createBooking();
  stack.doubles.sessions.set(operations.token, {
    subject: operations.subject,
    principalKind: 'account',
    permissions: ['operations.dispatch'],
  });
  const startsAt = new Date(Date.now() + 2 * 86_400_000);
  startsAt.setUTCMinutes(0, 0, 0);
  const { holdWire } = owned('booking')(
    path.join(ROOT, 'services', 'booking', 'dist-tests', 'test', 'support', 'fixtures.js'),
  );
  const hold = {
    ...holdWire({
      beneficiary: { kind: 'account', subjectId: stack.people.customer.subject },
      zoneId: movable.schedule.zoneId,
      startsAt,
      now: new Date(),
      quoteRef: stack.doubles.holds.get(movable.slot.holdId).quoteRef,
    }),
    owner: stack.people.customer.subject,
  };
  stack.doubles.holds.set(hold.holdId, hold);
  const reschedule = await support(operations, '', {
    method: 'POST',
    key: commandKey(),
    body: {
      kind: 'BOOKING_RESCHEDULE',
      subject: { type: 'booking', id: movable.bookingId },
      summary: 'Move to the day after tomorrow',
    },
  });
  assert.equal(reschedule.status, 201, JSON.stringify(reschedule.body));
  const moved = await support(operations, `/${reschedule.body.case.caseId}/decisions`, {
    method: 'POST',
    key: commandKey(),
    body: {
      action: 'RESCHEDULE_BOOKING',
      bookingHold: { holdId: hold.holdId, revision: hold.revision },
      reason: { code: 'TECHNICIAN_UNAVAILABLE', note: 'No technician free in the slot' },
      window: {
        startsAt: startsAt.toISOString(),
        endsAt: new Date(startsAt.getTime() + 3_600_000).toISOString(),
      },
    },
  });
  assert.equal(moved.body.case.status, 'RESOLVED', JSON.stringify(moved.body));
  assert.equal(moved.body.decisions[0].owner.operation, 'booking.reschedule');
  const movedBooking = await call(
    stack.booking.origin,
    stack.people.customer,
    `/internal/v1/booking/bookings/${movable.bookingId}`,
  );
  assert.equal(movedBooking.body.schedule.holdId, hold.holdId);
  assert.equal(movedBooking.body.schedule.startsAt, startsAt.toISOString());
});

test('H6: role separation is enforced by Support and by the owners', async () => {
  const { finance, operations, supportDesk, technician, customer } = stack.people;
  const subject = await attemptUnderReview();
  const caseId = (await openReview(finance, subject)).body.case.caseId;

  assert.equal((await support(null, '')).status, 401);
  assert.equal((await support(customer, '')).status, 403);
  assert.equal((await support(technician, '')).status, 403);
  // Operations does not see finance cases at all.
  assert.equal((await support(operations, `/${caseId}`)).status, 404);
  const opsList = await support(operations, '?kind=PAYMENT_REVIEW');
  assert.equal(opsList.status, 403);
  const opsDecide = await support(operations, `/${caseId}/decisions`, {
    method: 'POST',
    key: commandKey(),
    body: { action: 'DISMISS', reason: { code: 'ALREADY_HANDLED', note: 'Operations closing it' } },
  });
  assert.equal(opsDecide.status, 403);
  // Finance cannot open operational booking cases.
  const finBooking = await support(finance, '', {
    method: 'POST',
    key: commandKey(),
    body: {
      kind: 'BOOKING_CANCELLATION',
      subject: { type: 'booking', id: randomUUID() },
      summary: 'nope',
    },
  });
  assert.equal(finBooking.status, 403);
  // The support desk reads every queue but decides nothing.
  const deskRead = await support(supportDesk, `/${caseId}`);
  assert.equal(deskRead.status, 200);
  const deskDecide = await support(supportDesk, `/${caseId}/decisions`, {
    method: 'POST',
    key: commandKey(),
    body: {
      action: 'MARK_UNKNOWN',
      reason: { code: 'PROVIDER_UNREACHABLE', note: 'Support desk deciding' },
    },
  });
  assert.equal(deskDecide.status, 403);
  // A decision without a reason note or evidence never reaches Billing.
  const bare = await support(finance, `/${caseId}/decisions`, {
    method: 'POST',
    key: commandKey(),
    body: {
      action: 'APPROVE_MATCH',
      reason: { code: 'PROVIDER_CONFIRMED', note: 'ok' },
      amount: SYP('150000'),
    },
  });
  assert.equal(bare.status, 422);
  assert.equal(bare.body.error.code, 'REASON_NOTE_REQUIRED');
  const noEvidence = await support(finance, `/${caseId}/decisions`, {
    method: 'POST',
    key: commandKey(),
    body: {
      action: 'APPROVE_MATCH',
      reason: { code: 'PROVIDER_CONFIRMED', note: 'Statement matches but no proof given' },
      amount: SYP('150000'),
    },
  });
  assert.equal(noEvidence.body.error.code, 'EVIDENCE_REQUIRED');
  const still = await billingCall(finance, `/obligations/${subject.obligationId}`);
  assert.equal(still.body.attempts[0].status, 'PENDING_REVIEW');
});

/* --------------------------------- Part S -------------------------------- */

test('S1: concurrent opens for one subject produce one case; the same key replays the same case', async () => {
  const { finance, reviewer } = stack.people;
  const subject = await attemptUnderReview();
  const [a, b] = await Promise.all([openReview(finance, subject), openReview(reviewer, subject)]);
  assert.deepEqual([a.status, b.status].sort(), [201, 409]);
  const loser = a.status === 409 ? a : b;
  assert.equal(loser.body.error.code, 'CASE_ALREADY_OPEN');

  const other = await attemptUnderReview();
  const key = commandKey();
  const [x, y] = await Promise.all([
    openReview(finance, other, key),
    openReview(finance, other, key),
  ]);
  assert.ok([x.status, y.status].includes(201));
  assert.equal(x.body.case.caseId, y.body.case.caseId);
  const count = await rows(
    `SELECT count(*)::int AS n FROM app.support_case WHERE subject_id = '${other.attemptId}'`,
  );
  assert.equal(count[0].n, 1);
});

test('S2: the runtime identity cannot rewrite the audit trail or frozen decisions', async () => {
  const [event] = await rows('SELECT id FROM app.case_event LIMIT 1');
  const update = await sql(
    supportDb(),
    `UPDATE app.case_event SET action = 'x' WHERE id = '${event.id}'`,
  );
  assert.equal(update.ok, false);
  assert.match(update.message ?? '', /SUPPORT_APPEND_ONLY/);
  const del = await sql(supportDb(), `DELETE FROM app.case_event WHERE id = '${event.id}'`);
  assert.equal(del.ok, false);
  const [decision] = await rows(
    'SELECT case_id::text AS id FROM app.resolution_request WHERE amount_minor IS NOT NULL LIMIT 1',
  );
  const rewrite = await sql(
    supportDb(),
    `UPDATE app.resolution_request SET amount_minor = 1 WHERE case_id = '${decision.id}'`,
  );
  assert.equal(rewrite.ok, false);
  assert.match(rewrite.message ?? '', /SUPPORT_FROZEN/);
  // Exact money is stored as an integer of minor units, never a float.
  const [type] = await rows(
    "SELECT data_type, numeric_scale FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'resolution_request' AND column_name = 'amount_minor'",
  );
  assert.deepEqual(type, { data_type: 'numeric', numeric_scale: 0 });
  // The runtime identity cannot change the schema.
  const ddl = await sql(supportDb(), 'ALTER TABLE app.support_case ADD COLUMN x int');
  assert.equal(ddl.ok, false);
});
