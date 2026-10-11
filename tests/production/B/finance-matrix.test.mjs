/**
 * P06-B — the finance functional matrix is checked against this exact tree,
 * and the checker itself detects each class of drift it claims to detect.
 *
 * Requires: pnpm --filter @carwash/contracts run build.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkMatrix, routeKey } from '../../../scripts/production/B/check-finance-matrix.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const load = () =>
  JSON.parse(readFileSync(path.join(root, 'docs/production/B/finance-matrix.json'), 'utf8'));
const byId = (matrix, id) => matrix.functions.find((f) => f.id === id);

test('route keys ignore parameter names and slashes', () => {
  assert.equal(
    routeKey('post', 'internal/v1/billing', '/obligations/:obligationId/void'),
    routeKey('POST', '/internal/v1/billing/obligations/:id/void'),
  );
  assert.notEqual(routeKey('GET', '/a/:x'), routeKey('POST', '/a/:x'));
});

test('the committed matrix matches this tree', () => {
  assert.deepEqual(checkMatrix(root, load()), []);
});

test('every function is crosswalked: no implemented row without tests, no blocked row without blockers', () => {
  for (const f of load().functions) {
    if (f.status === 'IMPLEMENTED') assert.ok(f.tests.length > 0, f.id);
    if (f.status === 'BLOCKED') assert.ok(f.blockers.length > 0, f.id);
  }
});

test('an unclaimed published contract route is reported', () => {
  const matrix = load();
  byId(matrix, 'FIN-PAY-04').contractRoutes = [];
  assert.ok(checkMatrix(root, matrix).includes('unmapped contract route billing.voidObligation'));
});

test('an unclaimed Gateway route of a Lane B owner is reported', () => {
  const matrix = load();
  byId(matrix, 'FIN-ADM-01').gatewayRoutes = [];
  assert.ok(
    checkMatrix(root, matrix).some((p) => p.startsWith('unmapped Gateway route admin.billing')),
  );
});

test('claiming IMPLEMENTED for a route that is not served is reported', (t) => {
  // The real Booking obligation provider may arrive in a sibling PR. Use an
  // isolated tree with published contracts and no controllers for this negative case.
  const fixture = mkdtempSync(path.join(tmpdir(), 'finance-matrix-missing-route-'));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  cpSync(path.join(root, 'packages/contracts'), path.join(fixture, 'packages/contracts'), {
    recursive: true,
  });
  const matrix = load();
  Object.assign(byId(matrix, 'FIN-SAGA-01'), {
    status: 'IMPLEMENTED',
    tests: ['services/billing/test/billing.domain.spec.ts'],
  });
  assert.ok(
    checkMatrix(fixture, matrix).some((p) =>
      p.includes('IMPLEMENTED but POST /internal/v1/billing/booking-obligations'),
    ),
  );
});

test('a served route that no function or legacy entry claims is reported', (t) => {
  // Keep the legacy-route guard independent of where a later provider mounts
  // its compatibility API: the fixture deliberately serves the historical path.
  const fixture = mkdtempSync(path.join(tmpdir(), 'finance-matrix-unclaimed-route-'));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  cpSync(path.join(root, 'packages/contracts'), path.join(fixture, 'packages/contracts'), {
    recursive: true,
  });
  const src = path.join(fixture, 'services/pricing/src');
  mkdirSync(src, { recursive: true });
  writeFileSync(
    path.join(src, 'legacy.controller.ts'),
    "@Controller('internal/v1/pricing')\nclass Legacy { @Get('price-versions') read() {} }\n",
  );
  const matrix = load();
  matrix.legacyRoutes = matrix.legacyRoutes.filter(
    (l) => l.route !== 'GET /internal/v1/pricing/price-versions',
  );
  assert.ok(
    checkMatrix(fixture, matrix).some((p) =>
      p.startsWith('served route pricing GET /internal/v1/pricing/price-versions'),
    ),
  );
});

test('unclaimed route diagnostics preserve literal separators in the route', (t) => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'finance-matrix-'));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  cpSync(path.join(root, 'packages/contracts'), path.join(fixture, 'packages/contracts'), {
    recursive: true,
  });
  const src = path.join(fixture, 'services/billing/src');
  mkdirSync(src, { recursive: true });
  writeFileSync(
    path.join(src, 'diagnostic.controller.ts'),
    "@Controller('internal/v1/billing/a|b|c')\nclass Diagnostic { @Get() read() {} }\n",
  );
  assert.ok(
    checkMatrix(fixture, { functions: [], blockers: [] }).includes(
      'served route billing GET /internal/v1/billing/a|b|c (services/billing/src/diagnostic.controller.ts) is not claimed by the matrix',
    ),
  );
});

test('missing evidence files, absent tables and unclassified blockers are reported', () => {
  const matrix = load();
  byId(matrix, 'FIN-PAY-02').tests = ['services/billing/test/does-not-exist.spec.ts'];
  byId(matrix, 'FIN-PAY-03').tables = ['payment_magic'];
  matrix.blockers.find((b) => b.id === 'B-02').kind = 'SOMEONE_ELSE';
  matrix.blockers.find((b) => b.id === 'B-P06-05').lane = undefined;
  const problems = checkMatrix(root, matrix);
  assert.ok(
    problems.includes('function FIN-PAY-02: missing services/billing/test/does-not-exist.spec.ts'),
  );
  assert.ok(problems.some((p) => p.includes('table payment_magic')));
  assert.ok(problems.some((p) => p.startsWith('blocker B-02: external kind')));
  assert.ok(problems.includes('blocker B-P06-05: lane-owned blocker needs a lane'));
});

test('a fail-closed function must name what keeps it closed', () => {
  const matrix = load();
  byId(matrix, 'FIN-PAY-01').blockers = [];
  const problems = checkMatrix(root, matrix);
  assert.ok(problems.some((p) => p.startsWith('function FIN-PAY-01: a fail-closed function')));
});
