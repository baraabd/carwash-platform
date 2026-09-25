import { connect, type ChannelModel, type ConfirmChannel } from 'amqplib';
import type { MessageLogger } from './types';

/**
 * A single AMQP connection with an explicit confirm channel.
 *
 * Reconnection is explicit rather than implicit: callers are told when the
 * connection dropped so that in-flight work is retried from durable state
 * (outbox / unacknowledged deliveries) instead of being assumed to have
 * survived.
 */

export interface BrokerOptions {
  readonly url: string;
  /** Shown in the RabbitMQ management UI; never contains credentials. */
  readonly connectionName: string;
  readonly heartbeatSeconds?: number;
  readonly logger?: MessageLogger;
}

export class BrokerConnection {
  private constructor(
    private readonly model: ChannelModel,
    readonly channel: ConfirmChannel,
    private readonly logger: MessageLogger | undefined,
  ) {}

  static async open(options: BrokerOptions): Promise<BrokerConnection> {
    const url = new URL(options.url);
    url.searchParams.set('heartbeat', String(options.heartbeatSeconds ?? 10));
    const model = await connect(url.toString(), {
      clientProperties: { connection_name: options.connectionName },
    });
    const channel = await model.createConfirmChannel();
    // Unhandled 'error' on an EventEmitter would crash the process; the caller
    // learns about the failure through closed()/onClose instead.
    model.on('error', (error: Error) =>
      options.logger?.warn('broker_connection_error', { error: error.name }),
    );
    channel.on('error', (error: Error) =>
      options.logger?.warn('broker_channel_error', { error: error.name }),
    );
    return new BrokerConnection(model, channel, options.logger);
  }

  onClose(listener: () => void): void {
    this.model.on('close', listener);
  }

  async close(): Promise<void> {
    try {
      await this.channel.close();
    } catch (error: unknown) {
      this.logger?.debug('broker_channel_close_failed', {
        error: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
      });
    }
    try {
      await this.model.close();
    } catch (error: unknown) {
      this.logger?.debug('broker_connection_close_failed', {
        error: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
      });
    }
  }
}
