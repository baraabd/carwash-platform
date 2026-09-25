import { resolveCorrelationId } from './correlation';
import { errorStatusOf, toErrorResponse } from './errors';
import { createLogger, type Logger } from './logging';

export interface ApplicationMessage<TPayload = unknown> {
  readonly id: string;
  readonly type: string;
  readonly payload: TPayload;
  readonly correlationId?: string;
}

export interface ApplicationMessageHandler<TPayload = unknown> {
  handle(message: ApplicationMessage<TPayload>): Promise<void>;
}

export type ConsumerResult =
  | { readonly kind: 'handled'; readonly correlationId: string }
  | {
      readonly kind: 'failed';
      readonly correlationId: string;
      readonly code: string;
      readonly status: number;
      readonly retryable: boolean;
    };

export interface MessageConsumerAdapter<TPayload = unknown> {
  consume(message: ApplicationMessage<TPayload>): Promise<ConsumerResult>;
}

export interface MessageConsumerAdapterOptions<TPayload = unknown> {
  readonly service: string;
  readonly handler: ApplicationMessageHandler<TPayload>;
  readonly logger?: Logger;
}

/**
 * Transport adapter only: it invokes the application handler and classifies the
 * outcome. Broker ACK/retry/DLQ policy stays with the broker adapter so bounded
 * retries can be implemented explicitly by the messaging foundation.
 */
export function createMessageConsumerAdapter<TPayload = unknown>(
  options: MessageConsumerAdapterOptions<TPayload>,
): MessageConsumerAdapter<TPayload> {
  const logger = options.logger ?? createLogger({ service: options.service });
  return {
    async consume(message): Promise<ConsumerResult> {
      const correlationId = resolveCorrelationId(message.correlationId);
      try {
        await options.handler.handle({ ...message, correlationId });
        return { kind: 'handled', correlationId };
      } catch (error: unknown) {
        const body = toErrorResponse(error, correlationId);
        const status = errorStatusOf(error);
        const retryable = status === 429 || status >= 500;
        logger.warn('message_handler_failed', {
          messageId: message.id,
          messageType: message.type,
          correlationId,
          code: body.error.code,
          status,
          retryable,
          error,
        });
        return {
          kind: 'failed',
          correlationId,
          code: body.error.code,
          status,
          retryable,
        };
      }
    },
  };
}
