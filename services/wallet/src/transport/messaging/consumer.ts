import {
  AppError,
  createLogger,
  createMessageConsumerAdapter,
  type ApplicationMessage,
  type ApplicationMessageHandler,
  type MessageConsumerAdapter,
} from '@carwash/service-kit';
import { CONSUMED_EVENT_TYPES, type CustodyProjector } from '../../application';
import { ProjectionDeferred } from '../../domain';

/**
 * Message transport adapter for wallet.
 *
 * It delegates to an application handler. Broker ACK/retry/DLQ behavior is not
 * guessed here; the messaging foundation owns those transport semantics.
 */
export function createServiceMessageConsumer<TPayload>(
  handler: ApplicationMessageHandler<TPayload>,
): MessageConsumerAdapter<TPayload> {
  return createMessageConsumerAdapter({ service: 'wallet', handler });
}

/**
 * Proposed queue for the Billing custody events (CR-B-12.3). The runtime broker
 * binding is Lane E's: Wallet has no broker dependency until E adds it.
 */
export const WALLET_CUSTODY_QUEUE = 'wallet.billing-custody.v1';
export const WALLET_CUSTODY_BINDINGS = CONSUMED_EVENT_TYPES;

/**
 * Application handler for Billing custody events. The payload is the raw
 * envelope-v2 JSON object. Classification for the broker adapter:
 *  - applied / stale / duplicate / rejected -> handled (ack); rejected is
 *    recorded in the inbox and logged, never retried;
 *  - deferred (an earlier event has not been projected) -> retryable 503
 *    (nack + requeue, dead-letter by the broker's bounded policy).
 */
export class BillingCustodyEventHandler implements ApplicationMessageHandler<unknown> {
  private readonly logger = createLogger({
    service: 'wallet',
    base: { component: 'custody-inbox' },
  });

  constructor(private readonly projector: CustodyProjector) {}

  async handle(message: ApplicationMessage<unknown>): Promise<void> {
    try {
      const result = await this.projector.project(message.payload);
      this.logger.info('custody_event_projected', {
        messageId: message.id,
        messageType: message.type,
        correlationId: message.correlationId,
        outcome: result.outcome,
        reason: result.outcome === 'REJECTED' ? result.reason : null,
      });
    } catch (error: unknown) {
      if (error instanceof ProjectionDeferred)
        throw new AppError({
          status: 503,
          code: 'PROJECTION_DEFERRED',
          message: 'The event depends on an earlier event that has not been projected yet.',
          details: { reason: error.reason },
        });
      throw error;
    }
  }
}

export function createCustodyEventConsumer(
  projector: CustodyProjector,
): MessageConsumerAdapter<unknown> {
  return createServiceMessageConsumer(new BillingCustodyEventHandler(projector));
}
