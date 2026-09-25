import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const event = {
  eventId: '11111111-1111-4111-8111-111111111111',
  eventType: 'booking.confirmed.v1',
  schemaVersion: 1,
  producer: 'booking',
  occurredAt: '2026-09-25T00:00:00.000Z',
  correlationId: '22222222-2222-4222-8222-222222222222',
  aggregateVersion: 1,
  data: {
    bookingId: '33333333-3333-4333-8333-333333333333',
    customerId: '44444444-4444-4444-8444-444444444444',
  },
};
for (const specifier of ['@carwash/event-contracts', '@carwash/event-contracts/booking-confirmed']) {
  test(`built public contract entry ${specifier} validates V1 and rejects an incompatible version`, (t) => {
    const consumer = mkdtempSync(path.join(tmpdir(), 'washgo-contract-consumer-'));
    t.after(() => rmSync(consumer, { recursive: true, force: true }));
    const scope = path.join(consumer, 'node_modules/@carwash');
    mkdirSync(scope, { recursive: true });
    symlinkSync(path.join(root, 'packages/event-contracts'), path.join(scope, 'event-contracts'), 'junction');
    const code = `import assert from 'node:assert/strict';
      import { parseBookingConfirmedV1 } from ${JSON.stringify(specifier)};
      const event = ${JSON.stringify(event)};
      assert.deepEqual(parseBookingConfirmedV1(event), event);
      assert.throws(() => parseBookingConfirmedV1({...event, schemaVersion: 2}), /UNSUPPORTED_EVENT/);
      assert.throws(() => parseBookingConfirmedV1({...event, extra: true}), /UNEXPECTED_EVENT_FIELDS/);
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', code], {
      cwd: consumer,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
  });
}
