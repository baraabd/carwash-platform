import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APP_IDS,
  loadRegistry,
  validateRegistry,
  verifyRegisteredReferences,
} from '../../scripts/f010/reference-registry.mjs';

test('F010 registers exactly the three approved application references', () => {
  const manifest = validateRegistry(loadRegistry());
  assert.deepEqual(Object.keys(manifest.references).sort(), [...APP_IDS].sort());
  assert.deepEqual(manifest.rendering.viewports, [320, 390, 430, 768, 1024, 1440]);
});

test('F010 current reference bytes match their pinned registrations', () => {
  const result = verifyRegisteredReferences({ allowRegistration: true });
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.equal(result.verifiedReferences, 3);
});

test('F010 manifest validation rejects added, removed, or mutated authorities', () => {
  const base = loadRegistry();
  const extra = globalThis.structuredClone(base);
  extra.references.fake = globalThis.structuredClone(extra.references.customer);
  assert.throws(() => validateRegistry(extra), /REFERENCE_SET/);

  const removed = globalThis.structuredClone(base);
  delete removed.references.admin;
  assert.throws(() => validateRegistry(removed), /REFERENCE_SET/);

  const changed = globalThis.structuredClone(base);
  changed.references.technician.sha256 = '0'.repeat(64);
  assert.throws(() => validateRegistry(changed), /REGISTRATION_MISMATCH/);
});

test('F010 rendering contract cannot silently change canonical viewports', () => {
  const changed = globalThis.structuredClone(loadRegistry());
  changed.rendering.viewports = [390];
  assert.throws(() => validateRegistry(changed), /RENDERING_CONTRACT/);
});
