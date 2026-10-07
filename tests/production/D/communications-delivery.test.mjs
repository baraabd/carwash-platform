/**
 * Communications notification delivery state on a real PostgreSQL.
 *
 * Drives the compiled application/infrastructure modules with the service's
 * runtime identity. Time is an injected clock so lease expiry and backoff are
 * exercised deterministically. The provider is either a scripted port
 * implementation (declared as such in each case) or the real HTTP adapter
 * talking to a real local HTTP server. No external provider is contacted and
 * nothing here proves delivery by a real SMS/push/email vendor.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { ROOT, appDsn, context, serviceClient, sql } from '../../integration/_support.mjs';

const require = createRequire(path.join(ROOT, 'services', 'communications', 'package.json'));
const dist = (file) => require(path.join(ROOT, 'services', 'communications', 'dist', file));
const { EnqueueNotification, DeliveryWorker, NotificationAdministration } = dist(
  'application/notification.service.js',
);
const { PrismaNotificationIntake, PrismaNotificationRepository, sha256Hex } = dist(
  'infrastructure/persistence/prisma-notification.repository.js',
);
const { HttpNotificationProvider } = dist('infrastructure/provider/http-notification.provider.js');
const { PrismaInboxStore } = dist('inbox/prisma-inbox.store.js');
const { DEFAULT_DELIVERY_POLICY } = dist('domain/notification.js');

const client = serviceClient('communications');
const repository = new PrismaNotificationRepository(client);
test.after(() => client.$disconnect());

/** Mutable injected clock. */
function clock(start = new Date('2026-10-07T12:00:00.000Z')) {
  let now = start.getTime();
  return {
    now: () => new Date(now),
    advance(ms) {
      now += ms;
    },
  };
}

/** A scripted provider port implementation; each case declares its answers. */
function scripted(answers, { idempotent = false } = {}) {
  const calls = [];
  return {
    name: 'scripted-test-port',
    idempotentSubmission: idempotent,
    calls,
    async submit(submission) {
      calls.push(submission);
      const next = answers.length > 1 ? answers.shift() : answers[0];
      return typeof next === 'function' ? next(submission) : next;
    },
  };
}

function command(overrides = {}) {
  return {
    sourceService: 'booking',
    idempotencyKey: `booking:test:${randomUUID()}`,
    recipientRef: randomUUID(),
    channel: 'SMS',
    templateKey: 'booking.confirmed',
    templateVersion: 1,
    parameters: { slot: '10:30' },
    expiresAt: new Date('2026-10-07T18:00:00.000Z'),
    ...overrides,
  };
}

function worker(provider, time, options = {}) {
  return new DeliveryWorker(repository, provider, time, () => 0.5, {
    workerId: options.workerId ?? `w-${randomUUID().slice(0, 8)}`,
    batchSize: options.batchSize ?? 50,
    submitTimeoutMs: options.submitTimeoutMs ?? 1_000,
    policy: options.policy ?? DEFAULT_DELIVERY_POLICY,
  });
}

/**
 * Notifications created by earlier cases are still in the table. Each case
 * isolates itself by settling all other due work first (a fresh run ID would
 * need a fresh database); the scripted provider only ever sees this case's ids.
 */
async function quiesce() {
  await client.notification.updateMany({
    where: { state: { in: ['QUEUED', 'RETRY_WAIT', 'SENDING'] } },
    data: { state: 'CANCELLED', leaseOwner: null, leaseUntil: null, nextAttemptAt: null },
  });
}

async function enqueue(time, overrides = {}) {
  const result = await new EnqueueNotification(time, sha256Hex, randomUUID).execute(
    repository,
    command(overrides),
  );
  assert.equal(result.kind, 'CREATED');
  return result.notificationId;
}

const state = async (id) => (await repository.find(id))?.state;
const attempts = (id) =>
  client.deliveryAttempt.findMany({ where: { notificationId: id }, orderBy: { attemptNo: 'asc' } });

/* -------------------------------- intake --------------------------------- */

