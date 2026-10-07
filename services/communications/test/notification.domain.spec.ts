import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_DELIVERY_POLICY,
  NotificationRuleError,
  afterLeaseExpiry,
  afterReceipt,
  afterSubmission,
  backoffMs,
  canCancel,
  notificationRequest,
  providerIdempotencyKey,
  requestFingerprint,
  type SubmissionOutcome,
} from '../src/domain/notification';

const NOW = new Date('2026-10-07T12:00:00.000Z');
const RECIPIENT = '0e1f4a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b';

function request(overrides: Record<string, unknown> = {}) {
  return notificationRequest({
    sourceService: 'booking',
    idempotencyKey: 'booking:confirmed:0001',
    recipientRef: RECIPIENT,
    channel: 'SMS',
    templateKey: 'booking.confirmed',
    templateVersion: 3,
    parameters: { slot: '10:30', bookingRef: 'WG-1001' },
    expiresAt: new Date(NOW.getTime() + 3_600_000),
    now: NOW,
    ...overrides,
  });
}

function rejects(fn: () => unknown, code: string): void {
  assert.throws(fn, (e: unknown) => e instanceof NotificationRuleError && e.code === code);
}

test('communications domain: requests are validated against closed vocabularies and bounds', () => {
  assert.equal(request().channel, 'SMS');
  rejects(() => request({ channel: 'FAX' }), 'INVALID_CHANNEL');
  rejects(() => request({ recipientRef: '+963999999999' }), 'INVALID_RECIPIENT_REF');
  rejects(() => request({ templateVersion: 0 }), 'INVALID_TEMPLATE_VERSION');
  rejects(() => request({ idempotencyKey: 'short' }), 'INVALID_IDEMPOTENCY_KEY');
  rejects(() => request({ parameters: { a: 1 } }), 'INVALID_PARAMETER_VALUE');
  rejects(() => request({ parameters: { a: 'x\u0007' } }), 'INVALID_PARAMETER_VALUE');
  rejects(() => request({ parameters: { 'bad key': 'x' } }), 'INVALID_PARAMETER_KEY');
  rejects(() => request({ parameters: [] }), 'INVALID_PARAMETERS');
  rejects(() => request({ expiresAt: NOW }), 'ALREADY_EXPIRED');
  rejects(
    () => request({ expiresAt: new Date(NOW.getTime() + 8 * 24 * 3_600_000) }),
    'EXPIRY_TOO_FAR',
  );
});

test('communications domain: the fingerprint ignores parameter order and pins the template', () => {
  const a = request({ parameters: { b: '2', a: '1' } });
  const b = request({ parameters: { a: '1', b: '2' } });
  assert.equal(requestFingerprint(a), requestFingerprint(b));
  assert.notEqual(requestFingerprint(a), requestFingerprint(request({ templateVersion: 4 })));
  assert.notEqual(requestFingerprint(a), requestFingerprint(request({ channel: 'PUSH' })));
  assert.equal(providerIdempotencyKey('x'), 'cw-notification:x');
});

test('communications domain: backoff is bounded full jitter', () => {
  const policy = DEFAULT_DELIVERY_POLICY;
  assert.equal(
    backoffMs(1, policy, () => 0),
    policy.baseBackoffMs,
  );
  assert.equal(
    backoffMs(20, policy, () => 0.999999),
    Math.floor(policy.maxBackoffMs * 0.999999),
  );
  assert.ok(backoffMs(3, policy, () => 0.5) <= policy.baseBackoffMs * 4);
  assert.throws(() => backoffMs(1, policy, () => 1), /INVALID_RANDOM/);
});

function transition(outcome: SubmissionOutcome, attempt = 1, idempotentProvider = false) {
  return afterSubmission({
    outcome,
    attempt,
    now: NOW,
    expiresAt: new Date(NOW.getTime() + 3_600_000),
    idempotentProvider,
    policy: DEFAULT_DELIVERY_POLICY,
    random: () => 0.5,
  });
}

test('communications domain: a timeout is UNKNOWN, never success and never a blind resend', () => {
  assert.equal(transition({ kind: 'AMBIGUOUS', code: 'PROVIDER_TIMEOUT' }).state, 'UNKNOWN');
  // Only an idempotent provider makes a second submission harmless.
  assert.equal(
    transition({ kind: 'AMBIGUOUS', code: 'PROVIDER_TIMEOUT' }, 1, true).state,
    'RETRY_WAIT',
  );
});

test('communications domain: submission outcomes map to explicit states', () => {
  const accepted = transition({ kind: 'ACCEPTED', providerMessageId: 'm-1' });
  assert.deepEqual([accepted.state, accepted.providerMessageId], ['PROVIDER_ACCEPTED', 'm-1']);
  assert.equal(transition({ kind: 'REJECTED', code: 'BAD', retryable: false }).state, 'FAILED');
  const retry = transition({ kind: 'REJECTED', code: 'THROTTLED', retryable: true });
  assert.equal(retry.state, 'RETRY_WAIT');
  assert.ok(retry.nextAttemptAt && retry.nextAttemptAt > NOW);
  assert.equal(transition({ kind: 'NOT_SUBMITTED', code: 'DOWN' }).state, 'RETRY_WAIT');
  const exhausted = transition(
    { kind: 'NOT_SUBMITTED', code: 'DOWN' },
    DEFAULT_DELIVERY_POLICY.maxAttempts,
  );
  assert.deepEqual([exhausted.state, exhausted.errorCode], ['FAILED', 'DOWN:ATTEMPTS_EXHAUSTED']);
  const late = afterSubmission({
    outcome: { kind: 'NOT_SUBMITTED', code: 'DOWN' },
    attempt: 1,
    now: NOW,
    expiresAt: new Date(NOW.getTime() + 1_000),
    idempotentProvider: false,
    policy: DEFAULT_DELIVERY_POLICY,
    random: () => 0.5,
  });
  assert.equal(late.state, 'EXPIRED', 'a retry that would land after expiry is not scheduled');
});

test('communications domain: receipts never regress a settled fact', () => {
  assert.equal(afterReceipt('PROVIDER_ACCEPTED', 'DELIVERED'), 'DELIVERED');
  assert.equal(afterReceipt('UNKNOWN', 'DELIVERED'), 'DELIVERED');
  assert.equal(afterReceipt('DELIVERED', 'FAILED'), null);
  assert.equal(afterReceipt('FAILED', 'DELIVERED'), null);
  assert.equal(afterReceipt('QUEUED', 'DELIVERED'), null, 'nothing was sent yet');
  assert.ok(canCancel('QUEUED') && canCancel('RETRY_WAIT'));
  assert.ok(!canCancel('SENDING') && !canCancel('UNKNOWN') && !canCancel('PROVIDER_ACCEPTED'));
});

test('communications domain: an expired sender lease is resubmitted only under idempotency', () => {
  assert.equal(
    afterLeaseExpiry({ idempotentProvider: false, attempt: 1, maxAttempts: 5 }),
    'UNKNOWN',
  );
  assert.equal(
    afterLeaseExpiry({ idempotentProvider: true, attempt: 1, maxAttempts: 5 }),
    'RESUBMIT',
  );
  assert.equal(
    afterLeaseExpiry({ idempotentProvider: true, attempt: 5, maxAttempts: 5 }),
    'UNKNOWN',
  );
});
