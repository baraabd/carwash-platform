import { setTimeout as delay } from 'node:timers/promises';
import {
  BILLING_CASH_COLLECTED_V1,
  BILLING_CASH_COLLECTION_REVERSED_V1,
  BILLING_CUSTODY_HANDOVER_CHANGED_V1,
  BILLING_EVENTS_EXCHANGE,
} from '@carwash/event-contracts';
import {
  ConfirmingPublisher,
  brokerDeliveryCount,
  type ConfirmChannel,
  type ConsumeMessage,
  type MessageLogger,
} from '@carwash/platform-messaging';
import type { CustodyProjector, ProjectionOutcome } from '../../application';
import { WALLET_CUSTODY_QUEUE } from './consumer';
import {
  WALLET_CUSTODY_MAX_RETRIES,
  WALLET_CUSTODY_RETRY_EXCHANGE,
  WALLET_CUSTODY_RETRY_HEADER,
} from './custody-topology';

const SPECS = [
  BILLING_CASH_COLLECTED_V1,
  BILLING_CASH_COLLECTION_REVERSED_V1,
  BILLING_CUSTODY_HANDOVER_CHANGED_V1,
];
const MAX_BODY_BYTES = 64 * 1024;

/**
 * The projector already commits inbox + projection atomically in its own DB.
 * ACK follows that commit. Deferred events move to the queue's tail only after
 * a persistent, mandatory publication is confirmed; a lost ACK can duplicate,
 * never lose, a financial fact. Only Wallet's own retry exchange is writable.
 */
export class CustodyBrokerConsumer {
  private tag: string | undefined;
  private readonly inFlight = new Set<Promise<void>>();
  private readonly publisher: ConfirmingPublisher;

  constructor(
    private readonly options: {
      channel: ConfirmChannel;
      projector: Pick<CustodyProjector, 'project'>;
      logger: MessageLogger;
      retryDelayMs?: number;
      onBeforeAck?: (eventId: string, outcome: ProjectionOutcome) => void | Promise<void>;
      onRetry?: (eventId: string, attempt: number) => void;
    },
  ) {
    this.publisher = new ConfirmingPublisher(options.channel, options.logger, 5_000);
  }

  async start(): Promise<string> {
    await this.options.channel.prefetch(1);
    const reply = await this.options.channel.consume(
      WALLET_CUSTODY_QUEUE,
      (message) => {
        if (!message) return;
        const work = this.handle(message).catch(() => {
          // A closed channel leaves the original unacknowledged for broker recovery.
          this.options.logger.warn('custody_delivery_channel_lost');
        });
        this.inFlight.add(work);
        void work.finally(() => this.inFlight.delete(work));
      },
      { noAck: false },
    );
    this.tag = reply.consumerTag;
    return this.tag;
  }

  async stop(): Promise<void> {
    if (this.tag) await this.options.channel.cancel(this.tag).catch(() => {});
    this.tag = undefined;
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        Promise.allSettled([...this.inFlight]),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 5_000);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async handle(message: ConsumeMessage): Promise<void> {
    const { channel, logger } = this.options;
    let event: ReturnType<(typeof SPECS)[number]['parse']>;
    let attempt = 0;
    const body = message.content.toString('utf8');
    try {
      if (message.content.byteLength > MAX_BODY_BYTES) throw new Error('MESSAGE_TOO_LARGE');
      const spec = SPECS.find((candidate) => candidate.eventType === message.fields.routingKey);
      if (!spec) throw new Error('EVENT_TYPE_INVALID');
      event = spec.parse(JSON.parse(body));
      if (
        message.properties.messageId !== event.eventId ||
        message.properties.type !== event.eventType ||
        message.properties.correlationId !== event.correlationId
      )
        throw new Error('MESSAGE_ENVELOPE_MISMATCH');
      if (message.fields.exchange === WALLET_CUSTODY_RETRY_EXCHANGE) {
        const header: unknown = message.properties.headers?.[WALLET_CUSTODY_RETRY_HEADER];
        if (
          typeof header !== 'number' ||
          !Number.isSafeInteger(header) ||
          header < 1 ||
          header > WALLET_CUSTODY_MAX_RETRIES
        )
          throw new Error('RETRY_METADATA_INVALID');
        attempt = header;
      } else if (message.fields.exchange !== BILLING_EVENTS_EXCHANGE) {
        throw new Error('EVENT_SOURCE_INVALID');
      }
    } catch {
      logger.warn('custody_delivery_rejected');
      channel.nack(message, false, false);
      return;
    }
    try {
      const outcome = await this.options.projector.project(event);
      await this.options.onBeforeAck?.(event.eventId, outcome);
      channel.ack(message);
    } catch {
      if (
        attempt >= WALLET_CUSTODY_MAX_RETRIES ||
        brokerDeliveryCount(message) >= WALLET_CUSTODY_MAX_RETRIES
      ) {
        logger.warn('custody_delivery_exhausted', { eventId: event.eventId });
        channel.nack(message, false, false);
        return;
      }
      try {
        await delay(this.options.retryDelayMs ?? 250);
        await this.publisher.publish({
          exchange: WALLET_CUSTODY_RETRY_EXCHANGE,
          routingKey: event.eventType,
          body,
          messageId: event.eventId,
          eventType: event.eventType,
          correlationId: event.correlationId,
          headers: { [WALLET_CUSTODY_RETRY_HEADER]: attempt + 1 },
        });
        channel.ack(message);
        this.options.onRetry?.(event.eventId, attempt + 1);
      } catch {
        // If retry publication cannot be confirmed, the original stays durable.
        channel.nack(message, false, true);
      }
    }
  }
}
