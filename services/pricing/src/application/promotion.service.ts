import {
  PROMOTION_CODE,
  PROMOTION_ROUNDING,
  PromotionRuleError,
  REDEMPTION_RELEASE_REASONS,
  capCheck,
  nextRedemptionStatus,
  normalizeCouponCode,
  normalizePromotionTerms,
  planPromotionRevision,
  promotionRevisionInForce,
  quoteStatus,
  type PromotionTerms,
  type RedemptionReleaseReason,
} from '../domain';
import {
  AccessDenied,
  PromotionUniqueConflict,
  ReceiptAlreadyExists,
  type AccessAuthority,
  type Clock,
  type Hasher,
  type IdGenerator,
  type IdempotencyReceipt,
  type PolicyProvider,
  type PricingRepository,
  type PricingUnitOfWork,
  type PromotionActor,
  type PromotionAuditAction,
  type PromotionRevisionRecord,
  type RecordedOutcome,
  type RedemptionRecord,
  type ServiceCallerAuthority,
  type VerifiedPrincipal,
} from '../ports';
import { canonicalJson } from './canonical-json';
import { PricingApplicationError, type PricingErrorCode } from './pricing-errors';
import type { CommandResult, RequestContext } from './pricing.service';
import { redemptionChangedEvent } from './promotion-events';

/** Promotion management reuses the existing Identity grant for price publication. */
export const PROMOTION_MANAGE_PERMISSION = 'pricing.publish';
export const PROMOTION_PUBLISH_OPERATION = 'pricing.promotion.publish.v1';
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UTC_MILLIS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export interface ServiceRequestContext extends RequestContext {
  readonly serviceClient?: string | undefined;
  readonly serviceToken?: string | undefined;
}

const UNIQUE_CODES: Readonly<Record<string, PricingErrorCode>> = {
  COUPON_CODE: 'COUPON_CODE_TAKEN',
  REDEMPTION_BOOKING: 'REDEMPTION_CONFLICT',
  LIVE_BOOKING_REDEMPTION: 'BOOKING_ALREADY_REDEEMED',
  QUOTE_REDEEMED: 'QUOTE_ALREADY_REDEEMED',
};

export function termsView(terms: PromotionTerms): Record<string, unknown> {
  return {
    discount:
      terms.discount.kind === 'PERCENT'
        ? {
            kind: 'PERCENT',
            basisPoints: terms.discount.basisPoints,
            maxDiscountMinor: terms.discount.maxDiscountMinor?.toString() ?? null,
          }
        : { kind: 'FIXED', amountMinor: terms.discount.amountMinor.toString() },
    rounding: PROMOTION_ROUNDING,
    currency: terms.currency,
    packageIds: [...terms.packageIds],
    minSubtotalMinor: terms.minSubtotalMinor.toString(),
    endsAt: terms.endsAt?.toISOString() ?? null,
    totalCap: terms.totalCap,
    perCustomerCap: terms.perCustomerCap,
    active: terms.active,
  };
}

function revisionsView(revisions: readonly PromotionRevisionRecord[]): Record<string, unknown>[] {
  const ordered = [...revisions].sort((a, b) => a.revision - b.revision);
  return ordered.map((revision, index) => ({
    revision: revision.revision,
    effectiveFrom: revision.effectiveFrom.toISOString(),
    effectiveUntil: ordered[index + 1]?.effectiveFrom.toISOString() ?? null,
    publishedAt: revision.publishedAt.toISOString(),
    terms: termsView(revision.terms),
  }));
}

export function redemptionView(redemption: RedemptionRecord): Record<string, unknown> {
  return {
    redemptionId: redemption.id,
    promotionCode: redemption.promotionCode,
    quoteId: redemption.quoteId,
    bookingId: redemption.bookingId,
    discount: { amountMinor: redemption.discountMinor.toString(), currency: redemption.currency },
    status: redemption.status,
    version: redemption.version,
    reservedAt: redemption.reservedAt.toISOString(),
    settledAt: redemption.settledAt?.toISOString() ?? null,
    reason: redemption.reason,
  };
}

