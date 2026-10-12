import {
  Money,
  obligationBilledJournal,
  obligationVoidedJournal,
  planVoid,
  type FinancialStatus,
} from '../domain';
import {
  BookingAlreadyLinked,
  ObligationAlreadyExists,
  QuoteUnavailable,
  type BillingRepository,
  type BillingServiceScope,
  type Clock,
  type FinancialSnapshot,
  type Hasher,
  type IdGenerator,
  type ObligationRecord,
  type PrincipalKind,
  type PrincipalRef,
  type QuoteValidator,
  type ServiceCallerAuthority,
  type VerifiedPrincipal,
} from '../ports';
import { BillingApplicationError } from './billing-errors';
import {
  CommandSupport,
  decide,
  objectWithKeys,
  oneOf,
  revision,
  sameRef,
  target,
  uuid,
  type Command,
  type CommandResult,
} from './command-support';
import { obligationCreatedEvent, obligationStatusChangedEvent } from './events';
import { obligationView, snapshotFinancialStatus } from './views';

export const OBLIGATION_WRITE_SCOPE: BillingServiceScope = 'billing.obligation.write';

export const BOOKING_OPERATIONS = {
  create: 'billing.booking-obligation.create.v1',
  void: 'billing.booking-obligation.void.v1',
} as const;

const PRINCIPAL_KINDS: readonly PrincipalKind[] = ['account', 'guest'];

/** What the transport extracts from a workload request. Never a person's bearer token. */
export interface ServiceRequestContext {
  readonly clientId: string | undefined;
  readonly token: string | undefined;
  /** True when the request also carried an Authorization header: refused (ambiguous identity). */
  readonly bearerPresent: boolean;
  readonly correlationId: string;
}

/**
 * The beneficiary the workload acts for, shaped as the principal the
 * idempotency receipts and audit rows are keyed by. It holds no permission and
 * is never used for an access decision: authority comes from the workload
 * scope, and the booking link records which workload acted.
 */
function onBehalfOf(beneficiary: PrincipalRef): VerifiedPrincipal {
  return {
    kind: beneficiary.kind,
    subject: beneficiary.subjectId,
    sessionId: 'workload',
    permissions: [],
  };
}

function beneficiaryOf(value: unknown): PrincipalRef {
  const input = objectWithKeys(value, ['kind', 'subjectId']);
  return {
    kind: oneOf(input.kind, PRINCIPAL_KINDS, 'beneficiary.kind'),
    subjectId: uuid(input.subjectId, 'beneficiary.subjectId'),
  };
}

/**
 * The booking saga's view of Billing (billing.v1 createBookingObligation and
 * voidBookingObligation). Same money rules as the customer routes: the amount
 * is Pricing's server-computed total, never the caller's; creating an
 * obligation books a receivable only; void is allowed only while no payment
 * was ever reported. One booking has exactly one obligation.
 *
 * Every command: workload credential + scope -> idempotency key -> input ->
 * fingerprint (workload, beneficiary, request) -> replay a committed receipt or
 * run ONE local ACID transaction (obligation, journal, booking link, audit,
 * outbox, receipt). A rejected command leaves no receipt and may be retried.
 */
export class BookingObligationService {
  private readonly commands: CommandSupport;

  constructor(
    private readonly deps: {
      readonly repository: BillingRepository;
      readonly services: ServiceCallerAuthority;
      readonly quotes: QuoteValidator;
      readonly clock: Clock;
      readonly ids: IdGenerator;
      readonly hasher: Hasher;
    },
  ) {
    // CommandSupport's Identity path is never used here: workloads are
    // authorized by authorizeWorkload, before any receipt is read.
    this.commands = new CommandSupport({
      repository: deps.repository,
      authority: {
        verify: () => Promise.reject(new Error('WORKLOAD_ROUTE_HAS_NO_IDENTITY_SESSION')),
      },
      clock: deps.clock,
      hasher: deps.hasher,
    });
  }

  private authorizeWorkload(context: ServiceRequestContext): string {
    if (context.bearerPresent) throw new BillingApplicationError('AUTH_REQUIRED');
    const decision = this.deps.services.authorize(
      context.clientId,
      context.token,
      OBLIGATION_WRITE_SCOPE,
    );
    if (decision.ok) return decision.clientId;
    throw new BillingApplicationError(
      decision.reason === 'SCOPE_DENIED' ? 'AUTH_FORBIDDEN' : 'AUTH_REQUIRED',
    );
  }

