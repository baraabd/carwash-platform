import { bestEffortLog } from '@carwash/observability';
import { setTimeout as delay } from 'node:timers/promises';
import { BrokerConnection, type BrokerOptions } from './connection';
import { OutboxRelay, type OutboxRelayOptions, type RelayPass } from './outbox-relay';
import { ConfirmingPublisher } from './publisher';
import { assertTopology, type TopologySpec } from './topology';

export interface ReconnectingOutboxLoopOptions extends Omit<OutboxRelayOptions, 'publisher'> {
  readonly broker: BrokerOptions;
  readonly topology: TopologySpec;
  readonly signal: AbortSignal;
  readonly pollMs?: number;
  readonly confirmTimeoutMs?: number;
  readonly reconnectMinMs?: number;
  readonly reconnectMaxMs?: number;
  readonly onPass?: (result: RelayPass) => void | Promise<void>;
}

/**
 * Owner-neutral relay lifecycle. Every retry starts from durable, fenced rows;
 * there is no process-local success cache. Declare only producer-owned topology.
 * The lease must cover the entire sequential batch's confirm timeout budget.
 */
export async function runReconnectingOutboxLoop(
  options: ReconnectingOutboxLoopOptions,
): Promise<void> {
  const pollMs = options.pollMs ?? 250;
  const confirmTimeoutMs = options.confirmTimeoutMs ?? 5_000;
  const batchSize = options.batchSize ?? 20;
  const leaseMs = options.leaseMs ?? 120_000;
  const minBackoff = options.reconnectMinMs ?? 200;
  const maxBackoff = options.reconnectMaxMs ?? 5_000;
  if (
    ![pollMs, confirmTimeoutMs, batchSize, leaseMs, minBackoff, maxBackoff].every(
      (value) => Number.isSafeInteger(value) && value > 0,
    ) ||
    maxBackoff < minBackoff ||
    leaseMs <= batchSize * confirmTimeoutMs
  )
    throw new Error('INVALID_OUTBOX_LOOP_BUDGET');
  let backoff = minBackoff;
  while (!options.signal.aborted) {
    let connection: BrokerConnection | undefined;
    try {
      connection = await BrokerConnection.open(options.broker);
      let closed = false;
      connection.onClose(() => {
        closed = true;
      });
      await assertTopology(connection.channel, options.topology);
      const relay = new OutboxRelay({
        ...options,
        leaseMs,
        batchSize,
        publisher: new ConfirmingPublisher(
          connection.channel,
          options.logger,
          confirmTimeoutMs,
          options.telemetry,
        ),
      });
      while (!options.signal.aborted && !closed) {
        const result = await relay.runOnce(options.signal);
        await options.onPass?.(result);
        const failed = result.failed > 0 || result.leaseLost > 0;
        await delay(failed ? backoff : pollMs, undefined, { signal: options.signal });
        backoff = failed ? Math.min(backoff * 2, maxBackoff) : minBackoff;
      }
    } catch (error: unknown) {
      if (!options.signal.aborted)
        bestEffortLog(options.logger, 'warn', 'outbox_loop_unavailable', {
          error: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
          nextDelayMs: backoff,
        });
    } finally {
      await connection?.close();
    }
    if (options.signal.aborted) break;
    await delay(backoff, undefined, { signal: options.signal }).catch(() => {});
    backoff = Math.min(backoff * 2, maxBackoff);
  }
}
