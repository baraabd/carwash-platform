export interface FundingReleaseLease {
  readonly subscriptionId: string;
  readonly customerSubject: string;
  readonly correlationId: string;
  readonly acquisition: number;
  readonly workerId: string;
}

export interface FundingReleaseQueue {
  /** Only irreversibly cancelled subscriptions with zero reserved units in ALL periods. */
  claim(workerId: string, at: Date, limit: number): Promise<FundingReleaseLease[]>;
  finish(lease: FundingReleaseLease, at: Date, released: boolean): Promise<boolean>;
}
