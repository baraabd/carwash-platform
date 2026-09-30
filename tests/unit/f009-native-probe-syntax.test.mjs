import test from 'node:test';
import assert from 'node:assert/strict';
import { Script } from 'node:vm';
import { NATIVE_RUNTIME_PROBE } from '../../scripts/ci/native-runtime.mjs';

test('the literal native image probe parses independently of its containing module', () => {
  assert.doesNotThrow(() => new Script(NATIVE_RUNTIME_PROBE));
});
