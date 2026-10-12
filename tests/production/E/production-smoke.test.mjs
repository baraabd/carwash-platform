// P08-E2 production smoke client. Exercised against REAL local listeners: a
// TLS server with an openssl-issued CA/leaf for localhost, real DNS resolution
// of localhost and real HTTP fixtures that speak the Prometheus, Alertmanager
// and Grafana read APIs. These are local fixtures, NOT production evidence;
// they prove the probe semantics (deny-by-default, no redirects, timeout is a
// failure, no token leakage) the operator relies on against the real target.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import https from 'node:https';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  runSmoke,
  defaultIo,
  validateTarget,
  SmokeInputError,
  TARGET_SCHEMA,
} from '../../../scripts/production/E/release/smoke.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const TOKEN = 'grafana-read-token-never-in-report';

function pki() {
  const dir = mkdtempSync(path.join(tmpdir(), 'p08e2-pki-'));
  const ossl = (...args) =>
    execFileSync('openssl', args, { cwd: dir, stdio: ['ignore', 'ignore', 'pipe'] });
  const ec = ['-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes'];
  ossl(
    'req',
    '-x509',
    ...ec,
    '-keyout',
    'ca.key',
    '-out',
    'ca.pem',
    '-days',
    '30',
    '-subj',
    '/CN=p08e2-test-ca',
  );
  ossl('req', ...ec, '-keyout', 'leaf.key', '-out', 'leaf.csr', '-subj', '/CN=localhost');
  writeFileSync(
    path.join(dir, 'ext.cnf'),
    'subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n',
  );
  ossl(
    'x509',
    '-req',
    '-in',
    'leaf.csr',
    '-CA',
    'ca.pem',
    '-CAkey',
    'ca.key',
    '-CAcreateserial',
    '-out',
    'leaf.pem',
    '-days',
    '30',
    '-extfile',
    'ext.cnf',
  );
  const read = (f) => readFileSync(path.join(dir, f));
  const material = { ca: read('ca.pem'), key: read('leaf.key'), cert: read('leaf.pem') };
  rmSync(dir, { recursive: true, force: true });
  return material;
}

const PKI = pki();

function listen(server) {
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve(server.address().port)),
  );
}

/** A gateway double over real TLS whose behaviour each test can change. */
async function stack(t, overrides = {}) {
  const state = {
    live: { status: 200, body: { service: 'api-gateway', live: true, businessReady: true } },
    ready: {
      status: 200,
      body: { ready: true, dependencies: { identity: true, billing: true, booking: true } },
    },
    session: { status: 401, body: { code: 'UNAUTHENTICATED' } },
    media: { status: 403, body: { code: 'FORBIDDEN' } },
    hang: false,
    rules: ['GatewayHigh5xx', 'BillingProviderDown'],
    alertmanager: 'ready',
    ...overrides,
  };
  const seen = [];
  const gateway = https.createServer({ key: PKI.key, cert: PKI.cert }, (req, res) => {
    seen.push({ url: req.url, authorization: req.headers.authorization });
    if (state.hang) return; // never answers: the smoke must time out, not pass
    const reply = (r) => {
      res.writeHead(r.status, { 'content-type': 'application/json', ...(r.headers ?? {}) });
      res.end(JSON.stringify(r.body ?? {}));
    };
    if (req.url === '/health/live') return reply(state.live);
    if (req.url === '/health/ready') return reply(state.ready);
    if (req.url === '/api/v1/identity/session') return reply(state.session);
    if (req.url.startsWith('/api/v1/media/')) return reply(state.media);
    return reply({ status: 404 });
  });
  const ops = http.createServer((req, res) => {
    seen.push({ url: req.url, authorization: req.headers.authorization });
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/v2/status')
      return res.end(JSON.stringify({ cluster: { status: state.alertmanager } }));
    if (req.url === '/api/v1/rules?type=alert')
      return res.end(
        JSON.stringify({
          status: 'success',
          data: { groups: [{ rules: state.rules.map((name) => ({ type: 'alerting', name })) }] },
        }),
      );
    if (req.url.startsWith('/api/dashboards/uid/')) {
      res.statusCode = req.headers.authorization === `Bearer ${TOKEN}` ? 200 : 401;
      return res.end('{}');
    }
    res.statusCode = 404;
    res.end('{}');
  });
  const gwPort = await listen(gateway);
  const opsPort = await listen(ops);
  t.after(() => {
    gateway.closeAllConnections();
    ops.closeAllConnections();
    gateway.close();
    ops.close();
  });
  const ops_ = `http://127.0.0.1:${opsPort}`;
  const target = {
    schema: TARGET_SCHEMA,
    gatewayUrl: `https://localhost:${gwPort}`,
    hostnames: ['localhost'],
    tls: { minValidDays: 14 },
    timeoutMs: 1500,
    owners: ['identity', 'billing', 'booking'],
    identity: { sessionPath: '/api/v1/identity/session' },
    media: { privateObjectPath: '/api/v1/media/objects/smoke-probe' },
    payments: { owner: 'billing' },
    alerts: {
      prometheusUrl: ops_,
      alertmanagerUrl: ops_,
      requiredAlerts: ['GatewayHigh5xx', 'BillingProviderDown'],
    },
    dashboards: {
      grafanaUrl: ops_,
      uids: ['carwash-operations'],
      tokenRef: 'env://GRAFANA_READ_TOKEN',
    },
  };
  const io = (extra = {}) => ({
    ...defaultIo({
      ca: PKI.ca,
      readSecretRef: (ref) => (ref === 'env://GRAFANA_READ_TOKEN' ? TOKEN : null),
    }),
    ...extra,
  });
  return { state, target, io, seen };
}

