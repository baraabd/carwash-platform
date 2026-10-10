import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mediaPolicy } from '../../src/application';
import {
  BYTE_LIMITS,
  MediaError,
  assertClaimable,
  declaredUpload,
  isExpiryDue,
  isPurgeDue,
  isReservationOpen,
  isSweepDue,
  markAvailable,
  markExpired,
  markPurged,
  markRejected,
  markSwept,
  objectKey,
  reserve,
  residualKeys,
  sniffContentType,
  stagingKey,
  uuid,
  verifyUpload,
  type DeclaredUpload,
  type MediaObjectState,
} from '../../src/domain';

const T0 = new Date('2026-10-10T08:00:00.000Z');
const MIN = 60_000;
const ID = '5b4f2a6e-0d1c-4b8e-9a7f-3c2d1e0f9a8b';
const OWNER = '0b8f6f8e-1d5a-4c1e-9e5f-0a3b2c1d4e5f';
const at = (ms: number) => new Date(T0.getTime() + ms);
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60, 1)]);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(60, 2),
]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x24, 0, 0, 0]),
  Buffer.from('WEBPVP8 '),
  Buffer.alloc(60, 3),
]);
const GIF = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(60, 4)]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>');

function declared(bytes: Buffer, contentType: DeclaredUpload['contentType']): DeclaredUpload {
  return { purpose: 'WORK_EVIDENCE', contentType, byteLength: bytes.length, sha256: sha(bytes) };
}

function observed(bytes: Buffer) {
  return { byteLength: bytes.length, sha256: sha(bytes), head: bytes.subarray(0, 12) };
}

function reserved(ttlMs = 15 * MIN): MediaObjectState {
  return reserve({
    id: ID,
    ownerSubject: OWNER,
    declared: declared(JPEG, 'image/jpeg'),
    now: T0,
    ttlMs,
  });
}

// ------------------------------------------------------------ content sniffing

test('magic bytes: JPEG, PNG and WebP are recognised from their signatures', () => {
  assert.equal(sniffContentType(JPEG), 'image/jpeg');
  assert.equal(sniffContentType(PNG), 'image/png');
  assert.equal(sniffContentType(WEBP), 'image/webp');
});

test('magic bytes: GIF, SVG, HEIC-like, RIFF/WAVE, truncated and empty heads are not images', () => {
  assert.equal(sniffContentType(GIF), null);
  assert.equal(sniffContentType(SVG), null);
  const heic = Buffer.concat([
    Buffer.from([0, 0, 0, 0x18]),
    Buffer.from('ftypheic'),
    Buffer.alloc(8),
  ]);
  assert.equal(sniffContentType(heic), null);
  const wave = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE')]);
  assert.equal(sniffContentType(wave), null);
  assert.equal(sniffContentType(Buffer.from([0xff, 0xd8])), null, 'two JPEG bytes are not enough');
  assert.equal(sniffContentType(PNG.subarray(0, 7)), null);
  assert.equal(sniffContentType(Buffer.from('RIFF\0\0\0\0WEB')), null);
  assert.equal(sniffContentType(new Uint8Array(0)), null);
});

test('verification: exact length and digest, then the declared format', () => {
  assert.deepEqual(verifyUpload(declared(JPEG, 'image/jpeg'), observed(JPEG)), { ok: true });
  assert.deepEqual(verifyUpload(declared(PNG, 'image/png'), observed(PNG)), { ok: true });
  assert.deepEqual(verifyUpload(declared(WEBP, 'image/webp'), observed(WEBP)), { ok: true });
  const flipped = Buffer.from(JPEG);
  flipped[30] = 0x99;
  assert.deepEqual(verifyUpload(declared(JPEG, 'image/jpeg'), observed(flipped)), {
    ok: false,
    reason: 'UPLOAD_MISMATCH',
  });
  const longer = Buffer.concat([JPEG, Buffer.from([0])]);
  assert.deepEqual(verifyUpload(declared(JPEG, 'image/jpeg'), observed(longer)), {
    ok: false,
    reason: 'UPLOAD_MISMATCH',
  });
  // Declared PNG, bytes are a genuine JPEG: the digest matches, the format does not.
  assert.deepEqual(verifyUpload(declared(JPEG, 'image/png'), observed(JPEG)), {
    ok: false,
    reason: 'UNSUPPORTED_MEDIA',
  });
  assert.deepEqual(verifyUpload(declared(GIF, 'image/jpeg'), observed(GIF)), {
    ok: false,
    reason: 'UNSUPPORTED_MEDIA',
  });
});

