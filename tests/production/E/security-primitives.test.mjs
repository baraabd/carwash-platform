/**
 * P04-E3 — shared security primitives in @carwash/service-kit:
 * service-scope authentication, provider (webhook) signature verification and
 * the secret source interface. Unit evidence only; the owner's durable replay
 * store and the real HTTP ingress are proven in their own PostgreSQL/HTTP suites.
 *
 * Requires: pnpm build:packages
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(import.meta.url);
const kit = require(path.join(root, 'packages/service-kit/dist/index.js'));

const SCOPES = ['billing.obligation.write', 'billing.obligation.read'];
const token = () => randomBytes(32).toString('base64url');

// ---------------------------------------------------------------- service scopes

test('service clients: digests only, exact keys, known scopes, unique ids and credentials', () => {
  const t = token();
  const ok = JSON.stringify([
    { id: 'booking', tokenSha256: kit.serviceTokenDigest(t), scopes: ['billing.obligation.write'] },
  ]);
  assert.equal(kit.parseServiceClients(ok, SCOPES).length, 1);
  assert.deepEqual(kit.parseServiceClients(undefined, SCOPES), []);
  assert.deepEqual(kit.parseServiceClients('  ', SCOPES), []);
  const bad = (value, code) =>
    assert.throws(() => kit.parseServiceClients(JSON.stringify(value), SCOPES), new RegExp(code));
  const digest = kit.serviceTokenDigest(t);
  bad([{ id: 'booking', token: t, scopes: SCOPES }], 'SERVICE_CLIENTS_INVALID');
  bad([{ id: 'Booking', tokenSha256: digest, scopes: SCOPES }], 'INVALID_ID');
  bad([{ id: 'booking', tokenSha256: 'ab', scopes: SCOPES }], 'INVALID_DIGEST');
  bad([{ id: 'booking', tokenSha256: digest, scopes: ['billing.*'] }], 'INVALID_SCOPE');
  bad([{ id: 'booking', tokenSha256: digest, scopes: [] }], 'INVALID_SCOPE');
  bad(
    [
      { id: 'booking', tokenSha256: digest, scopes: SCOPES },
      { id: 'dispatch', tokenSha256: digest, scopes: SCOPES },
    ],
    'DUPLICATE_DIGEST',
  );
  bad(
    [
      { id: 'booking', tokenSha256: digest, scopes: SCOPES },
      { id: 'booking', tokenSha256: kit.serviceTokenDigest(token()), scopes: SCOPES },
    ],
    'INVALID_ID',
  );
  assert.throws(() => kit.parseServiceClients('{not json', SCOPES), /INVALID_JSON/);
});

test('service clients: deny by default; wrong id, wrong token or missing scope is refused', () => {
  const booking = token();
  const dispatch = token();
  const auth = new kit.ServiceClientAuthenticator(
    kit.parseServiceClients(
      JSON.stringify([
        {
          id: 'booking',
          tokenSha256: kit.serviceTokenDigest(booking),
          scopes: ['billing.obligation.write'],
        },
        {
          id: 'dispatch',
          tokenSha256: kit.serviceTokenDigest(dispatch),
          scopes: ['billing.obligation.read'],
        },
      ]),
      SCOPES,
    ),
  );
  assert.deepEqual(auth.authorize('booking', booking, 'billing.obligation.write'), {
    ok: true,
    clientId: 'booking',
    scope: 'billing.obligation.write',
  });
  // Another client's valid token under a different id.
  assert.equal(
    auth.authorize('booking', dispatch, 'billing.obligation.write').reason,
    'UNAUTHENTICATED',
  );
  assert.equal(
    auth.authorize('dispatch', dispatch, 'billing.obligation.write').reason,
    'SCOPE_DENIED',
  );
  assert.equal(
    auth.authorize(undefined, booking, 'billing.obligation.write').reason,
    'UNAUTHENTICATED',
  );
  assert.equal(
    auth.authorize('booking', 'short', 'billing.obligation.write').reason,
    'UNAUTHENTICATED',
  );
  // No configuration: everything is refused, never allowed.
  const none = new kit.ServiceClientAuthenticator(kit.parseServiceClients(undefined, SCOPES));
  assert.equal(none.authorize('booking', booking, 'billing.obligation.write').ok, false);
});

// ---------------------------------------------------------------- provider signatures

const SECRET = randomBytes(32);
const NOW = new Date('2026-10-10T12:00:00.000Z');
const body = Buffer.from(JSON.stringify({ reference: 'TX-1', amountMinor: '150000' }));

function signed(overrides = {}) {
  const headers = kit.signProviderNotification({
    rawBody: body,
    notificationId: 'ntf_0001-aaaa',
    secret: SECRET,
    at: NOW,
  });
  return {
    rawBody: body,
    signature: headers['x-provider-signature'],
    timestamp: headers['x-provider-timestamp'],
    notificationId: headers['x-provider-notification-id'],
    secrets: [SECRET],
    now: NOW,
    ...overrides,
  };
}

test('webhook signature: a correctly signed notification verifies', () => {
  const result = kit.verifyProviderSignature(signed());
  assert.equal(result.ok, true);
  assert.equal(result.notificationId, 'ntf_0001-aaaa');
});

test('webhook signature: tampered body, id, timestamp or secret is refused', () => {
  const reason = (input) => kit.verifyProviderSignature(input).reason;
  const tampered = Buffer.from(body.toString().replace('150000', '1500000'));
  assert.equal(reason(signed({ rawBody: tampered })), 'SIGNATURE_INVALID');
  // Re-labelling a captured notification to dodge de-duplication.
  assert.equal(reason(signed({ notificationId: 'ntf_0002-bbbb' })), 'SIGNATURE_INVALID');
  const headers = signed();
  assert.equal(
    reason({ ...headers, timestamp: String(Number(headers.timestamp) + 1) }),
    'SIGNATURE_INVALID',
  );
  assert.equal(reason(signed({ secrets: [randomBytes(32)] })), 'SIGNATURE_INVALID');
  // A whitespace-reformatted body is a different body: verification is over raw bytes.
  assert.equal(
    reason(signed({ rawBody: Buffer.from(JSON.stringify(JSON.parse(body.toString()), null, 1)) })),
    'SIGNATURE_INVALID',
  );
});

test('webhook replay: old captures are STALE; replays inside the window carry the same id', () => {
  const late = new Date(NOW.getTime() + 301_000);
  assert.equal(kit.verifyProviderSignature(signed({ now: late })).reason, 'STALE');
  const early = new Date(NOW.getTime() - 301_000);
  assert.equal(kit.verifyProviderSignature(signed({ now: early })).reason, 'STALE');
  // Inside the window a replay verifies but yields the SAME notification id, which
  // the owner's durable guard de-duplicates (FIRST once, DUPLICATE afterwards).
  const first = kit.verifyProviderSignature(signed());
  const replay = kit.verifyProviderSignature(signed({ now: new Date(NOW.getTime() + 60_000) }));
  assert.equal(first.notificationId, replay.notificationId);
});

test('webhook signature: rotation accepts any active secret; malformed input is refused', () => {
  const next = randomBytes(32);
  assert.equal(kit.verifyProviderSignature(signed({ secrets: [next, SECRET] })).ok, true);
  const reason = (input) => kit.verifyProviderSignature(input).reason;
  assert.equal(reason(signed({ secrets: [] })), 'NOT_CONFIGURED');
  assert.equal(reason(signed({ secrets: [Buffer.from('short')] })), 'NOT_CONFIGURED');
  assert.equal(reason(signed({ signature: undefined })), 'MALFORMED');
  assert.equal(reason(signed({ signature: 'sha256=abc' })), 'MALFORMED');
  assert.equal(reason(signed({ timestamp: '2026-10-10T12:00:00Z' })), 'MALFORMED');
  assert.equal(reason(signed({ notificationId: 'a b' })), 'MALFORMED');
  assert.equal(reason(signed({ rawBody: Buffer.alloc(16_385) })), 'TOO_LARGE');
  // Several presented signatures (provider-side rotation): one valid one is enough.
  const valid = signed();
  assert.equal(
    kit.verifyProviderSignature({ ...valid, signature: `v1=${'0'.repeat(64)}, ${valid.signature}` })
      .ok,
    true,
  );
});

// ---------------------------------------------------------------- secrets

test('secrets: env or mounted file, never both; rotation lines; errors never echo the value', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'p04e3-secret-'));
  try {
    const value = randomBytes(24).toString('hex');
    const file = path.join(dir, 'sig');
    writeFileSync(file, `${value}\n${randomBytes(24).toString('hex')}\n\n`);
    assert.equal(kit.readSecrets('PAY_SIGNING', { PAY_SIGNING_FILE: file }).length, 2);
    assert.equal(kit.readSecret('PAY_SIGNING', { PAY_SIGNING_FILE: file }).toString(), value);
    assert.equal(kit.readSecret('PAY_SIGNING', { PAY_SIGNING: value }).toString(), value);
    assert.equal(kit.readSecret('PAY_SIGNING', {}), null);
    const failure = (env, code) => {
      try {
        kit.readSecrets('PAY_SIGNING', env);
        assert.fail('expected a configuration error');
      } catch (error) {
        assert.equal(error.code, code);
        assert.ok(!String(error.message).includes(value), 'error must not echo the secret');
      }
    };
    failure({ PAY_SIGNING: value, PAY_SIGNING_FILE: file }, 'SECRET_AMBIGUOUS');
    failure({ PAY_SIGNING_FILE: 'relative/path' }, 'SECRET_FILE_NOT_ABSOLUTE');
    failure({ PAY_SIGNING_FILE: path.join(dir, 'missing') }, 'SECRET_FILE_UNREADABLE');
    failure({ PAY_SIGNING: value.slice(0, 10) }, 'SECRET_TOO_SHORT');
    const big = path.join(dir, 'big');
    writeFileSync(big, 'x'.repeat(16_385));
    failure({ PAY_SIGNING_FILE: big }, 'SECRET_FILE_UNREADABLE');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
