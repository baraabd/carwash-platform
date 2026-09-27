import { bestEffortLog } from '@carwash/observability';
import { traceHeaders, withContext, remoteContext, type Telemetry } from '@carwash/observability';
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
  readonly traceParent?: string | null;
  readonly createdAtMs?: number;
}

export class ConfirmingPublisher {
  private readonly returned = new Set<string>();
  private closed = false;

  constructor(
    private readonly channel: ConfirmChannel,
    private readonly logger?: MessageLogger,
    private readonly confirmTimeoutMs = 10_000,
    private readonly telemetry?: Telemetry,
  ) {
    this.channel.on('return', (message) => {
      const id = message.properties.messageId;
      if (typeof id === 'string') this.returned.add(id);
      bestEffortLog(this.logger, 'warn', 'publish_returned_unroutable', {
        exchange: message.fields.exchange,
        routingKey: message.fields.routingKey,
      });
    });
    this.channel.on('close', () => {
      this.closed = true;
    });
  }

  async publish(input: PublishInput): Promise<void> {
    const headers = {
      ...traceHeaders(),
      'x-correlation-id': input.correlationId,
      ...(input.traceParent ? { traceparent: input.traceParent } : {}),
    };
    const work = async (): Promise<void> => {
      try {
        await this.publishConfirmed(input);
        this.telemetry?.metrics.event('published');
        bestEffortLog(this.logger, 'info', 'message_published');
      } catch (error: unknown) {
        this.telemetry?.metrics.event('failed');
        throw error;
      }
    };
    if (this.telemetry) await this.telemetry.run('messaging.publish', work, headers);
    else await withContext(remoteContext(headers), work);
  }

  private async publishConfirmed(input: PublishInput): Promise<void> {
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
          timestamp: Math.floor((input.createdAtMs ?? Date.now()) / 1000),
          headers: traceHeaders(),
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
