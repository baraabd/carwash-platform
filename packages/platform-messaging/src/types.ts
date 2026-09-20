/** Ports and record shapes for the transactional outbox/inbox pattern. */

export interface MessageLogger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export interface OutboxRecord {
  readonly id: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly exchange: string;
  readonly routingKey: string;
  /** Canonical JSON text as it was committed with the local change. */
  readonly payload: string;
  readonly correlationId: string;
  readonly attempts: number;
}

/**
 * Storage port for the relay.
 *
 * Every mutating method is lease-guarded: an implementation MUST return false
 * when the caller no longer owns the lease, so a slow worker that resumes after
 * its lease expired cannot overwrite the state written by the worker that took
 * over. Returning true unconditionally re-introduces the lost-update defect the
 * lease exists to prevent.
 */
export interface OutboxStore {
  leaseBatch(input: {
    workerId: string;
    leaseMs: number;
    limit: number;
    maxAttempts: number;
  }): Promise<OutboxRecord[]>;
  markPublished(input: { id: string; workerId: string }): Promise<boolean>;
  markFailed(input: {
    id: string;
    workerId: string;
    error: string;
    maxAttempts: number;
  }): Promise<boolean>;
}

export type InboxOutcome = 'APPLIED' | 'DUPLICATE' | 'CONFLICT';

export interface InboxRecord {
  readonly eventId: string;
  readonly eventType: string;
  readonly payloadHash: string;
  readonly correlationId: string;
}

/**
 * Storage port for the consumer.
 *
 * `applyOnce` MUST write the inbox row and the local effect inside ONE
 * transaction. Acknowledging before that transaction commits turns a crash into
 * silent data loss; applying the effect outside it turns a redelivery into a
 * duplicate effect.
 */
export interface InboxStore {
  applyOnce(record: InboxRecord, effect: (tx: unknown) => Promise<void>): Promise<InboxOutcome>;
}
