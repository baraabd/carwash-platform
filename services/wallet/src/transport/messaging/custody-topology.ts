import { BILLING_EVENTS_EXCHANGE } from '@carwash/event-contracts';
import type { TopologySpec } from '@carwash/platform-messaging';
import { WALLET_CUSTODY_BINDINGS, WALLET_CUSTODY_QUEUE } from './consumer';

export const WALLET_CUSTODY_RETRY_EXCHANGE = 'wallet.billing-custody.retry';
export const WALLET_CUSTODY_DLX = 'wallet.billing-custody.dlx';
export const WALLET_CUSTODY_DLQ = 'wallet.billing-custody.dlq';
export const WALLET_CUSTODY_RETRY_HEADER = 'x-wallet-custody-attempt';
export const WALLET_CUSTODY_MAX_RETRIES = 10;

/** Wallet declares its resources and binds; it cannot declare or publish Billing's exchange. */
export const walletCustodyTopology: TopologySpec = {
  exchanges: [
    { name: WALLET_CUSTODY_RETRY_EXCHANGE, type: 'direct' },
    { name: WALLET_CUSTODY_DLX, type: 'topic' },
  ],
  queues: [
    {
      name: WALLET_CUSTODY_QUEUE,
      queueType: 'quorum',
      deliveryLimit: WALLET_CUSTODY_MAX_RETRIES,
      deadLetterExchange: WALLET_CUSTODY_DLX,
      deadLetterRoutingKey: 'custody',
    },
    { name: WALLET_CUSTODY_DLQ, queueType: 'quorum' },
  ],
  bindings: [
    ...WALLET_CUSTODY_BINDINGS.flatMap((routingKey) => [
      { queue: WALLET_CUSTODY_QUEUE, exchange: BILLING_EVENTS_EXCHANGE, routingKey },
      { queue: WALLET_CUSTODY_QUEUE, exchange: WALLET_CUSTODY_RETRY_EXCHANGE, routingKey },
    ]),
    { queue: WALLET_CUSTODY_DLQ, exchange: WALLET_CUSTODY_DLX, routingKey: '#' },
  ],
};
