import test from 'node:test';
import assert from 'node:assert/strict';
import { quoteFromJson, quoteToJson } from '../../src/infrastructure/persistence/snapshot-codec';
import { principal, quoteSnapshot } from '../support/fixtures';

test('quote duration persists exactly, and an old stored snapshot stays explicitly unknown', () => {
  const quote = quoteSnapshot(principal(), new Date());
  assert.deepEqual(quoteFromJson(quoteToJson(quote)), quote);
  const historical = quoteToJson(quote);
  delete historical.durationMinutes;
  const decoded = quoteFromJson(historical);
  assert.equal(decoded.durationMinutes, null, 'never infer historical duration from the held slot');
  assert.deepEqual({ ...decoded, durationMinutes: quote.durationMinutes }, quote);
});

test('corrupt persisted duration is refused, not defaulted or coerced', () => {
  const quote = quoteToJson(quoteSnapshot(principal(), new Date()));
  for (const durationMinutes of [4, 96_001, 60.1, '60', {}, true]) {
    assert.throws(
      () => quoteFromJson({ ...quote, durationMinutes }),
      /STORED_QUOTE_DURATION_INVALID/,
    );
  }
});
