import { PlanRuleError, SubscriptionRuleError } from '../domain';
import {
  ReceiptAlreadyExists,
  RepositoryBusy,
  UniqueConflict,
  type Clock,
  type IdempotencyReceipt,
  type RecordedOutcome,
  type SubscriptionRepository,
  type SubscriptionUnitOfWork,
  type UniqueTarget,
} from '../ports';
import {
  SubscriptionApplicationError,
  statusOf,
  type SubscriptionErrorCode,
} from './subscription-errors';

export interface CommandResult {
  readonly status: number;
  readonly body: Readonly<Record<string, unknown>>;
  readonly replayed: boolean;
}

const UNIQUE_CODES: Readonly<Record<UniqueTarget, SubscriptionErrorCode>> = {
  OPEN_SUBSCRIPTION: 'SUBSCRIPTION_ALREADY_OPEN',
  PAYMENT_REFERENCE: 'PAYMENT_REFERENCE_USED',
  RESERVATION_BOOKING: 'RESERVATION_CONFLICT',
  LIVE_BOOKING_RESERVATION: 'BOOKING_ALREADY_RESERVED',
};

export function uniqueError(error: UniqueConflict): SubscriptionApplicationError {
  return new SubscriptionApplicationError(UNIQUE_CODES[error.target]);
}

/**
 * A business rejection decided BEFORE any write of the command. It is recorded
 * in the idempotency receipt so a retry with the same key gets the same answer.
 */
export function rejection(error: unknown): RecordedOutcome | null {
  if (error instanceof SubscriptionRuleError)
    return { status: statusOf(error.code), body: { code: error.code } };
  if (error instanceof SubscriptionApplicationError && error.status >= 400 && error.status < 500)
    return { status: error.status, body: { code: error.code } };
  return null;
}

/** Maps a domain rule failure thrown outside a receipt-backed command. */
export function asApplicationError(error: unknown): unknown {
  if (error instanceof SubscriptionRuleError) return new SubscriptionApplicationError(error.code);
  if (error instanceof PlanRuleError) return new SubscriptionApplicationError('TERMS_INVALID');
  if (error instanceof UniqueConflict) return uniqueError(error);
  if (error instanceof RepositoryBusy) return new SubscriptionApplicationError('SERVICE_BUSY');
  return error;
}

function replay(receipt: IdempotencyReceipt, fingerprint: string): RecordedOutcome {
  if (receipt.requestFingerprint !== fingerprint)
    throw new SubscriptionApplicationError('IDEMPOTENCY_CONFLICT');
  return receipt.outcome;
}

/**
 * Receipt-backed staff/customer command: (actor, operation, key) replays the
 * first recorded outcome; a different request under the same key is a conflict.
 * The receipt, state change, audit and outbox commit in one transaction.
 * Work functions decide every rejection before their first write.
 */
export async function receiptCommand(input: {
  readonly repository: SubscriptionRepository;
  readonly clock: Clock;
  readonly actor: string;
  readonly operation: string;
  readonly key: string;
  readonly fingerprint: string;
  readonly work: (uow: SubscriptionUnitOfWork, now: Date) => Promise<RecordedOutcome>;
}): Promise<CommandResult> {
  const { repository, actor, operation, key, fingerprint } = input;
  const existing = await repository.findReceipt(actor, operation, key);
  if (existing) return { ...replay(existing, fingerprint), replayed: true };
  try {
    return await repository.transaction(async (uow) => {
      const raced = await uow.findReceipt(actor, operation, key);
      if (raced) return { ...replay(raced, fingerprint), replayed: true };
      const now = input.clock.now();
      let outcome: RecordedOutcome;
      try {
        outcome = await input.work(uow, now);
      } catch (error: unknown) {
        const rejected = rejection(error);
        if (!rejected) throw error;
        outcome = rejected;
      }
      await uow.saveReceipt(
        {
          actorSubject: actor,
          operation,
          idempotencyKey: key,
          requestFingerprint: fingerprint,
          outcome,
        },
        now,
      );
      return { ...outcome, replayed: false };
    });
  } catch (error: unknown) {
    if (error instanceof ReceiptAlreadyExists) {
      // A concurrent request with the same key committed first: replay it.
      const winner = await repository.findReceipt(actor, operation, key);
      if (winner) return { ...replay(winner, fingerprint), replayed: true };
    }
    throw asApplicationError(error);
  }
}
