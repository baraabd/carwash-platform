import {
  Money,
  PriceRuleError,
  QuoteRuleError,
  computeQuote,
  normalizeRates,
  normalizeSelection,
  planPriceVersion,
  quoteExpiry,
  quoteStatus,
  validateRatesAgainstCatalog,
  type CurrencyPolicy,
  type PricePublicationRejection,
  type Rate,
  type Selection,
} from '../domain';
import {
  AccessDenied,
  CatalogUnavailable,
  ReceiptAlreadyExists,
  type AccessAuthority,
  type CatalogRevisionReader,
  type Clock,
  type Hasher,
  type IdGenerator,
  type IdempotencyReceipt,
  type PolicyProvider,
  type PricingRepository,
  type PublishedPriceVersion,
  type RecordedOutcome,
  type StoredQuote,
  type VerifiedPrincipal,
} from '../ports';
import { canonicalJson } from './canonical-json';
import { PricingApplicationError } from './pricing-errors';

/** Requested from Lane E/Identity; until granted, price publication is denied. */
export const PRICING_PUBLISH_PERMISSION = 'pricing.publish';
/** Existing Identity grant for customers who may start a booking. */
export const QUOTE_PERMISSION = 'bookings.create:self';
export const PUBLISH_OPERATION = 'pricing.version.publish.v1';
export const QUOTE_OPERATION = 'pricing.quote.issue.v1';
export const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UTC_MILLIS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MAX_INT = 2_147_483_647;

export interface RequestContext {
  readonly credential: string | undefined;
  readonly correlationId: string;
}

export interface CommandResult {
  readonly status: number;
  readonly body: Readonly<Record<string, unknown>>;
  readonly replayed: boolean;
}

const REJECTION_STATUS: Readonly<Record<PricePublicationRejection, number>> = {
  VERSION_CONFLICT: 409,
  EFFECTIVE_FROM_IN_PAST: 422,
  EFFECTIVE_FROM_NOT_AFTER_PREVIOUS: 422,
  EFFECTIVE_FROM_TOO_FAR: 422,
  PRICE_PRECEDES_CATALOG: 422,
};

function rateWire(rate: Rate): { kind: string; definitionId: string; amountMinor: string } {
  return {
    kind: rate.kind,
    definitionId: rate.definitionId,
    amountMinor: rate.amountMinor.toString(),
  };
}

function versionView(
  version: PublishedPriceVersion,
  effectiveUntil: Date | null,
): Record<string, unknown> {
  return {
    version: version.version,
    effectiveFrom: version.effectiveFrom.toISOString(),
    effectiveUntil: effectiveUntil?.toISOString() ?? null,
    publishedAt: version.publishedAt.toISOString(),
    catalogRevision: version.catalogRevision,
    policyRevision: version.policyRevision,
    currency: version.currency,
    minorUnitExponent: version.minorUnitExponent,
    ratesFingerprint: version.ratesFingerprint,
    rates: version.rates.map(rateWire),
  };
}

function selectionWire(selection: Selection): Record<string, unknown> {
  return {
    catalogRevision: selection.catalogRevision,
    categoryId: selection.categoryId,
    packageId: selection.packageId,
    addonIds: [...selection.addonIds],
  };
}

export function quoteView(quote: StoredQuote, now: Date): Record<string, unknown> {
  const money = (amount: bigint) => Money.of(amount, quote.currency).toWire();
  return {
    quoteId: quote.id,
    status: quoteStatus(quote.expiresAt, now),
    evaluatedAt: now.toISOString(),
    issuedAt: quote.issuedAt.toISOString(),
    expiresAt: quote.expiresAt.toISOString(),
    priceVersion: quote.priceVersion,
    catalogRevision: quote.catalogRevision,
    policyRevision: quote.policyRevision,
    currency: quote.currency,
    minorUnitExponent: quote.minorUnitExponent,
    selection: selectionWire(quote.selection),
    lines: quote.lines.map((line) => ({
      kind: line.kind,
      definitionId: line.definitionId,
      included: line.included,
      amount: money(line.amountMinor),
    })),
    subtotal: money(quote.subtotalMinor),
    total: money(quote.totalMinor),
    durationMinutes: quote.durationMinutes,
    inputFingerprint: quote.inputFingerprint,
  };
}

function parseTimestamp(value: unknown, field: string): Date | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !UTC_MILLIS.test(value))
    throw new PricingApplicationError('REQUEST_INVALID', { field });
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value)
    throw new PricingApplicationError('REQUEST_INVALID', { field });
  return date;
}