test('C1: enqueue is idempotent on the business key and refuses a changed request', async () => {
  const time = clock();
  const enqueueCommand = new EnqueueNotification(time, sha256Hex, randomUUID);
  const base = command();
  const first = await enqueueCommand.execute(repository, base);
  const replay = await enqueueCommand.execute(repository, base);
  assert.equal(first.kind, 'CREATED');
  assert.deepEqual(replay, { kind: 'REPLAYED', notificationId: first.notificationId });
  const changed = await enqueueCommand.execute(repository, { ...base, templateVersion: 2 });
  assert.deepEqual(changed, { kind: 'CONFLICT' }, 'a template change never silently resends');
  assert.equal(
    await client.notification.count({ where: { idempotencyKey: base.idempotencyKey } }),
    1,
  );
});

test('C2: concurrent enqueues of one key create exactly one intent', async () => {
  const time = clock();
  const base = command();
  const results = await Promise.all(
    Array.from({ length: 8 }, () =>
      new EnqueueNotification(time, sha256Hex, randomUUID).execute(repository, base),
    ),
  );
  assert.equal(results.filter((r) => r.kind === 'CREATED').length, 1);
  assert.equal(results.filter((r) => r.kind === 'REPLAYED').length, 7);
  assert.equal(new Set(results.map((r) => r.notificationId)).size, 1);
});

test('C3: an inbox delivery records its intent atomically with the inbox row', async () => {
  const time = clock();
  const store = new PrismaInboxStore({ client });
  const eventId = randomUUID();
  const base = command({ idempotencyKey: `booking:event:${eventId}` });
  const record = {
    eventId,
    eventType: 'booking.confirmed.v1',
    payloadHash: 'd'.repeat(64),
    correlationId: randomUUID(),
  };
  const effect = (tx) =>
    new EnqueueNotification(time, sha256Hex, randomUUID)
      .execute(new PrismaNotificationIntake(tx), base)
      .then(() => undefined);
  assert.equal(await store.applyOnce(record, effect), 'APPLIED');
  assert.equal(await store.applyOnce(record, effect), 'DUPLICATE');
  assert.equal(
    await client.notification.count({ where: { idempotencyKey: base.idempotencyKey } }),
    1,
  );

  // A failure after the intent write rolls back both the intent and the inbox row.
  const failing = { ...record, eventId: randomUUID() };
  const failingKey = `booking:event:${failing.eventId}`;
  await assert.rejects(
    store.applyOnce(failing, async (tx) => {
      await new EnqueueNotification(time, sha256Hex, randomUUID).execute(
        new PrismaNotificationIntake(tx),
        command({ idempotencyKey: failingKey }),
      );
      throw new Error('SIMULATED_EFFECT_FAILURE');
    }),
    /SIMULATED_EFFECT_FAILURE/,
  );
  assert.equal(await client.notification.count({ where: { idempotencyKey: failingKey } }), 0);
  assert.equal(await client.inboxMessage.count({ where: { eventId: failing.eventId } }), 0);
});

/* ------------------------------- delivery -------------------------------- */

test('C4: accepted, then a delivery receipt; late contradicting receipts are ignored', async () => {
  await quiesce();
  const time = clock();
  const id = await enqueue(time);
  const provider = scripted([{ kind: 'ACCEPTED', providerMessageId: 'prov-c4' }]);
  const report = await worker(provider, time).runOnce();
  assert.equal(report.claimed, 1);
  assert.equal(provider.calls[0].idempotencyKey, `cw-notification:${id}`);
  assert.equal(await state(id), 'PROVIDER_ACCEPTED');
  const admin = new NotificationAdministration(repository, time);
  assert.equal(await admin.recordReceipt(id, 'DELIVERED'), 'APPLIED');
  assert.equal(await admin.recordReceipt(id, 'FAILED'), 'IGNORED');
  assert.equal(await state(id), 'DELIVERED');
  const [attempt] = await attempts(id);
  assert.deepEqual(
    [attempt.outcome, attempt.providerMessageId, attempt.fence],
    ['ACCEPTED', 'prov-c4', 1],
  );
});

test('C5: a timeout with a non-idempotent provider is UNKNOWN and is never resent', async () => {
  await quiesce();
  const time = clock();
  const id = await enqueue(time);
  const provider = scripted([{ kind: 'AMBIGUOUS', code: 'PROVIDER_TIMEOUT' }]);
  await worker(provider, time).runOnce();
  assert.equal(await state(id), 'UNKNOWN');
  time.advance(60 * 60 * 1000);
  const again = await worker(provider, time).runOnce();
  assert.equal(again.claimed, 0, 'UNKNOWN waits for reconciliation');
  assert.equal(provider.calls.length, 1, 'exactly one submission ever left');
});

