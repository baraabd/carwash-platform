import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const routes = readFileSync(
  new URL('../../apps/customer-web/src/app/routes.ts', import.meta.url),
  'utf8',
);
const shell = readFileSync(
  new URL('../../apps/customer-web/src/app/CustomerShell.tsx', import.meta.url),
  'utf8',
);
const pkg = JSON.parse(
  readFileSync(new URL('../../apps/customer-web/package.json', import.meta.url), 'utf8'),
);

test('C002 declares seven distinct booking route mount points', () => {
  for (const [index, id] of [
    [0, 'vehicle'], [1, 'care'], [2, 'location'], [3, 'time'],
    [4, 'contact'], [5, 'payment'], [6, 'review'],
  ]) {
    assert.match(routes, new RegExp(`index: ${index}, id: '${id}'.*path: '/book/${index}'`));
  }
});

test('C002 shell keeps approved outer structural landmarks', () => {
  for (const token of [
    'className="skip"', 'className="desktop-note"', 'className="desktop-number"',
    'className="app"', 'className="app-header"', 'className="main"',
    'className="bottom-nav"',
  ]) assert.ok(shell.includes(token), token);
});

test('C002 uses the pinned stable React/Vite stack', () => {
  assert.deepEqual(pkg.dependencies, {
    react: '19.3.0',
    'react-dom': '19.3.0',
    'react-router-dom': '7.18.4',
  });
  assert.equal(pkg.devDependencies.vite, '8.3.1');
  assert.equal(pkg.devDependencies['@vitejs/plugin-react'], '6.1.1');
});

test('C002 does not claim backend persistence or payment success', () => {
  assert.doesNotMatch(shell, /localStorage|sessionStorage|paid_demo|fetch\(|axios/i);
});
