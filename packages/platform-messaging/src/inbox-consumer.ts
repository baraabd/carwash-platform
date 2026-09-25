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
  readonly channel: ConfirmChannel;
  readonly queue: string;
  readonly store: InboxStore;
  readonly parse: (raw: unknown) => T;
  readonly effect: (event: T, tx: unknown) => Promise<void>;
  readonly logger?: MessageLogger;
  readonly prefetch?: number;
  /**
   * Bounded redelivery for TRANSIENT failures. The counter is process-local: a
   * restarted consumer starts counting again. That is a documented limitation,
   * not a guarantee of a global retry budget.
   */
  readonly maxTransientAttempts?: number;
  /**
   * Observation hook invoked after the local transaction has COMMITTED and
   * before the ACK is sent. It exists because that gap is the only place where
   * a crash can turn into a redelivery, and it must be observable to be
   * testable. Throwing from it suppresses the ACK, exactly as a crash would.
   */
  readonly onBeforeAck?: (event: T, outcome: InboxOutcome) => void | Promise<void>;
}

export interface ConsumerStats {
  applied: number;
  duplicates: number;
  conflicts: number;
  deadLettered: number;
  transientFailures: number;
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

  private readonly transientAttempts = new Map<string, number>();
  private consumerTag: string | undefined;

  constructor(private readonly options: InboxConsumerOptions<T>) {}

  async start(): Promise<string> {
    await this.options.channel.prefetch(this.options.prefetch ?? 1);
    const reply = await this.options.channel.consume(
      this.options.queue,
      (message) => {
        if (message === null) return; // consumer cancelled by the broker
        void this.handle(message);
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
  }

  private deadLetter(message: ConsumeMessage, reason: string): void {
    this.stats.deadLettered += 1;
    this.options.logger?.error('message_dead_lettered', { reason });
    // requeue=false -> the queue's dead-letter exchange, never an ACK.
    this.options.channel.nack(message, false, false);
  }

  private async handle(message: ConsumeMessage): Promise<void> {
    const body = message.content.toString('utf8');
    let event: T;
    try {
      event = this.options.parse(JSON.parse(body));
    } catch (error: unknown) {
      // Malformed or unsupported: retrying can never make it valid.
      this.deadLetter(message, error instanceof Error ? error.message : 'PARSE_ERROR');
      return;
    }

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
      this.transientAttempts.delete(event.eventId);
      // The commit has happened. Anything that prevents the ACK from here on
      // results in a redelivery, which the inbox row makes harmless.
      await this.options.onBeforeAck?.(event, outcome);
      this.options.channel.ack(message);
    } catch (error: unknown) {
      this.stats.transientFailures += 1;
      const attempts = (this.transientAttempts.get(event.eventId) ?? 0) + 1;
      this.transientAttempts.set(event.eventId, attempts);
      const max = this.options.maxTransientAttempts ?? 3;
      this.options.logger?.warn('inbox_apply_failed', {
        eventId: event.eventId,
        attempts,
        error: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
      });
      if (attempts >= max) {
        this.transientAttempts.delete(event.eventId);
        this.deadLetter(message, 'MAX_TRANSIENT_ATTEMPTS');
        return;
      }
      // Never an ACK: a database failure must not discard the message.
      this.options.channel.nack(message, false, true);
    }
  }
}