test('C6: an idempotent provider may be resubmitted under the same key after backoff', async () => {
  await quiesce();
  const time = clock();
  const id = await enqueue(time);
  const provider = scripted(
    [
      { kind: 'AMBIGUOUS', code: 'PROVIDER_TIMEOUT' },
      { kind: 'ACCEPTED', providerMessageId: 'prov-c6' },
    ],
    { idempotent: true },
  );
  await worker(provider, time).runOnce();
  assert.equal(await state(id), 'RETRY_WAIT');
  assert.equal((await worker(provider, time).runOnce()).claimed, 0, 'not due before backoff');
  time.advance(DEFAULT_DELIVERY_POLICY.maxBackoffMs);
  await worker(provider, time).runOnce();
  assert.equal(await state(id), 'PROVIDER_ACCEPTED');
  assert.deepEqual(
    provider.calls.map((c) => c.idempotencyKey),
    [`cw-notification:${id}`, `cw-notification:${id}`],
  );
});

test('C7: repeated not-submitted outcomes exhaust attempts and fail explicitly', async () => {
  await quiesce();
  const time = clock();
  const id = await enqueue(time);
  const provider = scripted([{ kind: 'NOT_SUBMITTED', code: 'PROVIDER_UNREACHABLE' }]);
  for (let pass = 0; pass < DEFAULT_DELIVERY_POLICY.maxAttempts; pass += 1) {
    await worker(provider, time).runOnce();
    time.advance(DEFAULT_DELIVERY_POLICY.maxBackoffMs);
  }
  const view = await repository.find(id);
  assert.equal(view.state, 'FAILED');
  assert.equal(view.lastErrorCode, 'PROVIDER_UNREACHABLE:ATTEMPTS_EXHAUSTED');
  assert.equal(view.attemptCount, DEFAULT_DELIVERY_POLICY.maxAttempts);
  assert.equal((await attempts(id)).length, DEFAULT_DELIVERY_POLICY.maxAttempts);
});

test('C8: racing workers claim each intent exactly once', async () => {
  await quiesce();
  const time = clock();
  const ids = [];
  for (let i = 0; i < 12; i += 1) ids.push(await enqueue(time));
  const providers = [0, 1, 2, 3].map(() =>
    scripted([{ kind: 'ACCEPTED', providerMessageId: 'p' }]),
  );
  const reports = await Promise.all(providers.map((p) => worker(p, time).runOnce()));
  const submitted = providers.flatMap((p) => p.calls.map((c) => c.idempotencyKey));
  assert.equal(submitted.length, ids.length, 'every intent was submitted');
  assert.equal(new Set(submitted).size, ids.length, 'no intent was submitted twice');
  assert.equal(
    reports.reduce((n, r) => n + r.claimed, 0),
    ids.length,
  );
  for (const id of ids) {
    assert.equal(await state(id), 'PROVIDER_ACCEPTED');
    assert.equal((await attempts(id)).length, 1);
  }
});

test('C9: a stale worker cannot overwrite the result of a newer claim', async () => {
  await quiesce();
  const time = clock();
  const id = await enqueue(time);
  const policy = { ...DEFAULT_DELIVERY_POLICY, leaseMs: 5_000 };
  // Worker A claims and then stalls inside the provider call.
  let releaseA;
  const stalled = new Promise((resolve) => (releaseA = resolve));
  const providerA = scripted([() => stalled], { idempotent: true });
  const runA = worker(providerA, time, { policy, submitTimeoutMs: 2_000 }).runOnce();
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(await state(id), 'SENDING');

  // Its lease lapses; worker B (idempotent provider) re-claims and succeeds.
  time.advance(policy.leaseMs + 1);
  const providerB = scripted([{ kind: 'ACCEPTED', providerMessageId: 'prov-b' }], {
    idempotent: true,
  });
  const reportB = await worker(providerB, time, { policy, submitTimeoutMs: 2_000 }).runOnce();
  assert.equal(reportB.completed, 1);

  // A finally answers with a contradicting result: it is fenced out.
  releaseA({ kind: 'REJECTED', code: 'LATE_REJECTION', retryable: false });
  const reportA = await runA;
  assert.equal(reportA.fencedOut, 1);
  const view = await repository.find(id);
  assert.equal(view.state, 'PROVIDER_ACCEPTED');
  const rows = await attempts(id);
  assert.deepEqual(
    rows.map((r) => [r.attemptNo, r.fence, r.outcome]),
    [
      [1, 1, 'REJECTED'],
      [2, 2, 'ACCEPTED'],
    ],
    'each attempt keeps what its own claim observed',
  );
});

