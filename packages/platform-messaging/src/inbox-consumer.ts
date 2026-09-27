import { bestEffortLog } from '@carwash/observability';
import {
  currentContext,
  withContext,
  remoteContext,
  safeId,
  type Telemetry,
} from '@carwash/observability';
import { createHash } from 'node:crypto';
import type { ConfirmChannel, ConsumeMessage } from 'amqplib';
import type { InboxOutcome, InboxRecord, InboxStore, MessageLogger } from './types';

/**
 * Inbox consumer.
 *
 * Contract, in order:
 *   1. parse the envelope (a permanently invalid message is dead-lettered, never
 *      retried forever),
 *   2. `applyOnce` writes the inbox row AND the local effect in ONE transaction,
 *   3. only after that transaction commits do we ACK.
 *
 * A crash between (2) and (3) causes redelivery, and the inbox row makes the
 * redelivery a no-op: the local effect happens once. Acking earlier would turn
 * the crash into silent loss; applying the effect outside the transaction would
 * turn the redelivery into a duplicate effect.
 */

export interface ParsedEvent {
  readonly eventId: string;
  readonly eventType: string;
  readonly correlationId: string;
}

export interface InboxConsumerOptions<T extends ParsedEvent> {
  readonly telemetry?: Telemetry;
  readonly channel: ConfirmChannel;
  readonly queue: string;
  readonly store: InboxStore;
  readonly parse: (raw: unknown) => T;
  readonly effect: (event: T, tx: unknown) => Promise<void>;
  readonly logger?: MessageLogger;
  readonly prefetch?: number;
  /**
   * Observation hook invoked after the local transaction has COMMITTED and
   * before the ACK is sent. It exists because that gap is the only place where
   * a crash can turn into a redelivery, and it must be observable to be
   * testable. Throwing from it suppresses the ACK, exactly as a crash would.
   */
  readonly onBeforeAck?: (event: T, outcome: InboxOutcome) => void | Promise<void>;
  /**
   * Observation only: invoked after the transient NACK has been issued.
   * RabbitMQ remains the authority for the durable delivery counter.
   */
  readonly onTransientFailure?: (event: T, deliveryCount: number) => void;
}

export interface ConsumerStats {
  applied: number;
  duplicates: number;
  conflicts: number;
  deadLettered: number;
  transientFailures: number;
}

export function brokerDeliveryCount(message: ConsumeMessage): number {
  const headers = message.properties.headers as Record<string, unknown> | undefined;
  const raw = headers?.['x-delivery-count'];
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : 0;
}

export function payloadHash(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex');
}

export class InboxConsumer<T extends ParsedEvent> {
  readonly stats: ConsumerStats = {
    applied: 0,
    duplicates: 0,
    conflicts: 0,
    deadLettered: 0,
    transientFailures: 0,
  };

  private consumerTag: string | undefined;
  private readonly inFlight = new Set<Promise<void>>();

  constructor(private readonly options: InboxConsumerOptions<T>) {}

  async start(): Promise<string> {
    await this.options.channel.prefetch(this.options.prefetch ?? 1);
    const reply = await this.options.channel.consume(
      this.options.queue,
      (message) => {
        if (message === null) return; // consumer cancelled by the broker
        const work = this.observe(message).catch((error: unknown) => {
          bestEffortLog(this.options.logger, 'error', 'consumer_callback_failed', { error });
        });
        this.inFlight.add(work);
        void work.finally(() => this.inFlight.delete(work));
      },
      { noAck: false },
    );
    this.consumerTag = reply.consumerTag;
    return reply.consumerTag;
  }

  async stop(): Promise<void> {
    if (this.consumerTag === undefined) return;
    const tag = this.consumerTag;
    this.consumerTag = undefined;
    await this.options.channel.cancel(tag);
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        Promise.allSettled([...this.inFlight]),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 5000);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    // On a deadline the owner closes the channel; RabbitMQ redelivers unacked work.
  }

  private deadLetter(message: ConsumeMessage, reason: string): void {
    this.stats.deadLettered += 1;
    this.options.telemetry?.metrics.event('rejected');
    bestEffortLog(this.options.logger, 'error', 'message_dead_lettered', { reason });
    // requeue=false -> the queue's dead-letter exchange, never an ACK.
    this.options.channel.nack(message, false, false);
  }

  private async observe(message: ConsumeMessage): Promise<void> {
    const carrier = message.properties.headers as Record<string, unknown> | undefined;
    const headers = {
      traceparent: carrier?.['traceparent'],
      'x-request-id': carrier?.['x-request-id'],
      'x-correlation-id': message.properties.correlationId,
    };
    const work = async (): Promise<void> => {
      this.options.telemetry?.metrics.active('consumer', 1);
      try {
        await this.handle(message);
      } finally {
        this.options.telemetry?.metrics.active('consumer', -1);
      }
    };
    if (this.options.telemetry)
      await this.options.telemetry.run('messaging.consume', work, headers);
    else await withContext(remoteContext(headers), work);
  }

  private async handle(message: ConsumeMessage): Promise<void> {
    const body = message.content.toString('utf8');
    let event: T;
    try {
      event = this.options.parse(JSON.parse(body));
    } catch {
      // Malformed or unsupported: retrying can never make it valid.
      this.deadLetter(message, 'PARSE_ERROR');
      return;
    }

    const context = currentContext();
    if (context)
      await withContext({ ...context, correlationId: safeId(event.correlationId) }, () =>
        this.apply(message, event, body),
      );
    else await this.apply(message, event, body);
  }

  private async apply(message: ConsumeMessage, event: T, body: string): Promise<void> {
    const record: InboxRecord = {
      eventId: event.eventId,
      eventType: event.eventType,
      payloadHash: payloadHash(body),
      correlationId: event.correlationId,
    };

    try {
      const outcome = await this.options.store.applyOnce(record, (tx) =>
        this.options.effect(event, tx),
      );
      if (outcome === 'CONFLICT') {
        // Same eventId, different bytes: an integrity problem, not a retry case.
        this.stats.conflicts += 1;
        this.deadLetter(message, 'EVENT_ID_PAYLOAD_CONFLICT');
        return;
      }
      if (outcome === 'DUPLICATE') this.stats.duplicates += 1;
      else this.stats.applied += 1;
      // The commit has happened. Anything that prevents the ACK from here on
      // results in a redelivery, which the inbox row makes harmless.
      await this.options.onBeforeAck?.(event, outcome);
      this.options.channel.ack(message);
      const timestamp: unknown = message.properties.timestamp;
      const age = typeof timestamp === 'number' ? Date.now() / 1000 - timestamp : undefined;
      this.options.telemetry?.metrics.event(outcome === 'DUPLICATE' ? 'duplicate' : 'applied', age);
    } catch (error: unknown) {
      this.stats.transientFailures += 1;
      this.options.telemetry?.metrics.event('retry');
      const deliveryCount = brokerDeliveryCount(message);
      bestEffortLog(this.options.logger, 'warn', 'inbox_apply_failed', {
        eventId: event.eventId,
        deliveryCount,
        error: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
      });
      // Never an ACK: a database/application failure must not discard the
      // message. The queue is quorum-backed with x-delivery-limit, so RabbitMQ
      // owns the bounded retry counter and dead-letters once the limit is
      // exceeded. Process restarts therefore cannot reset the retry budget.
      this.options.channel.nack(message, false, true);
      this.options.onTransientFailure?.(event, deliveryCount);
    }
  }
}
