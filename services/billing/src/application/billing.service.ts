import {
  Money,
  MoneyError,
  PAYMENT_METHODS,
  PaymentRuleError,
  RECONCILIATION_OUTCOMES,
  normalizeProviderReference,
  obligationBilledJournal,
  obligationVoidedJournal,
  outstanding,
  paymentMatchedJournal,
  planAttemptSubmission,
  planMethodSelection,
  planReconciliation,
  planVoid,
  type FinancialStatus,
  type PaymentMethod,
  type ReconciliationOutcome,
} from '../domain';
import {
  AccessDenied,
  ConcurrentModification,
  ObligationAlreadyExists,
  ProviderReferenceTaken,
  QuoteUnavailable,
  ReceiptAlreadyExists,
  type AccessAuthority,
  type AuditAction,
  type BillingRepository,
  type BillingUnitOfWork,
  type Clock,
  type FinancialSnapshot,
  type Hasher,
  type IdGenerator,
  type IdempotencyReceipt,
  type ObligationRecord,
  type PrincipalRef,
  type QuoteReader,
  type RecordedOutcome,
  type VerifiedPrincipal,
} from '../ports';
import { BillingApplicationError } from './billing-errors';
import { canonicalJson } from './canonical-json';
import { obligationCreatedEvent, obligationStatusChangedEvent } from './events';
import { financialStatusView, obligationView, snapshotFinancialStatus } from './views';

/** Existing Identity grants for customers (account or guest) starting/reading a booking. */
export const CREATE_PERMISSION = 'bookings.create:self';
export const READ_SELF_PERMISSION = 'bookings.read:self';
/** Existing Identity grant for Finance. */
export const FINANCE_READ_PERMISSION = 'billing.read';
/** Requested from Lane E/Identity; until granted every reconciliation is denied. */
export const RECONCILE_PERMISSION = 'billing.reconcile';

export const OPERATIONS = {
  create: 'billing.obligation.create.v1',
  initialize: 'billing.intent.initialize.v1',
  submit: 'billing.attempt.submit.v1',
  reconcile: 'billing.attempt.reconcile.v1',
  void: 'billing.obligation.void.v1',
} as const;

export const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_REVISION = 2_147_483_647;

export interface RequestContext {
  readonly credential: string | undefined;
  readonly correlationId: string;
}

export interface CommandResult {
  readonly status: number;
  readonly body: Readonly<Record<string, unknown>>;
  readonly replayed: boolean;
}

function objectWithKeys(body: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body))
    throw new BillingApplicationError('REQUEST_INVALID');
  const input = body as Record<string, unknown>;
  if (Object.keys(input).sort().join(',') !== [...keys].sort().join(','))
    throw new BillingApplicationError('REQUEST_INVALID');
  return input;
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID.test(value))
    throw new BillingApplicationError('REQUEST_INVALID', { field });
  return value;
}

function revision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value >= MAX_REVISION)
    throw new BillingApplicationError('REQUEST_INVALID', { field: 'expectedRevision' });
  return value;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  const found = allowed.find((candidate) => candidate === value);
  if (!found) throw new BillingApplicationError('REQUEST_INVALID', { field });
  return found;
}

function moneyInput(value: unknown, field: string): Money {
  try {
    return Money.parse(value);
  } catch (error: unknown) {
    if (!(error instanceof MoneyError)) throw error;
    if (error.code === 'CURRENCY_UNSUPPORTED')
      throw new BillingApplicationError('CURRENCY_UNSUPPORTED', { field });
    throw new BillingApplicationError('REQUEST_INVALID', { field });
  }
}

function sameRef(a: PrincipalRef, b: PrincipalRef): boolean {
  return a.kind === b.kind && a.subjectId === b.subjectId;
}

function refOf(principal: VerifiedPrincipal): PrincipalRef {
  return { kind: principal.kind, subjectId: principal.subject };
}

/** Runs a domain decision and converts its rule failure to a public code. */
function decide<T>(work: () => T): T {
  try {
    return work();
  } catch (error: unknown) {
    if (error instanceof PaymentRuleError) throw new BillingApplicationError(error.code);
    throw error;
  }
}

interface Command {
  readonly principal: VerifiedPrincipal;
  readonly operation: string;
  readonly key: string;
  readonly fingerprint: string;
}

