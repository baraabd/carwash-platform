// P08-E2 operating window decisions. Pure evaluation with an injected clock;
// the CLI case runs the real process. Thresholds below are test inputs only —
// production thresholds come from the owner-approved barrier receipt.
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  evaluateWindow,
  WindowInputError,
  OBSERVATIONS_SCHEMA,
} from '../../../scripts/production/E/release/window.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const OPEN = Date.parse('2026-10-11T08:00:00.000Z');
const minutes = (n) => OPEN + n * 60_000;
const iso = (ms) => new Date(ms).toISOString();

const policy = {
  durationMinutes: 60,
  maxSampleGapMinutes: 5,
  thresholds: {
    http5xxRate: { bound: 'max', limit: 0.01, onBreach: 'rollback' },
    bookingSuccessRate: { bound: 'min', limit: 0.95, onBreach: 'stop' },
    p95LatencyMs: { bound: 'max', limit: 800, onBreach: 'forward-recovery' },
  },
};

function observations({
  until = 60,
  every = 5,
  metrics = () => ({}),
  incidents = [],
  open = OPEN,
} = {}) {
  const samples = [];
  for (let m = every; m <= until; m += every)
    samples.push({
      at: iso(open + m * 60_000),
      metrics: { http5xxRate: 0.001, bookingSuccessRate: 0.99, p95LatencyMs: 300, ...metrics(m) },
    });
  return {
    schema: OBSERVATIONS_SCHEMA,
    openedAt: iso(open),
    contacts: { primary: 'primary-oncall', backup: 'backup-oncall' },
    samples,
    incidents,
  };
}

test('full window within every threshold is VERIFIED_IN_OPERATION', () => {
  const r = evaluateWindow({ policy, observations: observations(), now: minutes(61) });
  assert.equal(r.decision, 'VERIFIED_IN_OPERATION');
  assert.equal(r.samples, 12);
});

test('an open window with good samples is only OBSERVING', () => {
  const r = evaluateWindow({ policy, observations: observations({ until: 30 }), now: minutes(32) });
  assert.equal(r.decision, 'OBSERVING');
});

test('each breach maps to its approved action; rollback outranks stop outranks forward recovery', () => {
  const fwd = evaluateWindow({
    policy,
    observations: observations({ metrics: (m) => (m === 20 ? { p95LatencyMs: 900 } : {}) }),
    now: minutes(61),
  });
  assert.equal(fwd.decision, 'FORWARD_RECOVERY');
  const stop = evaluateWindow({
    policy,
    observations: observations({
      metrics: (m) => (m === 20 ? { p95LatencyMs: 900, bookingSuccessRate: 0.5 } : {}),
    }),
    now: minutes(61),
  });
  assert.equal(stop.decision, 'STOP');
  const rollback = evaluateWindow({
    policy,
    observations: observations({
      metrics: (m) =>
        m === 20
          ? { p95LatencyMs: 900, bookingSuccessRate: 0.5 }
          : m === 25
            ? { http5xxRate: 0.2 }
            : {},
    }),
    now: minutes(30),
  });
  assert.equal(rollback.decision, 'ROLLBACK');
  assert.equal(rollback.breaches.length, 3);
});

test('a sample gap or missing metric is STOP (unobservable), never verified', () => {
  const gap = observations();
  gap.samples = gap.samples.filter((s) => s.at !== iso(minutes(30)) && s.at !== iso(minutes(35)));
  assert.equal(evaluateWindow({ policy, observations: gap, now: minutes(61) }).decision, 'STOP');
  const missing = observations({ metrics: (m) => (m === 10 ? { http5xxRate: undefined } : {}) });
  const r = evaluateWindow({ policy, observations: missing, now: minutes(61) });
  assert.equal(r.decision, 'STOP');
  assert.equal(r.unobservable[0].metric, 'http5xxRate');
  const stale = evaluateWindow({
    policy,
    observations: observations({ until: 20 }),
    now: minutes(61),
  });
  assert.equal(stale.decision, 'STOP', 'samples that stop arriving cannot verify the window');
});