function objectWithKeys(body: unknown, keys: string): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body))
    throw new PricingApplicationError('REQUEST_INVALID');
  const input = body as Record<string, unknown>;
  if (Object.keys(input).sort().join(',') !== keys)
    throw new PricingApplicationError('REQUEST_INVALID');
  return input;
}

function boundedInt(value: unknown, min: number, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value >= MAX_INT)
    throw new PricingApplicationError('REQUEST_INVALID', { field });
  return value;
}

function selectionOf(body: unknown): Selection {
  try {
    return normalizeSelection(body);
  } catch (error: unknown) {
    if (error instanceof QuoteRuleError) throw new PricingApplicationError('REQUEST_INVALID');
    throw error;
  }
}

export class PricingService {
  constructor(
    private readonly deps: {
      readonly repository: PricingRepository;
      readonly authority: AccessAuthority;
      readonly catalog: CatalogRevisionReader;
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
      if (error instanceof AccessDenied) throw new PricingApplicationError(error.reason);
      throw new PricingApplicationError('AUTH_UNAVAILABLE');
    }
    if (permission && !principal.permissions.includes(permission))
      throw new PricingApplicationError('AUTH_FORBIDDEN');
    return principal;
  }

  private key(value: unknown): string {
    if (typeof value !== 'string' || !IDEMPOTENCY_KEY.test(value))
      throw new PricingApplicationError('IDEMPOTENCY_KEY_INVALID');
    return value;
  }

  private policy(): CurrencyPolicy {
    const policy = this.deps.policy.currencyPolicy();
    if (!policy) throw new PricingApplicationError('POLICY_UNAVAILABLE');
    return policy;
  }

  private replay(receipt: IdempotencyReceipt, fingerprint: string): RecordedOutcome {
    if (receipt.requestFingerprint !== fingerprint)
      throw new PricingApplicationError('IDEMPOTENCY_CONFLICT');
    return receipt.outcome;
  }

  private async withWindow(version: PublishedPriceVersion): Promise<Record<string, unknown>> {
    const next = await this.deps.repository.version(version.version + 1);
    return versionView(version, next?.effectiveFrom ?? null);
  }

  /** Current price list. Readable by any verified session; amounts are public prices. */
  async versionInForce(context: RequestContext): Promise<Record<string, unknown>> {
    await this.principal(context);
    const version = await this.deps.repository.versionInForce(this.deps.clock.now());
    if (!version) throw new PricingApplicationError('PRICES_NOT_PUBLISHED');
    return this.withWindow(version);
  }

  async listVersions(context: RequestContext): Promise<{ versions: Record<string, unknown>[] }> {
    await this.principal(context, PRICING_PUBLISH_PERMISSION);
    const versions = await this.deps.repository.listVersions(50);
    return {
      versions: versions.map((v) => ({
        version: v.version,
        effectiveFrom: v.effectiveFrom.toISOString(),
        publishedAt: v.publishedAt.toISOString(),
        catalogRevision: v.catalogRevision,
        policyRevision: v.policyRevision,
        currency: v.currency,
        ratesFingerprint: v.ratesFingerprint,
      })),
    };
  }

