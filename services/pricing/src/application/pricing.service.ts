import {
  PriceBookRuleError,
  QuoteRequestInvalid,
  QuoteRuleError,
  canonicalCatalogView,
  contractScale,
  normalizeUuid,
  parsePriceBookDraft,
  parsePrincipalRef,
  parseQuoteRequest,
  planPriceBookRevision,
  policyMatchesContract,
  priceSelection,
  quoteExpiry,
  validatePriceBookAgainstCatalog,
  validationReason,
  isRevision,
  type CatalogView,
  type CurrencyPolicy,
  type PriceBookDraft,
  type PrincipalRef,
  type QuoteRequest,
} from '../domain';
import {
  AccessDenied,
  CatalogUnavailable,
  ReceiptAlreadyExists,
  type AccessAuthority,
  type CatalogReader,
  type Clock,
  type Hasher,
  type IdGenerator,
  type IdempotencyReceipt,
  type PolicyProvider,
  type PriceBook,
  type PricingRepository,
  type RecordedOutcome,
  type ServiceAuthority,
  type ServiceCredential,
  type StoredQuote,
  type VerifiedPrincipal,
} from '../ports';
import { canonicalJson } from './canonical-json';
import { PricingApplicationError, errorOutcome } from './pricing-errors';
import { priceBookView, quoteView } from './views';

/** Contract id incl. major: a new major never replays an old result. */
export const CONTRACT = 'pricing.v1';
/** pricing.v1 `publishPriceBook` access (permission:pricing.prices.publish). */
export const PRICE_BOOK_PERMISSION = 'pricing.prices.publish';
/** Existing Identity self-service grant held by customers and guests. */
export const QUOTE_PERMISSION = 'bookings.create:self';
export const QUOTE_OPERATION = 'pricing.v1.createQuote';
export const PRICE_BOOK_OPERATION = 'pricing.v1.publishPriceBook';
export const RESOLVE_PURPOSES = ['booking-quote', 'booking-create', 'booking-display'] as const;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/;

export interface RequestContext {
  readonly credential: string | undefined;
  readonly correlationId: string;
}

export interface CommandResult {
  readonly status: number;
  readonly body: Readonly<Record<string, unknown>>;
  readonly replayed: boolean;
}

function samePrincipal(a: PrincipalRef, b: PrincipalRef): boolean {
  return a.kind === b.kind && a.subjectId === b.subjectId;
}

function requestWire(request: QuoteRequest): Record<string, unknown> {
  return {
    beneficiary: { kind: request.beneficiary.kind, subjectId: request.beneficiary.subjectId },
    vehicleType: request.vehicleType,
    zoneId: request.zoneId,
    selections: request.selections.map((s) => ({
      definitionId: s.definitionId,
      quantity: s.quantity,
    })),
  };
}

function draftWire(draft: PriceBookDraft): Record<string, unknown> {
  return {
    expectedPriceBookRevision: draft.expectedPriceBookRevision,
    currency: draft.currency,
    entries: draft.entries.map((e) => ({
      definitionId: e.definitionId,
      vehicleType: e.vehicleType,
      unitPriceMinor: e.unitPriceMinor.toString(),
    })),
  };
}

function catalogWire(view: CatalogView): Record<string, unknown> {
  return {
    catalogRevision: view.catalogRevision,
    publishedAt: view.publishedAt.toISOString(),
    definitions: view.definitions.map((d) => ({ ...d, vehicleTypes: [...d.vehicleTypes] })),
  };
}

/**
 * pricing.v1 owner use cases: price book publication, quote issuance, the
 * beneficiary's quote read and the service-scoped validation used by Booking.
 */
export class PricingService {
  constructor(
    private readonly deps: {
      readonly repository: PricingRepository;
      readonly authority: AccessAuthority;
      readonly services: ServiceAuthority;
      readonly catalog: CatalogReader;
      readonly policy: PolicyProvider;
      readonly clock: Clock;
      readonly ids: IdGenerator;
      readonly hasher: Hasher;
    },
  ) {}

  private async principal(
    context: RequestContext,
    permission?: string,
  ): Promise<VerifiedPrincipal> {
    let principal: VerifiedPrincipal;
    try {
      principal = await this.deps.authority.verify(context.credential, context.correlationId);
    } catch (error: unknown) {
      if (error instanceof AccessDenied && error.reason === 'AUTH_REQUIRED')
        throw new PricingApplicationError('AUTH_REQUIRED');
      throw new PricingApplicationError('DEPENDENCY_UNAVAILABLE', 'AUTH_UNAVAILABLE');
    }
    if (permission && !principal.permissions.includes(permission))
      throw new PricingApplicationError('AUTH_FORBIDDEN');
    return principal;
  }

