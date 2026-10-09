import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { objectKey, stagingKey } from '../../src/domain';
import {
  DISPATCH,
  MemoryObjectStore,
  TestClock,
  declare,
  errorCode,
  jpeg,
  key,
  meta,
  replica,
  technician,
  type Replica,
} from './support';

/**
 * Real PostgreSQL 16 (lane stack), RUNTIME role, two independent connection
 * pools standing in for two service replicas. The object store is the
 * in-memory double declared in support.ts; S3 itself is proven by the lane
 * suite tests/production/C/media-s3.test.mjs.
 *
 * Clocks: every scenario that depends on retention or deadlines runs on an
 * injected clock placed weeks in the past, so the worker passes it triggers
 * only ever see this suite's own fixtures.
 */
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const clock = new TestClock();
const objects = new MemoryObjectStore();
let a: Replica;
let b: Replica;

before(() => {
  a = replica(clock, objects);
  b = replica(clock, objects);
});

after(async () => {
  await a.prisma.client.$disconnect();
  await b.prisma.client.$disconnect();
});

async function rows<T>(sql: string, ...params: unknown[]): Promise<T[]> {
  return a.prisma.client.$queryRawUnsafe<T[]>(sql, ...params);
}

async function count(sql: string, ...params: unknown[]): Promise<number> {
  const [row] = await rows<{ n: number }>(sql, ...params);
  return Number(row?.n ?? 0);
}

/** SQLSTATE of a raw statement run as the runtime role. */
async function state(sql: string, ...params: unknown[]): Promise<string> {
  try {
    await a.prisma.client.$executeRawUnsafe(sql, ...params);
    return 'OK';
  } catch (error) {
    const cause = (
      error as {
        meta?: { driverAdapterError?: { cause?: { originalCode?: string; code?: string } } };
      }
    ).meta?.driverAdapterError?.cause;
    return cause?.originalCode ?? cause?.code ?? 'UNKNOWN';
  }
}

async function uploaded(
  target: Replica,
  tech = technician(),
  bytes: Buffer = jpeg(),
): Promise<{ id: string; tech: ReturnType<typeof technician>; bytes: Buffer }> {
  const { value } = await target.service.reserve(meta(tech), declare(bytes), key());
  objects.objects.set(stagingKey(value.record.object.id), bytes);
  return { id: value.record.object.id, tech, bytes };
}

async function available(target: Replica, tech = technician()) {
  const object = await uploaded(target, tech);
  const { value } = await target.service.finalize(meta(object.tech), object.id, key());
  assert.equal(value.object.status, 'AVAILABLE');
  return object;
}

// ------------------------------------------------------------ reservation

test('reservation is idempotent per (owner, key): same body replays, different body conflicts', async () => {
  clock.set(new Date());
  const tech = technician();
  const idem = key();
  const bytes = jpeg();
  const first = await a.service.reserve(meta(tech), declare(bytes), idem);
  const replay = await b.service.reserve(meta(tech), declare(bytes), idem);
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(replay.value.record.object.id, first.value.record.object.id);
  assert.ok(replay.value.upload, 'a replay of an open reservation gets a fresh upload URL');
  assert.equal(
    await errorCode(a.service.reserve(meta(tech), declare(jpeg(300)), idem)),
    'IDEMPOTENCY_CONFLICT',
  );
  // The same key from another owner is a different scope: a different object.
  const other = await a.service.reserve(meta(technician()), declare(bytes), idem);
  assert.notEqual(other.value.record.object.id, first.value.record.object.id);
  const stored = await rows<{ owner_subject: string; status: string; purpose: string }>(
    `SELECT owner_subject::text, status, purpose FROM app.media_object WHERE id = $1::uuid`,
    first.value.record.object.id,
  );
  assert.deepEqual(stored, [
    { owner_subject: tech.subject, status: 'RESERVED', purpose: 'WORK_EVIDENCE' },
  ]);
});

test('concurrent reservations with one key on two replicas create exactly one object', async () => {
  clock.set(new Date());
  const tech = technician();
  const idem = key();
  const body = declare(jpeg());
  const results = await Promise.all(
    Array.from({ length: 12 }, (_, i) => (i % 2 ? a : b).service.reserve(meta(tech), body, idem)),
  );
  const ids = new Set(results.map((r) => r.value.record.object.id));
  assert.equal(ids.size, 1);
  assert.equal(results.filter((r) => !r.replayed).length, 1);
  assert.equal(
    await count(
      `SELECT count(*)::int AS n FROM app.audit_entry WHERE action = 'media.reserved' AND target_id = $1::uuid`,
      [...ids][0],
    ),
    1,
  );
});