interface LockedCommand {
  readonly uow: BillingUnitOfWork;
  readonly before: FinancialSnapshot;
  readonly now: Date;
}

/**
 * Billing application service: financial obligations, payment intents, payment
 * attempts and reconciliation.
 *
 * Every mutating command: verify the caller with Identity -> validate input ->
 * fingerprint -> replay a committed receipt if one exists -> ONE local ACID
 * transaction that locks the obligation row, checks ownership and the expected
 * revision, applies the domain plan, posts balanced journals, appends audit and
 * outbox rows, and stores the idempotency receipt. Only committed successes are
 * stored as receipts; a rejected command leaves no receipt and may be retried.
 */
export class BillingService {
  constructor(
    private readonly deps: {
      readonly repository: BillingRepository;
      readonly authority: AccessAuthority;
      readonly quotes: QuoteReader;
      readonly clock: Clock;
      readonly ids: IdGenerator;
      readonly hasher: Hasher;
    },
  ) {}

  private async principal(context: RequestContext): Promise<VerifiedPrincipal> {
    try {
      return await this.deps.authority.verify(context.credential, context.correlationId);
    } catch (error: unknown) {
      if (error instanceof AccessDenied) throw new BillingApplicationError(error.reason);
      throw new BillingApplicationError('AUTH_UNAVAILABLE');
    }
  }

  private async permitted(context: RequestContext, permission: string) {
    const principal = await this.principal(context);
    if (!principal.permissions.includes(permission))
      throw new BillingApplicationError('AUTH_FORBIDDEN');
    return principal;
  }

  private key(value: unknown): string {
    if (typeof value !== 'string' || !IDEMPOTENCY_KEY.test(value))
      throw new BillingApplicationError('IDEMPOTENCY_KEY_INVALID');
    return value;
  }

  private command(
    principal: VerifiedPrincipal,
    operation: string,
    key: string,
    request: Record<string, unknown>,
  ): Command {
    const fingerprint = this.deps.hasher.sha256Hex(
      canonicalJson({ operation, actor: refOf(principal), request }),
    );
    return { principal, operation, key, fingerprint };
  }

  private replay(receipt: IdempotencyReceipt, command: Command): CommandResult {
    if (receipt.requestFingerprint !== command.fingerprint)
      throw new BillingApplicationError('IDEMPOTENCY_CONFLICT');
    return { ...receipt.outcome, replayed: true };
  }

  /**
   * Replay-or-execute. A concurrent request with the same key that commits first
   * makes our receipt insert fail; the winner's outcome is then replayed.
   */
  private async execute(
    command: Command,
    work: (uow: BillingUnitOfWork, now: Date) => Promise<RecordedOutcome>,
  ): Promise<CommandResult> {
    const actor = refOf(command.principal);
    const existing = await this.deps.repository.findReceipt(actor, command.operation, command.key);
    if (existing) return this.replay(existing, command);
    try {
      return await this.deps.repository.transaction(async (uow) => {
        const raced = await uow.findReceipt(actor, command.operation, command.key);
        if (raced) return this.replay(raced, command);
        const now = this.deps.clock.now();
        const outcome = await work(uow, now);
        await uow.saveReceipt(
          {
            actor,
            operation: command.operation,
            idempotencyKey: command.key,
            requestFingerprint: command.fingerprint,
            outcome,
          },
          now,
        );
        return { ...outcome, replayed: false };
      });
    } catch (error: unknown) {
      if (error instanceof ConcurrentModification)
        throw new BillingApplicationError('REVISION_CONFLICT');
      if (!(error instanceof ReceiptAlreadyExists)) throw error;
      const winner = await this.deps.repository.findReceipt(actor, command.operation, command.key);
      if (!winner) throw error;
      return this.replay(winner, command);
    }
  }

  /** Lock -> owner/finance access check -> revision check, inside the transaction. */
  private async locked(
    uow: BillingUnitOfWork,
    obligationId: string,
    expectedRevision: number,
    allowed: (obligation: ObligationRecord) => boolean,
  ): Promise<FinancialSnapshot> {
    const obligation = await uow.lockObligation(obligationId);
    // Wrong owner and missing are indistinguishable (non-enumerating), and the
    // revision is checked only after access, so it never leaks either.
    if (!obligation || !allowed(obligation)) throw new BillingApplicationError('NOT_FOUND');
    if (obligation.revision !== expectedRevision)
      throw new BillingApplicationError('REVISION_CONFLICT', {
        currentRevision: String(obligation.revision),
      });
    const snapshot = await uow.snapshot(obligationId);
    if (!snapshot) throw new Error('LOCKED_OBLIGATION_WITHOUT_SNAPSHOT');
    return snapshot;
  }

