import type { ConfirmChannel } from 'amqplib';
import type { MessageLogger } from './types';

/**
 * Publisher confirms, with unroutable publications treated as FAILURES.
 *
 * A broker ack means "the broker took responsibility for this message". It does
 * NOT mean the message reached a queue: with `mandatory`, a message that matched
 * no binding is returned to the publisher and then acked. Marking such a message
 * as published would silently lose it, so a returned message is surfaced as
 * UNROUTABLE and the outbox row stays unpublished.
 */

export class PublishError extends Error {
  constructor(
    readonly reason: 'NACK' | 'UNROUTABLE' | 'TIMEOUT' | 'CHANNEL_CLOSED',
    message?: string,
  ) {
    super(message ?? reason);
    this.name = 'PublishError';
  }
}

export interface PublishInput {
  readonly exchange: string;
  readonly routingKey: string;
  readonly body: string;
  readonly messageId: string;
  readonly eventType: string;
  readonly correlationId: string;
  /** Transport metadata such as the durable retry counter. */
  readonly headers?: Readonly<Record<string, unknown>>;
}

export class ConfirmingPublisher {
  private readonly returned = new Set<string>();
  private closed = false;

  constructor(
    private readonly channel: ConfirmChannel,
    private readonly logger?: MessageLogger,
    private readonly confirmTimeoutMs = 10_000,
  ) {
    this.channel.on('return', (message) => {
      const id = message.properties.messageId;
      if (typeof id === 'string') this.returned.add(id);
      this.logger?.warn('publish_returned_unroutable', {
        exchange: message.fields.exchange,
        routingKey: message.fields.routingKey,
      });
    });
    this.channel.on('close', () => {
      this.closed = true;
    });
  }

  async publish(input: PublishInput): Promise<void> {
    if (this.closed) throw new PublishError('CHANNEL_CLOSED');
    this.returned.delete(input.messageId);

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new PublishError('TIMEOUT'));
      }, this.confirmTimeoutMs);
      timer.unref?.();

      const finish = (error?: PublishError): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      };

      this.channel.publish(
        input.exchange,
        input.routingKey,
        Buffer.from(input.body, 'utf8'),
        {
          persistent: true,
          mandatory: true,
          contentType: 'application/json',
          messageId: input.messageId,
          correlationId: input.correlationId,
          type: input.eventType,
          timestamp: Date.now(),
          ...(input.headers ? { headers: { ...input.headers } } : {}),
        },
        (error: unknown) => {
          if (error) {
            finish(new PublishError('NACK', error instanceof Error ? error.message : undefined));
            return;
          }
          // basic.return always precedes basic.ack for the same message.
          if (this.returned.delete(input.messageId)) {
            finish(new PublishError('UNROUTABLE'));
            return;
          }
          finish();
        },
      );
    });
  }
}
