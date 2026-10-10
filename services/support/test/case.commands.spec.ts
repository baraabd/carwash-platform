import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  CaseRuleError,
  decisionInput,
  ownerCommandKey,
  planApproval,
  planDecision,
  type OwnerOutcome,
} from '../src/domain';
import {
  CaseCommands,
  CaseQueries,
  SupportApplicationError,
  caseStatusChangedEvent,
  parseCaseStatusChangedData,
  readableKinds,
} from '../src/application';
import {
  AccessFault,
  CaseConflict,
  type BillingOwner,
  type BookingOwner,
  type CaseDetail,
  type CaseEventRecord,
  type CaseListFilter,
  type CaseReader,
  type CaseRecord,
  type CaseStore,
  type CaseUnitOfWork,
  type DecisionRecord,
  type ObligationState,
  type OnBehalfOf,
  type OutboxEvent,
  type OwnerRequest,
  type VerifiedSession,
} from '../src/ports';

/* ------------------------------- fakes ------------------------------- */

/** In-memory fakes answer synchronously through the async ports. */
const settled = <T>(value: T): Promise<T> => Promise.resolve(value);
function settle<T>(work: () => T): Promise<T> {
  try {
    return Promise.resolve(work());
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
}

class MemoryStore implements CaseStore, CaseReader {
  cases = new Map<string, CaseRecord>();
  decisionRows: DecisionRecord[] = [];
  events: CaseEventRecord[] = [];
  outbox: OutboxEvent[] = [];

  async transaction<T>(work: (uow: CaseUnitOfWork) => Promise<T>): Promise<T> {
    // Copy-on-write so a throwing unit of work leaves nothing behind (atomicity).
    const saved = {
      cases: new Map(this.cases),
      decisions: [...this.decisionRows],
      events: [...this.events],
      outbox: [...this.outbox],
    };
    try {
      return await work(this.uow());
    } catch (error) {
      this.cases = saved.cases;
      this.decisionRows = saved.decisions;
      this.events = saved.events;
      this.outbox = saved.outbox;
      throw error;
    }
  }

  private uow(): CaseUnitOfWork {
    const cases = () => [...this.cases.values()];
    return {
      lockCase: (id) => settle(() => this.cases.get(id) ?? null),
      caseByOpenKey: (actor, key) =>
        settle(() => cases().find((c) => c.openedBy === actor && c.openKey === key) ?? null),
      activeCaseFor: (kind, subject) =>
        settle(
          () =>
            cases().find(
              (c) =>
                c.kind === kind &&
                c.subject.id === subject.id &&
                !['RESOLVED', 'CLOSED'].includes(c.status),
            ) ?? null,
        ),
      insertCase: (record) =>
        settle(() => {
          if (cases().some((c) => c.openedBy === record.openedBy && c.openKey === record.openKey))
            throw new CaseConflict('OPEN_KEY');
          this.cases.set(record.id, { ...record });
        }),
      updateCase: (id, expected, patch) =>
        settle(() => {
          const current = this.cases.get(id);
          if (!current || current.revision !== expected) return false;
          this.cases.set(id, { ...current, ...patch, revision: expected + 1 });
          return true;
        }),
      decisions: (caseId) => settle(() => this.decisionRows.filter((d) => d.caseId === caseId)),
      decisionByKey: (caseId, actor, key) =>
        settle(
          () =>
            this.decisionRows.find(
              (d) => d.caseId === caseId && d.decidedBy === actor && d.idempotencyKey === key,
            ) ?? null,
        ),
      insertDecision: (record) =>
        settle(() => {
          this.decisionRows.push({ ...record });
        }),
      updateDecision: (caseId, no, fence, patch) =>
        settle(() => {
          const index = this.decisionRows.findIndex(
            (d) => d.caseId === caseId && d.decisionNo === no && d.executionFence === fence,
          );
          if (index < 0) return false;
          this.decisionRows[index] = { ...this.decisionRows[index]!, ...patch };
          return true;
        }),
      appendEvent: (event) =>
        settle(() => {
          this.events.push(event);
        }),
      enqueue: (event) =>
        settle(() => {
          this.outbox.push(event);
        }),
    };
  }

  list(filter: CaseListFilter): Promise<readonly CaseRecord[]> {
    return settled(
      [...this.cases.values()].filter((c) => filter.kinds.includes(c.kind)).slice(0, filter.limit),
    );
  }

  detail(id: string): Promise<CaseDetail | null> {
    const record = this.cases.get(id);
    if (!record) return settled(null);
    return settled({
      record: { ...record },
      decisions: this.decisionRows.filter((d) => d.caseId === id).map((d) => ({ ...d })),
      events: this.events.filter((e) => e.caseId === id),
    });
  }
}

const SYP = (amountMinor: string) => ({ currency: 'SYP', amountMinor, scale: 2 });

class FakeBilling implements BillingOwner {
  obligations = new Map<string, ObligationState>();
  sent: { request: OwnerRequest; credential: string }[] = [];
  /** Scripted answers for the next sends; default APPLIED with the attempt's new status. */
  script: OwnerOutcome[] = [];

  obligation(_auth: OnBehalfOf, id: string) {
    return settled(this.obligations.get(id) ?? null);
  }

  execute(auth: OnBehalfOf, request: OwnerRequest): Promise<OwnerOutcome> {
    return settled(this.answer(auth, request));
  }

  private answer(auth: OnBehalfOf, request: OwnerRequest): OwnerOutcome {
    this.sent.push({ request, credential: auth.credential });
    if (request.operation === 'billing.refund')
      return { kind: 'UNAVAILABLE', code: 'OWNER_CAPABILITY_UNPUBLISHED' };
    const next = this.script.shift();
    const outcome = request.body.outcome as string;
    // The owner really applies the first command it receives with a key.
    const obligation = this.obligations.get(request.body.obligationId as string)!;
    const attempt = obligation.attempts.find((a) => a.attemptId === request.targetId)!;
    const applied = this.sent.filter((s) => s.request.key === request.key).length === 1;
    if (applied && (!next || next.kind !== 'REJECTED')) {
      this.obligations.set(obligation.obligationId, {
        ...obligation,
        revision: obligation.revision + 1,
        attempts: obligation.attempts.map((a) => (a === attempt ? { ...a, status: outcome } : a)),
      });
    }
    return next ?? { kind: 'APPLIED', ownerStatus: 200, ownerState: outcome };
  }
}

class FakeBooking implements BookingOwner {
  booking(_auth: OnBehalfOf, bookingId: string) {
    return settled({
      bookingId,
      revision: 3,
      status: 'CONFIRMED',
      confirmation: 'CONFIRMED',
      startsAt: '2026-10-12T08:00:00.000Z',
      endsAt: '2026-10-12T09:00:00.000Z',
    });
  }

  execute(): Promise<OwnerOutcome> {
    return settled({ kind: 'UNAVAILABLE', code: 'OWNER_CAPABILITY_UNPUBLISHED' });
  }
}

function session(permissions: string[]): VerifiedSession {
  return { subject: randomUUID(), sessionId: randomUUID(), authVersion: 1, permissions };
}

const auth: OnBehalfOf = {
  credential: 'Bearer aaaaaaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbb.cccccccccccccccccc',
  correlationId: randomUUID(),
};

function harness() {
  const store = new MemoryStore();
  const billing = new FakeBilling();
  const booking = new FakeBooking();
  let now = new Date('2026-10-11T10:00:00.000Z');
  const clock = { now: () => now };
  const commands = new CaseCommands({
    store,
    reader: store,
    billing,
    booking,
    clock,
    ids: { uuid: () => randomUUID() },
    executionLeaseMs: 15_000,
  });
  const queries = new CaseQueries(store, billing, booking, clock);
  return {
    store,
    billing,
    commands,
    queries,
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
  };
}

function seedAttempt(billing: FakeBilling, status = 'PENDING_REVIEW') {
  const obligationId = randomUUID();
  const attemptId = randomUUID();
  billing.obligations.set(obligationId, {
    obligationId,
    revision: 4,
    status: 'OPEN',
    financialStatus: 'UNDER_REVIEW',
    amount: SYP('150000'),
    verified: SYP('0'),
    outstanding: SYP('150000'),
    attempts: [{ attemptId, status, method: 'SHAM_CASH', claimed: SYP('150000') }],
  });
  return { obligationId, attemptId };
}

const key = () => randomUUID().replaceAll('-', '');
const FINANCE = ['billing.read', 'billing.refund', 'billing.reconcile'];
const OPERATIONS = ['operations.dispatch'];
const evidence = [{ kind: 'PROVIDER_STATEMENT', reference: 'STMT-2026-10-11-0042' }];

async function openReview(h: ReturnType<typeof harness>, who: VerifiedSession) {
  const { obligationId, attemptId } = seedAttempt(h.billing);
  const opened = await h.commands.open(who, auth, key(), {
    kind: 'PAYMENT_REVIEW',
    subject: { type: 'billing.payment-attempt', id: attemptId, parentId: obligationId },
    summary: 'Customer reported a Sham Cash transfer',
  });
  return { caseId: opened.detail.record.id, obligationId, attemptId, opened };
}

/* ------------------------------- domain ------------------------------- */

test('domain: a money decision needs a reason note, evidence and an exact amount', () => {
  const now = new Date();
  assert.throws(
    () =>
      decisionInput(
        'PAYMENT_REVIEW',
        { action: 'APPROVE_MATCH', reason: { code: 'PROVIDER_CONFIRMED', note: 'short' } },
        now,
      ),
    (e: unknown) => e instanceof CaseRuleError && e.code === 'REASON_NOTE_REQUIRED',
  );
  assert.throws(
    () =>
      decisionInput(
        'PAYMENT_REVIEW',
        {
          action: 'APPROVE_MATCH',
          reason: { code: 'PROVIDER_CONFIRMED', note: 'Statement line matches' },
        },
        now,
      ),
    (e: unknown) => e instanceof CaseRuleError && e.code === 'EVIDENCE_REQUIRED',
  );
  assert.throws(
    () =>
      decisionInput(
        'PAYMENT_REVIEW',
        {
          action: 'APPROVE_MATCH',
          reason: { code: 'PROVIDER_CONFIRMED', note: 'Statement line matches' },
          evidence,
          amount: { currency: 'SYP', amountMinor: 1500.5, scale: 2 },
        },
        now,
      ),
    (e: unknown) => e instanceof CaseRuleError && e.code === 'INVALID_AMOUNT',
  );
  assert.throws(
    () =>
      decisionInput(
        'PAYMENT_REVIEW',
        { action: 'CANCEL_BOOKING', reason: { code: 'OTHER', note: 'Not a finance action' } },
        now,
      ),
    (e: unknown) => e instanceof CaseRuleError && e.code === 'ACTION_NOT_ALLOWED_FOR_KIND',
  );
  assert.throws(
    () =>
      decisionInput(
        'REFUND',
        {
          action: 'REFUND',
          reason: { code: 'PROVIDER_CONFIRMED', note: 'Reason belongs to another kind' },
          evidence,
          amount: SYP('100'),
        },
        now,
      ),
    (e: unknown) => e instanceof CaseRuleError && e.code === 'REASON_NOT_ALLOWED_FOR_KIND',
  );
  // Evidence references are opaque: a pasted phone number with spaces is refused.
  assert.throws(
    () =>
      decisionInput(
        'PAYMENT_REVIEW',
        {
          action: 'MARK_UNKNOWN',
          reason: { code: 'PROVIDER_UNREACHABLE', note: 'Provider portal is down' },
          evidence: [{ kind: 'CALL_NOTE', reference: '+963 912 345 678' }],
        },
        now,
      ),
    (e: unknown) => e instanceof CaseRuleError && e.code === 'INVALID_EVIDENCE',
  );
});

test('domain: transitions, four-eyes and the owner command key', () => {
  assert.deepEqual(planDecision({ kind: 'REFUND', caseStatus: 'OPEN', action: 'REFUND' }), {
    decisionStatus: 'AWAITING_APPROVAL',
    caseStatus: 'AWAITING_APPROVAL',
    execute: false,
  });
  assert.equal(
    planDecision({ kind: 'PAYMENT_REVIEW', caseStatus: 'OPEN', action: 'DISMISS' }).caseStatus,
    'CLOSED',
  );
  // An unknown outcome may have moved money: no new decision until it is settled.
  assert.throws(
    () =>
      planDecision({ kind: 'PAYMENT_REVIEW', caseStatus: 'OUTCOME_UNKNOWN', action: 'DISMISS' }),
    (e: unknown) => e instanceof CaseRuleError && e.code === 'CASE_NOT_DECIDABLE',
  );
  const person = randomUUID();
  assert.throws(
    () =>
      planApproval({
        caseStatus: 'AWAITING_APPROVAL',
        decisionStatus: 'AWAITING_APPROVAL',
        proposer: person,
        approver: person.toUpperCase(),
        approve: true,
      }),
    (e: unknown) => e instanceof CaseRuleError && e.code === 'SAME_PERSON_APPROVAL',
  );
  const caseId = randomUUID();
  assert.equal(ownerCommandKey(caseId, 2), ownerCommandKey(caseId, 2));
  assert.match(ownerCommandKey(caseId, 2), /^[A-Za-z0-9_-]{16,128}$/);
});

test('events: data carries ids and statuses only and is self-validated', () => {
  const event = caseStatusChangedEvent(
    {
      kind: 'PAYMENT_REVIEW',
      previousStatus: 'OPEN',
      status: 'EXECUTING',
      decisionNo: 1,
      action: 'APPROVE_MATCH',
    },
    {
      eventId: randomUUID(),
      occurredAt: new Date('2026-10-11T10:00:00.000Z'),
      correlationId: randomUUID(),
      actorSubject: randomUUID(),
      caseId: randomUUID(),
      revision: 2,
    },
  );
  assert.deepEqual(Object.keys(JSON.parse(event.payload).data).sort(), [
    'action',
    'decisionNo',
    'kind',
    'previousStatus',
    'status',
  ]);
  assert.throws(() =>
    parseCaseStatusChangedData({
      kind: 'REFUND',
      previousStatus: 'OPEN',
      status: 'OPEN',
      decisionNo: null,
      action: null,
    }),
  );
});

/* ---------------------------- process manager ---------------------------- */

test('finance approves a match: Billing is asked once with the decider credential; case RESOLVED', async () => {
  const h = harness();
  const finance = session(FINANCE);
  const { caseId, attemptId, opened } = await openReview(h, finance);
  assert.equal(opened.created, true);
  assert.equal(opened.detail.record.snapshot.state.attemptStatus, 'PENDING_REVIEW');
  const detail = await h.commands.decide(finance, auth, caseId, key(), {
    action: 'APPROVE_MATCH',
    reason: { code: 'PROVIDER_CONFIRMED', note: 'Statement line 42 matches exactly' },
    evidence,
    amount: SYP('150000'),
  });
  assert.equal(detail.record.status, 'RESOLVED');
  assert.equal(detail.decisions[0]!.status, 'APPLIED');
  assert.equal(detail.decisions[0]!.ownerState, 'MATCHED');
  assert.equal(h.billing.sent.length, 1);
  assert.equal(h.billing.sent[0]!.credential, auth.credential);
  assert.equal(h.billing.sent[0]!.request.targetId, attemptId);
  assert.deepEqual(h.billing.sent[0]!.request.body.observedAmount, SYP('150000'));
  assert.equal(h.billing.sent[0]!.request.body.expectedRevision, 4);
  assert.deepEqual(
    detail.events.map((e) => e.action),
    ['case.opened', 'decision.recorded', 'execution.started', 'execution.finished'],
  );
  assert.ok(
    detail.events.every(
      (e) => e.actorSubject === finance.subject && e.correlationId === auth.correlationId,
    ),
  );
  // Nothing private leaves through the outbox.
  for (const row of h.store.outbox) {
    assert.doesNotMatch(row.payload, /Statement line|STMT-|150000|Sham Cash/);
  }
});

test('reject mismatch is recorded with the observed amount; replaying the same request does not resend', async () => {
  const h = harness();
  const finance = session(FINANCE);
  const { caseId } = await openReview(h, finance);
  const k = key();
  const body = {
    action: 'REJECT_MISMATCH',
    reason: { code: 'PROVIDER_AMOUNT_DIFFERS', note: 'Statement shows a smaller transfer' },
    evidence,
    amount: SYP('100000'),
  };
  const first = await h.commands.decide(finance, auth, caseId, k, body);
  const again = await h.commands.decide(finance, auth, caseId, k, body);
  assert.equal(first.record.status, 'RESOLVED');
  assert.equal(again.decisions.length, 1);
  assert.equal(h.billing.sent.length, 1);
  await assert.rejects(
    h.commands.decide(finance, auth, caseId, k, { ...body, amount: SYP('99999') }),
    (e: unknown) => e instanceof SupportApplicationError && e.code === 'IDEMPOTENCY_CONFLICT',
  );
});

test('a lost Billing answer is OUTCOME_UNKNOWN; the resend replays the same key and body and is verified', async () => {
  const h = harness();
  const finance = session(FINANCE);
  const { caseId } = await openReview(h, finance);
  h.billing.script.push({ kind: 'UNKNOWN', code: 'OWNER_NO_ANSWER' });
  const unknown = await h.commands.decide(finance, auth, caseId, key(), {
    action: 'APPROVE_MATCH',
    reason: { code: 'PROVIDER_CONFIRMED', note: 'Statement line 42 matches exactly' },
    evidence,
    amount: SYP('150000'),
  });
  assert.equal(unknown.record.status, 'OUTCOME_UNKNOWN');
  // No new decision may be taken over an unknown outcome.
  await assert.rejects(
    h.commands.decide(finance, auth, caseId, key(), {
      action: 'DISMISS',
      reason: { code: 'ALREADY_HANDLED', note: 'Trying to close it instead' },
    }),
    (e: unknown) => e instanceof CaseRuleError && e.code === 'CASE_NOT_DECIDABLE',
  );
  // Resend inside the lease is refused, never doubled.
  await assert.rejects(
    h.commands.resend(finance, auth, caseId, '1'),
    (e: unknown) => e instanceof SupportApplicationError && e.code === 'EXECUTION_IN_PROGRESS',
  );
  h.advance(20_000);
  // Billing already applied the first send: the resend is refused as stale,
  // and Billing's own record proves the decision applied.
  h.billing.script.push({ kind: 'REJECTED', ownerStatus: 409, code: 'REVISION_CONFLICT' });
  const resolved = await h.commands.resend(finance, auth, caseId, '1');
  assert.equal(resolved.record.status, 'RESOLVED');
  assert.equal(resolved.decisions[0]!.ownerState, 'MATCHED');
  assert.equal(h.billing.sent.length, 2);
  assert.deepEqual(h.billing.sent[1]!.request, h.billing.sent[0]!.request);
  assert.equal(resolved.decisions[0]!.executionAttempts, 2);
});

test('refund: four-eyes approval by a different finance reviewer; the unpublished owner command blocks', async () => {
  const h = harness();
  const proposer = session(FINANCE);
  const approver = session(FINANCE);
  const { obligationId } = seedAttempt(h.billing);
  const o = h.billing.obligations.get(obligationId)!;
  h.billing.obligations.set(obligationId, { ...o, verified: SYP('150000'), outstanding: SYP('0') });
  const opened = await h.commands.open(proposer, auth, key(), {
    kind: 'REFUND',
    subject: { type: 'billing.obligation', id: obligationId },
    summary: 'Customer paid twice',
  });
  const caseId = opened.detail.record.id;
  const proposed = await h.commands.decide(proposer, auth, caseId, key(), {
    action: 'REFUND',
    reason: { code: 'DUPLICATE_PAYMENT', note: 'Two transfers on the statement' },
    evidence,
    amount: SYP('150000'),
  });
  assert.equal(proposed.record.status, 'AWAITING_APPROVAL');
  assert.equal(h.billing.sent.length, 0);
  await assert.rejects(
    h.commands.approve(proposer, auth, caseId, '1', key(), {
      approve: true,
      note: 'Approving my own refund',
    }),
    (e: unknown) => e instanceof CaseRuleError && e.code === 'SAME_PERSON_APPROVAL',
  );
  await assert.rejects(
    h.commands.approve(session(OPERATIONS), auth, caseId, '1', key(), {
      approve: true,
      note: 'Operations cannot approve',
    }),
    (e: unknown) => e instanceof AccessFault && e.code === 'AUTH_FORBIDDEN',
  );
  const approved = await h.commands.approve(approver, auth, caseId, '1', key(), {
    approve: true,
    note: 'Checked both statement lines',
  });
  assert.equal(approved.record.status, 'BLOCKED_ON_OWNER');
  assert.equal(approved.decisions[0]!.ownerCode, 'OWNER_CAPABILITY_UNPUBLISHED');
  assert.equal(approved.decisions[0]!.approvedBy, approver.subject);
  // Nothing was sent, so a different decision may replace the blocked one.
  const dismissed = await h.commands.decide(approver, auth, caseId, key(), {
    action: 'DISMISS',
    reason: { code: 'ALREADY_HANDLED', note: 'Refunded through the provider portal' },
  });
  assert.equal(dismissed.record.status, 'CLOSED');
  assert.equal(dismissed.decisions[0]!.status, 'SUPERSEDED');
});

test('desk separation: operations cannot see or decide finance cases; finance cannot open booking cases', async () => {
  const h = harness();
  const finance = session(FINANCE);
  const operations = session(OPERATIONS);
  const { caseId } = await openReview(h, finance);
  await assert.rejects(
    h.queries.detail(operations, caseId),
    (e: unknown) => e instanceof SupportApplicationError && e.code === 'NOT_FOUND',
  );
  await assert.rejects(
    h.commands.decide(operations, auth, caseId, key(), {
      action: 'DISMISS',
      reason: { code: 'ALREADY_HANDLED', note: 'Operations closing a payment' },
    }),
    (e: unknown) => e instanceof AccessFault && e.code === 'AUTH_FORBIDDEN',
  );
  await assert.rejects(
    h.commands.open(finance, auth, key(), {
      kind: 'BOOKING_CANCELLATION',
      subject: { type: 'booking', id: randomUUID() },
      summary: 'Finance trying to cancel',
    }),
    (e: unknown) => e instanceof AccessFault && e.code === 'AUTH_FORBIDDEN',
  );
  const readOnly = session(['billing.read']);
  await assert.rejects(
    h.commands.decide(readOnly, auth, caseId, key(), {
      action: 'MARK_UNKNOWN',
      reason: { code: 'PROVIDER_UNREACHABLE', note: 'Provider portal is down' },
    }),
    (e: unknown) => e instanceof AccessFault && e.code === 'AUTH_FORBIDDEN',
  );
  assert.deepEqual(readableKinds(session(['support.cases.read'])).length, 5);
  assert.deepEqual(readableKinds(session([])), []);
});

test('operations cancel/reschedule: authoritative booking state recorded, owner command blocked', async () => {
  const h = harness();
  const operations = session(OPERATIONS);
  const bookingId = randomUUID();
  const opened = await h.commands.open(operations, auth, key(), {
    kind: 'BOOKING_RESCHEDULE',
    subject: { type: 'booking', id: bookingId },
    summary: 'Technician sick, customer agreed to move',
  });
  assert.equal(opened.detail.record.snapshot.state.bookingStatus, 'CONFIRMED');
  await assert.rejects(
    h.commands.open(operations, auth, key(), {
      kind: 'BOOKING_RESCHEDULE',
      subject: { type: 'booking', id: bookingId },
      summary: 'Second case for the same booking',
    }),
    (e: unknown) => e instanceof SupportApplicationError && e.code === 'CASE_ALREADY_OPEN',
  );
  const decided = await h.commands.decide(operations, auth, opened.detail.record.id, key(), {
    action: 'RESCHEDULE_BOOKING',
    reason: { code: 'TECHNICIAN_UNAVAILABLE', note: 'Assigned technician is sick today' },
    window: { startsAt: '2026-10-13T08:00:00.000Z', endsAt: '2026-10-13T09:00:00.000Z' },
  });
  assert.equal(decided.record.status, 'BLOCKED_ON_OWNER');
  assert.equal(decided.decisions[0]!.ownerRequest?.body.expectedRevision, 3);
  assert.deepEqual(decided.decisions[0]!.ownerRequest?.body.window, {
    startsAt: '2026-10-13T08:00:00.000Z',
    endsAt: '2026-10-13T09:00:00.000Z',
  });
});

test('a case is only opened for an attempt Billing still has under review', async () => {
  const h = harness();
  const finance = session(FINANCE);
  const { obligationId, attemptId } = seedAttempt(h.billing, 'MATCHED');
  await assert.rejects(
    h.commands.open(finance, auth, key(), {
      kind: 'PAYMENT_REVIEW',
      subject: { type: 'billing.payment-attempt', id: attemptId, parentId: obligationId },
      summary: 'Already matched',
    }),
    (e: unknown) => e instanceof SupportApplicationError && e.code === 'SUBJECT_NOT_ELIGIBLE',
  );
  await assert.rejects(
    h.commands.open(finance, auth, key(), {
      kind: 'PAYMENT_REVIEW',
      subject: { type: 'billing.payment-attempt', id: randomUUID(), parentId: obligationId },
      summary: 'Unknown attempt',
    }),
    (e: unknown) => e instanceof SupportApplicationError && e.code === 'SUBJECT_NOT_FOUND',
  );
});
