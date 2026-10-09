import {
  DEFAULT_DELIVERY_POLICY,
  afterSubmission,
  canCancel,
  notificationRequest,
  requestFingerprint,
  type DeliveryPolicy,
  type SubmissionOutcome,
} from '../domain/notification';
import type {
  ClaimedDelivery,
  Clock,
  EnqueueResult,
  Hasher,
  IdGenerator,
  NotificationIntake,
  NotificationProvider,
  NotificationRepository,
} from '../ports/notification.ports';

export interface EnqueueCommand {
  readonly sourceService: unknown;
  readonly idempotencyKey: unknown;
  readonly recipientRef: unknown;
  readonly channel: unknown;
  readonly templateKey: unknown;
  readonly templateVersion: unknown;
  readonly parameters: unknown;
  readonly expiresAt: unknown;
  /** Optional opaque owner reference the notification is about. */
  readonly subject?: unknown;
}

/**
 * Accepts a notification intent. Persisting the intent is the whole command;
 * nothing is sent here, so a source owner's transaction never waits on, or
 * depends on, a provider.
 */
export class EnqueueNotification {
  constructor(
    private readonly clock: Clock,
    private readonly hash: Hasher,
    private readonly newId: IdGenerator,
  ) {}

  execute(intake: NotificationIntake, command: EnqueueCommand): Promise<EnqueueResult> {
    const now = this.clock.now();
    const request = notificationRequest({ ...command, now });
    return intake.enqueue({
      request,
      requestHash: this.hash(requestFingerprint(request)),
      notificationId: this.newId(),
      now,
    });
  }
}

export interface DeliveryRunReport {
  readonly claimed: number;
  readonly completed: number;
  /** Completions refused by fencing: a newer claim or a receipt won. */
  readonly fencedOut: number;
  readonly outcomes: Readonly<Record<SubmissionOutcome['kind'], number>>;
}

/**
 * One pass of the delivery worker. Each claimed intent is submitted under a
 * hard deadline; whatever the provider port reports is recorded through a
 * fenced write, so a slow worker can never overwrite a newer attempt.
 */
export class DeliveryWorker {
  constructor(
    private readonly repository: NotificationRepository,
    private readonly provider: NotificationProvider,
    private readonly clock: Clock,
    private readonly random: () => number,
    private readonly options: {
      readonly workerId: string;
      readonly batchSize: number;
      readonly submitTimeoutMs: number;
      readonly policy?: DeliveryPolicy;
    },
  ) {
    if (!/^[A-Za-z0-9._:-]{1,64}$/.test(options.workerId)) throw new Error('INVALID_WORKER_ID');
    if (!Number.isSafeInteger(options.batchSize) || options.batchSize < 1)
      throw new Error('INVALID_BATCH_SIZE');
    if (options.submitTimeoutMs <= 0) throw new Error('INVALID_SUBMIT_TIMEOUT');
    // A submission must finish well inside the lease, or a second worker could
    // claim the intent while the first is still waiting on the provider.
    if (options.submitTimeoutMs * 2 > this.policy.leaseMs)
      throw new Error('LEASE_TOO_SHORT_FOR_TIMEOUT');
  }

  private get policy(): DeliveryPolicy {
    return this.options.policy ?? DEFAULT_DELIVERY_POLICY;
  }

  async runOnce(): Promise<DeliveryRunReport> {
    const outcomes: Record<SubmissionOutcome['kind'], number> = {
      ACCEPTED: 0,
      REJECTED: 0,
      NOT_SUBMITTED: 0,
      AMBIGUOUS: 0,
    };
    let completed = 0;
    let fencedOut = 0;
    let claimed = 0;
    for (let index = 0; index < this.options.batchSize; index += 1) {
      // A batch bounds this pass, not a reservation of future submissions.
      // If this process stops while submitting one intent, all later intents
      // remain QUEUED and can still be delivered by a non-idempotent provider.
      const [delivery] = await this.repository.claimDue({
        now: this.clock.now(),
        workerId: this.options.workerId,
        limit: 1,
        leaseMs: this.policy.leaseMs,
        idempotentProvider: this.provider.idempotentSubmission,
        maxAttempts: this.policy.maxAttempts,
      });
      if (!delivery) break;
      claimed += 1;
      const outcome = await this.submit(delivery);
      outcomes[outcome.kind] += 1;
      const now = this.clock.now();
      const written = await this.repository.complete({
        notificationId: delivery.notificationId,
        fence: delivery.fence,
        attempt: delivery.attempt,
        outcome: outcome.kind,
        transition: afterSubmission({
          outcome,
          attempt: delivery.attempt,
          now,
          expiresAt: delivery.expiresAt,
          idempotentProvider: this.provider.idempotentSubmission,
          policy: this.policy,
          random: this.random,
        }),
        now,
      });
      if (written) completed += 1;
      else fencedOut += 1;
    }
    return { claimed, completed, fencedOut, outcomes };
  }

  private async submit(delivery: ClaimedDelivery): Promise<SubmissionOutcome> {
    const signal = AbortSignal.timeout(this.options.submitTimeoutMs);
    try {
      return await this.provider.submit(delivery.submission, signal);
    } catch {
      // An adapter that throws instead of classifying gives no proof that the
      // request did not leave: treat it as possibly sent.
      return { kind: 'AMBIGUOUS', code: 'PROVIDER_ADAPTER_ERROR' };
    }
  }
}

export class NotificationAdministration {
  constructor(
    private readonly repository: NotificationRepository,
    private readonly clock: Clock,
  ) {}

  /** A verified provider receipt; adapters own signature verification. */
  recordReceipt(notificationId: string, receipt: 'DELIVERED' | 'FAILED') {
    return this.repository.applyReceipt({ notificationId, receipt, now: this.clock.now() });
  }

  async cancel(notificationId: string) {
    const current = await this.repository.find(notificationId);
    if (!current) return 'NOT_FOUND' as const;
    if (!canCancel(current.state)) return 'NOT_CANCELLABLE' as const;
    return this.repository.cancel(notificationId, this.clock.now());
  }

  find(notificationId: string) {
    return this.repository.find(notificationId);
  }
}