test('C10: a lapsed lease without idempotency is UNKNOWN until its own late answer arrives', async () => {
  await quiesce();
  const time = clock();
  const id = await enqueue(time);
  const policy = { ...DEFAULT_DELIVERY_POLICY, leaseMs: 5_000 };
  let release;
  const stalled = new Promise((resolve) => (release = resolve));
  const runA = worker(scripted([() => stalled]), time, {
    policy,
    submitTimeoutMs: 2_000,
  }).runOnce();
  await new Promise((resolve) => setTimeout(resolve, 200));

  time.advance(policy.leaseMs + 1);
  const sweeper = scripted([{ kind: 'ACCEPTED', providerMessageId: 'never' }]);
  assert.equal(
    (await worker(sweeper, time, { policy, submitTimeoutMs: 2_000 }).runOnce()).claimed,
    0,
  );
  assert.equal(sweeper.calls.length, 0, 'no second submission without idempotency');
  assert.equal(await state(id), 'UNKNOWN');

  // Same fence, no newer claim: the original claim's answer resolves the ambiguity.
  release({ kind: 'ACCEPTED', providerMessageId: 'prov-late' });
  assert.equal((await runA).completed, 1);
  assert.equal(await state(id), 'PROVIDER_ACCEPTED');
});

test('C11: expired intents are settled without a provider call; cancel is limited', async () => {
  await quiesce();
  const time = clock();
  const id = await enqueue(time, { expiresAt: new Date('2026-10-07T12:10:00.000Z') });
  const cancelled = await enqueue(time);
  const admin = new NotificationAdministration(repository, time);
  assert.equal(await admin.cancel(cancelled), 'CANCELLED');
  time.advance(11 * 60 * 1000);
  const provider = scripted([{ kind: 'ACCEPTED', providerMessageId: 'x' }]);
  await worker(provider, time).runOnce();
  assert.equal(provider.calls.length, 0);
  assert.equal(await state(id), 'EXPIRED');
  assert.equal(await state(cancelled), 'CANCELLED');
  assert.equal(await admin.cancel(id), 'NOT_CANCELLABLE');
  assert.equal(await admin.cancel(randomUUID()), 'NOT_FOUND');
});

test('C12: database constraints refuse impossible states for the runtime identity', async () => {
  const id = await enqueue(clock());
  const url = appDsn(context, 'communications');
  for (const [statement, constraint] of [
    [
      `UPDATE app.notification SET state = 'SENT_MAYBE' WHERE id = '${id}'`,
      'notification_state_known',
    ],
    [
      `UPDATE app.notification SET state = 'SENDING' WHERE id = '${id}'`,
      'notification_lease_only_while_sending',
    ],
    [
      `UPDATE app.notification SET provider_message_id = 'x' WHERE id = '${id}'`,
      'notification_provider_id_only_when_accepted',
    ],
  ]) {
    const result = await sql(url, statement);
    assert.equal(result.ok, false, `${statement} must be refused`);
    assert.equal(result.code, '23514', `check violation, got ${result.code} ${result.message}`);
    assert.match(result.message ?? '', new RegExp(constraint));
  }
});

test('C13: the real HTTP adapter turns an unanswered request into UNKNOWN end to end', async (t) => {
  await quiesce();
  const server = createServer(() => undefined); // receives the request, never answers
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const time = clock();
  const id = await enqueue(time);
  const provider = new HttpNotificationProvider({
    endpoint: new URL(`http://127.0.0.1:${server.address().port}/send`),
    token: 'test-token-0123456789abcdef',
    idempotentSubmission: false,
  });
  const report = await worker(provider, time, { submitTimeoutMs: 400 }).runOnce();
  assert.deepEqual(report.outcomes, { ACCEPTED: 0, REJECTED: 0, NOT_SUBMITTED: 0, AMBIGUOUS: 1 });
  const view = await repository.find(id);
  assert.deepEqual([view.state, view.lastErrorCode], ['UNKNOWN', 'PROVIDER_TIMEOUT']);
});