  private key(value: unknown): string {
    if (value === undefined) throw new PricingApplicationError('IDEMPOTENCY_KEY_REQUIRED');
    if (typeof value !== 'string' || !IDEMPOTENCY_KEY.test(value))
      throw new PricingApplicationError('REQUEST_INVALID', null, [
        { field: 'header.idempotency-key', code: 'INVALID_IDEMPOTENCY_KEY' },
      ]);
    return value;
  }

  /** The accepted policy (B-03), only if pricing.v1 Money can carry it exactly. */
  private policy(): CurrencyPolicy {
    const policy = this.deps.policy.currencyPolicy();
    if (!policy || !policyMatchesContract(policy))
      throw new PricingApplicationError('DEPENDENCY_UNAVAILABLE', 'POLICY_UNAVAILABLE');
    return policy;
  }

  private fingerprint(operation: string, actor: string, target: string | null, body: unknown) {
    return this.deps.hasher.sha256Hex(
      canonicalJson({ v: 1, contract: CONTRACT, operation, actor, target, body }),
    );
  }

  private replay(receipt: IdempotencyReceipt, fingerprint: string): RecordedOutcome {
    if (receipt.requestFingerprint !== fingerprint)
      throw new PricingApplicationError('IDEMPOTENCY_CONFLICT');
    return receipt.outcome;
  }

  // -------------------------------------------------------------------------
  // publishPriceBook
  // -------------------------------------------------------------------------

  /**
   * Publishes the next complete price book against the CURRENT published
   * Catalog. The Catalog read happens BEFORE the transaction (no network call
   * holds a lock); receipt, book and audit then commit together.
   */
  async publishPriceBook(
    context: RequestContext,
    idempotencyKey: unknown,
    body: unknown,
  ): Promise<CommandResult> {
    const principal = await this.principal(context, PRICE_BOOK_PERMISSION);
    const key = this.key(idempotencyKey);
    const policy = this.policy();
    let draft: PriceBookDraft;
    try {
      draft = parsePriceBookDraft(body, policy);
    } catch (error: unknown) {
      if (!(error instanceof PriceBookRuleError)) throw error;
      throw new PricingApplicationError(
        error.structural ? 'REQUEST_INVALID' : 'VALIDATION_FAILED',
        null,
        error.issues,
      );
    }
    const requestFingerprint = this.fingerprint(
      PRICE_BOOK_OPERATION,
      principal.subject,
      null,
      draftWire(draft),
    );
    const existing = await this.deps.repository.findReceipt(
      principal.subject,
      PRICE_BOOK_OPERATION,
      key,
    );
    if (existing) return { ...this.replay(existing, requestFingerprint), replayed: true };

    let catalog: CatalogView;
    try {
      catalog = canonicalCatalogView(await this.deps.catalog.current(context.correlationId));
    } catch (error: unknown) {
      if (error instanceof CatalogUnavailable)
        throw new PricingApplicationError('UPSTREAM_UNAVAILABLE', 'CATALOG_UNAVAILABLE');
      throw error;
    }
    try {
      validatePriceBookAgainstCatalog(draft.entries, catalog);
    } catch (error: unknown) {
      if (!(error instanceof PriceBookRuleError)) throw error;
      throw new PricingApplicationError('VALIDATION_FAILED', null, error.issues);
    }
    const catalogFingerprint = this.deps.hasher.sha256Hex(canonicalJson(catalogWire(catalog)));
    const entriesFingerprint = this.deps.hasher.sha256Hex(
      canonicalJson({
        catalogFingerprint,
        policyRevision: policy.revision,
        currency: draft.currency,
        entries: draftWire(draft).entries,
      }),
    );

    try {
      return await this.deps.repository.transaction(async (uow) => {
        const head = await uow.lockPriceBookHead();
        const raced = await uow.findReceipt(principal.subject, PRICE_BOOK_OPERATION, key);
        if (raced) return { ...this.replay(raced, requestFingerprint), replayed: true };
        const now = this.deps.clock.now();
        const plan = planPriceBookRevision(head, draft.expectedPriceBookRevision);
        let outcome: RecordedOutcome;
        if (plan.accepted) {
          const book: PriceBook = {
            revision: plan.revision,
            currency: draft.currency,
            scale: policy.minorUnitExponent,
            policyRevision: policy.revision,
            catalog,
            catalogFingerprint,
            entries: draft.entries,
            entriesFingerprint,
            publishedAt: now,
          };
          await uow.insertPriceBook({
            ...book,
            publishedBy: principal.subject,
            correlationId: context.correlationId,
          });
          outcome = { status: 201, body: priceBookView(book) };
        } else {
          outcome = errorOutcome('REVISION_CONFLICT');
        }
        await uow.saveReceipt(
          {
            actorSubject: principal.subject,
            operation: PRICE_BOOK_OPERATION,
            idempotencyKey: key,
            requestFingerprint,
            outcome,
          },
          now,
        );
        await uow.appendAudit({
          id: this.deps.ids.uuid(),
          occurredAt: now,
          actor: principal.subject,
          action: plan.accepted
            ? 'pricing.price-book.published'
            : 'pricing.price-book.publish-rejected',
          subjectRef: plan.accepted ? `price-book:${plan.revision}` : null,
          purpose: null,
          outcome: plan.accepted ? 'PUBLISHED' : 'REVISION_CONFLICT',
          correlationId: context.correlationId,
        });
        return { ...outcome, replayed: false };
      });
    } catch (error: unknown) {
      if (!(error instanceof ReceiptAlreadyExists)) throw error;
      const winner = await this.deps.repository.findReceipt(
        principal.subject,
        PRICE_BOOK_OPERATION,
        key,
      );
      if (!winner) throw error;
      return { ...this.replay(winner, requestFingerprint), replayed: true };
    }
  }