function objectWithKeys(body: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body))
    throw new PricingApplicationError('REQUEST_INVALID');
  const input = body as Record<string, unknown>;
  if (Object.keys(input).sort().join(',') !== [...keys].sort().join(','))
    throw new PricingApplicationError('REQUEST_INVALID');
  return input;
}

function uuidField(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID.test(value))
    throw new PricingApplicationError('REQUEST_INVALID', { field });
  return value;
}

/**
 * Promotion management (staff, `pricing.publish`) and the redemption lifecycle
 * used by the Booking saga (service credential, scope `pricing.promotion.redeem`).
 *
 * Caps are enforced under a row lock on the promotion: concurrent reservations
 * for the last remaining use serialise and exactly one succeeds; the database
 * re-checks the caps at COMMIT. A redemption is idempotent on
 * (promotion, booking): a retried reserve never consumes a second use.
 */
export class PromotionService {
  constructor(
    private readonly deps: {
      readonly repository: PricingRepository;
      readonly authority: AccessAuthority;
      readonly callers: ServiceCallerAuthority;
      readonly policy: PolicyProvider;
      readonly clock: Clock;
      readonly ids: IdGenerator;
      readonly hasher: Hasher;
    },
  ) {}

  private async staff(context: RequestContext): Promise<VerifiedPrincipal> {
    let principal: VerifiedPrincipal;
    try {
      principal = await this.deps.authority.verify(context.credential, context.correlationId);
    } catch (error: unknown) {
      if (error instanceof AccessDenied) throw new PricingApplicationError(error.reason);
      throw new PricingApplicationError('AUTH_UNAVAILABLE');
    }
    if (!principal.permissions.includes(PROMOTION_MANAGE_PERMISSION))
      throw new PricingApplicationError('AUTH_FORBIDDEN');
    return principal;
  }

  private caller(context: ServiceRequestContext): string {
    const client = this.deps.callers.authorize(
      context.serviceClient,
      context.serviceToken,
      'pricing.promotion.redeem',
    );
    if (!client) throw new PricingApplicationError('SERVICE_AUTH_REQUIRED');
    return client;
  }

  private async audit(
    uow: PricingUnitOfWork,
    now: Date,
    actor: PromotionActor,
    action: PromotionAuditAction,
    promotionCode: string,
    redemptionId: string | null,
    outcome: string,
    correlationId: string,
  ): Promise<void> {
    await uow.appendPromotionAudit({
      id: this.deps.ids.uuid(),
      occurredAt: now,
      actor,
      action,
      promotionCode,
      redemptionId,
      outcome,
      correlationId,
    });
  }

  private replay(receipt: IdempotencyReceipt, fingerprint: string): RecordedOutcome {
    if (receipt.requestFingerprint !== fingerprint)
      throw new PricingApplicationError('IDEMPOTENCY_CONFLICT');
    return receipt.outcome;
  }

