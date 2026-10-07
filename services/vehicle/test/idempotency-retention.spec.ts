import assert from 'node:assert/strict';
import test from 'node:test';
import { IdempotencyRetention } from '../src/infrastructure/persistence/idempotency-retention';

test('retention coalesces overlapping sweeps and shutdown drains the active sweep', async () => {
  let calls = 0;
  let release: () => void = () => assert.fail('purge gate is not initialized');
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const retention = new IdempotencyRetention(
    async () => {
      calls += 1;
      await gate;
    },
    () => assert.fail('unexpected purge failure'),
  );
  retention.start();
  const first = retention.sweep();
  assert.equal(retention.sweep(), first);
  await Promise.resolve();
  assert.equal(calls, 1);
  let stopped = false;
  const stop = retention.stop().then(() => {
    stopped = true;
  });
  await Promise.resolve();
  assert.equal(stopped, false);
  release();
  await stop;
  assert.equal(stopped, true);
});

test('retention records bounded failure and a later sweep retries', async () => {
  let calls = 0;
  let errors = 0;
  const retention = new IdempotencyRetention(
    () => {
      calls += 1;
      return calls === 1
        ? Promise.reject(new Error('database failure with private details'))
        : Promise.resolve();
    },
    () => {
      errors += 1;
    },
  );
  await retention.sweep();
  await retention.sweep();
  assert.equal(calls, 2);
  assert.equal(errors, 1);
  await retention.stop();
});
