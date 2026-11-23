// Executes the BUILT @carwash/contracts package (dist), i.e. what consumers import.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const c = require('../../../packages/contracts/dist/index.js');

const throwsCode = (fn, code) =>
  assert.throws(fn, (error) => error instanceof c.ContractViolation && error.code === code);

test('money: exact minor units, closed currency, fixed scale', () => {
  const price = c.parseMoney({ currency: 'SYP', amountMinor: '150000', scale: 2 }, '$.price');
  assert.deepEqual(price, { currency: 'SYP', amountMinor: '150000', scale: 2 });
  // 0.1 + 0.2 style binary drift is impossible: values are bigint minor units.
  const total = c.sumMoney('SYP', [
    c.money('SYP', 10n),
    c.money('SYP', 20n),
    c.multiplyMoney(c.money('SYP', 999_999_999_999n), 3),
  ]);
  assert.equal(total.amountMinor, '3000000000027');
  assert.equal(c.compareMoney(c.money('SYP', 5n), c.money('SYP', 7n)), -1);
  assert.equal(c.subtractMoney(c.money('SYP', 5n), c.money('SYP', 7n)).amountMinor, '-2');
});

test('money: rejects floats, numbers, wrong scale, unknown currency, overflow, mixing', () => {
  throwsCode(
    () => c.parseMoney({ currency: 'SYP', amountMinor: 1500, scale: 2 }, '$'),
    'INVALID_MONEY_AMOUNT',
  );
  throwsCode(
    () => c.parseMoney({ currency: 'SYP', amountMinor: '15.00', scale: 2 }, '$'),
    'INVALID_MONEY_AMOUNT',
  );
  throwsCode(
    () => c.parseMoney({ currency: 'SYP', amountMinor: '007', scale: 2 }, '$'),
    'INVALID_MONEY_AMOUNT',
  );
  throwsCode(
    () => c.parseMoney({ currency: 'SYP', amountMinor: '-0', scale: 2 }, '$'),
    'INVALID_MONEY_AMOUNT',
  );
  throwsCode(
    () => c.parseMoney({ currency: 'SYP', amountMinor: '1', scale: 0 }, '$'),
    'UNSUPPORTED_MONEY_SCALE',
  );
  throwsCode(
    () => c.parseMoney({ currency: 'EUR', amountMinor: '1', scale: 2 }, '$'),
    'INVALID_ENUM',
  );
  throwsCode(
    () => c.parseMoney({ currency: 'SYP', amountMinor: '1', scale: 2, x: 1 }, '$'),
    'UNEXPECTED_FIELD',
  );
  throwsCode(
    () => c.parseMoney({ currency: 'SYP', amountMinor: '1'.repeat(19), scale: 2 }, '$'),
    'INVALID_MONEY_AMOUNT',
  );
  throwsCode(() => c.money('SYP', 10n ** 18n), 'MONEY_OUT_OF_RANGE');
  throwsCode(() => c.addMoney(c.money('SYP', 1n), c.money('USD', 1n)), 'CURRENCY_MISMATCH');
  throwsCode(() => c.multiplyMoney(c.money('SYP', 1n), 1.5), 'INVALID_QUANTITY');
  throwsCode(
    () => c.parseNonNegativeMoney({ currency: 'SYP', amountMinor: '-5', scale: 2 }, '$'),
    'NEGATIVE_MONEY',
  );
});

test('time: canonical UTC instants and real civil dates only', () => {
  assert.equal(c.parseUtc('2026-10-07T08:30:00.000Z', '$'), '2026-10-07T08:30:00.000Z');
  for (const bad of [
    '2026-10-07T08:30:00Z',
    '2026-10-07T11:30:00.000+03:00',
    '2026-02-30T00:00:00.000Z',
    1,
    null,
  ]) {
    throwsCode(() => c.parseUtc(bad, '$'), 'INVALID_TIMESTAMP');
  }
  assert.equal(c.parseLocalDate('2028-02-29', '$'), '2028-02-29');
  throwsCode(() => c.parseLocalDate('2027-02-29', '$'), 'INVALID_DATE');
  assert.equal(c.utc(new Date(Date.UTC(2026, 9, 7))), '2026-10-07T00:00:00.000Z');
});

test('error envelope: stable code/status/retryable mapping and strict parsing', () => {
  const ids = { requestId: 'req-1', correlationId: 'corr-1' };
  const err = c.apiError('IDEMPOTENCY_CONFLICT', 'key reused', ids);
  assert.equal(c.API_ERROR_STATUS.IDEMPOTENCY_CONFLICT, 409);
  assert.equal(err.error.retryable, false);
  assert.deepEqual(c.parseApiErrorEnvelope(err), err);
  assert.equal(c.apiError('UPSTREAM_UNAVAILABLE', 'x', ids).error.retryable, true);
  // A timeout on a mutation is never retryable blindly.
  assert.equal(c.apiError('OUTCOME_UNKNOWN', 'x', ids).error.retryable, false);
  throwsCode(
    () => c.parseApiErrorEnvelope({ error: { ...err.error, retryable: true } }),
    'INCONSISTENT_RETRYABLE',
  );
  for (const code of c.API_ERROR_CODES) assert.ok(c.API_ERROR_STATUS[code] >= 400, code);
});

