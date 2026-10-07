import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  HttpNotificationProvider,
  httpProviderFromEnv,
} from '../src/infrastructure/provider/http-notification.provider';
import type { ProviderSubmission } from '../src/ports/notification.ports';

const TOKEN = 'test-token-0123456789abcdef';
const SUBMISSION: ProviderSubmission = {
  idempotencyKey: 'cw-notification:6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b',
  channel: 'SMS',
  recipientRef: '0e1f4a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b',
  templateKey: 'booking.confirmed',
  templateVersion: 1,
  parameters: { slot: '10:30' },
};

type Handler = (req: IncomingMessage, res: ServerResponse, body: string) => void;

async function withServer(handler: Handler, fn: (url: URL) => Promise<void>): Promise<void> {
  const server = createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => (body += chunk));
    req.on('end', () => handler(req, res, body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(new URL(`http://127.0.0.1:${port}/send`));
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function provider(url: URL, idempotentSubmission = false) {
  return new HttpNotificationProvider({ endpoint: url, token: TOKEN, idempotentSubmission });
}

const reply =
  (status: number, body = ''): Handler =>
  (_req, res) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(body);
  };

test('http provider: a 2xx with a correlatable id is ACCEPTED and carries our idempotency key', async () => {
  let seen: { key?: string | undefined; auth?: string | undefined; body?: unknown } = {};
  await withServer(
    (req, res, body) => {
      seen = {
        key: req.headers['idempotency-key'] as string,
        auth: req.headers.authorization,
        body: JSON.parse(body) as unknown,
      };
      reply(202, '{"messageId":"prov-123"}')(req, res, body);
    },
    async (url) => {
      const outcome = await provider(url).submit(SUBMISSION, AbortSignal.timeout(2_000));
      assert.deepEqual(outcome, { kind: 'ACCEPTED', providerMessageId: 'prov-123' });
    },
  );
  assert.equal(seen.key, SUBMISSION.idempotencyKey);
  assert.equal(seen.auth, `Bearer ${TOKEN}`);
  assert.deepEqual(seen.body, {
    channel: 'SMS',
    recipientRef: SUBMISSION.recipientRef,
    template: { key: 'booking.confirmed', version: 1 },
    parameters: { slot: '10:30' },
  });
});

test('http provider: an uncorrelatable 2xx is AMBIGUOUS, not success', async () => {
  for (const body of ['', 'not json', '{"messageId":42}', `{"messageId":"${'x'.repeat(5000)}"}`])
    await withServer(reply(200, body), async (url) => {
      const outcome = await provider(url).submit(SUBMISSION, AbortSignal.timeout(2_000));
      assert.deepEqual(outcome, { kind: 'AMBIGUOUS', code: 'PROVIDER_RESPONSE_INVALID' });
    });
});

test('http provider: status codes are classified conservatively', async () => {
  const cases: [number, unknown][] = [
    [429, { kind: 'REJECTED', code: 'PROVIDER_REFUSED_429', retryable: true }],
    [401, { kind: 'REJECTED', code: 'PROVIDER_REFUSED_401', retryable: true }],
    [422, { kind: 'REJECTED', code: 'PROVIDER_REJECTED_422', retryable: false }],
    [500, { kind: 'AMBIGUOUS', code: 'PROVIDER_SERVER_500' }],
    [503, { kind: 'AMBIGUOUS', code: 'PROVIDER_SERVER_503' }],
  ];
  for (const [status, expected] of cases)
    await withServer(reply(status, '{}'), async (url) => {
      assert.deepEqual(
        await provider(url).submit(SUBMISSION, AbortSignal.timeout(2_000)),
        expected,
      );
    });
});

test('http provider: a provider that never answers is a timeout, i.e. AMBIGUOUS', async () => {
  await withServer(
    () => undefined, // accepts the request and never responds
    async (url) => {
      const started = Date.now();
      const outcome = await provider(url).submit(SUBMISSION, AbortSignal.timeout(300));
      assert.deepEqual(outcome, { kind: 'AMBIGUOUS', code: 'PROVIDER_TIMEOUT' });
      assert.ok(Date.now() - started < 2_000, 'the deadline is enforced');
    },
  );
});

test('http provider: a refused connection is provably NOT_SUBMITTED', async () => {
  let closedPort = 0;
  await withServer(reply(200), (url) => {
    closedPort = Number(url.port);
    return Promise.resolve();
  });
  const outcome = await provider(new URL(`http://127.0.0.1:${closedPort}/send`)).submit(
    SUBMISSION,
    AbortSignal.timeout(2_000),
  );
  assert.deepEqual(outcome, { kind: 'NOT_SUBMITTED', code: 'PROVIDER_UNREACHABLE' });
});

test('http provider: configuration fails closed and never echoes the token', () => {
  assert.throws(
    () =>
      new HttpNotificationProvider({
        endpoint: new URL('http://sms.example.com/'),
        token: TOKEN,
        idempotentSubmission: false,
      }),
    /PROVIDER_HTTPS_REQUIRED/,
  );
  assert.throws(
    () =>
      new HttpNotificationProvider({
        endpoint: new URL('https://u:p@sms.example.com/'),
        token: TOKEN,
        idempotentSubmission: false,
      }),
    /INVALID_PROVIDER_URL/,
  );
  assert.throws(
    () =>
      new HttpNotificationProvider({
        endpoint: new URL('https://sms.example.com/'),
        token: 'bad\ntoken',
        idempotentSubmission: false,
      }),
    (e: unknown) =>
      e instanceof Error && e.message === 'INVALID_PROVIDER_TOKEN' && !e.message.includes('bad'),
  );
  assert.throws(() => httpProviderFromEnv({}), /PROVIDER_NOT_CONFIGURED/);
  assert.throws(
    () =>
      httpProviderFromEnv({
        NOTIFICATION_PROVIDER_URL: 'https://sms.example.com/',
        NOTIFICATION_PROVIDER_TOKEN: TOKEN,
      }),
    /PROVIDER_IDEMPOTENCY_UNDECLARED/,
  );
  assert.equal(
    httpProviderFromEnv({
      NOTIFICATION_PROVIDER_URL: 'https://sms.example.com/',
      NOTIFICATION_PROVIDER_TOKEN: TOKEN,
      NOTIFICATION_PROVIDER_IDEMPOTENT: 'true',
    }).idempotentSubmission,
    true,
  );
});