  /**
   * Publishes the next immutable revision. Revision 1 creates the promotion and
   * registers its coupon (digest only); later revisions must send couponCode null.
   */
  async publishRevision(
    context: RequestContext,
    idempotencyKey: unknown,
    code: string,
    body: unknown,
  ): Promise<CommandResult> {
    const principal = await this.staff(context);
    if (typeof idempotencyKey !== 'string' || !IDEMPOTENCY_KEY.test(idempotencyKey))
      throw new PricingApplicationError('IDEMPOTENCY_KEY_INVALID');
    if (!PROMOTION_CODE.test(code))
      throw new PricingApplicationError('REQUEST_INVALID', { field: 'promotionCode' });
    const input = objectWithKeys(body, [
      'expectedRevision',
      'effectiveFrom',
      'couponCode',
      'terms',
    ]);
    const expectedRevision = input.expectedRevision;
    if (
      typeof expectedRevision !== 'number' ||
      !Number.isInteger(expectedRevision) ||
      expectedRevision < 0 ||
      expectedRevision > 1_000_000
    )
      throw new PricingApplicationError('REQUEST_INVALID', { field: 'expectedRevision' });
    let effectiveFrom: Date | null = null;
    if (input.effectiveFrom !== null) {
      if (typeof input.effectiveFrom !== 'string' || !UTC_MILLIS.test(input.effectiveFrom))
        throw new PricingApplicationError('REQUEST_INVALID', { field: 'effectiveFrom' });
      effectiveFrom = new Date(input.effectiveFrom);
      if (effectiveFrom.toISOString() !== input.effectiveFrom)
        throw new PricingApplicationError('REQUEST_INVALID', { field: 'effectiveFrom' });
    }
    // The coupon is fixed at creation: required on revision 1, absent afterwards.
    if ((expectedRevision === 0) !== (input.couponCode !== null))
      throw new PricingApplicationError('REQUEST_INVALID', { field: 'couponCode' });
    const policy = this.deps.policy.currencyPolicy();
    if (!policy) throw new PricingApplicationError('POLICY_UNAVAILABLE');
    let terms: PromotionTerms;
    let couponDigest: string | null = null;
    try {
      terms = normalizePromotionTerms(input.terms, policy.currency);
      if (input.couponCode !== null)
        couponDigest = this.deps.hasher.sha256Hex(normalizeCouponCode(input.couponCode));
    } catch (error: unknown) {
      if (!(error instanceof PromotionRuleError)) throw error;
      if (error.code === 'PROMOTION_CURRENCY_MISMATCH')
        throw new PricingApplicationError('PROMOTION_TERMS_INVALID', {
          reason: error.code,
          field: error.path,
        });
      throw new PricingApplicationError('REQUEST_INVALID', { field: error.path });
    }
    const actor: PromotionActor = { kind: 'account', id: principal.subject };
    const fingerprint = this.deps.hasher.sha256Hex(
      canonicalJson({
        operation: PROMOTION_PUBLISH_OPERATION,
        actor: principal.subject,
        code,
        expectedRevision,
        effectiveFrom: effectiveFrom?.toISOString() ?? null,
        couponDigest,
        terms: termsView(terms),
      }),
    );
    const existing = await this.deps.repository.findReceipt(
      principal.subject,
      PROMOTION_PUBLISH_OPERATION,
      idempotencyKey,
    );
    if (existing) return { ...this.replay(existing, fingerprint), replayed: true };
    try {
      return await this.deps.repository.transaction(async (uow) => {
        const raced = await uow.findReceipt(
          principal.subject,
          PROMOTION_PUBLISH_OPERATION,
          idempotencyKey,
        );
        if (raced) return { ...this.replay(raced, fingerprint), replayed: true };
        const now = this.deps.clock.now();
        let promotion = await uow.lockPromotion(code);
        if (!promotion && couponDigest) {
          promotion = { code, couponDigest, createdAt: now, createdBy: principal.subject };
          await uow.insertPromotion(promotion);
        }
        const revisions = promotion ? await uow.promotionRevisions(code) : [];
        const head = revisions.at(-1) ?? null;
        const plan = planPromotionRevision({ head, expectedRevision, effectiveFrom, now });
        let outcome: RecordedOutcome;
        if (!plan.accepted) {
          outcome = {
            status: plan.reason === 'REVISION_CONFLICT' ? 409 : 422,
            body: { code: plan.reason },
          };
        } else {
          const revision: PromotionRevisionRecord = {
            promotionCode: code,
            revision: plan.revision,
            effectiveFrom: plan.effectiveFrom,
            publishedAt: now,
            publishedBy: principal.subject,
            correlationId: context.correlationId,
            terms,
          };
          await uow.insertPromotionRevision(revision);
          outcome = {
            status: 201,
            body: { promotionCode: code, revisions: revisionsView([...revisions, revision]) },
          };
        }
        await uow.saveReceipt(
          {
            actorSubject: principal.subject,
            operation: PROMOTION_PUBLISH_OPERATION,
            idempotencyKey,
            requestFingerprint: fingerprint,
            outcome,
          },
          now,
        );
        // A rejected revision 1 has no promotion row to audit against; it lives in the receipt.
        if (promotion)
          await this.audit(
            uow,
            now,
            actor,
            plan.accepted
              ? 'pricing.promotion.revision-published'
              : 'pricing.promotion.revision-rejected',
            code,
            null,
            plan.accepted ? `REVISION_${plan.revision}` : plan.reason,
            context.correlationId,
          );
        return { ...outcome, replayed: false };
      });
    } catch (error: unknown) {
      if (error instanceof ReceiptAlreadyExists) {
        const winner = await this.deps.repository.findReceipt(
          principal.subject,
          PROMOTION_PUBLISH_OPERATION,
          idempotencyKey,
        );
        if (winner) return { ...this.replay(winner, fingerprint), replayed: true };
      }
      if (error instanceof PromotionUniqueConflict)
        throw new PricingApplicationError(UNIQUE_CODES[error.target] ?? 'REQUEST_INVALID');
      throw error;
    }
  }

