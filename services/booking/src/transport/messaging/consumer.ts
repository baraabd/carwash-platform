import {
  createMessageConsumerAdapter,
  type ApplicationMessageHandler,
  type MessageConsumerAdapter,
} from '@carwash/service-kit';

/**
 * Message transport adapter for booking.
 *
 * It delegates to an application handler. Broker ACK/retry/DLQ behavior is not
 * guessed here; the messaging foundation owns those transport semantics.
 */
export function createServiceMessageConsumer<TPayload>(
  handler: ApplicationMessageHandler<TPayload>,
): MessageConsumerAdapter<TPayload> {
  return createMessageConsumerAdapter({ service: 'booking', handler });
}
