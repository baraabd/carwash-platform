import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  EvidenceFenceRelay,
  fenceIdempotencyKey,
  fenceRetryDelayMs,
} from '../../src/application/evidence-fence';
import type {
  EvidenceFenceQueue,
  EvidenceFenceTarget,
  FenceOutcome,
  LeasedFence,
} from '../../src/ports';

class FakeQueue implements EvidenceFenceQueue {
  readonly fenced: string[] = [];
  readonly retries: { id: string; code: string; delayMs: number }[] = [];
  constructor(private readonly due: LeasedFence[]) {}
  leaseDue(): Promise<LeasedFence[]> {
    return Promise.resolve(this.due.splice(0));
  }
  markFenced(evidenceId: string): Promise<boolean> {
    this.fenced.push(evidenceId);
    return Promise.resolve(true);
  }
  markRetry(evidenceId: string, _w: string, code: string, delayMs: number): Promise<boolean> {
    this.retries.push({ id: evidenceId, code, delayMs });
    return Promise.resolve(true);
  }
  countStuck(): Promise<number> {
    return Promise.resolve(0);
  }
}

const fence = (attempts = 1): LeasedFence => ({
  evidenceId: randomUUID(),
  mediaObjectId: randomUUID(),
  attempts,
});

test('only Media 2xx confirms a fence; every other answer is kept for retry', async () => {
  const ok = fence();
  const down = fence(3);
  const refused = fence();
  const answers = new Map<string, FenceOutcome>([
    [ok.evidenceId, { kind: 'FENCED' }],
    [down.evidenceId, { kind: 'FAILED', code: 'MEDIA_UNAVAILABLE' }],
    [refused.evidenceId, { kind: 'FAILED', code: 'MEDIA_HTTP_404' }],
  ]);
  const calls: { objectId: string; claimRef: string; key: string }[] = [];
  const media: EvidenceFenceTarget = {
    revokeOwnerAccess(objectId, claimRef, key) {
      calls.push({ objectId, claimRef, key });
      return Promise.resolve(answers.get(claimRef) as FenceOutcome);
    },
  };
  const queue = new FakeQueue([ok, down, refused]);
  const result = await new EvidenceFenceRelay(queue, media).pass('w', randomUUID(), 10);

  assert.deepEqual(result, { leased: 3, fenced: 1, failed: 2 });
  assert.deepEqual(queue.fenced, [ok.evidenceId]);
  assert.deepEqual(
    queue.retries.map((r) => [r.id, r.code]),
    [
      [down.evidenceId, 'MEDIA_UNAVAILABLE'],
      [refused.evidenceId, 'MEDIA_HTTP_404'],
    ],
  );
  // The link id is the claimRef, and the key is stable per link (a retry is the same request).
  assert.deepEqual(calls[0], {
    objectId: ok.mediaObjectId,
    claimRef: ok.evidenceId,
    key: fenceIdempotencyKey(ok.evidenceId),
  });
  assert.match(fenceIdempotencyKey(ok.evidenceId), /^[A-Za-z0-9_-]{16,128}$/);
});

test('retry delay grows with attempts, is jittered and capped at five minutes', () => {
  assert.equal(
    fenceRetryDelayMs(1, () => 0),
    500,
  );
  assert.equal(
    fenceRetryDelayMs(1, () => 1),
    1_000,
  );
  assert.equal(
    fenceRetryDelayMs(4, () => 1),
    8_000,
  );
  assert.equal(
    fenceRetryDelayMs(40, () => 1),
    300_000,
  );
  assert.equal(
    fenceRetryDelayMs(40, () => 0),
    150_000,
  );
});
