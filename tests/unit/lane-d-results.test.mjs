import assert from 'node:assert/strict';
import test from 'node:test';
import { testResults } from '../../scripts/production/D/test-results.mjs';

const footer = 'ℹ tests 2\nℹ pass 2\nℹ fail 0\nℹ cancelled 0\nℹ skipped 0\nℹ todo 0\n';

test('Lane D gate accepts only a complete, nonempty successful result', () => {
  assert.equal(testResults(footer, 0, null).accepted, true);
  for (const output of [
    '',
    footer + footer,
    footer.replace('ℹ tests 2\n', ''),
    footer.replaceAll('2', '0'),
  ])
    assert.equal(testResults(output, 0, null).accepted, false);
  for (const name of ['fail', 'cancelled', 'skipped', 'todo'])
    assert.equal(
      testResults(footer.replace(`ℹ ${name} 0`, `ℹ ${name} 1`), 0, null).accepted,
      false,
    );
  for (const [code, signal] of [
    [1, null],
    [null, null],
    [0, 'SIGTERM'],
  ])
    assert.equal(testResults(footer, code, signal).accepted, false);
});