// ------------------------------------------------------------ input validation

test('reservation body: purpose, type, size bounds (20 .. 10 MiB) and lower-case hex digest', () => {
  const good = {
    purpose: 'WORK_EVIDENCE',
    contentType: 'image/webp',
    byteLength: BYTE_LIMITS.max,
    sha256: 'a'.repeat(64),
  };
  assert.deepEqual(declaredUpload(good), good);
  assert.equal(declaredUpload({ ...good, byteLength: 20 }).byteLength, 20);
  const bad: Array<[string, Record<string, unknown>]> = [
    ['purpose', { ...good, purpose: 'AVATAR' }],
    ['heic', { ...good, contentType: 'image/heic' }],
    ['svg', { ...good, contentType: 'image/svg+xml' }],
    ['case', { ...good, contentType: 'IMAGE/JPEG' }],
    ['too small', { ...good, byteLength: 19 }],
    ['too large', { ...good, byteLength: BYTE_LIMITS.max + 1 }],
    ['fraction', { ...good, byteLength: 20.5 }],
    ['string length', { ...good, byteLength: '100' }],
    ['upper hex', { ...good, sha256: 'A'.repeat(64) }],
    ['short hex', { ...good, sha256: 'a'.repeat(63) }],
    ['not hex', { ...good, sha256: 'g'.repeat(64) }],
  ];
  for (const [label, input] of bad) {
    assert.throws(
      () =>
        declaredUpload({
          purpose: input.purpose,
          contentType: input.contentType,
          byteLength: input.byteLength,
          sha256: input.sha256,
        }),
      (error: unknown) => error instanceof MediaError && error.code === 'INVALID_INPUT',
      label,
    );
  }
});

test('identifiers are UUIDs, normalised to lower case', () => {
  assert.equal(uuid(ID.toUpperCase(), 'objectId'), ID);
  assert.throws(() => uuid('objects/../x', 'objectId'), /objectId must be a UUID/);
  assert.throws(() => uuid(42, 'objectId'), /objectId must be a UUID/);
});

// ------------------------------------------------------------ state machine

test('keys carry only the opaque id', () => {
  assert.equal(objectKey(ID), `objects/${ID}`);
  assert.equal(stagingKey(ID), `uploads/${ID}`);
});

test('RESERVED -> AVAILABLE before the deadline, version + 1, finalizedAt set', () => {
  const object = reserved();
  assert.equal(object.status, 'RESERVED');
  assert.equal(object.version, 1);
  assert.equal(object.reservationExpiresAt.getTime(), at(15 * MIN).getTime());
  assert.ok(isReservationOpen(object, at(15 * MIN - 1)));
  assert.ok(!isReservationOpen(object, at(15 * MIN)), 'the deadline itself is closed');
  const available = markAvailable(object, at(MIN));
  assert.equal(available.status, 'AVAILABLE');
  assert.equal(available.version, 2);
  assert.equal(available.finalizedAt?.getTime(), at(MIN).getTime());
  assert.equal(available.rejectReason, null);
});

test('RESERVED -> REJECTED records the reason; terminal states refuse finalize', () => {
  const rejected = markRejected(reserved(), 'UNSUPPORTED_MEDIA', at(MIN));
  assert.equal(rejected.status, 'REJECTED');
  assert.equal(rejected.rejectReason, 'UNSUPPORTED_MEDIA');
  const notAvailable = (error: unknown) =>
    error instanceof MediaError && error.code === 'OBJECT_NOT_AVAILABLE';
  assert.throws(() => markAvailable(rejected, at(2 * MIN)), notAvailable);
  assert.throws(() => markRejected(rejected, 'UPLOAD_MISMATCH', at(2 * MIN)), notAvailable);
  assert.throws(() => markAvailable(markAvailable(reserved(), at(MIN)), at(2 * MIN)), notAvailable);
  assert.throws(() => markAvailable(reserved(), at(15 * MIN)), notAvailable, 'past the deadline');
});

