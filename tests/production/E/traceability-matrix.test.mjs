/**
 * The approved-UI traceability matrix is checked against this exact tree, and
 * the checker detects each class of drift it claims to detect.
 *
 * Source-level traceability only: no browser, database or release evidence.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkTraceabilityMatrix,
  citedPath,
  extractInventory,
  MATRIX_PATH,
  w07RowIds,
} from '../../../scripts/production/E/traceability-matrix.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const load = () => JSON.parse(readFileSync(path.join(root, MATRIX_PATH), 'utf8'));
const rowCovering = (matrix, ref, kind, item) =>
  matrix.requirements.find((r) => r.reference === ref && r.covers?.[kind]?.includes(item));
const expectProblem = (matrix, pattern) => {
  const problems = checkTraceabilityMatrix(root, matrix);
  assert.ok(
    problems.some((p) => pattern.test(p)),
    `expected ${pattern}, got:\n${problems.join('\n')}`,
  );
};

test('the committed matrix matches this tree', () => {
  assert.deepEqual(checkTraceabilityMatrix(root, load()), []);
});

test('the inventory is extracted from the references, not copied', () => {
  const { inventory, problems } = extractInventory(root, load());
  assert.deepEqual(problems, []);
  assert.deepEqual(inventory.RC.steps, [
    'vehicle',
    'care',
    'location',
    'time',
    'contact',
    'payment',
    'review',
  ]);
  assert.equal(inventory.RC.paymentStates.length, 8);
  assert.equal(inventory.RT.stages.length, 8);
  assert.equal(inventory.RT.sheets.length, 21);
  assert.equal(inventory.RA.screens.length, 17);
  assert.equal(w07RowIds(root).length, 124);
});

test('cited paths ignore routes, symbols and annotations', () => {
  assert.equal(
    citedPath('apps/customer-web/src/app/router.tsx:AppRouter'),
    'apps/customer-web/src/app/router.tsx',
  );
  assert.equal(
    citedPath('docs/production/A/evidence (2026-10-09, 269a7ec)'),
    'docs/production/A/evidence',
  );
  assert.equal(citedPath('none'), null);
  assert.equal(citedPath('GET /v1/customer/me'), null);
});

test('an approved action that no row covers is reported', () => {
  const matrix = load();
  const row = rowCovering(matrix, 'RC', 'actions', 'pay-copy');
  row.covers.actions = row.covers.actions.filter((a) => a !== 'pay-copy');
  for (const other of matrix.requirements)
    if (other.reference === 'RC')
      other.covers.actions = other.covers.actions.filter((a) => a !== 'pay-copy');
  expectProblem(matrix, /uncovered RC\.actions pay-copy/);
});

test('a row covering something the reference does not contain is reported', () => {
  const matrix = load();
  rowCovering(matrix, 'RT', 'stages', 'wash').covers.stages.push('auto-approve');
  expectProblem(matrix, /RT\.stages auto-approve is not in the reference/);
});

test('dropping a W07 full-scope row is reported', () => {
  const matrix = load();
  for (const row of matrix.requirements) row.w07 = (row.w07 ?? []).filter((id) => id !== 'CB02');
  expectProblem(matrix, /W07 row CB02 is not carried forward/);
});

test('a fabricated source path is reported', () => {
  const matrix = load();
  matrix.requirements[0].existingFunction.push('apps/customer-web/src/does-not-exist.tsx:Ghost');
  expectProblem(matrix, /does-not-exist\.tsx missing/);
});

test('an unaccepted row without a blocker is reported', () => {
  const matrix = load();
  const row = matrix.requirements.find((r) => r.status === 'PARTIAL');
  row.blockers = [];
  expectProblem(matrix, new RegExp(`row ${row.id}: PARTIAL without a blocker`));
});

test('an unclassified or unowned blocker is reported', () => {
  const matrix = load();
  matrix.blockers[0].classification = 'MISC';
  matrix.blockers[1].owner = 'someone';
  expectProblem(matrix, /classification/);
  expectProblem(matrix, /owner someone/);
});

test('unapproved scope in a requirement is reported', () => {
  const matrix = load();
  matrix.requirements[0].title = 'Advertiser campaign console';
  expectProblem(matrix, /unapproved scope/);
});

test('a changed reference pin is reported before anything else', () => {
  const matrix = load();
  matrix.references.RC.sha256 = '0'.repeat(64);
  expectProblem(matrix, /reference RC/);
});

test('the merge plan must be tied to the matrix base and ordered', () => {
  const matrix = load();
  matrix.mergePlan.base = '1'.repeat(40);
  expectProblem(matrix, /mergePlan\.base must equal base\.sha/);
  const reordered = load();
  reordered.mergePlan.steps.reverse();
  expectProblem(reordered, /depends on later\/unknown step/);
});

test('historical evidence may not be presented as acceptance of the base', () => {
  const matrix = load();
  matrix.historicalEvidence[0].appliesToBase = true;
  expectProblem(matrix, /must not apply to base/);
  const claimed = load();
  claimed.base.currentCandidateAcceptance = 'ACCEPTED';
  expectProblem(claimed, /currentCandidateAcceptance must stay NONE/);
});

test('every required owner decision topic is recorded', () => {
  const matrix = load();
  matrix.decisions = matrix.decisions.filter((d) => d.topic !== 'cashCustody');
  expectProblem(matrix, /decision cashCustody missing/);
});

test('every row is mapped to a CLOSE sprint bound to the base', () => {
  const matrix = load();
  const sprint = matrix.closeSprints.sprints.find((s) => s.rows.includes('CUS-001'));
  sprint.rows = sprint.rows.filter((id) => id !== 'CUS-001');
  expectProblem(matrix, /row CUS-001 is not mapped to a CLOSE sprint/);
  const rebased = load();
  rebased.closeSprints.base = '0'.repeat(40);
  expectProblem(rebased, /closeSprints\.base must equal base\.sha/);
  const stale = load();
  stale.closeSprints.sprints[0].liveBlockers += 1;
  expectProblem(stale, /liveBlockers \d+ != \d+/);
  const unknown = load();
  unknown.closeSprints.sprints[0].keyBlockers.push('NOPE-01');
  expectProblem(unknown, /unknown blocker NOPE-01/);
});
