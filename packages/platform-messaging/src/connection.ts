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
  private closedState = false;
  private readonly closeListeners = new Set<() => void>();

  private constructor(
    private readonly model: ChannelModel,
    readonly channel: ConfirmChannel,
    private readonly logger: MessageLogger | undefined,
  ) {
    const notify = (): void => {
      if (this.closedState) return;
      this.closedState = true;
      for (const listener of this.closeListeners) listener();
      this.closeListeners.clear();
    };
    this.channel.once('close', notify);
    this.model.once('close', notify);
  }

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
    // Callers may subscribe after the close event raced with startup. In that
    // case notify on the next microtask instead of silently missing the signal.
    if (this.closedState) {
      queueMicrotask(listener);
      return;
    }
    this.closeListeners.add(listener);
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
