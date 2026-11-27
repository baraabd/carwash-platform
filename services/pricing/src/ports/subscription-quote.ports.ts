import type { pricingV1, subscriptionV1 } from '@carwash/contracts';
export interface SubscriptionPlanReader {
  read(planId: string, correlationId: string): Promise<subscriptionV1.PlanV1 | null>;
}
export interface SubscriptionQuoteStore {
  receipt(
    actor: string,
    key: string,
  ): Promise<{ fingerprint: string; quote: pricingV1.SubscriptionQuoteV1 } | null>;
  get(id: string): Promise<pricingV1.SubscriptionQuoteV1 | null>;
  create(
    actor: string,
    key: string,
    fingerprint: string,
    quote: pricingV1.SubscriptionQuoteV1,
  ): Promise<{ fingerprint: string; quote: pricingV1.SubscriptionQuoteV1; replayed: boolean }>;
}