  /**
   * Publishes the next price version for an exact catalog revision. The catalog
   * view is fetched BEFORE the transaction (no network call holds a DB lock);
   * receipt, version and audit then commit together.
   */
  async publish(
    context: RequestContext,
    idempotencyKey: unknown,
    body: unknown,
  ): Promise<CommandResult> {
    const principal = await this.principal(context, PRICING_PUBLISH_PERMISSION);
    const key = this.key(idempotencyKey);
    const input = objectWithKeys(body, 'catalogRevision,effectiveFrom,expectedVersion,rates');
    const expectedVersion = boundedInt(input.expectedVersion, 0, 'expectedVersion');
    const catalogRevision = boundedInt(input.catalogRevision, 1, 'catalogRevision');
    const effectiveFrom = parseTimestamp(input.effectiveFrom, 'effectiveFrom');
    const policy = this.policy();
    let rates: Rate[];
    try {
      rates = normalizeRates(input.rates, policy);
    } catch (error: unknown) {
      if (!(error instanceof PriceRuleError)) throw error;
      if (error.code === 'RATES_MALFORMED')
        throw new PricingApplicationError('REQUEST_INVALID', { field: error.path });
      throw new PricingApplicationError('RATES_INVALID', { reason: error.code, field: error.path });
    }
    const requestFingerprint = this.deps.hasher.sha256Hex(
      canonicalJson({
        operation: PUBLISH_OPERATION,
        actor: principal.subject,
        expectedVersion,
        effectiveFrom: effectiveFrom?.toISOString() ?? null,
        catalogRevision,
        rates: rates.map(rateWire),
      }),
    );
    const existing = await this.deps.repository.findReceipt(
      principal.subject,
      PUBLISH_OPERATION,
      key,
    );
    if (existing) return { ...this.replay(existing, requestFingerprint), replayed: true };

    let snapshot;
    try {
      snapshot = await this.deps.catalog.read(catalogRevision, context.correlationId);
    } catch (error: unknown) {
      if (error instanceof CatalogUnavailable)
        throw new PricingApplicationError('UPSTREAM_UNAVAILABLE');
      throw error;
    }
    if (!snapshot || snapshot.revision !== catalogRevision)
      throw new PricingApplicationError('CATALOG_REVISION_UNKNOWN');
    try {
      validateRatesAgainstCatalog(rates, snapshot);
    } catch (error: unknown) {
      if (!(error instanceof PriceRuleError)) throw error;
      throw new PricingApplicationError('RATES_INVALID', { reason: error.code, field: error.path });
    }
    const ratesFingerprint = this.deps.hasher.sha256Hex(
      canonicalJson({
        catalogRevision,
        catalogFingerprint: snapshot.definitionsFingerprint,
        policyRevision: policy.revision,
        currency: policy.currency,
        rates: rates.map(rateWire),
      }),
    );

    return this.deps.repository.transaction(async (uow) => {
      const head = await uow.lockHead();
      const raced = await uow.findReceipt(principal.subject, PUBLISH_OPERATION, key);
      if (raced) return { ...this.replay(raced, requestFingerprint), replayed: true };
      const now = this.deps.clock.now();
      const plan = planPriceVersion({
        head,
        expectedVersion,
        effectiveFrom,
        now,
        catalogEffectiveFrom: snapshot.effectiveFrom,
      });
      let outcome: RecordedOutcome;
      if (plan.accepted) {
        const version: PublishedPriceVersion = {
          version: plan.version,
          effectiveFrom: plan.effectiveFrom,
          publishedAt: now,
          catalogRevision,
          policyRevision: policy.revision,
          currency: policy.currency,
          minorUnitExponent: policy.minorUnitExponent,
          ratesFingerprint,
          rates,
          catalog: snapshot,
        };
        await uow.insertPriceVersion({
          ...version,
          publishedBy: principal.subject,
          correlationId: context.correlationId,
        });
        outcome = { status: 201, body: versionView(version, null) };
      } else {
        outcome = { status: REJECTION_STATUS[plan.reason], body: { code: plan.reason } };
      }
      await uow.saveReceipt(
        {
          actorSubject: principal.subject,
          operation: PUBLISH_OPERATION,
          idempotencyKey: key,
          requestFingerprint,
          outcome,
        },
        now,
      );
      await uow.appendAudit({
        id: this.deps.ids.uuid(),
        occurredAt: now,
        actorSubject: principal.subject,
        action: plan.accepted ? 'pricing.version.published' : 'pricing.version.publish-rejected',
        version: plan.accepted ? plan.version : null,
        outcome: plan.accepted ? 'PUBLISHED' : plan.reason,
        correlationId: context.correlationId,
      });
      return { ...outcome, replayed: false };
    });
  }

  private inputFingerprint(
    owner: string,
    priceVersion: number,
    policyRevision: string,
    selection: Selection,
  ): string {
    return this.deps.hasher.sha256Hex(
      canonicalJson({ owner, priceVersion, policyRevision, selection: selectionWire(selection) }),
    );
  }

  private async renderOutcome(
    outcome: RecordedOutcome,
  ): Promise<Readonly<Record<string, unknown>>> {
    if (outcome.status !== 201) return outcome.body;
    const quoteId = outcome.body.quoteId;
    const quote = typeof quoteId === 'string' ? await this.deps.repository.quote(quoteId) : null;
    if (!quote) throw new Error('QUOTE_RECEIPT_WITHOUT_QUOTE');
    // Replays return the ORIGINAL snapshot and expiry; status is evaluated now.
    return quoteView(quote, this.deps.clock.now());
  }