test('unresolved or unacknowledged incidents keep the window from verifying', () => {
  const open = evaluateWindow({
    policy,
    observations: observations({ incidents: [{ id: 'INC-1', acknowledgedBy: 'primary-oncall' }] }),
    now: minutes(61),
  });
  assert.equal(open.decision, 'OBSERVING');
  assert.deepEqual(open.openIncidents, ['INC-1']);
  const unacked = evaluateWindow({
    policy,
    observations: observations({ incidents: [{ id: 'INC-2', resolvedAt: iso(minutes(40)) }] }),
    now: minutes(61),
  });
  assert.deepEqual(unacked.unacknowledgedIncidents, ['INC-2']);
  assert.equal(unacked.decision, 'OBSERVING');
});

test('samples outside the window and future samples are ignored', () => {
  const obs = observations({ until: 30 });
  obs.samples.push({ at: iso(minutes(45)), metrics: { http5xxRate: 1 } });
  obs.samples.push({ at: iso(minutes(-10)), metrics: { http5xxRate: 1 } });
  assert.equal(
    evaluateWindow({ policy, observations: obs, now: minutes(32) }).decision,
    'OBSERVING',
  );
});

test('missing policy fields, contacts or clock are refused (no defaults)', () => {
  assert.throws(
    () =>
      evaluateWindow({
        policy: { ...policy, maxSampleGapMinutes: undefined },
        observations: observations(),
        now: minutes(61),
      }),
    WindowInputError,
  );
  assert.throws(
    () =>
      evaluateWindow({
        policy: { ...policy, thresholds: {} },
        observations: observations(),
        now: minutes(61),
      }),
    WindowInputError,
  );
  assert.throws(
    () =>
      evaluateWindow({
        policy: {
          ...policy,
          thresholds: { x: { bound: 'max', limit: Number.NaN, onBreach: 'rollback' } },
        },
        observations: observations(),
        now: minutes(61),
      }),
    WindowInputError,
  );
  const sameContact = { ...observations(), contacts: { primary: 'a', backup: 'a' } };
  assert.throws(
    () => evaluateWindow({ policy, observations: sameContact, now: minutes(61) }),
    /distinct/,
  );
  assert.throws(
    () => evaluateWindow({ policy, observations: observations(), now: Number.NaN }),
    WindowInputError,
  );
});

test('CLI uses the PASSED barrier receipt and exit codes follow the decision', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'p08e2-window-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cli = path.join(repoRoot, 'scripts/production/E/operating-window.mjs');
  const receipt = {
    schema: 'carwash.release-receipt/v1',
    family: 'ext.operating-window-policy',
    status: 'PASSED',
    details: policy,
  };
  writeFileSync(path.join(dir, 'policy.json'), JSON.stringify(receipt));
  // The CLI reads the real clock: open the window 61 minutes before now.
  const open = Date.now() - 61 * 60_000;
  writeFileSync(path.join(dir, 'obs.json'), JSON.stringify(observations({ open })));
  const run = () =>
    spawnSync(
      process.execPath,
      [
        cli,
        '--policy',
        path.join(dir, 'policy.json'),
        '--observations',
        path.join(dir, 'obs.json'),
      ],
      { encoding: 'utf8' },
    );
  const ok = run();
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /VERIFIED_IN_OPERATION/);
  writeFileSync(
    path.join(dir, 'obs.json'),
    JSON.stringify(observations({ open, metrics: (m) => (m === 5 ? { http5xxRate: 0.5 } : {}) })),
  );
  assert.equal(run().status, 2);
  writeFileSync(path.join(dir, 'policy.json'), JSON.stringify({ ...receipt, status: 'FAILED' }));
  assert.equal(run().status, 1);
});
