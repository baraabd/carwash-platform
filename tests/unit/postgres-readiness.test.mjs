import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { waitFor } from '../../scripts/acceptance/lib/infra.mjs';

// Execute the actual readiness function with only Docker IO substituted.
// These startup/cancellation fixtures are not PostgreSQL acceptance evidence.
const source = readFileSync(
  new URL('../../scripts/acceptance/lib/infra.mjs', import.meta.url),
  'utf8',
);
const start = source.indexOf('export async function waitForPostgresReady(');
const end = source.indexOf('/** Provision the least-privilege broker identities.', start);
assert.ok(start >= 0 && end > start);
const readiness = source.slice(start, end).replace('export ', '');

function withDockerProbe(probe) {
  return new Function('composeExec', 'waitFor', `${readiness}\nreturn waitForPostgresReady;`)(
    probe,
    (description, check, options) => waitFor(description, check, { ...options, intervalMs: 1 }),
  );
}

test('PostgreSQL readiness waits for the final TCP server after socket-only initdb', async () => {
  let attempts = 0;
  const ready = withDockerProbe(async (_context, service, argv) => {
    assert.equal(service, 'postgres');
    attempts += 1;
    // Docker initdb accepts sockets immediately, but does not listen on TCP.
    const tcp = argv[argv.indexOf('-h') + 1] === '127.0.0.1';
    const runtimeStarted = attempts > 1;
    return { code: !tcp || runtimeStarted ? 0 : 2, outcome: 'exited' };
  });
  await ready({}, undefined, { timeoutMs: 1000 });
  assert.equal(attempts, 2, 'The socket-only initialization server must never satisfy readiness');

  const compose = readFileSync(
    new URL('../../infra/compose.acceptance.yml', import.meta.url),
    'utf8',
  );
  assert.match(compose, /pg_isready -h 127\.0\.0\.1 -p 5432 -U cw_acceptance_bootstrap/);
});

test('PostgreSQL readiness rejects abnormal exits within the remaining deadline', async () => {
  let attempts = 0;
  const ready = withDockerProbe(async (_context, _service, _argv, options) => {
    attempts += 1;
    assert.ok(options.timeoutMs > 0 && options.timeoutMs <= 30);
    return { code: 0, outcome: 'timeout' };
  });
  await assert.rejects(ready({}, undefined, { timeoutMs: 30 }), /WAIT_TIMEOUT/);
  assert.ok(attempts > 0);
});

test('PostgreSQL readiness propagates cancellation before and during polling', async () => {
  const before = new AbortController();
  before.abort();
  let attempts = 0;
  const ready = withDockerProbe(async () => {
    attempts += 1;
    return { code: 0, outcome: 'exited' };
  });
  await assert.rejects(ready({}, before.signal), { name: 'AbortError' });
  assert.equal(attempts, 0);

  const during = new AbortController();
  const cancelled = withDockerProbe(async (_context, _service, _argv, options) => {
    assert.equal(options.signal, during.signal);
    during.abort();
    return { code: 0, outcome: 'exited' };
  });
  await assert.rejects(cancelled({}, during.signal), { name: 'AbortError' });
});
