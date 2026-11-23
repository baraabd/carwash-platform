// Contract compatibility gate over the BUILT packages and the reviewed lock.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { LOCK_PATH, currentSurface } from '../../../scripts/production/E/contract-surface.mjs';

const require = createRequire(import.meta.url);
const contracts = require('../../../packages/contracts/dist/index.js');

const lock = JSON.parse(readFileSync(LOCK_PATH, 'utf8'));
const now = currentSurface();

/** Pure compatibility check, exported shape kept local so it can be exercised negatively. */
function breaking(locked, current) {
  const problems = [];
  for (const [id, c] of Object.entries(locked.http)) {
    const cur = current.http[id];
    if (!cur) {
      problems.push(`${id}: removed`);
      continue;
    }
    if (cur.owner !== c.owner || cur.prefix !== c.prefix)
      problems.push(`${id}: owner/prefix changed`);
    for (const [name, route] of Object.entries(c.routes)) {
      if (JSON.stringify(cur.routes[name]) !== JSON.stringify(route))
        problems.push(`${id}.${name}: changed or removed`);
    }
    for (const reason of c.reasons)
      if (!cur.reasons.includes(reason)) problems.push(`${id}: reason ${reason} removed`);
  }
  for (const code of locked.errorCodes)
    if (!current.errorCodes.includes(code)) problems.push(`error code ${code} removed`);
  for (const [cur, scale] of Object.entries(locked.currencies)) {
    if (current.currencies[cur] !== scale) problems.push(`currency ${cur} scale changed/removed`);
  }
  for (const [id, e] of Object.entries(locked.events)) {
    if (JSON.stringify(current.events[id]) !== JSON.stringify(e))
      problems.push(`event ${id}: changed or removed`);
  }
  return problems;
}

function unreviewedAdditions(locked, current) {
  return JSON.stringify(locked) === JSON.stringify(current) ? [] : ['surface differs from lock'];
}

test('every published owner contract passes the structural lint', () => {
  for (const contract of contracts.OWNER_CONTRACTS) {
    assert.deepEqual(contracts.contractProblems(contract), [], contract.id);
  }
});

test('current surface is backward compatible with the reviewed lock', () => {
  assert.deepEqual(breaking(lock, now), []);
});

test('the surface never grows without a reviewed lock update', () => {
  assert.deepEqual(
    unreviewedAdditions(lock, now),
    [],
    'run node scripts/production/E/contract-surface.mjs --write and review the lock diff',
  );
});

test('the gate detects removals, changed access and dropped reasons (negative controls)', () => {
  const clone = () => JSON.parse(JSON.stringify(now));
  const removedRoute = clone();
  delete removedRoute.http['customer.v1'].routes.getProfile;
  assert.match(breaking(lock, removedRoute).join(), /customer\.v1\.getProfile/);

  const loosened = clone();
  loosened.http['vehicle.v1'].routes.resolveVehicleSnapshot.access = 'public';
  assert.match(breaking(lock, loosened).join(), /resolveVehicleSnapshot/);

  const unkeyed = clone();
  unkeyed.http['pricing.v1'].routes.createQuote.idempotent = false;
  assert.match(breaking(lock, unkeyed).join(), /createQuote/);

  const reason = clone();
  reason.http['pricing.v1'].reasons = reason.http['pricing.v1'].reasons.filter(
    (r) => r !== 'QUOTE_EXPIRED',
  );
  assert.match(breaking(lock, reason).join(), /QUOTE_EXPIRED/);

  const rescale = clone();
  rescale.currencies.SYP = 0;
  assert.match(breaking(lock, rescale).join(), /SYP/);

  const event = clone();
  delete event.events['scheduling.hold-changed.v1'];
  assert.match(breaking(lock, event).join(), /hold-changed/);

  const added = clone();
  added.http['customer.v1'].reasons.push('NEW_REASON');
  assert.deepEqual(breaking(lock, added), [], 'additions are compatible');
  assert.notDeepEqual(unreviewedAdditions(lock, added), [], 'but must be locked deliberately');
});

test('structural lint rejects unsafe route declarations (negative controls)', () => {
  const base = { id: 'demo.v1', owner: 'demo', prefix: '/internal/v1/demo', reasons: [] };
  const bad = [
    { m: { method: 'POST', path: '/x', access: 'principal' }, re: /idempotent or safe/ },
    {
      m: { method: 'POST', path: '/x', access: 'public', idempotent: true },
      re: /public mutation/,
    },
    { m: { method: 'GET', path: '/x', access: 'principal', idempotent: true }, re: /GET flags/ },
    { m: { method: 'GET', path: '/x', access: 'anyone' }, re: /access/ },
    { m: { method: 'GET', path: '/x/../y', access: 'principal' }, re: /path/ },
  ];
  for (const { m, re } of bad) {
    assert.match(contracts.contractProblems({ ...base, routes: { r: m } }).join(), re);
  }
  assert.match(
    contracts.contractProblems({ ...base, prefix: '/internal/v1/other', routes: {} }).join(),
    /prefix/,
  );
});
