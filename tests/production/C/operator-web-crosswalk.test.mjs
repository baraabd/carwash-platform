/**
 * P06-C crosswalk: the immutable technician reference's five views, six phases,
 * 21 sheets and 46 actions, each mapped to a production disposition and, where
 * production-mapped, to a requested operator gateway route that the app calls
 * and the route table forwards to the owning service.
 *
 * Static evidence over source + the built dist (run `pnpm --filter
 * @carwash/operator-web run build` first). It proves coverage and the absence
 * of trial tooling in the production bundle; it does not prove service
 * behaviour (see p06c-real-services.test.mjs for that).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './_support.mjs';
import { ROUTES } from './support/operator-gateway.mjs';

const read = (...parts) => readFileSync(path.join(ROOT, ...parts), 'utf8');
const crosswalk = JSON.parse(read('docs', 'production', 'C', 'P06-C-technician-crosswalk.json'));
const reference = read(crosswalk.reference);
const SRC = path.join(ROOT, 'apps', 'operator-web', 'src');
const DIST = path.join(ROOT, 'apps', 'operator-web', 'dist');

function filesUnder(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesUnder(path.join(dir, entry.name)) : [path.join(dir, entry.name)],
  );
}
const source = filesUnder(SRC)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');
const apiSource = read('apps', 'operator-web', 'src', 'api', 'operator-api.ts');

function distText(pattern = /\.(js|html|css)$/) {
  assert.ok(existsSync(DIST), 'build operator-web first: dist/ is missing');
  return filesUnder(DIST)
    .filter((f) => pattern.test(f))
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');
}

/** Every literal `data-action` of the reference plus the template-built nav keys and `primary`. */
function referenceActions() {
  const literal = [...reference.matchAll(/data-action="([a-z-]+)"/g)].map((m) => m[1]);
  return new Set([...literal, 'primary', 'collections']);
}

/** "METHOD /api/operator/x/:id/y" -> a concrete path the harness table must route. */
function concrete(route) {
  const [method, template] = route.split(' ');
  return { method, path: template.replace(/:[A-Za-z]+/g, 'a1b2c3d4-0000-4000-8000-000000000001') };
}

function routed({ method, path: p }) {
  return ROUTES.some(([methods, pattern]) => methods.includes(method) && pattern.test(p));
}

/** The static suffix of a client route must appear in the app's API module. */
function calledByApp(route) {
  const template = route.split(' ')[1];
  const tail = template
    .split('/')
    .filter((s) => s && !s.startsWith(':'))
    .pop();
  return (
    apiSource.includes(`/${tail}`) ||
    apiSource.includes(`'${tail}'`) ||
    /evidence|checklist/.test(template)
  );
}

test('five views: the crosswalk names exactly the app views and every read is routed', () => {
  const views = crosswalk.views.map((v) => v.view);
  assert.deepEqual(views, ['home', 'tasks', 'collections', 'profile', 'task']);
  assert.match(
    source,
    /const VIEWS: readonly View\[\] = \['home', 'tasks', 'collections', 'profile', 'task'\]/,
  );
  for (const v of crosswalk.views)
    for (const r of v.reads)
      assert.ok(routed(concrete(r)), `${v.view}: ${r} is not a harness route`);
});

test('six phases: identical to the reference PHASES and each entered by a routed command', () => {
  const match = reference.match(/const PHASES\s*=\s*\[([^\]]+)\]/);
  assert.ok(match, 'reference PHASES');
  const phases = [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(
    crosswalk.phases.map((p) => p.phase),
    phases,
  );
  assert.equal(phases.length, 6);
  for (const p of crosswalk.phases) {
    assert.ok(routed(concrete(p.enter)), `${p.phase}: ${p.enter}`);
    assert.ok(calledByApp(p.enter), `${p.phase}: app never calls ${p.enter}`);
  }
});