test('C14: pending submission leaves later intents queued with no attempt or expiring lease', async () => {
  await quiesce();
  const time = clock();
  const ids = [await enqueue(time), await enqueue(time), await enqueue(time)];
  const entered = Promise.withResolvers();
  const answer = Promise.withResolvers();
  const provider = scripted([
    () => {
      entered.resolve();
      return answer.promise;
    },
    { kind: 'ACCEPTED', providerMessageId: 'remaining' },
  ]);
  const run = worker(provider, time, { batchSize: 3 }).runOnce();
  await entered.promise;
  try {
    const pendingId = provider.calls[0].idempotencyKey.replace('cw-notification:', '');
    for (const id of ids.filter((candidate) => candidate !== pendingId)) {
      assert.equal(await state(id), 'QUEUED');
      assert.equal((await attempts(id)).length, 0, 'unsent work has no sender lease to expire');
    }
  } finally {
    answer.resolve({ kind: 'ACCEPTED', providerMessageId: 'first' });
    await run;
  }
  for (const id of ids) assert.equal(await state(id), 'PROVIDER_ACCEPTED');
});

for (const idempotentProvider of [false, true]) {
  test(`C15: completion and lease expiry use one lock order (idempotent=${idempotentProvider})`, async () => {
    await quiesce();
    const time = clock();
    const id = await enqueue(time);
    const claimOptions = {
      now: time.now(),
      workerId: 'lock-order-first',
      limit: 1,
      leaseMs: 5_000,
      idempotentProvider,
      maxAttempts: DEFAULT_DELIVERY_POLICY.maxAttempts,
    };
    const [claim] = await repository.claimDue(claimOptions);
    assert.equal(claim.notificationId, id);
    time.advance(5_001);

    // Pause a real sweeper transaction while it owns the notification row.
    // Let completion reach its first row, then release the sweeper to close
    // the attempt. Attempt-first completion would now deadlock PostgreSQL.
    const sweeperLocked = Promise.withResolvers();
    const releaseSweeper = Promise.withResolvers();
    const completionStarted = Promise.withResolvers();
    const sweeperClient = client.$extends({
      query: {
        notification: {
          async updateMany({ args, query }) {
            const result = await query(args);
            if (result.count === 1) {
              sweeperLocked.resolve();
              await releaseSweeper.promise;
            }
            return result;
          },
        },
      },
    });
    const completionClient = client.$extends({
      query: {
        notification: {
          async updateMany({ args, query }) {
            completionStarted.resolve();
            return query(args);
          },
        },
        deliveryAttempt: {
          async updateMany({ args, query }) {
            const result = await query(args);
            completionStarted.resolve();
            return result;
          },
        },
      },
    });
    const sweep = new PrismaNotificationRepository(sweeperClient).claimDue({
      ...claimOptions,
      now: time.now(),
      workerId: 'lock-order-sweeper',
    });
    await sweeperLocked.promise;
    const completion = new PrismaNotificationRepository(completionClient).complete({
      notificationId: id,
      fence: claim.fence,
      attempt: claim.attempt,
      outcome: 'ACCEPTED',
      transition: {
        state: 'PROVIDER_ACCEPTED',
        nextAttemptAt: null,
        providerMessageId: 'lock-order-accepted',
        errorCode: null,
      },
      now: time.now(),
    });
    try {
      await completionStarted.promise;
    } finally {
      releaseSweeper.resolve();
    }
    const [claimed, written] = await Promise.all([sweep, completion]);
    assert.equal(claimed.length, idempotentProvider ? 1 : 0);
    assert.equal(written, !idempotentProvider, 'a newer fence wins; an unchanged fence resolves');
    assert.equal(await state(id), idempotentProvider ? 'SENDING' : 'PROVIDER_ACCEPTED');
    assert.equal((await attempts(id))[0].outcome, 'ACCEPTED', 'late evidence is preserved');
  });
}