  /** Audit + status-changed outbox row + fresh view, all on the same transaction. */
  private async finish(
    step: LockedCommand,
    command: Command,
    context: RequestContext,
    audit: {
      readonly action: AuditAction;
      readonly outcome: string;
      readonly attemptId: string | null;
    },
    status: number,
  ): Promise<RecordedOutcome> {
    const obligationId = step.before.obligation.id;
    const after = await step.uow.snapshot(obligationId);
    if (!after) throw new Error('OBLIGATION_DISAPPEARED');
    const actor = refOf(command.principal);
    await step.uow.appendAudit({
      id: this.deps.ids.uuid(),
      occurredAt: step.now,
      actor,
      action: audit.action,
      obligationId,
      attemptId: audit.attemptId,
      outcome: audit.outcome,
      correlationId: context.correlationId,
    });
    const previous: FinancialStatus = snapshotFinancialStatus(step.before);
    const current: FinancialStatus = snapshotFinancialStatus(after);
    if (previous !== current) {
      const obligation = after.obligation;
      await step.uow.appendOutbox(
        obligationStatusChangedEvent(
          {
            previousFinancialStatus: previous,
            financialStatus: current,
            verified: obligation.verified.toWire(),
            outstanding: (obligation.status === 'VOIDED'
              ? Money.zero(obligation.amount.currency)
              : outstanding(obligation)
            ).toWire(),
          },
          {
            eventId: this.deps.ids.uuid(),
            occurredAt: step.now,
            correlationId: context.correlationId,
            actor,
            obligationId,
            revision: obligation.revision,
          },
        ),
      );
    }
    return { status, body: obligationView(after) };
  }

  private isOwner(principal: VerifiedPrincipal) {
    return (obligation: ObligationRecord) => sameRef(obligation.owner, refOf(principal));
  }

  // ---------------------------------------------------------------- commands

