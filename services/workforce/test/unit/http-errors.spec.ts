import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkforceError } from '../../src/domain';
import { IdentityAuthFailure } from '../../src/infrastructure/identity/identity-session.client';
import { RequestBudget } from '../../src/transport/http/actor-resolver';
import { RateLimited, errorBody, statusOf } from '../../src/transport/http/http-errors';

const IDS = ['44444444-4444-4444-8444-444444444444', 'req-1'] as const;

function reply(error: unknown) {
  const body = errorBody(error, ...IDS);
  return { status: statusOf(body), code: body.error.code, reason: body.error.reason, body };
}

test('requested P03-C1 outcomes: 404 OPERATOR_NOT_FOUND, 409 REVISION_CONFLICT', () => {
  assert.deepEqual(
    (({ status, code, reason }) => ({ status, code, reason }))(
      reply(new WorkforceError('OPERATOR_NOT_FOUND', 'x')),
    ),
    { status: 404, code: 'NOT_FOUND', reason: 'OPERATOR_NOT_FOUND' },
  );
  assert.deepEqual(
    (({ status, code, reason }) => ({ status, code, reason }))(
      reply(new WorkforceError('REVISION_CONFLICT', 'x')),
    ),
    { status: 409, code: 'CONFLICT', reason: 'REVISION_CONFLICT' },
  );
  assert.deepEqual(
    (({ status, code, reason }) => ({ status, code, reason }))(
      reply(new WorkforceError('INVALID_CURSOR', 'x')),
    ),
    { status: 400, code: 'REQUEST_INVALID', reason: 'INVALID_CURSOR' },
  );
});

test('authentication and authorization map to 401/403 without a reason', () => {
  assert.equal(reply(new IdentityAuthFailure('UNAUTHENTICATED')).status, 401);
  const forbidden = reply(new WorkforceError('FORBIDDEN', 'secret detail'));
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.reason, null);
  assert.equal(forbidden.body.error.message, 'The operation is not allowed.');
  const invalid = reply(new WorkforceError('INVALID_INPUT', 'Unexpected field: x'));
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.message, 'The request is invalid.', 'no internal text');
});

test('retryable failures carry retryAfterMs; others never do', () => {
  const identity = reply(new IdentityAuthFailure('UNAVAILABLE'));
  assert.equal(identity.status, 503);
  assert.equal(identity.body.error.retryable, true);
  assert.equal(identity.body.error.retryAfterMs, 1_000);
  const limited = reply(new RateLimited(1_234.2));
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error.retryAfterMs, 1_235);
  const internal = reply(new Error('boom'));
  assert.equal(internal.status, 500);
  assert.equal(internal.body.error.retryable, false);
  assert.equal(internal.body.error.retryAfterMs, null);
});

test('the per-actor budget reports the remaining window', () => {
  let at = 1_000;
  const budget = new RequestBudget(1, 60_000, () => at);
  budget.take('user:a');
  at = 11_000;
  assert.throws(
    () => budget.take('user:a'),
    (error: unknown) => error instanceof RateLimited && error.retryAfterMs === 50_000,
  );
});
