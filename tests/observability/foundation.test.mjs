import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { randomUUID, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
const require = createRequire(import.meta.url);
const packageRequire = createRequire(
  new URL('../../packages/observability/package.json', import.meta.url),
);
const {
  Telemetry,
  createLogger,
  redact,
  createMetrics,
  Registry,
  currentContext,
  traceHeaders,
  remoteContext,
  instrumentApplication,
} = require('../../packages/observability/dist/index.js');
const { InMemorySpanExporter } = packageRequire('@opentelemetry/sdk-trace-base');

for (const key of [
  'cookies',
  'Cookie',
  'set-cookie',
  'authorization',
  'refreshToken',
  'otp',
  'password',
  'paymentSecret',
  'restrictedDocumentId',
  'evidenceId',
  'body',
  'payload',
  'apiKey',
  'phone',
  'email',
]) {
  test(`redaction removes nested ${key}`, () => {
    const lines = [];
    const logger = createLogger({ service: 'test', sink: (line) => lines.push(line) });
    logger.info('event', { safe: { nested: [{ [key]: 'sensitive-sentinel-value' }] } });
    assert.equal(lines.length, 1);
    assert.ok(!lines[0].includes('sensitive-sentinel-value'));
  });
}
test('errors, buffers, accessors, cycles and hostile serialization cannot leak or throw', () => {
  let invoked = false;
  const obj = {
    error: new Error('sensitive-sentinel-value'),
    buffer: Buffer.from('sensitive-sentinel-value'),
    get trap() {
      invoked = true;
      throw new Error('accessor');
    },
    toJSON() {
      throw new Error('toJSON');
    },
  };
  obj.self = obj;
  const encoded = JSON.stringify(redact(obj));
  assert.equal(invoked, false);
  assert.ok(!encoded.includes('sensitive-sentinel-value'));
  assert.ok(encoded.includes('[CIRCULAR]'));
  const proxy = new Proxy(
    {},
    {
      ownKeys() {
        throw new Error('proxy');
      },
    },
  );
  assert.equal(redact(proxy), '[UNREADABLE]');
});
test('Pino output protects reserved provenance and rejects free-text messages', () => {
  const lines = [];
  const log = createLogger({
    service: 'catalog',
    environment: 'test',
    sink: (line) => lines.push(line),
  });
  log
    .child({ service: 'forged', environment: 'forged', traceId: 'forged' })
    .info('secret otp 123456', { msg: 'sensitive-sentinel-value', level: 'forged', ts: 'forged' });
  const value = JSON.parse(lines[0]);
  assert.equal(value.service, 'catalog');
  assert.equal(value.environment, 'test');
  assert.equal(value.level, 'info');
  assert.equal(value.msg, '[REDACTED]');
  assert.equal(value.traceId, undefined);
  assert.ok(!lines[0].includes('forged'));
});
test('failing sinks and clocks cannot break callers; synchronous flush terminates', async () => {
  for (const options of [
    {
      sink() {
        throw new Error('destination');
      },
    },
    {
      clock() {
        throw new Error('clock');
      },
      sink() {},
    },
  ]) {
    const logger = createLogger({ service: 'test', ...options });
    assert.doesNotThrow(() => logger.info('event'));
    await logger.flush();
  }
});
test('a shared registry survives duplicate factories and module reload', async () => {
  const registry = new Registry();
  const first = createMetrics('test', 'test', registry);
  assert.equal(first, createMetrics('test', 'test', registry));
  const path = require.resolve('../../packages/observability/dist/metrics.js');
  delete require.cache[path];
  const reloaded = require(path);
  assert.equal(first, reloaded.createMetrics('test', 'test', registry));
  first.http('GET', '/', 200, 0.01);
  const text = await registry.metrics();
  assert.equal(text.match(/# HELP cw_http_requests_total /g).length, 1);
});
test('unbounded paths, methods, outcomes and IDs never become metric labels', async () => {
  const metrics = createMetrics('test', 'test');
  for (let i = 0; i < 250; i++) {
    metrics.http(
      `private-${i}`,
      `/bookings/${randomUUID()}?token=sensitive-sentinel-value`,
      200,
      0.1,
    );
    metrics.event(`private-${i}`);
  }
  metrics.http('GET', '/health/ready', 503, 0.01);
  metrics.event('retry', 10);
  const text = await metrics.registry.metrics();
  assert.ok(!/private-|bookings|token=|requestId|correlationId|userId/.test(text));
  assert.ok(text.includes('route="application"'));
  assert.match(text, /cw_service_ready\{[^\n]+\} 0/);
  const counts = await metrics.registry.getSingleMetric('cw_http_requests_total').get();
  assert.equal(counts.values.length, 2);
});
test('actual pool gauges are collected without credentials and failures are isolated', async () => {
  const metrics = createMetrics('catalog', 'test');
  metrics.observePool(() => ({ totalCount: 4, idleCount: 3, waitingCount: 1 }));
  assert.match(
    await metrics.registry.metrics(),
    /cw_db_pool_connections\{state="waiting"[^\n]+\} 1/,
  );
  metrics.observePool(() => {
    throw new Error('database password sensitive-sentinel-value');
  });
  const text = await metrics.registry.metrics();
  assert.ok(!text.includes('sensitive-sentinel-value'));
});
test('W3C trace and correlation survive HTTP and messaging scopes; spans flush on shutdown', async () => {
  const exported = [];
  const exporter = {
    export(spans, done) {
      exported.push(...spans);
      done({ code: 0 });
    },
    shutdown: async () => {},
  };
  const lines = [];
  const options = { environment: 'test', exporter, sink: (line) => lines.push(JSON.parse(line)) };
  const gateway = new Telemetry({ service: 'gateway', ...options });
  const owner = new Telemetry({ service: 'catalog', ...options });
  const consumer = new Telemetry({ service: 'communications', ...options });
  const correlation = randomUUID();
  await gateway.run(
    'http.request',
    async () => {
      gateway.logger.info('accepted');
      const headers = traceHeaders();
      await owner.run(
        'http.request',
        async () => {
          owner.logger.info('received');
          await owner.run('messaging.publish', async () => {
            const carrier = traceHeaders();
            await consumer.run(
              'messaging.consume',
              async () => {
                consumer.logger.info('applied');
              },
              carrier,
            );
          });
        },
        headers,
      );
    },
    { 'x-correlation-id': correlation, baggage: 'password=sensitive-sentinel-value' },
  );
  await Promise.all([gateway.shutdown(), owner.shutdown(), consumer.shutdown()]);
  assert.equal(exported.length, 4);
  assert.equal(new Set(exported.map((span) => span.spanContext().traceId)).size, 1);
  assert.equal(new Set(lines.map((line) => line.traceId)).size, 1);
  assert.ok(lines.every((line) => line.correlationId === correlation));
  assert.equal(new Set(exported.map((span) => span.spanContext().spanId)).size, 4);
  assert.ok(!JSON.stringify(lines).includes('sensitive-sentinel-value'));
  assert.equal(currentContext(), undefined);
});
test('parallel requests have isolated async context', async () => {
  const telemetry = new Telemetry({ service: 'parallel', sink() {} });
  const ids = Array.from({ length: 20 }, () => randomUUID());
  await Promise.all(
    ids.map((id) =>
      telemetry.run(
        'http.request',
        async () => {
          await new Promise((resolve) => setImmediate(resolve));
          assert.equal(currentContext().correlationId, id);
        },
        { 'x-correlation-id': id },
      ),
    ),
  );
  await telemetry.shutdown();
});
test('remote unsampled trace remains unsampled and malformed trace headers are discarded', async () => {
  const exporter = new InMemorySpanExporter();
  const telemetry = new Telemetry({ service: 'sampling', exporter, sink() {} });
  const parent = '00-1234567890abcdef1234567890abcdef-1234567890abcdef-00';
  await telemetry.run(
    'http.request',
    async () => {
      assert.match(
        traceHeaders().traceparent,
        /^00-1234567890abcdef1234567890abcdef-[a-f0-9]{16}-00$/,
      );
      assert.equal(traceHeaders().baggage, undefined);
    },
    { traceparent: parent, tracestate: 'secret=value', baggage: 'private=value' },
  );
  await telemetry.shutdown();
  assert.equal(exporter.getFinishedSpans().length, 0);
  for (const bad of [
    '',
    parent.toUpperCase(),
    parent.replace('1234567890abcdef1234567890abcdef', '0'.repeat(32)),
    parent.replace('-00', '-ff'),
    'sensitive-sentinel-value',
  ]) {
    assert.equal(traceHeaders(remoteContext({ traceparent: bad })).traceparent, undefined);
  }
});
test('export failure and hung shutdown remain bounded, without swallowing business errors or retrying the callback', async () => {
  let calls = 0;
  const telemetry = new Telemetry({
    service: 'failed-export',
    flushTimeoutMs: 25,
    sink() {},
    exporter: {
      export(_spans, callback) {
        callback({ code: 1 });
      },
      shutdown: () => new Promise(() => {}),
    },
  });
  const failure = new Error('business-failed');
  await assert.rejects(
    telemetry.run('worker.run', async () => {
      calls++;
      throw failure;
    }),
    (error) => error === failure,
  );
  assert.equal(calls, 1);
  const before = performance.now();
  assert.equal(telemetry.shutdown(), telemetry.shutdown());
  await telemetry.shutdown();
  assert.ok(performance.now() - before < 1000);
});

async function application(service, env = {}) {
  let middleware;
  const server = createServer((request, response) => {
    middleware(request, response, () => {
      response.statusCode = request.url === '/health/ready' ? 503 : 200;
      response.end(JSON.stringify(traceHeaders()));
    });
  });
  const app = {
    use(value) {
      middleware = value;
    },
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
  const telemetry = instrumentApplication(app, service, env);
  assert.equal(instrumentApplication(app, service, env), telemetry);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { app, telemetry, url: `http://127.0.0.1:${server.address().port}` };
}
test('real HTTP exposes private authenticated metrics, preserves readiness and correlates responses', async () => {
  const token = randomBytes(32).toString('hex');
  const { app, url } = await application('http-foundation', {
    OBSERVABILITY_METRICS_TOKEN: token,
    NODE_ENV: 'test',
  });
  try {
    assert.equal((await fetch(`${url}/metrics`)).status, 404);
    assert.equal(
      (await fetch(`${url}/metrics`, { headers: { authorization: 'Bearer wrong' } })).status,
      404,
    );
    const correlation = randomUUID();
    const live = await fetch(`${url}/health/live`, {
      headers: { 'x-correlation-id': correlation, cookie: 'sensitive-sentinel-value' },
    });
    const body = await live.json();
    assert.equal(body['x-correlation-id'], correlation);
    assert.equal(live.headers.get('traceparent'), body.traceparent);
    assert.equal((await fetch(`${url}/health/ready`)).status, 503);
    const result = await fetch(`${url}/metrics`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(result.status, 200);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    const text = await result.text();
    assert.ok(!text.includes(token) && !text.includes('sensitive-sentinel-value'));
    assert.match(text, /cw_service_ready\{[^\n]+\} 0/);
  } finally {
    await app.close();
  }
});
test('metrics are disabled with missing or weak configuration and failed collectors return 503', async () => {
  const first = await application('disabled-metrics', { OBSERVABILITY_METRICS_TOKEN: 'weak' });
  try {
    assert.equal(
      (await fetch(`${first.url}/metrics`, { headers: { authorization: 'Bearer weak' } })).status,
      404,
    );
  } finally {
    await first.app.close();
  }
  const token = randomBytes(32).toString('hex');
  const second = await application('failed-metrics', { OBSERVABILITY_METRICS_TOKEN: token });
  second.telemetry.metrics.registry.metrics = async () => {
    throw new Error('secret');
  };
  try {
    assert.equal(
      (await fetch(`${second.url}/metrics`, { headers: { authorization: `Bearer ${token}` } }))
        .status,
      503,
    );
    assert.equal((await fetch(`${second.url}/health/live`)).status, 200);
  } finally {
    await second.app.close();
  }
});

// This exporter never invokes its completion callback: the outer shutdown budget
// must terminate independently of the OpenTelemetry batch processor timeout.
test('a hung exporter records a safe timeout and cannot hold service shutdown open', async () => {
  const lines = [];
  const telemetry = new Telemetry({
    service: 'hung-exporter',
    flushTimeoutMs: 20,
    sink: (line) => lines.push(JSON.parse(line)),
    exporter: { export() {}, shutdown: () => new Promise(() => {}) },
  });
  await telemetry.run('worker.run', async () => 42);
  const started = performance.now();
  await telemetry.shutdown();
  assert.ok(performance.now() - started < 500);
  assert.ok(lines.some((line) => line.msg === 'telemetry_flush_timeout'));
});

test('untrusted logger callbacks cannot replace HTTP errors or readiness responses', async () => {
  const {
    AppExceptionFilter,
    HealthController,
  } = require('../../packages/service-kit/dist/index.js');
  const logger = {
    warn() {
      throw new Error('sink');
    },
    error() {
      throw new Error('sink');
    },
  };
  let status;
  let body;
  const response = {
    status(code) {
      status = code;
      return this;
    },
    json(value) {
      body = value;
      return value;
    },
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ headers: {}, url: '/secret/private-id' }),
      getResponse: () => response,
    }),
  };
  assert.doesNotThrow(() => new AppExceptionFilter(logger).catch(new Error('business'), host));
  assert.equal(status, 500);
  assert.ok(!JSON.stringify(body).includes('business'));
  await new HealthController({ service: 'untrusted-logger', businessReady: false, logger }).ready(
    response,
  );
  assert.equal(status, 503);
});