const result = (report, name) => report.results.find((r) => r.check === name);

test('every probe PASSED on a healthy target', async (t) => {
  const { target, io } = await stack(t);
  const report = await runSmoke(target, io());
  assert.equal(report.verdict, 'PASSED', JSON.stringify(report.results, null, 2));
  assert.equal(result(report, 'tls localhost').status, 'PASSED');
  assert.ok(
    report.pendingSeparately.some((p) => /booking/.test(p)),
    'booking path is never claimed by the smoke',
  );
});

test('the foundation gateway (businessReady:false) fails the smoke', async (t) => {
  const { target, io } = await stack(t, {
    live: { status: 200, body: { live: true, businessReady: false } },
  });
  const report = await runSmoke(target, io());
  assert.equal(report.verdict, 'FAILED');
  assert.match(result(report, 'gateway live').reason, /businessReady:false/);
});

test('an owner not ready or not routed fails, including the payment owner', async (t) => {
  const { target, io } = await stack(t, {
    ready: {
      status: 503,
      body: { ready: false, dependencies: { identity: true, billing: false } },
    },
  });
  const report = await runSmoke(target, io());
  assert.equal(result(report, 'gateway ready').status, 'FAILED');
  assert.equal(result(report, 'owner ready billing').reason, 'not ready');
  assert.equal(result(report, 'owner ready booking').reason, 'not routed by gateway');
  assert.equal(result(report, 'payment provider ready (billing)').status, 'FAILED');
});

test('anonymous Identity session or Media access that is not denied fails', async (t) => {
  const { target, io } = await stack(t, {
    session: { status: 200, body: { subject: 'x' } },
    media: { status: 302, headers: { location: 'https://bucket.invalid/object?sig=1' } },
  });
  const report = await runSmoke(target, io());
  assert.match(result(report, 'identity session denies anonymous').reason, /HTTP 200/);
  // The redirect is not followed and is not treated as denial.
  assert.match(result(report, 'private media denies anonymous').reason, /HTTP 302/);
});

test('a hung target is a timeout FAILURE, never success', async (t) => {
  const { target, io } = await stack(t, { hang: true });
  const report = await runSmoke({ ...target, timeoutMs: 300 }, io());
  assert.equal(report.verdict, 'FAILED');
  assert.equal(result(report, 'gateway live').reason, 'timeout');
  assert.equal(result(report, 'identity session denies anonymous').reason, 'timeout');
});

