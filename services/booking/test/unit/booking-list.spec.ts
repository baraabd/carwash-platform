import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { bookingCursor, bookingListQuery } from '../../src/application/booking-list';
import { BookingError } from '../../src/domain';

test('booking list uses bounded canonical keyset pagination', () => {
  assert.deepEqual(bookingListQuery({}), { limit: 20, after: null });
  const after = { createdAt: new Date('2026-11-22T12:34:56.789Z'), id: randomUUID() };
  assert.deepEqual(bookingListQuery({ limit: '100', cursor: bookingCursor(after) }), {
    limit: 100,
    after,
  });
  for (const raw of [
    { limit: '0' },
    { limit: '101' },
    { limit: 10 },
    { limit: ['1', '2'] },
    { owner: randomUUID() },
    { cursor: 'not-json' },
    { cursor: ['x'] },
    {
      cursor: Buffer.from(JSON.stringify({ ...after, createdAt: 'invalid' })).toString('base64url'),
    },
    {
      cursor: Buffer.from(JSON.stringify({ ...after, owner: randomUUID() })).toString('base64url'),
    },
  ])
    assert.throws(
      () => bookingListQuery(raw),
      (error: unknown) => error instanceof BookingError && error.code === 'INVALID_INPUT',
    );
});