  private async promotionView(code: string): Promise<Record<string, unknown> | null> {
    const promotion = await this.deps.repository.promotion(code);
    if (!promotion) return null;
    const revisions = await this.deps.repository.promotionRevisions(code);
    const usage = await this.deps.repository.promotionUsage(code);
    return { promotionCode: code, revisions: revisionsView(revisions), usage };
  }

  async listPromotions(
    context: RequestContext,
  ): Promise<{ promotions: Record<string, unknown>[] }> {
    await this.staff(context);
    const promotions = [];
    for (const code of await this.deps.repository.promotionCodes(100)) {
      const view = await this.promotionView(code);
      if (view) promotions.push(view);
    }
    return { promotions };
  }

  async getPromotion(context: RequestContext, code: string): Promise<Record<string, unknown>> {
    await this.staff(context);
    const view = PROMOTION_CODE.test(code) ? await this.promotionView(code) : null;
    if (!view) throw new PricingApplicationError('NOT_FOUND');
    return view;
  }

  private async recordChange(
    uow: PricingUnitOfWork,
    now: Date,
    actor: PromotionActor,
    redemption: RedemptionRecord,
    previous: RedemptionRecord['status'] | null,
    correlationId: string,
  ): Promise<void> {
    const action: PromotionAuditAction =
      redemption.status === 'RESERVED'
        ? 'pricing.promotion.redemption-reserved'
        : redemption.status === 'COMMITTED'
          ? 'pricing.promotion.redemption-committed'
          : 'pricing.promotion.redemption-released';
    await this.audit(
      uow,
      now,
      actor,
      action,
      redemption.promotionCode,
      redemption.id,
      redemption.status,
      correlationId,
    );
    await uow.appendOutbox(
      redemptionChangedEvent(
        {
          promotionCode: redemption.promotionCode,
          quoteId: redemption.quoteId,
          bookingId: redemption.bookingId,
          previousStatus: previous,
          status: redemption.status,
          discount: {
            currency: redemption.currency,
            amountMinor: redemption.discountMinor.toString(),
          },
          reason: redemption.reason,
        },
        {
          eventId: this.deps.ids.uuid(),
          occurredAt: now,
          correlationId,
          actor,
          redemptionId: redemption.id,
          version: redemption.version,
        },
      ),
    );
  }

