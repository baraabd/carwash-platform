import type {
  Channel,
  DeliveryState,
  NotificationRequest,
  SubmissionOutcome,
  Transition,
} from '../domain/notification';

export interface Clock {
  now(): Date;
}

/** What the provider receives. The recipient is still an opaque reference. */
export interface ProviderSubmission {
  readonly idempotencyKey: string;
  readonly channel: Channel;
  readonly recipientRef: string;
  readonly templateKey: string;
  readonly templateVersion: number;
  readonly parameters: Readonly<Record<string, string>>;
}

/**
 * Outbound delivery provider. Implementations MUST classify honestly:
 * NOT_SUBMITTED only when the request provably never left the process, and
 * AMBIGUOUS for anything after that point without a definite answer.
 */
export interface NotificationProvider {
  readonly name: string;
  /** True only if the provider documents deduplication on our idempotency key. */
  readonly idempotentSubmission: boolean;
  submit(submission: ProviderSubmission, signal: AbortSignal): Promise<SubmissionOutcome>;
}

export type EnqueueResult =
  | { readonly kind: 'CREATED'; readonly notificationId: string }
  | { readonly kind: 'REPLAYED'; readonly notificationId: string }
  | { readonly kind: 'CONFLICT' };

/** A claimed unit of work. `fence` proves which claim owns the attempt. */
export interface ClaimedDelivery {
  readonly notificationId: string;
  readonly fence: number;
  readonly attempt: number;
  readonly expiresAt: Date;
  readonly submission: ProviderSubmission;
}

export interface NotificationView {
  readonly id: string;
  readonly state: DeliveryState;
  readonly attemptCount: number;
  readonly channel: Channel;
  readonly templateKey: string;
  readonly templateVersion: number;
  readonly nextAttemptAt: Date | null;
  readonly expiresAt: Date;
  readonly lastErrorCode: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Writes that may run inside a caller's transaction (for example an inbox effect). */
export interface NotificationIntake {
  enqueue(input: {
    request: NotificationRequest;
    requestHash: string;
    notificationId: string;
    now: Date;
  }): Promise<EnqueueResult>;
}

export interface NotificationRepository extends NotificationIntake {
  /**
   * Claim due work with compare-and-set on `fence`. Also settles, without a
   * provider call, intents that expired or whose sender lease lapsed.
   */
  claimDue(input: {
    now: Date;
    workerId: string;
    limit: number;
    leaseMs: number;
    idempotentProvider: boolean;
    maxAttempts: number;
  }): Promise<readonly ClaimedDelivery[]>;
  /** Fenced completion: false when a newer claim or a receipt already moved the intent. */
  complete(input: {
    notificationId: string;
    fence: number;
    attempt: number;
    outcome: SubmissionOutcome['kind'];
    transition: Transition;
    now: Date;
  }): Promise<boolean>;
  applyReceipt(input: {
    notificationId: string;
    receipt: 'DELIVERED' | 'FAILED';
    now: Date;
  }): Promise<'APPLIED' | 'IGNORED' | 'NOT_FOUND'>;
  cancel(notificationId: string, now: Date): Promise<'CANCELLED' | 'NOT_CANCELLABLE' | 'NOT_FOUND'>;
  find(notificationId: string): Promise<NotificationView | null>;
}

export type Hasher = (canonical: string) => string;
export type IdGenerator = () => string;