test('21 sheets: one entry per reference sheet (issue sheet = 4 modes) with a disposition', () => {
  const calls = [...reference.matchAll(/showSheet\(/g)].length - 1; // minus the definition
  const issueModes = new Set([...reference.matchAll(/showIssue\('([a-z]+)'/g)].map((m) => m[1]));
  assert.equal(calls - 1 + issueModes.size, 21, 'reference sheet count');
  assert.equal(crosswalk.sheets.length, 21);
  assert.deepEqual(
    crosswalk.sheets
      .filter((s) => s.sheet.startsWith('issue:'))
      .map((s) => s.sheet.slice(6))
      .sort(),
    [...issueModes].sort(),
  );
  const dist = distText();
  for (const s of crosswalk.sheets) {
    assert.ok(reference.includes(s.title), `${s.sheet}: title not in the reference`);
    if (s.disposition === 'removed') {
      assert.ok(s.decision, `${s.sheet}: removal needs a recorded decision`);
      assert.ok(!dist.includes(s.title), `${s.sheet}: removed sheet still ships`);
      continue;
    }
    const shown = s.productionTitle ?? s.title;
    if (s.productionTitle)
      assert.match(s.decision ?? '', /PC-\d+/, `${s.sheet}: copy edit needs a PC id`);
    assert.ok(source.includes(shown), `${s.sheet}: «${shown}» not rendered by the app`);
    for (const r of s.server ?? []) {
      assert.ok(routed(concrete(r)), `${s.sheet}: ${r} is not a harness route`);
      assert.ok(calledByApp(r), `${s.sheet}: app never calls ${r}`);
    }
  }
});

test('46 actions: exactly the reference set, removed ones absent from the production bundle', () => {
  const ref = referenceActions();
  const keys = Object.keys(crosswalk.actions);
  assert.equal(keys.length, 46);
  assert.deepEqual(
    [...ref].sort(),
    [...keys].sort(),
    'crosswalk covers exactly the reference actions',
  );
  const dist = distText();
  for (const [action, entry] of Object.entries(crosswalk.actions)) {
    assert.ok(['ported', 'production-mapped', 'removed'].includes(entry.disposition), action);
    if (entry.disposition === 'removed') {
      assert.ok(entry.decision, `${action}: removal needs a recorded decision`);
      assert.ok(
        !new RegExp(`data-action="${action}"|['"]${action}['"]`).test(dist),
        `${action}: removed action still ships`,
      );
      continue;
    }
    assert.ok(
      source.includes(`'${action}'`) || source.includes(`"${action}"`),
      `${action}: not handled by the app`,
    );
    if (entry.disposition === 'production-mapped') assert.ok(entry.server.length > 0, action);
    for (const r of entry.server) {
      assert.ok(routed(concrete(r)), `${action}: ${r} is not a harness route`);
      assert.ok(calledByApp(r), `${action}: app never calls ${r}`);
    }
  }
});

test('no trial tooling in the production bundle: no reset, demo data, local persistence or designer notes', () => {
  // Markup and script only: the stylesheet is the reference CSS byte for byte (P03-C5 §1).
  const dist = distText(/\.(js|html)$/);
  for (const marker of [
    'washgo-technician-approval-v1', // the reference's whole-state localStorage key
    'prototype-bar',
    'design-footer',
    'تجريبي',
    'تجريبية',
    'محليًا',
    'إعادة بدء التجربة',
    'Math.random',
  ])
    assert.ok(!dist.includes(marker), `production bundle contains «${marker}»`);
  // Browser storage holds only the preferences key and P05-C2's offline profile cache
  // (owner decision P05-C-D1); never the reference's whole-state key.
  const keys = new Set(
    [...dist.matchAll(/localStorage\.(?:get|set|remove)Item\(\s*([A-Za-z_$][\w$]*|'[^']*')/g)].map(
      (m) => m[1],
    ),
  );
  assert.ok(keys.size <= 2, `two storage keys at most, found ${[...keys].join(', ')}`);
  const declared = [...dist.matchAll(/["'`](washgo-[a-z-]+-v\d+)["'`]/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(declared)].sort(), [
    'washgo-operator-preferences-v1',
    'washgo-operator-profile-cache-v1',
  ]);
});