  /**
   * Booking reserves the use of the promotion its quote carries. The quote must
   * belong to the customer Booking acts for and still be usable; the caps of the
   * revision in force NOW apply (a deactivated or ended promotion is refused).
   */
  async reserve(context: ServiceRequestContext, body: unknown): Promise<CommandResult> {
    const client = this.caller(context);
    const input = objectWithKeys(body, ['quoteId', 'bookingId', 'customerSubject']);
    const quoteId = uuidField(input.quoteId, 'quoteId');
    const bookingId = uuidField(input.bookingId, 'bookingId');
    const customerSubject = uuidField(input.customerSubject, 'customerSubject');
    const actor: PromotionActor = { kind: 'service', id: client };
    const quote = await this.deps.repository.quote(quoteId);
    if (!quote || quote.ownerSubject !== customerSubject)
      throw new PricingApplicationError('NOT_FOUND');
    if (!quote.discount) throw new PricingApplicationError('QUOTE_HAS_NO_PROMOTION');
    const discount = quote.discount;
    try {
      return await this.deps.repository.transaction(async (uow) => {
        const promotion = await uow.lockPromotion(discount.promotionCode);
        if (!promotion) throw new Error('QUOTE_PROMOTION_MISSING');
        const existing = await uow.redemptionFor(discount.promotionCode, bookingId);
        if (existing) {
          if (existing.quoteId !== quoteId)
            throw new PricingApplicationError('REDEMPTION_CONFLICT');
          return { status: 200, body: redemptionView(existing), replayed: true };
        }
        const now = this.deps.clock.now();
        if (quoteStatus(quote.expiresAt, now) !== 'USABLE')
          throw new PricingApplicationError('QUOTE_EXPIRED');
        const current = promotionRevisionInForce(
          await uow.promotionRevisions(discount.promotionCode),
          now,
        );
        if (
          !current ||
          !current.terms.active ||
          (current.terms.endsAt && now.getTime() >= current.terms.endsAt.getTime())
        )
          throw new PricingApplicationError('PROMOTION_INACTIVE');
        const live = await uow.liveRedemptions(discount.promotionCode, customerSubject);
        const rejection = capCheck({
          terms: current.terms,
          liveTotal: live.total,
          liveForCustomer: live.customer,
        });
        if (rejection) throw new PricingApplicationError(rejection);
        const redemption: RedemptionRecord = {
          id: this.deps.ids.uuid(),
          promotionCode: discount.promotionCode,
          capsRevision: current.revision,
          quoteId,
          bookingId,
          customerSubject,
          discountMinor: discount.amountMinor,
          currency: quote.currency,
          status: 'RESERVED',
          version: 1,
          reservedAt: now,
          reservedBy: client,
          settledAt: null,
          settledBy: null,
          reason: null,
          correlationId: context.correlationId,
        };
        await uow.insertRedemption(redemption);
        await this.recordChange(uow, now, actor, redemption, null, context.correlationId);
        return { status: 201, body: redemptionView(redemption), replayed: false };
      });
    } catch (error: unknown) {
      if (error instanceof PromotionUniqueConflict)
        throw new PricingApplicationError(UNIQUE_CODES[error.target] ?? 'REDEMPTION_CONFLICT');
      throw error;
    }
  }

  async forBooking(
    context: ServiceRequestContext,
    bookingId: string | undefined,
  ): Promise<{ redemptions: Record<string, unknown>[] }> {
    this.caller(context);
    const id = uuidField(bookingId, 'bookingId');
    return {
      redemptions: (await this.deps.repository.redemptionsForBooking(id)).map(redemptionView),
    };
  }

  /** COMMIT when the booking is confirmed; RELEASE (compensation) when it is cancelled or fails. */
  async complete(
    context: ServiceRequestContext,
    id: string,
    action: 'COMMIT' | 'RELEASE',
    body: unknown,
  ): Promise<CommandResult> {
    const client = this.caller(context);
    if (!UUID.test(id)) throw new PricingApplicationError('NOT_FOUND');
    let reason: RedemptionReleaseReason | null = null;
    if (action === 'RELEASE') {
      const value = objectWithKeys(body, ['reason']).reason;
      const found = REDEMPTION_RELEASE_REASONS.find((r) => r === value);
      if (!found) throw new PricingApplicationError('REQUEST_INVALID', { field: 'reason' });
      reason = found;
    } else objectWithKeys(body ?? {}, []);
    const target = action === 'COMMIT' ? 'COMMITTED' : 'RELEASED';
    const actor: PromotionActor = { kind: 'service', id: client };
    return this.deps.repository.transaction(async (uow) => {
      const redemption = await uow.lockRedemption(id);
      if (!redemption) throw new PricingApplicationError('NOT_FOUND');
      if (redemption.status === target)
        return { status: 200, body: redemptionView(redemption), replayed: true };
      const status = nextRedemptionStatus(redemption.status, action);
      if (!status) throw new PricingApplicationError('REDEMPTION_NOT_RESERVED');
      const now = this.deps.clock.now();
      const updated: RedemptionRecord = {
        ...redemption,
        status,
        version: redemption.version + 1,
        settledAt: now,
        settledBy: client,
        reason,
      };
      await uow.updateRedemption(updated);
      await this.recordChange(uow, now, actor, updated, redemption.status, context.correlationId);
      return { status: 200, body: redemptionView(updated), replayed: false };
    });
  }
}
