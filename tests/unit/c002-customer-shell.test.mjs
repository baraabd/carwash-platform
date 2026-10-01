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
const css = readFileSync(
  new URL('../../apps/customer-web/src/styles/customer-shell.css', import.meta.url),
  'utf8',
);

test('C002 declares seven distinct booking route mount points', () => {
  for (const [index, id] of [
    [0, 'vehicle'],
    [1, 'care'],
    [2, 'location'],
    [3, 'time'],
    [4, 'contact'],
    [5, 'payment'],
    [6, 'review'],
  ]) {
    assert.match(routes, new RegExp(`index: ${index}, id: '${id}'.*path: '/book/${index}'`));
  }
});

test('C002 shell keeps approved outer structural landmarks', () => {
  for (const token of [
    'className="skip"',
    'className="desktop-note"',
    'className="desktop-number"',
    'className="app"',
    'className="app-header"',
    'className="main"',
    'className="bottom-nav"',
  ])
    assert.ok(shell.includes(token), token);
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

test('C002 outer shell keeps approved customer reference geometry and tokens', () => {
  for (const fragment of [
    '--bg: #f6f7f2;',
    '--ink: #16352b;',
    '--green: #18533c;',
    '--lime: #d1f58a;',
    '--line: #e1e7dd;',
    'padding: 16px 20px 10px;',
    'min-height: 78px;',
    'padding: 0 20px calc(108px + env(safe-area-inset-bottom));',
    'width: 35px; height: 39px; border-radius: 15px 15px 15px 5px;',
    'letter-spacing: -1.4px; font-size: 25px;',
    'padding: 7px 10px calc(7px + env(safe-area-inset-bottom));',
    'border-radius: 13px; width: 49px; height: 30px;',
    'background: #e6f0d7;',
  ]) {
    assert.ok(css.includes(fragment), fragment);
  }
});