// ------------------------------------------------------------ finalize

test('two concurrent finalizes on two replicas produce one transition and one audit row', async () => {
  clock.set(new Date());
  objects.delayMs = 30; // both requests are inside their I/O phase at once
  try {
    for (let round = 0; round < 5; round += 1) {
      const { id, tech } = await uploaded(a);
      const [x, y] = await Promise.all([
        a.service.finalize(meta(tech), id, key()),
        b.service.finalize(meta(tech), id, key()),
      ]);
      assert.equal(x.value.object.status, 'AVAILABLE');
      assert.equal(y.value.object.status, 'AVAILABLE');
      assert.equal(x.value.object.version, 2);
      assert.equal(y.value.object.version, 2);
      assert.equal(
        await count(
          `SELECT count(*)::int AS n FROM app.audit_entry WHERE target_id = $1::uuid AND action IN ('media.finalized', 'media.rejected')`,
          id,
        ),
        1,
      );
      assert.ok(objects.objects.has(objectKey(id)), 'verified bytes stored under the final key');
      assert.ok(!objects.objects.has(stagingKey(id)), 'staging upload removed after finalize');
    }
  } finally {
    objects.delayMs = 0;
  }
});

test('finalize replay: same key returns the same object; finalizing AVAILABLE again is a no-op', async () => {
  clock.set(new Date());
  const { id, tech } = await uploaded(a);
  const idem = key();
  const first = await a.service.finalize(meta(tech), id, idem);
  const replay = await b.service.finalize(meta(tech), id, idem);
  assert.equal(replay.replayed, true);
  assert.equal(replay.value.object.version, first.value.object.version);
  const again = await a.service.finalize(meta(tech), id, key());
  assert.equal(again.value.object.status, 'AVAILABLE');
  assert.equal(again.value.object.version, 2);
  // The same key for another object is a misuse.
  const other = await uploaded(a, tech);
  assert.equal(
    await errorCode(a.service.finalize(meta(tech), other.id, idem)),
    'IDEMPOTENCY_CONFLICT',
  );
});

test('finalize before upload: UPLOAD_MISSING, state and idempotency untouched; retry with the same key succeeds', async () => {
  clock.set(new Date());
  const tech = technician();
  const bytes = jpeg();
  const { value } = await a.service.reserve(meta(tech), declare(bytes), key());
  const id = value.record.object.id;
  const idem = key();
  assert.equal(await errorCode(a.service.finalize(meta(tech), id, idem)), 'UPLOAD_MISSING');
  const [row] = await rows<{ status: string; version: number }>(
    `SELECT status, version FROM app.media_object WHERE id = $1::uuid`,
    id,
  );
  assert.deepEqual(row, { status: 'RESERVED', version: 1 });
  objects.objects.set(stagingKey(id), bytes);
  const retried = await a.service.finalize(meta(tech), id, idem);
  assert.equal(retried.value.object.status, 'AVAILABLE');
  assert.equal(retried.replayed, false);
});

test('storage failure during finalize: STORAGE_UNAVAILABLE, never success, state unchanged', async () => {
  clock.set(new Date());
  for (const op of ['read', 'write'] as const) {
    const { id, tech } = await uploaded(a);
    objects.failing = op;
    try {
      assert.equal(
        await errorCode(a.service.finalize(meta(tech), id, key())),
        'STORAGE_UNAVAILABLE',
      );
    } finally {
      objects.failing = null;
    }
    const [row] = await rows<{ status: string; version: number }>(
      `SELECT status, version FROM app.media_object WHERE id = $1::uuid`,
      id,
    );
    assert.deepEqual(row, { status: 'RESERVED', version: 1 }, op);
    assert.equal(
      (await a.service.finalize(meta(tech), id, key())).value.object.status,
      'AVAILABLE',
    );
  }
});