  /**
   * Creates the financial obligation for a quote the caller owns. The amount is
   * Pricing's server-computed total read on the caller's behalf BEFORE the
   * transaction (no network call holds a database lock); a client amount is
   * never accepted. No money is received: the journal only books a receivable.
   */
  async createObligation(
    context: RequestContext,
    idempotencyKey: unknown,
    body: unknown,
  ): Promise<CommandResult> {
    const principal = await this.permitted(context, CREATE_PERMISSION);
    const key = this.key(idempotencyKey);
    const input = objectWithKeys(body, ['quoteId']);
    const quoteId = uuid(input.quoteId, 'quoteId');
    const command = this.command(principal, OPERATIONS.create, key, { quoteId });
    const existing = await this.deps.repository.findReceipt(
      refOf(principal),
      command.operation,
      key,
    );
    if (existing) return this.replay(existing, command);

    let quote;
    try {
      // The credential was verified above, so it is a string here.
      quote = await this.deps.quotes.read(quoteId, context.credential ?? '', context.correlationId);
    } catch (error: unknown) {
      if (error instanceof QuoteUnavailable)
        throw new BillingApplicationError('UPSTREAM_UNAVAILABLE');
      throw error;
    }
    if (!quote || quote.quoteId !== quoteId) throw new BillingApplicationError('NOT_FOUND');
    if (!quote.usable) throw new BillingApplicationError('QUOTE_NOT_USABLE');
    if (quote.total.isZero()) throw new BillingApplicationError('AMOUNT_INVALID');
    const total = quote.total;

    try {
      return await this.execute(command, async (uow, now) => {
        const already = await uow.obligationIdForQuote(quoteId);
        if (already) throw new ObligationAlreadyExists();
        const obligation: ObligationRecord = {
          id: this.deps.ids.uuid(),
          owner: refOf(principal),
          quoteId,
          amount: total,
          verified: Money.zero(total.currency),
          status: 'OPEN',
          revision: 1,
          createdAt: now,
          updatedAt: now,
        };
        await uow.insertObligation(obligation, context.correlationId);
        await uow.postJournal(obligationBilledJournal(obligation.id, total), {
          id: this.deps.ids.uuid(),
          obligationId: obligation.id,
          postedAt: now,
          correlationId: context.correlationId,
        });
        await uow.appendAudit({
          id: this.deps.ids.uuid(),
          occurredAt: now,
          actor: obligation.owner,
          action: 'billing.obligation.created',
          obligationId: obligation.id,
          attemptId: null,
          outcome: 'OPEN',
          correlationId: context.correlationId,
        });
        const snapshot = await uow.snapshot(obligation.id);
        if (!snapshot) throw new Error('OBLIGATION_NOT_VISIBLE_IN_OWN_TRANSACTION');
        await uow.appendOutbox(
          obligationCreatedEvent(
            {
              quoteId,
              amount: total.toWire(),
              financialStatus: snapshotFinancialStatus(snapshot),
            },
            {
              eventId: this.deps.ids.uuid(),
              occurredAt: now,
              correlationId: context.correlationId,
              actor: obligation.owner,
              obligationId: obligation.id,
              revision: obligation.revision,
            },
          ),
        );
        return { status: 201, body: obligationView(snapshot) };
      });
    } catch (error: unknown) {
      if (!(error instanceof ObligationAlreadyExists)) throw error;
      // A same-key request that lost the unique-index race replays the winner.
      const receipt = await this.deps.repository.findReceipt(
        refOf(principal),
        command.operation,
        key,
      );
      if (receipt) return this.replay(receipt, command);
      // One quote has exactly one obligation. Only the quote's owner reaches this
      // point (Pricing confirmed it), so returning their existing obligation
      // (200, not 201) discloses nothing and makes creation safe to repeat.
      const existing = await this.existingObligationFor(quoteId, refOf(principal));
      if (!existing) throw new BillingApplicationError('OBLIGATION_ALREADY_EXISTS');
      return { status: 200, body: obligationView(existing), replayed: false };
    }
  }

  private async existingObligationFor(
    quoteId: string,
    owner: PrincipalRef,
  ): Promise<FinancialSnapshot | null> {
    const id = await this.deps.repository.obligationIdForQuote(quoteId);
    if (!id) return null;
    const snapshot = await this.deps.repository.snapshot(id);
    return snapshot && sameRef(snapshot.obligation.owner, owner) ? snapshot : null;
  }

  /**
   * Chooses (or switches) the payment method. The intent fixes the amount and
   * the payee context for any QR/instructions; it NEVER records money received.
   */
  async initializePayment(
    context: RequestContext,
    obligationId: string,
    idempotencyKey: unknown,
    body: unknown,
  ): Promise<CommandResult> {
    const principal = await this.permitted(context, CREATE_PERMISSION);
    const id = this.target(obligationId);
    const key = this.key(idempotencyKey);
    const input = objectWithKeys(body, ['expectedRevision', 'method']);
    const expectedRevision = revision(input.expectedRevision);
    const method: PaymentMethod = oneOf(input.method, PAYMENT_METHODS, 'method');
    const command = this.command(principal, OPERATIONS.initialize, key, {
      obligationId: id,
      expectedRevision,
      method,
    });
    return this.execute(command, async (uow, now) => {
      const before = await this.locked(uow, id, expectedRevision, this.isOwner(principal));
      const plan = decide(() =>
        planMethodSelection({
          obligation: before.obligation,
          current: before.activeIntent,
          method,
        }),
      );
      if (plan.supersedeCurrent && before.activeIntent)
        await uow.setIntentStatus(
          before.activeIntent.id,
          before.activeIntent.status,
          'SUPERSEDED',
          now,
        );
      await uow.insertIntent(
        {
          id: this.deps.ids.uuid(),
          obligationId: id,
          method,
          status: plan.status,
          amount: plan.amount,
          createdAt: now,
          updatedAt: now,
        },
        context.correlationId,
      );
      await uow.updateObligation(id, expectedRevision, {
        verified: before.obligation.verified,
        status: before.obligation.status,
        updatedAt: now,
      });
      return this.finish(
        { uow, before, now },
        command,
        context,
        { action: 'billing.intent.initialized', outcome: method, attemptId: null },
        201,
      );
    });
  }