  /**
   * Issues an immutable, expiring quote from IDs only. Server time, server rates
   * and the stored catalog view decide everything; a client total is never read.
   */
  async issueQuote(
    context: RequestContext,
    idempotencyKey: unknown,
    body: unknown,
  ): Promise<CommandResult> {
    const principal = await this.principal(context, QUOTE_PERMISSION);
    const key = this.key(idempotencyKey);
    const selection = selectionOf(body);
    const requestFingerprint = this.deps.hasher.sha256Hex(
      canonicalJson({
        operation: QUOTE_OPERATION,
        actor: principal.subject,
        selection: selectionWire(selection),
      }),
    );
    const existing = await this.deps.repository.findReceipt(
      principal.subject,
      QUOTE_OPERATION,
      key,
    );
    if (existing) {
      const outcome = this.replay(existing, requestFingerprint);
      return { status: outcome.status, body: await this.renderOutcome(outcome), replayed: true };
    }
    const policy = this.policy();
    const ttl = this.deps.policy.quoteTtlSeconds();
    if (ttl === null) throw new PricingApplicationError('POLICY_UNAVAILABLE');

    let outcome: RecordedOutcome;
    try {
      outcome = await this.deps.repository.transaction(async (uow) => {
        // Publication cannot change the current/next version pair until the
        // quote commits. Sample time only after any publication wait.
        await uow.lockPrices();
        const now = this.deps.clock.now();
        const version = await uow.versionInForce(now);
        if (!version) throw new PricingApplicationError('PRICES_NOT_PUBLISHED');
        // Prices published under another policy revision are not usable until
        // republished: no silent currency/precision reinterpretation.
        if (version.policyRevision !== policy.revision || version.currency !== policy.currency)
          throw new PricingApplicationError('POLICY_UNAVAILABLE');
        let result: RecordedOutcome;
        if (version.catalogRevision !== selection.catalogRevision) {
          result = {
            status: 409,
            body: { code: 'CATALOG_REVISION_MISMATCH', catalogRevision: version.catalogRevision },
          };
        } else {
          try {
            const computed = computeQuote({
              selection,
              snapshot: version.catalog,
              rates: version.rates,
              policy,
            });
            const next = await uow.version(version.version + 1);
            const quoteId = this.deps.ids.uuid();
            await uow.insertQuote({
              id: quoteId,
              ownerSubject: principal.subject,
              priceVersion: version.version,
              catalogRevision: version.catalogRevision,
              policyRevision: version.policyRevision,
              currency: computed.currency,
              minorUnitExponent: version.minorUnitExponent,
              selection,
              lines: computed.lines,
              subtotalMinor: computed.subtotalMinor,
              totalMinor: computed.totalMinor,
              durationMinutes: computed.durationMinutes,
              inputFingerprint: this.inputFingerprint(
                principal.subject,
                version.version,
                version.policyRevision,
                selection,
              ),
              issuedAt: now,
              expiresAt: quoteExpiry(now, ttl, next?.effectiveFrom ?? null),
              correlationId: context.correlationId,
            });
            result = { status: 201, body: { quoteId } };
          } catch (error: unknown) {
            if (!(error instanceof QuoteRuleError) || error.code === 'RATE_MISSING') throw error;
            result = { status: 422, body: { code: error.code } };
          }
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
      return { status: replayed.status, body: await this.renderOutcome(replayed), replayed: true };
    }
    return { status: outcome.status, body: await this.renderOutcome(outcome), replayed: false };
  }

  private async ownedQuote(principal: VerifiedPrincipal, id: string): Promise<StoredQuote> {
    // Wrong owner and missing are indistinguishable (non-enumerating).
    if (!UUID.test(id)) throw new PricingApplicationError('NOT_FOUND');
    const quote = await this.deps.repository.quote(id);
    if (!quote || quote.ownerSubject !== principal.subject)
      throw new PricingApplicationError('NOT_FOUND');
    return quote;
  }

  async getQuote(context: RequestContext, id: string): Promise<Record<string, unknown>> {
    const principal = await this.principal(context, QUOTE_PERMISSION);
    return quoteView(await this.ownedQuote(principal, id), this.deps.clock.now());
  }

  /**
   * Read-only check used before a booking is confirmed: the quote belongs to the
   * caller, is still usable at server time and was issued for exactly this
   * selection. It never extends, reissues or mutates the quote.
   */
  async validateQuote(
    context: RequestContext,
    id: string,
    body: unknown,
  ): Promise<Record<string, unknown>> {
    const principal = await this.principal(context, QUOTE_PERMISSION);
    const quote = await this.ownedQuote(principal, id);
    const selection = selectionOf(body);
    const expected = this.inputFingerprint(
      principal.subject,
      quote.priceVersion,
      quote.policyRevision,
      selection,
    );
    if (expected !== quote.inputFingerprint)
      throw new PricingApplicationError('QUOTE_SELECTION_MISMATCH');
    const now = this.deps.clock.now();
    if (quoteStatus(quote.expiresAt, now) !== 'USABLE')
      throw new PricingApplicationError('QUOTE_EXPIRED');
    return quoteView(quote, now);
  }
}
