import { HoldChangeHandler, parseHoldChanged, type HoldChangedMessage } from '../../application';
import { PrismaInboxStore } from '../../infrastructure/messaging/prisma-inbox.store';
import type { PrismaDispatchStore } from '../../infrastructure/persistence/prisma-dispatch.store';
import type { Clock, DispatchTransaction, IdGenerator } from '../../ports';

/** Published source of the jobs Dispatch works on (Scheduling's topic exchange). */
export const SCHEDULING_EVENTS_EXCHANGE = 'scheduling.events';
export const HOLD_CHANGED_ROUTING_KEY = 'scheduling.hold-changed.v1';

/**
 * The three parts the shared `InboxConsumer` (@carwash/platform-messaging)
 * needs: the published parser, the inbox store and the effect. A permanently
 * invalid message fails `parse` and is dead-lettered; the effect runs inside
 * the inbox transaction; the broker ACK follows the commit.
 *
 * The long-running consumer PROCESS is not wired here because amqplib and the
 * messaging package are not dependencies of this service (lockfile is Lane
 * E's; CR-P02-C3 §2). The parts are exercised against real RabbitMQ by
 * tests/production/C/dispatch-inbox-rabbitmq.test.mjs.
 */
export function holdChangedConsumerParts(
  store: PrismaDispatchStore,
  clock: Clock,
  ids: IdGenerator,
): {
  readonly parse: (raw: unknown) => HoldChangedMessage;
  readonly store: PrismaInboxStore;
  readonly effect: (message: HoldChangedMessage, tx: DispatchTransaction) => Promise<string>;
} {
  const handler = new HoldChangeHandler(clock, ids);
  return {
    parse: parseHoldChanged,
    store: new PrismaInboxStore(store),
    effect: (message, tx) => handler.apply(tx, message),
  };
}
