import test from 'node:test';
import assert from 'node:assert/strict';
import { serviceKit } from './_load.mjs';

const {
  createLogger,
  redact,
  REDACTED,
  parsePort,
  loadServiceRuntimeConfig,
  resolveCorrelationId,
  CORRELATION_HEADER,
  databaseSchemaFromUrl,
} = serviceKit;

/** Capture emitted lines instead of writing to the real stream. */
function capture(options = {}) {
  const lines = [];
  const logger = createLogger({
    service: 'test-service',
    sink: (line) => lines.push(line),
    clock: () => new Date('2026-09-20T00:00:00.000Z'),
    ...options,
  });
  return { logger, lines, records: () => lines.map((l) => JSON.parse(l)) };
}

test('logger: emits one parseable JSON object per call', () => {
  const { logger, records } = capture();
  logger.info('service_started', { port: 3000 });
  const [record] = records();
  assert.equal(record.level, 'info');
  assert.equal(record.service, 'test-service');
  assert.equal(record.msg, 'service_started');
  assert.equal(record.port, 3000);
  assert.equal(record.ts, '2026-09-20T00:00:00.000Z');
});

test('logger: level threshold suppresses lower levels', () => {
  const { logger, lines } = capture({ level: 'warn' });
  logger.debug('d');
  logger.info('i');
  logger.warn('w');
  logger.error('e');
  assert.equal(lines.length, 2);
});

test('logger: child loggers inherit and extend base fields', () => {
  const { logger, records } = capture();
  logger.child({ component: 'relay' }).child({ workerId: 'w1' }).info('pass');
  const [record] = records();
  assert.equal(record.component, 'relay');
  assert.equal(record.workerId, 'w1');
});

test('redaction: secret-looking keys never reach the output', () => {
  const { logger, records } = capture();
  logger.info('config', {
    password: 'hunter2',
    apiKey: 'abc',
    DATABASE_URL: 'postgresql://u:p@h/db',
    authorization: 'Bearer x',
    safe: 'kept',
  });
  const [record] = records();
  assert.equal(record.password, REDACTED);
  assert.equal(record.apiKey, REDACTED);
  assert.equal(record.DATABASE_URL, REDACTED);
  assert.equal(record.authorization, REDACTED);
  assert.equal(record.safe, 'kept');
});

test('redaction: reaches secrets nested inside objects and arrays', () => {
  const { logger, records } = capture();
  logger.info('nested', {
    outer: { inner: { deeper: { secret: 'shh', ok: 1 } } },
    list: [{ token: 't1' }, { token: 't2' }],
  });
  const [record] = records();
  assert.equal(record.outer.inner.deeper.secret, REDACTED);
  assert.equal(record.outer.inner.deeper.ok, 1);
  assert.equal(record.list[0].token, REDACTED);
  assert.equal(record.list[1].token, REDACTED);
});

test('redaction: credentials inside a connection string are stripped', () => {
  // The dangerous case: a DSN arriving under an innocuous key name.
  const value = redact({
    note: 'connect via postgresql://appuser:sup3rs3cret@db.internal:5432/cw',
  });
  assert.ok(!JSON.stringify(value).includes('sup3rs3cret'));
  assert.match(value.note, /postgresql:\/\/appuser:\[REDACTED\]@db\.internal/);
});

test('redaction: amqp credentials are stripped too', () => {
  const value = redact({ broker: 'amqp://cw_catalog_app:brokerPass123@127.0.0.1:5672/vhost' });
  assert.ok(!JSON.stringify(value).includes('brokerPass123'));
});

test('redaction: message text is scrubbed, not only fields', () => {
  const { logger, records } = capture();
  logger.error('failed on postgresql://u:leakedpw@h:5432/db');
  assert.ok(!records()[0].msg.includes('leakedpw'));
});

test('redaction: circular references do not crash the logger', () => {
  const { logger, records } = capture();
  const a = { name: 'a' };
  a.self = a;
  logger.info('circular', { a });
  assert.equal(records()[0].a.self, '[CIRCULAR]');
});

test('redaction: excessive nesting is truncated rather than followed forever', () => {
  let deep = { end: true };
  for (let i = 0; i < 30; i += 1) deep = { deep };
  const value = redact(deep);
  assert.ok(JSON.stringify(value).includes('[TRUNCATED_DEPTH]'));
});

test('redaction: Error objects expose name and message only', () => {
  const value = redact({ error: new Error('boom at postgresql://u:p@h/db') });
  assert.equal(value.error.name, 'Error');
  assert.ok(!value.error.message.includes(':p@'));
  assert.equal(value.error.stack, undefined);
});

test('config: a valid port is parsed', () => {
  assert.equal(parsePort('8080', 3000), 8080);
  assert.equal(parsePort(undefined, 3000), 3000);
  assert.equal(parsePort('', 3000), 3000);
});

for (const bad of ['0', '65536', '-1', 'abc', '3000abc', '3.5', ' 80']) {
  test(`config: rejects invalid port ${JSON.stringify(bad)}`, () => {
    assert.throws(() => parsePort(bad, 3000), /INVALID_PORT/);
  });
}

test('config: fails closed on an unknown log level', () => {
  assert.throws(
    () => loadServiceRuntimeConfig('catalog', { LOG_LEVEL: 'verbose' }),
    /INVALID_LOG_LEVEL/,
  );
});

test('config: defaults bind to loopback, never all interfaces', () => {
  assert.equal(loadServiceRuntimeConfig('catalog', {}).host, '127.0.0.1');
});

test('correlation: a well-formed caller id is preserved', () => {
  const id = '123e4567-e89b-42d3-a456-426614174000';
  assert.equal(resolveCorrelationId(id), id);
});

for (const bad of ['not-a-uuid', '', 42, null, undefined, {}, '../../etc/passwd', '<script>']) {
  test(`correlation: untrusted header ${JSON.stringify(bad)} is replaced, not echoed`, () => {
    const value = resolveCorrelationId(bad);
    assert.notEqual(value, bad);
    assert.match(
      value,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
}

test('correlation: header name is the documented one', () => {
  assert.equal(CORRELATION_HEADER, 'x-correlation-id');
});

test('database: schema is taken from the DSN query string', () => {
  assert.equal(databaseSchemaFromUrl('postgresql://u:p@h:5432/db?schema=app'), 'app');
  assert.equal(databaseSchemaFromUrl('postgresql://u:p@h:5432/db?schema=custom'), 'custom');
});

test('database: a DSN without a schema falls back to app, never public', () => {
  // Falling back to `public` would silently run with privileges the application
  // role does not have, and fail much later with a confusing error.
  assert.equal(databaseSchemaFromUrl('postgresql://u:p@h:5432/db'), 'app');
  assert.equal(databaseSchemaFromUrl('not a url'), 'app');
});
