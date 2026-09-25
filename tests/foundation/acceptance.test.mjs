import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { gatePlan, tapHasUnprovenTests, verdict } from '../../scripts/f001/acceptance.mjs';
const passed = () =>
  ['design-before', ...gatePlan.map((g) => g.id), 'design-after'].map((id) => ({ id, status: 'PASS' }));
test('decision logic accepts only every named gate, no blocker and a clean final source (synthetic decision input)', () => {
  assert.equal(verdict(passed(), [], false), 'ACCEPTED');
});
for (const [name, gates, blockers, dirty, expected] of [
  ['missing gate', passed().slice(1), [], false, 'BLOCKED'],
  ['duplicate instead of missing gate', [passed()[1], ...passed().slice(1)], [], false, 'BLOCKED'],
  ['extra result', [...passed(), { id: 'unknown', status: 'PASS' }], [], false, 'BLOCKED'],
  ['explicit blocker', passed(), ['lock missing'], false, 'BLOCKED'],
  ['dirty source', passed(), [], true, 'BLOCKED'],
  ['no execution', [], [], false, 'BLOCKED'],
  ['one failure', passed().map((g, i) => (i === 2 ? { ...g, status: 'FAILED' } : g)), [], false, 'FAILED'],
  ['not run', passed().map((g, i) => (i === 2 ? { ...g, status: 'NOT_RUN' } : g)), [], false, 'BLOCKED'],
])
  test(`acceptance decision rejects ${name}`, () => assert.equal(verdict(gates, blockers, dirty), expected));
const summary = '# tests 215\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n';
test('complete zero-failure TAP summary is eligible', () =>
  assert.equal(tapHasUnprovenTests(summary), false));
for (const key of ['fail', 'cancelled', 'skipped', 'todo'])
  test(`TAP with ${key} does not count as acceptance success`, () => {
    assert.equal(tapHasUnprovenTests(summary.replace(`# ${key} 0`, `# ${key} 1`)), true);
  });
test('empty or partial TAP is not success', () => {
  for (const output of [
    '',
    'PASS',
    '# tests 1\n',
    summary.replace('# tests 215', '# tests 0'),
    summary.replace('# skipped 0\n', ''),
  ])
    assert.equal(tapHasUnprovenTests(output), true);
});
test('legacy and design gates remain mandatory alongside new gates', () => {
  for (const id of [
    'legacy-foundation',
    'design-lock-tests',
    'catalog-and-real-pnpm-discovery',
    'full-source-boundaries',
    'strict-typecheck',
    'independent-workspace-builds',
    'dependency-audit',
    'lint',
    'format',
  ])
    assert.ok(gatePlan.some((g) => g.id === id));
  assert.ok(gatePlan.find((g) => g.id === 'install-frozen').args.includes('--frozen-lockfile'));
});

test('legacy and design commands explicitly emit TAP on Node 24', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  for (const name of ['test:domain', 'test:design-lock', 'test:contracts'])
    assert.ok(manifest.scripts[name].includes('--test-reporter=tap'));
});
