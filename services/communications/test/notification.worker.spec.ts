import test from 'node:test';
import assert from 'node:assert/strict';
import { DeliveryWorker } from '../src/application/notification.service';
import type { SubmissionOutcome } from '../src/domain/notification';
import type {
  ClaimedDelivery,
  NotificationProvider,
  NotificationRepository,
} from '../src/ports/notification.ports';

const NOW = new Date('2026-10-07T12:00:00.000Z');

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** In-memory port: these tests prove worker scheduling, not database claims. */
function queue(size: number, failCompletion = false) {
  const states = Array.from({ length: size }, () => 'QUEUED');
  const claimTimes: Date[] = [];
  const repository: NotificationRepository = {
    claimDue({ limit, now }) {
      claimTimes.push(now);
      const claims: ClaimedDelivery[] = [];
      for (let index = 0; index < states.length && claims.length < limit; index += 1) {
        if (states[index] !== 'QUEUED') continue;
        states[index] = 'SENDING';
        claims.push({
          notificationId: String(index),
          fence: 1,
          attempt: 1,
          expiresAt: new Date(NOW.getTime() + 3_600_000),
          submission: {
            idempotencyKey: `cw-notification:${index}`,
            channel: 'SMS',
            recipientRef: '0e1f4a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b',
            templateKey: 'booking.confirmed',
            templateVersion: 1,
            parameters: {},
          },
        });
      }
      return Promise.resolve(claims);
    },
    complete({ notificationId, transition }) {
      if (failCompletion) return Promise.reject(new Error('DATABASE_UNAVAILABLE'));
      states[Number(notificationId)] = transition.state;
      return Promise.resolve(true);
    },
    enqueue() {
      return Promise.reject(new Error('UNUSED_PORT'));
    },
    applyReceipt() {
      return Promise.reject(new Error('UNUSED_PORT'));
    },
    cancel() {
      return Promise.reject(new Error('UNUSED_PORT'));
    },
    find() {
      return Promise.reject(new Error('UNUSED_PORT'));
    },
  };
  return { repository, states, claimTimes };
}

function worker(
  repository: NotificationRepository,
  submit: NotificationProvider['submit'],
  batchSize = 3,
  now = () => NOW,
) {
  return new DeliveryWorker(
    repository,
    { name: 'scripted-port', idempotentSubmission: false, submit },
    { now },
    () => 0.5,
    { workerId: 'worker-test', batchSize, submitTimeoutMs: 1_000 },
  );
}

const accepted: SubmissionOutcome = { kind: 'ACCEPTED', providerMessageId: 'provider-1' };

test('worker leaves later intents unclaimed while the first submission is pending', async () => {
  const { repository, states } = queue(3);
  const entered = deferred<void>();
  const answer = deferred<SubmissionOutcome>();
  let calls = 0;
  const run = worker(repository, () => {
    calls += 1;
    if (calls === 1) {
      entered.resolve();
      return answer.promise;
    }
    return Promise.resolve(accepted);
  }).runOnce();
  await entered.promise;
  try {
    assert.deepEqual(states, ['SENDING', 'QUEUED', 'QUEUED']);
  } finally {
    answer.resolve(accepted);
    await run;
  }
  assert.equal(calls, 3);
  assert.deepEqual(
    states,
    Array.from({ length: 3 }, () => 'PROVIDER_ACCEPTED'),
  );
});

test('a completion failure leaves every unsent intent available for another worker', async () => {
  const { repository, states } = queue(3, true);
  let calls = 0;
  await assert.rejects(
    worker(repository, () => {
      calls += 1;
      return Promise.resolve(accepted);
    }).runOnce(),
    /DATABASE_UNAVAILABLE/,
  );
  assert.equal(calls, 1);
  assert.deepEqual(states, ['SENDING', 'QUEUED', 'QUEUED']);
});

test('the batch bounds submissions and every claim uses the current clock', async () => {
  const { repository, states, claimTimes } = queue(4);
  let elapsed = 0;
  const report = await worker(
    repository,
    () => {
      elapsed += 20_000;
      return Promise.resolve(accepted);
    },
    2,
    () => new Date(NOW.getTime() + elapsed),
  ).runOnce();
  assert.deepEqual(report, {
    claimed: 2,
    completed: 2,
    fencedOut: 0,
    outcomes: { ACCEPTED: 2, REJECTED: 0, NOT_SUBMITTED: 0, AMBIGUOUS: 0 },
  });
  assert.deepEqual(states, ['PROVIDER_ACCEPTED', 'PROVIDER_ACCEPTED', 'QUEUED', 'QUEUED']);
  assert.deepEqual(claimTimes, [NOW, new Date(NOW.getTime() + 20_000)]);
});

test('invalid batch sizes cannot create an unbounded or silently empty pass', () => {
  const { repository } = queue(1);
  for (const size of [0, -1, 1.5, Infinity, NaN]) {
    assert.throws(
      () => worker(repository, () => Promise.resolve(accepted), size),
      /INVALID_BATCH_SIZE/,
    );
  }
});
