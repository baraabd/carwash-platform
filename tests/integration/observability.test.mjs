import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  serviceClient,
  resetSlice,
  createProbe,
  spawnWorker,
  relayArgs,
  relayEnv,
  consumerArgs,
  consumerEnv,
} from './_support.mjs';
const require = createRequire(import.meta.url);
const { instrumentApplication } = require('../../packages/observability/dist/index.js');
async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}
async function close(server) {
  await new Promise((resolve) => server.close(resolve));
}

test(
  'F008 real HTTP -> PostgreSQL outbox -> restarted relay -> RabbitMQ -> consumer trace',
  { timeout: 90000 },
  async () => {
    const clients = {
      catalog: serviceClient('catalog'),
      communications: serviceClient('communications'),
      reporting: serviceClient('reporting'),
    };
    const collected = [];
    const collector = createServer((request, response) => {
      const chunks = [];
      request.on('data', (chunk) => chunks.push(chunk));
      request.on('end', () => {
        try {
          collected.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end('{}');
        } catch {
          response.statusCode = 400;
          response.end();
        }
      });
    });
    const collectorUrl = await listen(collector);
    const endpoint = `${collectorUrl}/v1/traces`;
    let middleware;
    const producer = createServer((request, response) =>
      middleware(request, response, () => {
        // A test-only HTTP transport invokes the real owner-local transactional producer.
        // This does not introduce a public business API into the foundation shell.
        void createProbe(clients.catalog, { label: 'probe-f008-context' })
          .then((value) => {
            response.setHeader('content-type', 'application/json');
            response.end(JSON.stringify(value));
          })
          .catch(() => {
            response.statusCode = 500;
            response.end();
          });
      }),
    );
    const app = {
      use(handler) {
        middleware = handler;
      },
      close: () => close(producer),
    };
    instrumentApplication(app, 'catalog', {
      NODE_ENV: 'test',
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: endpoint,
    });
    const producerUrl = await listen(producer);
    let consumer;
    let relay;
    let producerClosed = false;
    try {
      await resetSlice(clients);
      const traceId = randomBytes(16).toString('hex');
      const correlationId = randomUUID();
      const response = await fetch(producerUrl, {
        headers: {
          traceparent: `00-${traceId}-${randomBytes(8).toString('hex')}-01`,
          'x-correlation-id': correlationId,
          cookie: 'private-sentinel-cookie',
        },
      });
      assert.equal(response.status, 200);
      const event = await response.json();
      const persisted = await clients.catalog.outboxMessage.findUnique({
        where: { eventId: event.eventId },
      });
      assert.equal(persisted.traceParent, response.headers.get('traceparent'));
      assert.equal(event.correlationId, correlationId);
      assert.ok(
        !JSON.parse(persisted.payload).traceparent,
        'transport metadata must not alter the business contract',
      );
      // The request context and the producer's tracer are gone before a separate process publishes.
      await app.close();
      producerClosed = true;
      const traceEnv = { OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: endpoint, NODE_ENV: 'test' };
      consumer = spawnWorker(
        consumerArgs('communications', ['--stop-after', '1']),
        consumerEnv('communications', traceEnv),
      );
      await consumer.waitFor((line) => line.event === 'consumer_started');
      relay = spawnWorker(relayArgs(['--once']), relayEnv(traceEnv));
      const committed = await consumer.waitFor(
        (line) => line.event === 'consumer_committed' && line.eventId === event.eventId,
      );
      assert.equal(committed.traceId, traceId);
      assert.equal(committed.correlationId, correlationId);
      assert.equal(committed.service, 'communications');
      assert.equal((await relay.exited).code, 0);
      assert.equal((await consumer.exited).code, 0);
      const spans = collected
        .flatMap((batch) => batch.resourceSpans ?? [])
        .flatMap((resource) => (resource.scopeSpans ?? []).flatMap((scope) => scope.spans ?? []));
      const chain = spans.filter((span) => span.traceId === traceId);
      for (const operation of ['http.request', 'messaging.publish', 'messaging.consume'])
        assert.ok(
          chain.some((span) => span.name === operation),
          `missing flushed ${operation} span`,
        );
      const publish = chain.find((span) => span.name === 'messaging.publish');
      const consume = chain.find((span) => span.name === 'messaging.consume');
      assert.equal(publish.parentSpanId, persisted.traceParent.split('-')[2]);
      assert.equal(consume.parentSpanId, publish.spanId);
      assert.ok(!JSON.stringify(collected).includes('private-sentinel-cookie'));
      assert.ok(
        !JSON.stringify([...relay.lines, ...consumer.lines]).includes('private-sentinel-cookie'),
      );
      const applied = await clients.communications.probeNotification.findUnique({
        where: { probeId: event.probeId },
      });
      assert.equal(applied.applyCount, 1);
    } finally {
      await relay?.stop();
      await consumer?.stop();
      if (!producerClosed) await app.close();
      await close(collector);
      await Promise.all(Object.values(clients).map((client) => client.$disconnect()));
    }
  },
);
