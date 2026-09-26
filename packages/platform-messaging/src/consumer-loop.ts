import { setTimeout as delay } from 'node:timers/promises';
import type { ConfirmChannel } from 'amqplib';
import { BrokerConnection, type BrokerOptions } from './connection';
import { InboxConsumer, type ParsedEvent } from './inbox-consumer';
import { assertTopology, type TopologySpec } from './topology';
import type { MessageLogger } from './types';

export interface ReconnectingInboxLoopOptions<T extends ParsedEvent> {
  readonly broker: BrokerOptions;
  readonly topology: TopologySpec;
  readonly signal: AbortSignal;
  readonly createConsumer: (channel: ConfirmChannel) => InboxConsumer<T>;
  readonly logger?: MessageLogger;
  readonly reconnectMinMs?: number;
  readonly reconnectMaxMs?: number;
  readonly onConnected?: (input: {
    readonly consumer: InboxConsumer<T>;
    readonly connectionNumber: number;
  }) => void | Promise<void>;
  readonly onDisconnected?: (input: { readonly connectionNumber: number }) => void | Promise<void>;
  readonly onUnavailable?: (input: {
    readonly error: unknown;
    readonly nextDelayMs: number;
  }) => void | Promise<void>;
}

async function waitForCloseOrAbort(
  connection: BrokerConnection,
  signal: AbortSignal,
): Promise<'closed' | 'aborted'> {
  if (signal.aborted) return 'aborted';
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: 'closed' | 'aborted'): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      resolve(value);
    };
    const onAbort = (): void => finish('aborted');
    signal.addEventListener('abort', onAbort, { once: true });
    connection.onClose(() => finish('closed'));
  });
}

/**
 * Keep one InboxConsumer attached to RabbitMQ and recreate the whole
 * connection/channel/consumer session after a broker or channel loss.
 *
 * Durable queue state, redelivery counters and unacked messages live in
 * RabbitMQ, not in this loop. Reconnection therefore resumes the same
 * at-least-once stream instead of inventing process-local delivery state.
 */
export async function runReconnectingInboxLoop<T extends ParsedEvent>(
  options: ReconnectingInboxLoopOptions<T>,
): Promise<void> {
  const minBackoff = options.reconnectMinMs ?? 200;
  const maxBackoff = options.reconnectMaxMs ?? 5_000;
  if (
    !Number.isInteger(minBackoff) ||
    !Number.isInteger(maxBackoff) ||
    minBackoff < 1 ||
    maxBackoff < minBackoff
  ) {
    throw new Error('INVALID_RECONNECT_BACKOFF');
  }

  let connectionNumber = 0;
  let backoffMs = minBackoff;

  while (!options.signal.aborted) {
    let connection: BrokerConnection | undefined;
    let consumer: InboxConsumer<T> | undefined;

    try {
      connection = await BrokerConnection.open(options.broker);
      await assertTopology(connection.channel, options.topology);
      consumer = options.createConsumer(connection.channel);
      await consumer.start();

      connectionNumber += 1;
      backoffMs = minBackoff;
      await options.onConnected?.({ consumer, connectionNumber });

      const outcome = await waitForCloseOrAbort(connection, options.signal);
      if (outcome === 'closed' && !options.signal.aborted) {
        options.logger?.warn('inbox_broker_disconnected', { connectionNumber });
        await options.onDisconnected?.({ connectionNumber });
      }
    } catch (error: unknown) {
      if (options.signal.aborted) break;
      options.logger?.warn('inbox_broker_unavailable', {
        error: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
        nextDelayMs: backoffMs,
      });
      await options.onUnavailable?.({ error, nextDelayMs: backoffMs });
    } finally {
      await consumer?.stop().catch(() => {});
      await connection?.close();
    }

    if (options.signal.aborted) break;

    await delay(backoffMs, undefined, { signal: options.signal }).catch(() => {});
    backoffMs = Math.min(backoffMs * 2, maxBackoff);
  }
}