test('RESERVED -> EXPIRED only after deadline + grace; marks the keys swept', () => {
  const grace = 2 * MIN;
  const object = reserved();
  assert.ok(!isExpiryDue(object, at(15 * MIN), grace));
  assert.ok(!isExpiryDue(object, at(17 * MIN - 1), grace));
  assert.ok(isExpiryDue(object, at(17 * MIN), grace));
  assert.throws(() => markExpired(object, at(16 * MIN), grace), /RESERVATION_NOT_DUE/);
  const expired = markExpired(object, at(17 * MIN), grace);
  assert.equal(expired.status, 'EXPIRED');
  assert.equal(expired.version, 2);
  assert.equal(expired.storageSweptAt?.getTime(), at(17 * MIN).getTime());
  assert.ok(!isExpiryDue(markAvailable(object, at(MIN)), at(60 * MIN), grace));
  assert.deepEqual(residualKeys(expired), [stagingKey(ID), objectKey(ID)]);
});

test('claims: only AVAILABLE inside the claim window; purge only unclaimed after retention', () => {
  const policy = { retentionMs: 24 * 60 * MIN, claimGuardMs: 60 * MIN };
  const available = markAvailable(reserved(), at(0));
  assertClaimable(available, policy, at(23 * 60 * MIN - 1));
  assert.throws(() => assertClaimable(available, policy, at(23 * 60 * MIN)), /usable state/);
  assert.throws(() => assertClaimable(reserved(), policy, at(MIN)), /usable state/);
  const rejected = markRejected(reserved(), 'UPLOAD_MISMATCH', at(MIN));
  assert.throws(() => assertClaimable(rejected, policy, at(2 * MIN)), /usable state/);

  assert.ok(!isPurgeDue(available, false, policy, at(24 * 60 * MIN - 1)));
  assert.ok(isPurgeDue(available, false, policy, at(24 * 60 * MIN)));
  assert.ok(!isPurgeDue(available, true, policy, at(365 * 24 * 60 * MIN)), 'claimed: never');
  assert.ok(!isPurgeDue(rejected, false, policy, at(365 * 24 * 60 * MIN)), 'not AVAILABLE');
  assert.throws(
    () => markPurged(available, true, policy, at(48 * 60 * MIN)),
    /OBJECT_NOT_PURGEABLE/,
  );
  const purged = markPurged(available, false, policy, at(48 * 60 * MIN));
  assert.equal(purged.status, 'PURGED');
  assert.equal(purged.version, available.version + 1);
  assert.ok(purged.purgedAt && purged.storageSweptAt);
});

test('the claim window always closes strictly before purge eligibility (guard band)', () => {
  const policy = mediaPolicy();
  const available = markAvailable(reserved(), T0);
  for (let t = 0; t <= policy.retentionMs + MIN; t += MIN) {
    let claimable = true;
    try {
      assertClaimable(available, policy, at(t));
    } catch {
      claimable = false;
    }
    assert.ok(!(claimable && isPurgeDue(available, false, policy, at(t))), `t=${t}`);
  }
});

test('sweep: finalized objects only, once, after deadline + grace, without a new revision', () => {
  const grace = 2 * MIN;
  const available = markAvailable(reserved(), at(MIN));
  assert.ok(!isSweepDue(available, at(16 * MIN), grace));
  assert.ok(isSweepDue(available, at(17 * MIN), grace));
  assert.deepEqual(residualKeys(available), [stagingKey(ID)], 'verified bytes stay');
  const swept = markSwept(available, at(17 * MIN));
  assert.equal(swept.version, available.version);
  assert.ok(!isSweepDue(swept, at(60 * MIN), grace));
  const rejected = markRejected(reserved(), 'UPLOAD_MISMATCH', at(MIN));
  assert.deepEqual(residualKeys(rejected), [stagingKey(ID), objectKey(ID)]);
  assert.ok(!isSweepDue(reserved(), at(60 * MIN), grace), 'RESERVED is the expiry path');
});

test('policy: defaults are inside bounds; out-of-range and inconsistent values stop the process', () => {
  const policy = mediaPolicy();
  assert.equal(policy.reservationTtlMs, 15 * MIN);
  assert.equal(policy.readUrlTtlMs, 120_000);
  assert.throws(() => mediaPolicy({ readUrlTtlMs: 59 }), /OUT_OF_RANGE_readUrlTtlMs/);
  assert.throws(() => mediaPolicy({ readUrlTtlMs: 301 }), /OUT_OF_RANGE_readUrlTtlMs/);
  assert.throws(
    () => mediaPolicy({ reservationTtlMs: 300, uploadUrlTtlMs: 600 }),
    /UPLOAD_URL_OUTLIVES_RESERVATION/,
  );
  assert.throws(
    () => mediaPolicy({ retentionMs: 7_200, claimGuardMs: 3_601 }),
    /CLAIM_GUARD_TOO_LARGE/,
  );
});
