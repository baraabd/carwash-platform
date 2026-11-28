import { pricingV1 } from '@carwash/contracts';
import {
  AccessDenied,
  type AccessAuthority,
  type Clock,
  type Hasher,
  type IdGenerator,
  type PolicyProvider,
} from '../ports';
import type {
  SubscriptionPlanReader,
  SubscriptionQuoteStore,
} from '../ports/subscription-quote.ports';
import { PricingApplicationError } from './pricing-errors';
import type { RequestContext } from './pricing.service';

export class SubscriptionQuoteService {
  constructor(
    private readonly deps: {
      readonly authority: AccessAuthority;
      readonly store: SubscriptionQuoteStore;
      readonly plans: SubscriptionPlanReader;
      readonly clock: Clock;
      readonly ids: IdGenerator;
      readonly hasher: Hasher;
      readonly policy: PolicyProvider;
    },
  ) {}
  private async principal(context: RequestContext) {
    try {
      const actor = await this.deps.authority.verify(context.credential, context.correlationId);
      if (actor.kind !== 'account' || !actor.permissions.includes('bookings.create:self'))
        throw new PricingApplicationError('AUTH_FORBIDDEN');
      return actor;
    } catch (error) {
      if (error instanceof PricingApplicationError) throw error;
      throw new PricingApplicationError(
        error instanceof AccessDenied && error.reason === 'AUTH_REQUIRED'
          ? 'AUTH_REQUIRED'
          : 'DEPENDENCY_UNAVAILABLE',
        'AUTH_UNAVAILABLE',
      );
    }
  }
  private view(quote: pricingV1.SubscriptionQuoteV1) {
    return {
      ...quote,
      status:
        this.deps.clock.now().getTime() < Date.parse(quote.expiresAt)
          ? ('USABLE' as const)
          : ('EXPIRED' as const),
    };
  }
  async create(context: RequestContext, key: unknown, body: unknown) {
    const actor = await this.principal(context);
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(key))
      throw new PricingApplicationError('IDEMPOTENCY_KEY_REQUIRED');
    let request: pricingV1.CreateSubscriptionQuoteV1;
    try {
      request = pricingV1.parseCreateSubscriptionQuoteV1(body);
    } catch {
      throw new PricingApplicationError('REQUEST_INVALID');
    }
    const fingerprint = this.deps.hasher.sha256Hex(JSON.stringify(request));
    const previous = await this.deps.store.receipt(actor.subject, key);
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        throw new PricingApplicationError('IDEMPOTENCY_CONFLICT');
      return { status: 200, body: this.view(previous.quote), replayed: true };
    }
    let plan;
    try {
      plan = await this.deps.plans.read(request.planId, context.correlationId);
    } catch {
      throw new PricingApplicationError('UPSTREAM_UNAVAILABLE', 'SUBSCRIPTION_UNAVAILABLE');
    }
    if (!plan || plan.status !== 'PUBLISHED')
      throw new PricingApplicationError('BUSINESS_RULE_VIOLATION', 'PLAN_NOT_AVAILABLE');
    if (plan.version !== request.planVersion)
      throw new PricingApplicationError('REVISION_CONFLICT', 'PLAN_VERSION_CHANGED');
    const ttl = this.deps.policy.quoteTtlSeconds();
    if (ttl === null)
      throw new PricingApplicationError('DEPENDENCY_UNAVAILABLE', 'POLICY_UNAVAILABLE');
    const now = this.deps.clock.now();
    const quote = pricingV1.parseSubscriptionQuoteV1({
      ...request,
      quoteId: this.deps.ids.uuid(),
      beneficiary: { kind: 'account', subjectId: actor.subject },
      status: 'USABLE',
      currency: plan.price.currency,
      total: plan.price,
      planContentHash: plan.contentHash,
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttl * 1000).toISOString(),
    });
    const saved = await this.deps.store.create(actor.subject, key, fingerprint, quote);
    if (saved.fingerprint !== fingerprint)
      throw new PricingApplicationError('IDEMPOTENCY_CONFLICT');
    return {
      status: saved.replayed ? 200 : 201,
      body: this.view(saved.quote),
      replayed: saved.replayed,
    };
  }
  async get(context: RequestContext, id: string) {
    const actor = await this.principal(context);
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new PricingApplicationError('NOT_FOUND');
    const quote = await this.deps.store.get(id);
    if (!quote || quote.beneficiary.subjectId !== actor.subject)
      throw new PricingApplicationError('NOT_FOUND');
    return this.view(quote);
  }
}