  /**
   * Records the provider transaction reference the customer reports. The intent
   * moves to UNDER_REVIEW; nothing is verified until Finance reconciles it.
   */
  async submitAttempt(
    context: RequestContext,
    obligationId: string,
    idempotencyKey: unknown,
    body: unknown,
  ): Promise<CommandResult> {
    const principal = await this.permitted(context, CREATE_PERMISSION);
    const id = this.target(obligationId);
    const key = this.key(idempotencyKey);
    const input = objectWithKeys(body, ['expectedRevision', 'providerReference']);
    const expectedRevision = revision(input.expectedRevision);
    const reference = normalizeProviderReference(input.providerReference);
    if (!reference)
      throw new BillingApplicationError('REQUEST_INVALID', { field: 'providerReference' });
    const command = this.command(principal, OPERATIONS.submit, key, {
      obligationId: id,
      expectedRevision,
      providerReference: reference,
    });
    try {
      return await this.execute(command, async (uow, now) => {
        const before = await this.locked(uow, id, expectedRevision, this.isOwner(principal));
        const attemptsSoFar = await uow.countAttempts(id);
        decide(() =>
          planAttemptSubmission({
            obligation: before.obligation,
            intent: before.activeIntent,
            attemptsSoFar,
          }),
        );
        const intent = before.activeIntent;
        if (!intent) throw new Error('PLAN_ACCEPTED_WITHOUT_INTENT');
        const attemptId = this.deps.ids.uuid();
        await uow.insertAttempt(
          {
            id: attemptId,
            intentId: intent.id,
            obligationId: id,
            method: intent.method,
            providerReference: reference,
            status: 'PENDING_REVIEW',
            claimed: intent.amount,
            submittedAt: now,
            reconciledAt: null,
            reconciledBy: null,
            observed: null,
          },
          context.correlationId,
        );
        await uow.setIntentStatus(intent.id, intent.status, 'UNDER_REVIEW', now);
        await uow.updateObligation(id, expectedRevision, {
          verified: before.obligation.verified,
          status: before.obligation.status,
          updatedAt: now,
        });
        return this.finish(
          { uow, before, now },
          command,
          context,
          { action: 'billing.attempt.submitted', outcome: 'PENDING_REVIEW', attemptId },
          202,
        );
      });
    } catch (error: unknown) {
      if (error instanceof ProviderReferenceTaken)
        throw new BillingApplicationError('PROVIDER_REFERENCE_TAKEN');
      throw error;
    }
  }

  /**
   * Finance records what the provider statement shows for one attempt. MATCHED
   * is the ONLY path that recognises money; UNKNOWN keeps it under review.
   * The obligation's owner can never reconcile their own payment.
   */
  async reconcileAttempt(
    context: RequestContext,
    attemptId: string,
    idempotencyKey: unknown,
    body: unknown,
  ): Promise<CommandResult> {
    const principal = await this.permitted(context, RECONCILE_PERMISSION);
    const target = this.target(attemptId);
    const key = this.key(idempotencyKey);
    const input = objectWithKeys(body, ['expectedRevision', 'outcome', 'observedAmount']);
    const expectedRevision = revision(input.expectedRevision);
    const outcome: ReconciliationOutcome = oneOf(input.outcome, RECONCILIATION_OUTCOMES, 'outcome');
    const observed =
      input.observedAmount === null ? null : moneyInput(input.observedAmount, 'observedAmount');
    const command = this.command(principal, OPERATIONS.reconcile, key, {
      attemptId: target,
      expectedRevision,
      outcome,
      observedAmount: observed?.toWire() ?? null,
    });
    const obligationId = await this.deps.repository.obligationIdForAttempt(target);
    if (!obligationId) throw new BillingApplicationError('NOT_FOUND');
    return this.execute(command, async (uow, now) => {
      const before = await this.locked(uow, obligationId, expectedRevision, () => true);
      if (sameRef(before.obligation.owner, refOf(principal)))
        throw new BillingApplicationError('AUTH_FORBIDDEN');
      const attempt = before.attempts.find((candidate) => candidate.id === target);
      if (!attempt) throw new BillingApplicationError('NOT_FOUND');
      if (observed && observed.currency !== before.obligation.amount.currency)
        throw new BillingApplicationError('CURRENCY_UNSUPPORTED', { field: 'observedAmount' });
      const plan = decide(() =>
        planReconciliation({
          obligation: before.obligation,
          attemptStatus: attempt.status,
          outcome,
          observed,
        }),
      );
      const intent = before.activeIntent;
      // An open attempt always belongs to the active intent: the method cannot
      // change while a reference is under review.
      if (!intent || intent.id !== attempt.intentId) throw new Error('OPEN_ATTEMPT_WITHOUT_INTENT');
      await uow.reconcileAttempt(attempt.id, attempt.status, {
        to: plan.attemptStatus,
        at: now,
        by: refOf(principal),
        observed: outcome === 'UNKNOWN' ? null : observed,
      });
      if (plan.intentStatus !== intent.status)
        await uow.setIntentStatus(intent.id, intent.status, plan.intentStatus, now);
      const verified = plan.received
        ? before.obligation.verified.plus(plan.received)
        : before.obligation.verified;
      if (plan.received)
        await uow.postJournal(paymentMatchedJournal(attempt.id, attempt.method, plan.received), {
          id: this.deps.ids.uuid(),
          obligationId,
          postedAt: now,
          correlationId: context.correlationId,
        });
      await uow.updateObligation(obligationId, expectedRevision, {
        verified,
        status: plan.obligationStatus,
        updatedAt: now,
      });
      return this.finish(
        { uow, before, now },
        command,
        context,
        {
          action: 'billing.attempt.reconciled',
          outcome: plan.attemptStatus,
          attemptId: attempt.id,
        },
        200,
      );
    });
  }