test('mismatching or mis-typed bytes are REJECTED with a reason and their bytes deleted', async () => {
  clock.set(new Date());
  const tech = technician();
  const declared = jpeg(400);
  const { value } = await a.service.reserve(meta(tech), declare(declared), key());
  const swapped = Buffer.from(declared);
  swapped[200] = (swapped[200]! + 1) % 256;
  objects.objects.set(stagingKey(value.record.object.id), swapped);
  const mismatch = await a.service.finalize(meta(tech), value.record.object.id, key());
  assert.equal(mismatch.value.object.status, 'REJECTED');
  assert.equal(mismatch.value.object.rejectReason, 'UPLOAD_MISMATCH');
  assert.ok(!objects.objects.has(stagingKey(value.record.object.id)));
  assert.ok(!objects.objects.has(objectKey(value.record.object.id)));

  const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(100, 1)]);
  const typed = await a.service.reserve(meta(tech), declare(gif, 'image/png'), key());
  objects.objects.set(stagingKey(typed.value.record.object.id), gif);
  const unsupported = await a.service.finalize(meta(tech), typed.value.record.object.id, key());
  assert.equal(unsupported.value.object.rejectReason, 'UNSUPPORTED_MEDIA');
  assert.equal(
    await errorCode(a.service.issueReadUrl(meta(tech), typed.value.record.object.id)),
    'OBJECT_NOT_AVAILABLE',
  );
  assert.equal(
    await errorCode(a.service.issueUploadUrl(meta(tech), typed.value.record.object.id)),
    'OBJECT_NOT_AVAILABLE',
  );
});

test('owner-only access: another technician gets OBJECT_NOT_FOUND for every route', async () => {
  clock.set(new Date());
  const { id } = await available(a);
  const stranger = meta(technician());
  assert.equal(await errorCode(a.service.getObject(stranger, id)), 'OBJECT_NOT_FOUND');
  assert.equal(await errorCode(a.service.issueReadUrl(stranger, id)), 'OBJECT_NOT_FOUND');
  assert.equal(await errorCode(a.service.issueUploadUrl(stranger, id)), 'OBJECT_NOT_FOUND');
  assert.equal(await errorCode(a.service.finalize(stranger, id, key())), 'OBJECT_NOT_FOUND');
  assert.equal((await a.service.getObject(meta(DISPATCH), id)).object.id, id);
});

// ------------------------------------------------------------ claims

test('claims: idempotent per (object, claimRef), concurrent duplicates collapse, only AVAILABLE', async () => {
  clock.set(new Date());
  const { id } = await available(a);
  const claimRef = randomUUID();
  const body = { claimRef, holder: 'dispatch.task-evidence' };
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, i) => (i % 2 ? a : b).service.claim(meta(DISPATCH), id, body)),
  );
  assert.equal(results.filter((r) => !r.replayed).length, 1);
  assert.ok(results.every((r) => r.value.record.claimed && r.value.claim.claimRef === claimRef));
  await a.service.claim(meta(DISPATCH), id, { ...body, claimRef: randomUUID() });
  assert.equal(
    await count(`SELECT count(*)::int AS n FROM app.object_claim WHERE object_id = $1::uuid`, id),
    2,
  );
  assert.equal(
    await count(
      `SELECT count(*)::int AS n FROM app.audit_entry WHERE action = 'media.claimed' AND target_id = $1::uuid`,
      id,
    ),
    2,
  );
  const reserved = await uploaded(a);
  assert.equal(
    await errorCode(a.service.claim(meta(DISPATCH), reserved.id, body)),
    'OBJECT_NOT_AVAILABLE',
  );
  assert.equal(
    await errorCode(a.service.claim(meta(DISPATCH), randomUUID(), body)),
    'OBJECT_NOT_FOUND',
  );
});

// ------------------------------------------------------------ worker passes

test('purge with SKIP LOCKED across two pools: every unclaimed object purged once, claimed kept', async () => {
  const past = new Date(Date.now() - 40 * DAY);
  clock.set(past);
  const fixtures: string[] = [];
  for (let i = 0; i < 16; i += 1) fixtures.push((await available(a)).id);
  const kept = fixtures.slice(0, 3);
  for (const id of kept) {
    await a.service.claim(meta(DISPATCH), id, {
      claimRef: randomUUID(),
      holder: 'dispatch.task-evidence',
    });
  }
  clock.set(new Date(past.getTime() + 25 * HOUR));
  objects.delayMs = 15; // deletes overlap, so the replicas contend for rows
  try {
    const [x, y] = await Promise.all([
      a.service.purgePass(randomUUID(), 50),
      b.service.purgePass(randomUUID(), 50),
    ]);
    const purged = await rows<{ id: string }>(
      `SELECT id::text FROM app.media_object WHERE id = ANY($1::uuid[]) AND status = 'PURGED'`,
      fixtures,
    );
    assert.equal(purged.length, 13);
    assert.ok(x.purged + y.purged >= 13);
  } finally {
    objects.delayMs = 0;
  }
  const audits = await rows<{ target_id: string; n: number }>(
    `SELECT target_id::text, count(*)::int AS n FROM app.audit_entry
      WHERE action = 'media.purged' AND target_id = ANY($1::uuid[]) GROUP BY 1`,
    fixtures,
  );
  assert.equal(audits.length, 13);
  assert.ok(
    audits.every((r) => r.n === 1),
    'no object purged twice',
  );
  for (const id of fixtures) {
    const stays = kept.includes(id);
    assert.equal(objects.objects.has(objectKey(id)), stays, id);
  }
  const claimedStates = await rows<{ status: string }>(
    `SELECT status FROM app.media_object WHERE id = ANY($1::uuid[])`,
    kept,
  );
  assert.ok(
    claimedStates.every((r) => r.status === 'AVAILABLE'),
    'claimed objects are never purged',
  );
});