  private command(
    beneficiary: PrincipalRef,
    operation: string,
    key: string,
    request: Record<string, unknown>,
  ): Command {
    return this.commands.command(onBehalfOf(beneficiary), operation, key, request);
  }

  /** The existing obligation of this booking, or a conflict when it was created differently. */
  private async existingFor(
    bookingId: string,
    clientId: string,
    beneficiary: PrincipalRef,
    quoteId: string,
  ): Promise<FinancialSnapshot | null> {
    const link = await this.deps.repository.bookings.forBooking(bookingId);
    if (!link) return null;
    const snapshot = await this.deps.repository.snapshot(link.obligationId);
    if (!snapshot) throw new Error('LINKED_OBLIGATION_MISSING');
    const same =
      link.clientId === clientId &&
      snapshot.obligation.quoteId === quoteId &&
      sameRef(snapshot.obligation.owner, beneficiary);
    if (!same) throw new BillingApplicationError('OBLIGATION_ALREADY_EXISTS');
    return snapshot;
  }

  /**
   * Creates the obligation for a booking's beneficiary. Pricing validates the
   * quote for that beneficiary (purpose booking-create) BEFORE the transaction,
   * so no network call holds a database lock. Repeating the call for the same
   * booking returns its obligation (200) without asking Pricing again, so a
   * saga retry still succeeds after the quote expired.
   */
  async createForBooking(
    context: ServiceRequestContext,
    idempotencyKey: unknown,
    body: unknown,
  ): Promise<CommandResult> {
    const clientId = this.authorizeWorkload(context);
    const key = this.commands.key(idempotencyKey);
    const input = objectWithKeys(body, ['beneficiary', 'quoteId', 'bookingId']);
    const beneficiary = beneficiaryOf(input.beneficiary);
    const quoteId = uuid(input.quoteId, 'quoteId');
    const bookingId = uuid(input.bookingId, 'bookingId');
    const command = this.command(beneficiary, BOOKING_OPERATIONS.create, key, {
      clientId,
      beneficiary,
      quoteId,
      bookingId,
    });
    const replayed = await this.commands.committed(command);
    if (replayed) return replayed;
    const existing = await this.existingFor(bookingId, clientId, beneficiary, quoteId);
    if (existing) return { status: 200, body: obligationView(existing), replayed: false };
    // A quote obligated through the customer route can never be adopted.
    if (await this.deps.repository.obligationIdForQuote(quoteId))
      throw new BillingApplicationError('OBLIGATION_ALREADY_EXISTS');

    let total: Money;
    try {
      const validation = await this.deps.quotes.validate(
        quoteId,
        beneficiary,
        context.correlationId,
      );
      if (validation.kind !== 'VALID') throw new BillingApplicationError('QUOTE_NOT_USABLE');
      total = validation.total;
    } catch (error: unknown) {
      if (error instanceof QuoteUnavailable)
        throw new BillingApplicationError('UPSTREAM_UNAVAILABLE');
      throw error;
    }
    if (total.isZero()) throw new BillingApplicationError('AMOUNT_INVALID');

    try {
      return await this.commands.execute(command, async (uow, now) => {
        if (await uow.bookings.forBooking(bookingId)) throw new BookingAlreadyLinked();
        if (await uow.obligationIdForQuote(quoteId)) throw new ObligationAlreadyExists();
        const obligation: ObligationRecord = {
          id: this.deps.ids.uuid(),
          owner: beneficiary,
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
          handoverId: null,
          postedAt: now,
          correlationId: context.correlationId,
        });
        await uow.bookings.insert(
          { bookingId, obligationId: obligation.id, clientId, createdAt: now, voidedAt: null },
          context.correlationId,
        );
        await uow.appendAudit({
          id: this.deps.ids.uuid(),
          occurredAt: now,
          actor: beneficiary,
          action: 'billing.obligation.created',
          obligationId: obligation.id,
          attemptId: null,
          receiptId: null,
          handoverId: null,
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
              actor: beneficiary,
              obligationId: obligation.id,
              revision: obligation.revision,
            },
          ),
        );
        return { status: 201, body: obligationView(snapshot) };
      });
    } catch (error: unknown) {
      if (!(error instanceof BookingAlreadyLinked || error instanceof ObligationAlreadyExists))
        throw error;
      // Lost a race: a same-key winner is replayed by execute(); a different
      // key for the same booking gets the winner's obligation when it matches.
      const winner = await this.existingFor(bookingId, clientId, beneficiary, quoteId);
      if (!winner) throw new BillingApplicationError('OBLIGATION_ALREADY_EXISTS');
      return { status: 200, body: obligationView(winner), replayed: false };
    }
  }

  /**
   * Saga compensation: the booking will not happen. Only the workload that
   * created the booking's obligation may void it, and only while no payment was
   * ever reported (planVoid). Anything else is NOT_FOUND / VOID_NOT_ALLOWED.
   */
  async voidForBooking(
    context: ServiceRequestContext,
    obligationId: string,
    idempotencyKey: unknown,
    body: unknown,
  ): Promise<CommandResult> {
    const clientId = this.authorizeWorkload(context);
    const id = target(obligationId);
    const key = this.commands.key(idempotencyKey);
    const input = objectWithKeys(body, ['expectedRevision']);
    const expectedRevision = revision(input.expectedRevision);
    const link = await this.deps.repository.bookings.forObligation(id);
    if (!link || link.clientId !== clientId) throw new BillingApplicationError('NOT_FOUND');
    const current = await this.deps.repository.snapshot(id);
    if (!current) throw new Error('LINKED_OBLIGATION_MISSING');
    const beneficiary = current.obligation.owner;
    const command = this.command(beneficiary, BOOKING_OPERATIONS.void, key, {
      clientId,
      obligationId: id,
      expectedRevision,
    });
    return this.commands.execute(command, async (uow, now) => {
      const obligation = await uow.lockObligation(id);
      if (!obligation) throw new BillingApplicationError('NOT_FOUND');
      if (obligation.revision !== expectedRevision)
        throw new BillingApplicationError('REVISION_CONFLICT');
      const before = await uow.snapshot(id);
      if (!before) throw new Error('LOCKED_OBLIGATION_WITHOUT_SNAPSHOT');
      const attemptsSoFar = await uow.countAttempts(id);
      decide(() => planVoid({ obligation: before.obligation, attemptsSoFar }));
      // planVoid passed, so the obligation is OPEN and unpaid; an active cash
      // receipt would have settled it.
      if (before.activeIntent)
        await uow.setIntentStatus(
          before.activeIntent.id,
          before.activeIntent.status,
          'CANCELLED',
          now,
        );
      await uow.postJournal(obligationVoidedJournal(id, before.obligation.amount), {
        id: this.deps.ids.uuid(),
        obligationId: id,
        handoverId: null,
        postedAt: now,
        correlationId: context.correlationId,
      });
      await uow.updateObligation(id, expectedRevision, {
        verified: before.obligation.verified,
        status: 'VOIDED',
        updatedAt: now,
      });
      await uow.bookings.markVoided(id, now, context.correlationId);
      await uow.appendAudit({
        id: this.deps.ids.uuid(),
        occurredAt: now,
        actor: beneficiary,
        action: 'billing.obligation.voided',
        obligationId: id,
        attemptId: null,
        receiptId: null,
        handoverId: null,
        outcome: 'VOIDED',
        correlationId: context.correlationId,
      });
      const after = await uow.snapshot(id);
      if (!after) throw new Error('OBLIGATION_DISAPPEARED');
      const previous: FinancialStatus = snapshotFinancialStatus(before);
      const next: FinancialStatus = snapshotFinancialStatus(after);
      if (previous !== next)
        await uow.appendOutbox(
          obligationStatusChangedEvent(
            {
              previousFinancialStatus: previous,
              financialStatus: next,
              verified: after.obligation.verified.toWire(),
              outstanding: Money.zero(after.obligation.amount.currency).toWire(),
            },
            {
              eventId: this.deps.ids.uuid(),
              occurredAt: now,
              correlationId: context.correlationId,
              actor: beneficiary,
              obligationId: id,
              revision: after.obligation.revision,
            },
          ),
        );
      return { status: 200, body: obligationView(after) };
    });
  }
}