  /**
   * Saga compensation: the booking this obligation was created for will not
   * happen. Allowed only while no payment was ever reported (see planVoid).
   */
  async voidObligation(
    context: RequestContext,
    obligationId: string,
    idempotencyKey: unknown,
    body: unknown,
  ): Promise<CommandResult> {
    const principal = await this.permitted(context, CREATE_PERMISSION);
    const id = this.target(obligationId);
    const key = this.key(idempotencyKey);
    const input = objectWithKeys(body, ['expectedRevision']);
    const expectedRevision = revision(input.expectedRevision);
    const command = this.command(principal, OPERATIONS.void, key, {
      obligationId: id,
      expectedRevision,
    });
    return this.execute(command, async (uow, now) => {
      const before = await this.locked(uow, id, expectedRevision, this.isOwner(principal));
      const attemptsSoFar = await uow.countAttempts(id);
      decide(() => planVoid({ obligation: before.obligation, attemptsSoFar }));
      const intent = before.activeIntent;
      if (intent) await uow.setIntentStatus(intent.id, intent.status, 'CANCELLED', now);
      await uow.postJournal(obligationVoidedJournal(id, before.obligation.amount), {
        id: this.deps.ids.uuid(),
        obligationId: id,
        postedAt: now,
        correlationId: context.correlationId,
      });
      await uow.updateObligation(id, expectedRevision, {
        verified: before.obligation.verified,
        status: 'VOIDED',
        updatedAt: now,
      });
      return this.finish(
        { uow, before, now },
        command,
        context,
        { action: 'billing.obligation.voided', outcome: 'VOIDED', attemptId: null },
        200,
      );
    });
  }

  // ------------------------------------------------------------------ queries

  private target(id: string): string {
    if (!UUID.test(id)) throw new BillingApplicationError('NOT_FOUND');
    return id;
  }

  private async readable(context: RequestContext, obligationId: string) {
    const principal = await this.principal(context);
    const id = this.target(obligationId);
    const snapshot = await this.deps.repository.snapshot(id);
    const owner =
      snapshot !== null &&
      sameRef(snapshot.obligation.owner, refOf(principal)) &&
      principal.permissions.includes(READ_SELF_PERMISSION);
    const finance = principal.permissions.includes(FINANCE_READ_PERMISSION);
    if (!snapshot || !(owner || finance)) throw new BillingApplicationError('NOT_FOUND');
    return snapshot;
  }

  async getObligation(context: RequestContext, obligationId: string) {
    return obligationView(await this.readable(context, obligationId));
  }

  async getFinancialStatus(context: RequestContext, obligationId: string) {
    return financialStatusView(await this.readable(context, obligationId));
  }
}