test('expiry: RESERVED past deadline + grace becomes EXPIRED once and stray bytes are deleted', async () => {
  const past = new Date(Date.now() - 30 * DAY);
  clock.set(past);
  const stray = await uploaded(a); // bytes present but never finalized
  const empty = await a.service.reserve(meta(technician()), declare(jpeg()), key());
  clock.set(new Date(past.getTime() + 16 * 60_000)); // past deadline, inside the grace
  await a.service.purgePass(randomUUID(), 50);
  assert.equal(
    await count(
      `SELECT count(*)::int AS n FROM app.media_object WHERE id = $1::uuid AND status = 'RESERVED'`,
      stray.id,
    ),
    1,
  );
  assert.equal(
    await errorCode(a.service.finalize(meta(stray.tech), stray.id, key())),
    'OBJECT_NOT_AVAILABLE',
  );
  clock.set(new Date(past.getTime() + 18 * 60_000));
  await Promise.all([a.service.purgePass(randomUUID(), 50), b.service.purgePass(randomUUID(), 50)]);
  const states = await rows<{ status: string; n: number }>(
    `SELECT status, count(*)::int AS n FROM app.media_object WHERE id = ANY($1::uuid[]) GROUP BY 1`,
    [stray.id, empty.value.record.object.id],
  );
  assert.deepEqual(states, [{ status: 'EXPIRED', n: 2 }]);
  assert.ok(!objects.objects.has(stagingKey(stray.id)));
  assert.equal(
    await count(
      `SELECT count(*)::int AS n FROM app.audit_entry WHERE action = 'media.expired' AND target_id = $1::uuid`,
      stray.id,
    ),
    1,
  );
});

test('sweep: a re-used staging upload after finalize is deleted once no URL can be valid', async () => {
  const past = new Date(Date.now() - 20 * DAY);
  clock.set(past);
  const { id, bytes } = await available(a);
  objects.objects.set(stagingKey(id), bytes); // the client PUT again with its still-valid URL
  clock.set(new Date(past.getTime() + 18 * 60_000));
  await a.service.purgePass(randomUUID(), 50);
  assert.ok(!objects.objects.has(stagingKey(id)));
  assert.ok(objects.objects.has(objectKey(id)), 'verified bytes are untouched');
  const [row] = await rows<{ version: number; swept: boolean }>(
    `SELECT version, storage_swept_at IS NOT NULL AS swept FROM app.media_object WHERE id = $1::uuid`,
    id,
  );
  assert.deepEqual(row, { version: 2, swept: true }, 'bookkeeping only, no new revision');
});

test('idempotency records are purged in bounded batches', async () => {
  const purged = await a.store.purgeIdempotencyBefore(new Date(Date.now() + DAY), 5);
  assert.ok(purged <= 5);
});

// ------------------------------------------------------------ database guards

