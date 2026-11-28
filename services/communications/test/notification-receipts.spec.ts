import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { signProviderNotification } from '@carwash/service-kit';
import { NotificationAdministration } from '../src/application/notification.service';
import {
  ConnectorReceiptVerifier,
  RECEIPT_SCHEMA,
  ReceiptIngressError,
  receiptVerifierFromEnv,
} from '../src/infrastructure/provider/connector-receipts';
import { createHttpApplication } from '../src/transport/http/create-app';
import { NOTIFICATION_RECEIPTS_V1 } from '../src/transport/http/notification-receipts.http';
import { NotificationReceiptsController } from '../src/transport/http/notification-receipts.controller';

const KEY = randomBytes(48);
const NOW = new Date('2026-11-28T12:00:00.000Z');
const CONNECTOR = 'isolated-receipt-test';
const ID = '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b';
const body = (changes: Record<string, unknown> = {}) =>
  Buffer.from(
    JSON.stringify({
      schema: RECEIPT_SCHEMA,
      connectorId: CONNECTOR,
      notificationId: ID,
      submissionKey: `cw-notification:${ID}`,
      providerMessageId: 'message-123',
      receipt: 'DELIVERED',
      ...changes,
    }),
  );
const signed = (rawBody: Buffer, at = NOW, receiptId = randomUUID(), secret = KEY) =>
  signProviderNotification({ rawBody, at, notificationId: receiptId, secret });
const verifier = new ConnectorReceiptVerifier(CONNECTOR, KEY);
const refuses = (fn: () => unknown, status: number) =>
  assert.throws(
    fn,
    (error: unknown) => error instanceof ReceiptIngressError && error.status === status,
  );

test('receipt verifier authenticates exact bytes, signed replay identity and connector before parsing', () => {
  const rawBody = body();
  const headers = signed(rawBody);
  const fact = verifier.verify({ rawBody, headers, now: NOW });
  assert.equal(fact.receiptId, headers['x-provider-notification-id']);
  assert.equal(fact.notificationId, ID);
  assert.equal(fact.payloadHash, createHash('sha256').update(rawBody).digest('hex'));
  assert.equal(fact.receipt, 'DELIVERED');
  refuses(
    () =>
      verifier.verify({
        rawBody,
        headers: signed(rawBody, NOW, randomUUID(), randomBytes(48)),
        now: NOW,
      }),
    401,
  );
  refuses(() => verifier.verify({ rawBody: body({ receipt: 'FAILED' }), headers, now: NOW }), 401);
  refuses(
    () =>
      verifier.verify({
        rawBody,
        headers: { ...headers, 'x-provider-notification-id': randomUUID() },
        now: NOW,
      }),
    401,
  );
});

test('receipt verifier refuses stale/future signatures, missing auth, wrong connector and malformed facts', () => {
  for (const offset of [-301_000, 301_000]) {
    const rawBody = body();
    refuses(
      () =>
        verifier.verify({
          rawBody,
          headers: signed(rawBody, new Date(NOW.getTime() + offset)),
          now: NOW,
        }),
      401,
    );
  }
  refuses(() => verifier.verify({ rawBody: body(), headers: {}, now: NOW }), 401);
  for (const change of [
    { schema: 'other.v1' },
    { notificationId: 'not-a-uuid' },
    { receipt: 'PROVIDER_ACCEPTED' },
    { receipt: ['DELIVERED'] },
    { submissionKey: `cw-notification:${randomUUID()}` },
    { providerMessageId: 'bad\nvalue' },
    { token: 'forbidden-body-token' },
  ]) {
    const rawBody = body(change);
    refuses(() => verifier.verify({ rawBody, headers: signed(rawBody), now: NOW }), 400);
  }
  const wrong = body({ connectorId: 'another-connector' });
  refuses(() => verifier.verify({ rawBody: wrong, headers: signed(wrong), now: NOW }), 401);
  const malformed = Buffer.from('{');
  refuses(() => verifier.verify({ rawBody: malformed, headers: signed(malformed), now: NOW }), 400);
});

