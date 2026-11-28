import type { Money } from '../domain';

/** One Subscription workload owns this namespace, including after cancellation. */
export interface SubscriptionFundingNamespace {
  readonly subscriptionId: string;
  readonly clientId: string;
  readonly customerSubject: string;
  readonly createdAt: Date;
  readonly releasedAt: Date | null;
  readonly correlationId: string;
}

/** A settled obligation funds exactly one period until its owner quiesces the subscription. */
export interface SubscriptionFundingClaim {
  readonly obligationId: string;
  readonly creditId: string;
  readonly subscriptionId: string;
  readonly periodNo: number;
  readonly quoteId: string;
  readonly amount: Money;
  readonly claimedAt: Date;
  readonly releasedAt: Date | null;
  readonly correlationId: string;
}

export interface SubscriptionFundingStore {
  lockCommand(
    clientId: string,
    operation: 'CLAIM' | 'RELEASE',
    key: string,
  ): Promise<string | null>;
  bindCommand(input: {
    clientId: string;
    operation: 'CLAIM' | 'RELEASE';
    key: string;
    fingerprint: string;
    recordedAt: Date;
    correlationId: string;
  }): Promise<void>;
  /** Serializes acquire/release even before the namespace exists. */
  lockSubscription(subscriptionId: string): Promise<void>;
  namespace(subscriptionId: string): Promise<SubscriptionFundingNamespace | null>;
  insertNamespace(record: SubscriptionFundingNamespace): Promise<void>;
  releaseNamespace(subscriptionId: string, at: Date): Promise<void>;
  forObligation(obligationId: string): Promise<SubscriptionFundingClaim | null>;
  forPeriod(subscriptionId: string, periodNo: number): Promise<SubscriptionFundingClaim | null>;
  activeClaims(subscriptionId: string): Promise<SubscriptionFundingClaim[]>;
  insertClaim(record: SubscriptionFundingClaim): Promise<void>;
  releaseClaim(obligationId: string, at: Date): Promise<void>;
}
