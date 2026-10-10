import {
  EligibilityChangeHandler,
  parseEligibilityChanged,
  type EligibilityChangedMessage,
} from '../../application';
import { PrismaInboxStore } from '../../infrastructure/messaging/prisma-inbox.store';
import type { PrismaDispatchStore } from '../../infrastructure/persistence/prisma-dispatch.store';
import type { Clock, DispatchTransaction, IdGenerator } from '../../ports';

/** Published source of eligibility changes (Workforce's topic exchange). */
export const WORKFORCE_EVENTS_EXCHANGE = 'workforce.events';
export const ELIGIBILITY_CHANGED_ROUTING_KEY = 'workforce.eligibility-changed.v1';

/**
 * Parts for the shared `InboxConsumer` (@carwash/platform-messaging), exactly
 * like `holdChangedConsumerParts`: published parser, inbox store, effect in the
 * inbox transaction. The long-running process waits for CR-P02-C3 §2.
 */
export function eligibilityChangedConsumerParts(
  store: PrismaDispatchStore,
  clock: Clock,
  ids: IdGenerator,
): {
  readonly parse: (raw: unknown) => EligibilityChangedMessage;
  readonly store: PrismaInboxStore;
  readonly effect: (message: EligibilityChangedMessage, tx: DispatchTransaction) => Promise<string>;
} {
  const handler = new EligibilityChangeHandler(clock, ids);
  return {
    parse: parseEligibilityChanged,
    store: new PrismaInboxStore(store),
    effect: (message, tx) => handler.apply(tx, message),
  };
}