test('receipt signing key is a bounded protected file, independent of the outbound token', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'cw-receipt-key-'));
  const file = path.join(directory, 'signing-key');
  const link = path.join(directory, 'link');
  try {
    assert.equal(receiptVerifierFromEnv({}), null);
    assert.throws(
      () => receiptVerifierFromEnv({ NOTIFICATION_RECEIPT_SIGNING_KEY: KEY.toString('hex') }),
      /DIRECT_SECRET_REFUSED/,
    );
    assert.throws(
      () => receiptVerifierFromEnv({ NOTIFICATION_RECEIPT_CONNECTOR_ID: CONNECTOR }),
      /CONFIG_INVALID/,
    );
    writeFileSync(file, KEY, { mode: 0o600 });
    const env = {
      NOTIFICATION_RECEIPT_CONNECTOR_ID: CONNECTOR,
      NOTIFICATION_RECEIPT_SIGNING_KEY_FILE: file,
    };
    assert.ok(receiptVerifierFromEnv(env));
    symlinkSync(file, link);
    assert.throws(
      () => receiptVerifierFromEnv({ ...env, NOTIFICATION_RECEIPT_SIGNING_KEY_FILE: link }),
      /KEY_FILE_INVALID/,
    );
    chmodSync(file, 0o644);
    assert.throws(() => receiptVerifierFromEnv(env), /KEY_FILE_INVALID/);
    chmodSync(file, 0o600);
    writeFileSync(file, Buffer.alloc(257));
    assert.throws(() => receiptVerifierFromEnv(env), /KEY_FILE_INVALID/);
    const outbound = 'independent-key-required-'.repeat(2);
    writeFileSync(file, outbound);
    assert.throws(
      () => receiptVerifierFromEnv({ ...env, NOTIFICATION_PROVIDER_TOKEN: outbound }),
      /KEY_REUSE_REFUSED/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('mounted receipt controller authenticates raw HTTP before its application port', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'cw-receipt-http-'));
  const file = path.join(directory, 'key');
  writeFileSync(file, KEY, { mode: 0o600 });
  const values = {
    DATABASE_URL:
      'postgresql://cw_communications_app:placeholder@127.0.0.1:5432/cw_communications?schema=app',
    NOTIFICATION_RECEIPT_CONNECTOR_ID: CONNECTOR,
    NOTIFICATION_RECEIPT_SIGNING_KEY_FILE: file,
  };
  const previous = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]));
  Object.assign(process.env, values);
  const app = await createHttpApplication();
  let calls = 0;
  app.get(NotificationAdministration).recordReceipt = () => {
    calls += 1;
    return Promise.resolve('APPLIED');
  };
  try {
    assert.ok(app.get(NotificationReceiptsController));
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const send = (rawBody: Buffer, headers: Record<string, string>, suffix = '') =>
      fetch(origin + NOTIFICATION_RECEIPTS_V1 + suffix, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: new Uint8Array(rawBody),
      });
    const rawBody = body();
    const headers = signed(rawBody, new Date());
    const accepted = await send(rawBody, headers);
    assert.equal(accepted.status, 204);
    assert.equal(accepted.headers.get('cache-control'), 'no-store');
    assert.equal(calls, 1, 'only authenticated input reaches the application');
    for (const [bytes, requestHeaders, suffix, expected] of [
      [rawBody, {}, '', 401],
      [body({ receipt: 'FAILED' }), headers, '', 401],
      [rawBody, signed(rawBody, new Date(Date.now() - 301_000)), '', 401],
      [rawBody, headers, '?token=forbidden', 400],
      [Buffer.alloc(4_097), headers, '', 413],
      [gzipSync(rawBody), { ...headers, 'content-encoding': 'gzip' }, '', 400],
    ] as const) {
      const response = await send(bytes, requestHeaders, suffix);
      assert.equal(response.status, expected);
      const result = await response.text();
      assert.ok(
        !result.includes('message-123') && !result.includes(headers['x-provider-signature']),
      );
    }
    assert.equal(calls, 1);
    for (const [result, expected] of [
      ['CORRELATION_PENDING', 409],
      ['CONFLICT', 409],
      ['NOT_FOUND', 404],
      ['REPLAYED', 204],
      ['IGNORED', 204],
    ] as const) {
      app.get(NotificationAdministration).recordReceipt = () => Promise.resolve(result);
      assert.equal((await send(rawBody, signed(rawBody, new Date()))).status, expected);
    }
  } finally {
    await app.close();
    for (const name of Object.keys(values)) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