test('idempotency: key format and deterministic fingerprint material', () => {
  assert.equal(c.parseIdempotencyKey('abcdefghij0123456789'), 'abcdefghij0123456789');
  throwsCode(() => c.parseIdempotencyKey('short'), 'INVALID_IDEMPOTENCY_KEY');
  throwsCode(() => c.parseIdempotencyKey('has space in it 12345'), 'INVALID_IDEMPOTENCY_KEY');
  const a = c.idempotencyMaterial({
    operation: 'vehicle.create',
    actor: 'u1',
    target: null,
    body: { b: 1, a: [1, 'x'] },
  });
  const b = c.idempotencyMaterial({
    operation: 'vehicle.create',
    actor: 'u1',
    target: null,
    body: { a: [1, 'x'], b: 1 },
  });
  assert.equal(a, b, 'key order must not change the fingerprint');
  const otherActor = c.idempotencyMaterial({
    operation: 'vehicle.create',
    actor: 'u2',
    target: null,
    body: { a: [1, 'x'], b: 1 },
  });
  assert.notEqual(a, otherActor, 'actor is part of the scope');
  // NFC normalization: composed and decomposed Arabic/Latin text fingerprint identically.
  assert.equal(c.canonicalJson('é'), c.canonicalJson('é'));
  throwsCode(() => c.canonicalJson({ x: Number.NaN }), 'NON_FINITE_NUMBER');
});

test('revision: If-Match round trip and refusal of weak/invalid tags', () => {
  assert.equal(c.formatIfMatch(7), '"7"');
  assert.equal(c.parseIfMatch('"7"'), 7);
  throwsCode(() => c.parseIfMatch(undefined), 'REVISION_REQUIRED');
  for (const bad of ['7', 'W/"7"', '"0"', '"-1"', '"99999999999"']) {
    assert.throws(() => c.parseIfMatch(bad), c.ContractViolation, bad);
  }
});

test('pagination: bounded limit, opaque cursor, closed page shape', () => {
  assert.deepEqual(c.parsePageRequest({}), { limit: 20, cursor: null });
  assert.deepEqual(c.parsePageRequest({ limit: '50', cursor: 'abc_-1' }), {
    limit: 50,
    cursor: 'abc_-1',
  });
  throwsCode(() => c.parsePageRequest({ limit: '0' }), 'INVALID_INTEGER');
  throwsCode(() => c.parsePageRequest({ limit: '101' }), 'INVALID_INTEGER');
  throwsCode(() => c.parsePageRequest({ cursor: 'a/b' }), 'INVALID_FORMAT');
  const page = c.parsePage(
    { items: [1, 2], nextCursor: null, asOf: '2026-10-07T00:00:00.000Z' },
    '$',
    (x) => x,
  );
  assert.deepEqual(page, { items: [1, 2], nextCursor: null, asOf: '2026-10-07T00:00:00.000Z' });
  throwsCode(
    () =>
      c.parsePage(
        { items: [], nextCursor: null, asOf: '2026-10-07T00:00:00.000Z', total: 2 },
        '$',
        (x) => x,
      ),
    'UNEXPECTED_FIELD',
  );
});

test('text: NFC, length in code points, control characters refused', () => {
  assert.equal(c.text('سيارة', '$', { max: 5 }), 'سيارة');
  throwsCode(() => c.text('a\u0000b', '$', { max: 10 }), 'INVALID_CHARACTERS');
  throwsCode(() => c.text('', '$', { max: 10 }), 'INVALID_LENGTH');
  assert.equal(c.isTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'), true);
  assert.equal(c.isTraceparent('00-00000000000000000000000000000000-00f067aa0ba902b7-01'), false);
});

test('error envelope: owner reason and retry hint rules', () => {
  const ids = { requestId: 'r', correlationId: 'c' };
  const quote = c.apiError('BUSINESS_RULE_VIOLATION', 'x', ids, { reason: 'QUOTE_EXPIRED' });
  assert.equal(quote.error.reason, 'QUOTE_EXPIRED');
  assert.deepEqual(c.parseApiErrorEnvelope(quote), quote);
  const limited = c.apiError('RATE_LIMITED', 'x', ids, { retryAfterMs: 1500 });
  assert.equal(limited.error.retryAfterMs, 1500);
  throwsCode(() => c.apiError('CONFLICT', 'x', ids, { retryAfterMs: 10 }), 'INVALID_RETRY_AFTER');
  throwsCode(() => c.apiError('CONFLICT', 'x', ids, { reason: 'lower' }), 'INVALID_ERROR_REASON');
  throwsCode(
    () => c.parseApiErrorEnvelope({ error: { ...quote.error, retryAfterMs: 5 } }),
    'INVALID_RETRY_AFTER',
  );
});

test('coordinates: fixed 6-decimal strings, exact range, device conversion refuses non-finite', () => {
  assert.deepEqual(c.parseCoordinates({ latitude: '33.513800', longitude: '36.276500' }, '$'), {
    latitude: '33.513800',
    longitude: '36.276500',
  });
  assert.deepEqual(c.coordinatesFromDegrees(-0.0000001, 36.2765), {
    latitude: '0.000000',
    longitude: '36.276500',
  });
  throwsCode(
    () => c.parseCoordinates({ latitude: '90.000001', longitude: '0.000000' }, '$'),
    'COORDINATE_OUT_OF_RANGE',
  );
  throwsCode(
    () => c.parseCoordinates({ latitude: 33.5, longitude: '0.000000' }, '$'),
    'INVALID_COORDINATE',
  );
  throwsCode(() => c.coordinatesFromDegrees(Number.NaN, 1), 'INVALID_COORDINATE');
  throwsCode(() => c.coordinatesFromDegrees(1, Infinity), 'INVALID_COORDINATE');
});