  // -------------------------------------------------------------------------
  // createQuote / getQuote
  // -------------------------------------------------------------------------

  private async render(outcome: RecordedOutcome): Promise<Readonly<Record<string, unknown>>> {
    if (outcome.status !== 201) return outcome.body;
    const quoteId = outcome.body.quoteId;
    const quote = typeof quoteId === 'string' ? await this.deps.repository.quote(quoteId) : null;
    if (!quote) throw new Error('QUOTE_RECEIPT_WITHOUT_QUOTE');
    // Replays return the ORIGINAL snapshot and expiry; status is evaluated now.
    return quoteView(quote, this.deps.clock.now());
  }

  /**
   * Issues an immutable, expiring quote from IDs only, for the caller itself.
   * Server time, the price book in force and its stored Catalog view decide
   * everything; a client amount is never read.
   */
  async createQuote(
    context: RequestContext,
    idempotencyKey: unknown,
    body: unknown,
  ): Promise<CommandResult> {
    const principal = await this.principal(context, QUOTE_PERMISSION);
    const key = this.key(idempotencyKey);
    let request: QuoteRequest;
    try {
      request = parseQuoteRequest(body);
    } catch (error: unknown) {
      if (error instanceof QuoteRequestInvalid)
        throw new PricingApplicationError('REQUEST_INVALID', null, [
          { field: error.field, code: 'INVALID' },
        ]);
      throw error;
    }
    // A principal quotes for itself only; no on-behalf grant exists in pricing.v1.
    if (!samePrincipal(request.beneficiary, { kind: principal.kind, subjectId: principal.subject }))
      throw new PricingApplicationError('AUTH_FORBIDDEN');
    const requestFingerprint = this.fingerprint(
      QUOTE_OPERATION,
      principal.subject,
      null,
      requestWire(request),
    );
    const existing = await this.deps.repository.findReceipt(
      principal.subject,
      QUOTE_OPERATION,
      key,
    );
    if (existing) {
      const outcome = this.replay(existing, requestFingerprint);
      return { status: outcome.status, body: await this.render(outcome), replayed: true };
    }
    const policy = this.policy();
    const ttl = this.deps.policy.quoteTtlSeconds();
    if (ttl === null)
      throw new PricingApplicationError('DEPENDENCY_UNAVAILABLE', 'POLICY_UNAVAILABLE');

    let outcome: RecordedOutcome;
    try {
      outcome = await this.deps.repository.transaction(async (uow) => {
        const book = await uow.priceBookInForce();
        if (!book)
          throw new PricingApplicationError('DEPENDENCY_UNAVAILABLE', 'PRICES_NOT_PUBLISHED');
        // A book published under another policy revision is not reinterpreted.
        if (
          book.policyRevision !== policy.revision ||
          book.currency !== policy.currency ||
          book.scale !== contractScale(book.currency)
        )
          throw new PricingApplicationError('DEPENDENCY_UNAVAILABLE', 'POLICY_UNAVAILABLE');
        const now = this.deps.clock.now();
        let result: RecordedOutcome;
        try {
          const priced = priceSelection({
            request,
            catalog: book.catalog,
            entries: book.entries,
            maxAmountMinor: policy.maxAmountMinor,
          });
          const quote: StoredQuote = {
            id: this.deps.ids.uuid(),
            revision: 1,
            beneficiary: request.beneficiary,
            requestedBy: principal.subject,
            vehicleType: request.vehicleType,
            zoneId: request.zoneId,
            currency: book.currency,
            scale: book.scale,
            priceBookRevision: book.revision,
            catalogRevision: book.catalog.catalogRevision,
            policyRevision: book.policyRevision,
            lines: priced.lines.map((line) => ({ ...line, lineId: this.deps.ids.uuid() })),
            totalMinor: priced.totalMinor,
            issuedAt: now,
            expiresAt: quoteExpiry(now, ttl),
            correlationId: context.correlationId,
          };
          await uow.insertQuote(quote);
          result = { status: 201, body: { quoteId: quote.id } };
        } catch (error: unknown) {
          if (!(error instanceof QuoteRuleError)) throw error;
          result = errorOutcome('BUSINESS_RULE_VIOLATION', error.reason);
        }
        await uow.saveReceipt(
          {
            actorSubject: principal.subject,
            operation: QUOTE_OPERATION,
            idempotencyKey: key,
            requestFingerprint,
            outcome: result,
          },
          now,
        );
        return result;
      });
    } catch (error: unknown) {
      if (!(error instanceof ReceiptAlreadyExists)) throw error;
      // A concurrent request with the same key committed first: replay it.
      const winner = await this.deps.repository.findReceipt(
        principal.subject,
        QUOTE_OPERATION,
        key,
      );
      if (!winner) throw error;
      const replayed = this.replay(winner, requestFingerprint);
      return { status: replayed.status, body: await this.render(replayed), replayed: true };
    }
    return { status: outcome.status, body: await this.render(outcome), replayed: false };
  }

