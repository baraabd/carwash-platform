import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import type { ConfirmChannel, ConsumeMessage } from '@carwash/platform-messaging';
import { CustodyBrokerConsumer } from '../src/transport/messaging/custody-broker.consumer';
import {
  WALLET_CUSTODY_MAX_RETRIES,
  WALLET_CUSTODY_RETRY_EXCHANGE,
  WALLET_CUSTODY_RETRY_HEADER,
} from '../src/transport/messaging/custody-topology';
import { collected } from './support/billing-events';

/** Channel double proves ACK ordering only; actual AMQP delivery has separate acceptance. */
class Channel extends EventEmitter {
  handler: ((message: ConsumeMessage | null) => void) | undefined;
  readonly acknowledgements: string[] = [];
  readonly requeues: boolean[] = [];
  readonly publications: { exchange: string; body: Buffer; options: Record<string, unknown> }[] =
    [];
  confirm: ((error: Error | null) => void) | undefined;
  prefetch(): Promise<void> {
    return Promise.resolve();
  }
  consume(_queue: string, handler: (message: ConsumeMessage | null) => void) {
    this.handler = handler;
    return Promise.resolve({ consumerTag: 'test-consumer' });
  }
  cancel(): Promise<void> {
    return Promise.resolve();
  }
  ack(message: ConsumeMessage): void {
    this.acknowledgements.push(String(message.properties.messageId));
  }
  nack(_message: ConsumeMessage, _all: boolean, requeue: boolean): void {
    this.requeues.push(requeue);
  }
  publish(
    exchange: string,
    _key: string,
    body: Buffer,
    options: Record<string, unknown>,
    callback: (error: Error | null) => void,
  ): boolean {
    this.publications.push({ exchange, body, options });
    this.confirm = callback;
    return true;
  }
}
const logger = { debug() {}, info() {}, warn() {}, error() {} };
function delivery(event: Record<string, unknown>, retry?: number): ConsumeMessage {
  return {
    content: Buffer.from(JSON.stringify(event)),
    fields: {
      routingKey: String(event.eventType),
      exchange: retry === undefined ? 'washgo.billing.events' : WALLET_CUSTODY_RETRY_EXCHANGE,
    },
    properties: {
      messageId: event.eventId,
      type: event.eventType,
      correlationId: event.correlationId,
      headers: retry === undefined ? {} : { [WALLET_CUSTODY_RETRY_HEADER]: retry },
    },
  } as unknown as ConsumeMessage;
}
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'adapter completed');
    await delay(1);
  }
}

test('custody broker adapter: ACK follows the committed owner projection', async () => {
  const channel = new Channel();
  const event = collected({});
  let commit: (() => void) | undefined;
  const consumer = new CustodyBrokerConsumer({
    channel: channel as unknown as ConfirmChannel,
    logger,
    projector: {
      project: () =>
        new Promise((resolve) => {
          commit = () => resolve({ outcome: 'APPLIED', eventId: String(event.eventId) });
        }),
    },
  });
  await consumer.start();
  channel.handler?.(delivery(event));
  await until(() => commit !== undefined);
  assert.equal(channel.acknowledgements.length, 0);
  commit?.();
  await until(() => channel.acknowledgements.length === 1);
  await consumer.stop();
});

test('custody broker adapter: deferred retry is persistent, bounded and confirmed before original ACK', async () => {
  const channel = new Channel();
  const event = collected({});
  const consumer = new CustodyBrokerConsumer({
    channel: channel as unknown as ConfirmChannel,
    logger,
    retryDelayMs: 1,
    projector: { project: () => Promise.reject(new Error('DEPENDENCY_MISSING')) },
  });
  await consumer.start();
  channel.handler?.(delivery(event, 2));
  await until(() => channel.publications.length === 1);
  assert.equal(channel.acknowledgements.length, 0);
  const publication = channel.publications[0];
  assert.ok(publication);
  assert.equal(publication.exchange, WALLET_CUSTODY_RETRY_EXCHANGE);
  assert.equal(publication.options.persistent, true);
  assert.equal(publication.options.mandatory, true);
  assert.equal(
    (publication.options.headers as Record<string, unknown>)[WALLET_CUSTODY_RETRY_HEADER],
    3,
  );
  channel.confirm?.(null);
  await until(() => channel.acknowledgements.length === 1);
  await consumer.stop();
});

test('custody broker adapter: retry publication failure keeps the original unacknowledged', async () => {
  const channel = new Channel();
  const event = collected({});
  const consumer = new CustodyBrokerConsumer({
    channel: channel as unknown as ConfirmChannel,
    logger,
    retryDelayMs: 1,
    projector: { project: () => Promise.reject(new Error('DATABASE_UNAVAILABLE')) },
  });
  await consumer.start();
  channel.handler?.(delivery(event));
  await until(() => channel.confirm !== undefined);
  channel.confirm?.(new Error('BROKER_NACK'));
  await until(() => channel.requeues.length === 1);
  assert.equal(channel.acknowledgements.length, 0);
  assert.deepEqual(channel.requeues, [true]);
  await consumer.stop();
});

test('custody broker adapter: exhausted durable retry budget is dead-lettered without effect', async () => {
  const channel = new Channel();
  const event = collected({});
  const consumer = new CustodyBrokerConsumer({
    channel: channel as unknown as ConfirmChannel,
    logger,
    projector: { project: () => Promise.reject(new Error('DEPENDENCY_MISSING')) },
  });
  await consumer.start();
  channel.handler?.(delivery(event, WALLET_CUSTODY_MAX_RETRIES));
  await until(() => channel.requeues.length === 1);
  assert.deepEqual(channel.requeues, [false]);
  assert.equal(channel.publications.length, 0);
  assert.equal(channel.acknowledgements.length, 0);
  await consumer.stop();
});

test('custody broker adapter: transport/envelope disagreement is rejected before the owner is called', async () => {
  const channel = new Channel();
  const event = collected({});
  let calls = 0;
  const consumer = new CustodyBrokerConsumer({
    channel: channel as unknown as ConfirmChannel,
    logger,
    projector: {
      project: () => {
        calls += 1;
        return Promise.resolve({ outcome: 'APPLIED', eventId: String(event.eventId) });
      },
    },
  });
  const message = delivery(event);
  message.properties.messageId = 'foreign-message';
  await consumer.start();
  channel.handler?.(message);
  await until(() => channel.requeues.length === 1);
  assert.equal(calls, 0);
  assert.deepEqual(channel.requeues, [false]);
  await consumer.stop();
});
