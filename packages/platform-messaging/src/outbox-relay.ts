import { PublishError, type ConfirmingPublisher } from './publisher';
import type { MessageLogger, OutboxRecord, OutboxStore } from './types';

/**
 * Relay worker: durable outbox rows -> broker.
 *
 * Ordering of effects is deliberate and must not be "optimised":
 *   1. lease the row (so a competing worker cannot take it),
 *   2. publish and WAIT for the broker confirm,
 *   3. mark published, but only while we still hold the lease.
 *
 * Marking first would lose the event when publishing fails. Marking without the
 * lease guard would let a worker that stalled past its lease overwrite the row a
 * second worker already finalised.
 *
 * This yields at-least-once delivery. Consumers must still be idempotent; no
 * end-to-end exactly-once claim is made or provable here.
 */

export interface OutboxRelayOptions {
  readonly workerId: string;
  readonly store: OutboxStore;
  readonly publisher: ConfirmingPublisher;
  readonly logger?: MessageLogger;
  readonly leaseMs?: number;
  readonly batchSize?: number;
  readonly maxAttempts?: number;
  /** Observation/fault-injection seam after the durable lease is acquired. */
  readonly onLeased?: (records: readonly OutboxRecord[]) => void | Promise<void>;
}

export interface RelayPass {
  readonly leased: number;
  readonly published: number;
  readonly failed: number;
  readonly leaseLost: number;
}

export class OutboxRelay {
  private readonly leaseMs: number;
  private readonly batchSize: number;
  private readonly maxAttempts: number;

  constructor(private readonly options: OutboxRelayOptions) {
    this.leaseMs = options.leaseMs ?? 30_000;
    this.batchSize = options.batchSize ?? 20;
    this.maxAttempts = options.maxAttempts ?? 5;
  }

  async runOnce(signal?: AbortSignal): Promise<RelayPass> {
    const records = await this.options.store.leaseBatch({
      workerId: this.options.workerId,
      leaseMs: this.leaseMs,
      limit: this.batchSize,
      maxAttempts: this.maxAttempts,
    });
    await this.options.onLeased?.(records);
    let published = 0;
    let failed = 0;
    let leaseLost = 0;

    for (const record of records) {
      if (signal?.aborted) break;
      try {
        await this.publish(record);
      } catch (error: unknown) {
        failed += 1;
        const reason =
          error instanceof PublishError
            ? error.reason
            : error instanceof Error
              ? error.name
              : 'UNKNOWN_ERROR';
        const owned = await this.options.store.markFailed({
          id: record.id,
          workerId: this.options.workerId,
          error: reason,
          maxAttempts: this.maxAttempts,
        });
        if (!owned) leaseLost += 1;
        this.options.logger?.warn('outbox_publish_failed', {
          eventId: record.eventId,
          eventType: record.eventType,
          reason,
          leaseHeld: owned,
        });
        continue;
      }
      const owned = await this.options.store.markPublished({
        id: record.id,
        workerId: this.options.workerId,
      });
      if (owned) {
        published += 1;
      } else {
        // Confirmed by the broker but our lease had already moved on. The row is
        // left to its current owner; the event may be published twice, which is
        // exactly why consumers deduplicate.
        leaseLost += 1;
        this.options.logger?.warn('outbox_lease_lost_after_publish', {
          eventId: record.eventId,
        });
      }
    }
    return { leased: records.length, published, failed, leaseLost };
  }

  private async publish(record: OutboxRecord): Promise<void> {
    await this.options.publisher.publish({
      exchange: record.exchange,
      routingKey: record.routingKey,
      body: record.payload,
      messageId: record.eventId,
      eventType: record.eventType,
      correlationId: record.correlationId,
    });
  }
}
