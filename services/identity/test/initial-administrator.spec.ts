import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  initialAdministratorCommand,
  initialAdministratorFingerprint,
} from '../src/domain/initial-administrator';
import { parseBootstrapArguments } from '../src/transport/cli/bootstrap-initial-administrator';

const valid = () => ({
  accountId: randomUUID(),
  expectedEmail: 'operator@example.invalid',
  requestId: randomUUID(),
  reason: 'Approved initial administrator provisioning',
});

test('initial administrator requires explicit target, matching email, reason and stable request identity', () => {
  const input = valid();
  const parsed = initialAdministratorCommand({
    ...input,
    accountId: input.accountId.toUpperCase(),
    expectedEmail: ' Operator@Example.Invalid ',
  });
  assert.deepEqual(parsed, input);
  for (const patch of [
    { accountId: '' },
    { expectedEmail: 'not-email' },
    { requestId: '' },
    { reason: 'short' },
    { reason: 'approved\nnew command' },
    { reason: 'x'.repeat(513) },
  ])
    assert.throws(
      () => initialAdministratorCommand({ ...input, ...patch }),
      (error: unknown) => error instanceof Error && error.message === 'BOOTSTRAP_INVALID_REQUEST',
    );
  assert.notEqual(
    initialAdministratorFingerprint(input),
    initialAdministratorFingerprint({ ...input, reason: 'Different approved operational request' }),
  );
});

test('initial administrator CLI refuses missing, duplicate and unknown options', () => {
  const input = valid();
  const argv = [
    '--account-id',
    input.accountId,
    '--expected-email',
    input.expectedEmail,
    '--request-id',
    input.requestId,
    '--reason',
    input.reason,
  ];
  assert.deepEqual(parseBootstrapArguments(argv), input);
  for (const args of [
    [],
    argv.slice(0, 6),
    [...argv, '--force', 'true'],
    ['--account-id', input.accountId, ...argv.slice(0, 6)],
    ['--verify-account', 'true', ...argv.slice(2)],
  ])
    assert.throws(() => parseBootstrapArguments(args), /BOOTSTRAP_INVALID_REQUEST/);
});
