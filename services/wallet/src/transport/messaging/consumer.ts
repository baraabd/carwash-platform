import {
  createMessageConsumerAdapter,
  type ApplicationMessageHandler,
  type MessageConsumerAdapter,
} from '@carwash/service-kit';

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
 * Broker binding state for the billing.v1 custody events. Binding needs the
 * `@carwash/platform-messaging` dependency (lockfile owned by Lane E,
 * CONTRACT_REQUEST_E_WALLET CR-B-P06-WAL-01), so no queue is consumed yet and the
 * projection receives no live events. Readiness stays false meanwhile.
 */
export const BILLING_EVENTS_BINDING = 'NOT_BOUND' as const;