test('database CHECKs and triggers refuse inconsistent rows even from the runtime role', async () => {
  clock.set(new Date());
  const now = new Date();
  const later = new Date(now.getTime() + HOUR);
  const insert = (status: string, extra: Record<string, unknown> = {}) => {
    const row = {
      id: randomUUID(),
      owner_subject: randomUUID(),
      purpose: 'WORK_EVIDENCE',
      content_type: 'image/jpeg',
      byte_length: 100,
      sha256: 'a'.repeat(64),
      status,
      reject_reason: null,
      reservation_expires_at: later,
      finalized_at: null,
      expired_at: null,
      purged_at: null,
      storage_swept_at: null,
      created_at: now,
      updated_at: now,
      ...extra,
    };
    const columns = Object.keys(row);
    return state(
      `INSERT INTO app.media_object (${columns.join(', ')})
       VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')})`,
      ...Object.values(row),
    );
  };
  assert.equal(await insert('RESERVED'), 'OK');
  assert.equal(await insert('DONE'), '23514', 'unknown status');
  assert.equal(await insert('AVAILABLE'), '23514', 'AVAILABLE without finalized_at');
  assert.equal(await insert('REJECTED', { finalized_at: now }), '23514', 'REJECTED without reason');
  assert.equal(
    await insert('RESERVED', { reject_reason: 'UPLOAD_MISMATCH' }),
    '23514',
    'reason on a non-rejected object',
  );
  assert.equal(await insert('EXPIRED', { expired_at: now }), '23514', 'EXPIRED without sweep mark');
  assert.equal(await insert('RESERVED', { content_type: 'image/gif' }), '23514');
  assert.equal(await insert('RESERVED', { byte_length: 19 }), '23514');
  assert.equal(await insert('RESERVED', { byte_length: 10_485_761 }), '23514');
  assert.equal(await insert('RESERVED', { sha256: 'A'.repeat(64) }), '23514');
  assert.equal(await insert('RESERVED', { purpose: 'AVATAR' }), '23514');
  assert.equal(await insert('RESERVED', { reservation_expires_at: now }), '23514');

  const { id: rejectedId } = await (async () => {
    const tech = technician();
    const bytes = jpeg();
    const { value } = await a.service.reserve(meta(tech), declare(bytes), key());
    objects.objects.set(
      stagingKey(value.record.object.id),
      Buffer.from('not the declared bytes...'),
    );
    await a.service.finalize(meta(tech), value.record.object.id, key());
    return { id: value.record.object.id };
  })();
  assert.equal(
    await state(
      `UPDATE app.media_object SET status = 'AVAILABLE', reject_reason = NULL, version = version + 1 WHERE id = $1::uuid`,
      rejectedId,
    ),
    '23514',
    'REJECTED -> AVAILABLE is not a transition',
  );
  const { id } = await available(a);
  assert.equal(
    await state(
      `UPDATE app.media_object SET status = 'PURGED', purged_at = now(), storage_swept_at = now() WHERE id = $1::uuid`,
      id,
    ),
    '23514',
    'a transition must bump the version',
  );
  assert.equal(
    await state(`UPDATE app.media_object SET sha256 = $2 WHERE id = $1::uuid`, id, 'b'.repeat(64)),
    '23514',
    'the declared digest is immutable',
  );
  assert.equal(
    await state(
      `UPDATE app.media_object SET finalized_at = now() - interval '9 days' WHERE id = $1::uuid`,
      id,
    ),
    '23514',
    'timestamps cannot be rewritten without a transition',
  );
  assert.equal(await state(`DELETE FROM app.media_object WHERE id = $1::uuid`, id), '23514');
  await a.service.claim(meta(DISPATCH), id, {
    claimRef: randomUUID(),
    holder: 'dispatch.task-evidence',
  });
  assert.equal(
    await state(
      `UPDATE app.media_object SET status = 'PURGED', purged_at = now(), storage_swept_at = now(), version = version + 1 WHERE id = $1::uuid`,
      id,
    ),
    '23514',
    'a claimed object can never be purged',
  );
  assert.equal(
    await state(
      `INSERT INTO app.object_claim (object_id, claim_ref, holder, created_at) VALUES ($1::uuid, $2::uuid, 'dispatch.task-evidence', now())`,
      rejectedId,
      randomUUID(),
    ),
    '23514',
    'claims only on AVAILABLE objects',
  );
  assert.equal(
    await state(
      `INSERT INTO app.object_claim (object_id, claim_ref, holder, created_at) VALUES ($1::uuid, $2::uuid, 'booking.other', now())`,
      id,
      randomUUID(),
    ),
    '23514',
  );
  assert.equal(await state(`DELETE FROM app.object_claim WHERE object_id = $1::uuid`, id), '23514');
  assert.equal(
    await state(`UPDATE app.audit_entry SET action = 'x' WHERE target_id = $1::uuid`, id),
    '23514',
  );
  assert.equal(await state(`DELETE FROM app.audit_entry WHERE target_id = $1::uuid`, id), '23514');
});

test('the runtime role has DML only: no DDL and no access to the migration history', async () => {
  assert.equal(await state(`CREATE TABLE app.intruder (id int)`), '42501');
  assert.equal(await state(`SELECT 1 FROM app._prisma_migrations`), '42501');
  assert.equal(
    await state(`ALTER TABLE app.media_object DISABLE TRIGGER media_object_guard_trg`),
    '42501',
  );
});

test('audit details carry no subject ids, keys or URLs', async () => {
  const details = await rows<{ details: Record<string, unknown> }>(
    `SELECT details FROM app.audit_entry ORDER BY occurred_at DESC LIMIT 200`,
  );
  for (const { details: d } of details) {
    const text = JSON.stringify(d);
    assert.ok(!/objects\/|uploads\/|https?:|X-Amz|Signature/i.test(text), text);
    assert.ok(!('ownerSubject' in d) && !('subject' in d));
  }
});