  /** The beneficiary's own quote. Missing and foreign are indistinguishable (404). */
  async getQuote(context: RequestContext, id: string): Promise<Record<string, unknown>> {
    const principal = await this.principal(context);
    const quoteId = normalizeUuid(id);
    const quote = quoteId === null ? null : await this.deps.repository.quote(quoteId);
    if (
      !quote ||
      !samePrincipal(quote.beneficiary, { kind: principal.kind, subjectId: principal.subject })
    )
      throw new PricingApplicationError('NOT_FOUND');
    return quoteView(quote, this.deps.clock.now());
  }

  // -------------------------------------------------------------------------
  // validateQuote (service scope pricing.quote.validate, safe)
  // -------------------------------------------------------------------------

  /**
   * Read-only decision for a workload caller (Booking) that already holds the
   * beneficiary and revision. It never extends, reissues or mutates the quote.
   * Every decision is audited with the caller and its declared purpose.
   */
  async validateQuote(
    credential: ServiceCredential,
    correlationId: string,
    id: string,
    body: unknown,
  ): Promise<Record<string, unknown>> {
    const decision = this.deps.services.authorize(credential, 'pricing.quote.validate');
    if (!decision.ok)
      throw new PricingApplicationError(
        decision.reason === 'UNAUTHENTICATED' ? 'AUTH_REQUIRED' : 'AUTH_FORBIDDEN',
      );
    if (typeof body !== 'object' || body === null || Array.isArray(body))
      throw new PricingApplicationError('REQUEST_INVALID');
    const input = body as Record<string, unknown>;
    if (Object.keys(input).sort().join(',') !== 'beneficiary,expectedRevision,purpose')
      throw new PricingApplicationError('REQUEST_INVALID');
    if (!isRevision(input.expectedRevision))
      throw new PricingApplicationError('REQUEST_INVALID', null, [
        { field: '$.expectedRevision', code: 'INVALID' },
      ]);
    const purpose = RESOLVE_PURPOSES.find((p) => p === input.purpose);
    if (!purpose)
      throw new PricingApplicationError('REQUEST_INVALID', null, [
        { field: '$.purpose', code: 'INVALID' },
      ]);
    let beneficiary: PrincipalRef;
    try {
      beneficiary = parsePrincipalRef(input.beneficiary, '$.beneficiary');
    } catch (error: unknown) {
      if (error instanceof QuoteRequestInvalid)
        throw new PricingApplicationError('REQUEST_INVALID', null, [
          { field: error.field, code: 'INVALID' },
        ]);
      throw error;
    }
    const quoteId = normalizeUuid(id);
    const quote = quoteId === null ? null : await this.deps.repository.quote(quoteId);
    const now = this.deps.clock.now();
    const reason = quote
      ? validationReason({ quote, expectedRevision: input.expectedRevision, beneficiary, now })
      : null;
    await this.deps.repository.appendAudit({
      id: this.deps.ids.uuid(),
      occurredAt: now,
      actor: `service:${decision.clientId}`,
      action: 'pricing.quote.validated',
      subjectRef: quoteId === null ? null : `quote:${quoteId}`,
      purpose,
      outcome: quote ? (reason ?? 'VALID') : 'NOT_FOUND',
      correlationId,
    });
    if (!quote) throw new PricingApplicationError('NOT_FOUND');
    return {
      quoteId: quote.id,
      revision: quote.revision,
      valid: reason === null,
      reason,
      total: quoteView(quote, now).total,
    };
  }
}