test('an untrusted certificate and a near-expiry certificate both fail TLS', async (t) => {
  const { target, io } = await stack(t);
  const untrusted = await runSmoke(target, io({ ca: undefined }));
  assert.equal(result(untrusted, 'tls localhost').status, 'FAILED');
  assert.equal(result(untrusted, 'gateway live').status, 'FAILED');
  const expiring = await runSmoke({ ...target, tls: { minValidDays: 60 } }, io());
  assert.match(result(expiring, 'tls localhost').reason, /expires in/);
});

test('missing alert rules or an unready alertmanager fail', async (t) => {
  const { target, io } = await stack(t, { rules: ['GatewayHigh5xx'], alertmanager: 'settling' });
  const report = await runSmoke(target, io());
  assert.match(result(report, 'required alert rules loaded').reason, /BillingProviderDown/);
  assert.equal(result(report, 'alertmanager ready').status, 'FAILED');
});

test('dashboards without a resolved token are NOT_AUTHORIZED; the token never reaches the report', async (t) => {
  const { target, io, seen } = await stack(t);
  const without = await runSmoke(target, io({ readSecretRef: () => null }));
  assert.equal(result(without, 'dashboard carwash-operations').status, 'NOT_AUTHORIZED');
  assert.equal(without.verdict, 'FAILED');
  const withToken = await runSmoke(target, io());
  assert.equal(result(withToken, 'dashboard carwash-operations').status, 'PASSED');
  assert.ok(!JSON.stringify(withToken).includes(TOKEN));
  // The token is only ever sent to the dashboard API, never to the gateway.
  assert.ok(seen.filter((s) => s.authorization).every((s) => s.url.startsWith('/api/dashboards/')));
});

test('target validation refuses defaults and plaintext gateways', () => {
  const base = {
    schema: TARGET_SCHEMA,
    gatewayUrl: 'https://api.example.invalid',
    hostnames: ['api.example.invalid'],
    tls: { minValidDays: 14 },
    timeoutMs: 2000,
    owners: ['identity'],
    identity: { sessionPath: '/s' },
    media: { privateObjectPath: '/m' },
    payments: { owner: 'billing' },
    alerts: {
      prometheusUrl: 'https://p.invalid',
      alertmanagerUrl: 'https://a.invalid',
      requiredAlerts: ['x'],
    },
    dashboards: { grafanaUrl: 'https://g.invalid', uids: ['d'] },
  };
  assert.equal(validateTarget(base), base);
  assert.throws(
    () => validateTarget({ ...base, gatewayUrl: 'http://api.example.invalid' }),
    SmokeInputError,
  );
  assert.throws(() => validateTarget({ ...base, tls: {} }), /no default/);
  assert.throws(() => validateTarget({ ...base, timeoutMs: undefined }), SmokeInputError);
  assert.throws(
    () => validateTarget({ ...base, alerts: { ...base.alerts, requiredAlerts: [] } }),
    SmokeInputError,
  );
});

test('CLI resolves only env:// token references and exits 2 on FAILED', async (t) => {
  const { target } = await stack(t);
  const dir = mkdtempSync(path.join(tmpdir(), 'p08e2-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(path.join(dir, 'target.json'), JSON.stringify(target));
  writeFileSync(path.join(dir, 'ca.pem'), PKI.ca);
  const cli = path.join(repoRoot, 'scripts/production/E/production-smoke.mjs');
  // Async spawn: the fixture servers live in this process' event loop.
  const run = (env) =>
    execFileAsync(
      process.execPath,
      [
        cli,
        '--target',
        path.join(dir, 'target.json'),
        '--ca',
        path.join(dir, 'ca.pem'),
        '--out',
        path.join(dir, 'report.json'),
      ],
      env,
    );
  const passed = await run({ ...process.env, GRAFANA_READ_TOKEN: TOKEN });
  assert.equal(passed.code, 0, passed.stdout + passed.stderr);
  assert.ok(!readFileSync(path.join(dir, 'report.json'), 'utf8').includes(TOKEN));
  const failed = await run({ ...process.env, GRAFANA_READ_TOKEN: '' });
  assert.equal(failed.code, 2);
  assert.match(failed.stdout, /NOT_AUTHORIZED\s+dashboard carwash-operations/);
  const bad = spawnSync(process.execPath, [cli], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
});

function execFileAsync(file, args, env) {
  return new Promise((resolve) => {
    const child = spawn(file, args, { env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}
