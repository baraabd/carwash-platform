// Production smoke (P08-E2). Read-only probes against an authorized target:
// DNS, TLS, gateway live/ready, owner readiness, Identity session denial,
// private Media denial, payment-provider readiness, alerting and dashboards.
//
// The smoke never sends credentials it was not given, never follows redirects
// (a redirect on a private resource is a failure, not a pass), never creates a
// booking or moves money. A probe that would need authorization that is absent
// is NOT_AUTHORIZED, which is not PASSED. Timeouts are FAILED with reason
// "timeout"; they are never treated as success.
import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';

export const TARGET_SCHEMA = 'carwash.smoke-target/v1';

export class SmokeInputError extends Error {}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;

function endpoint(value, label, { allowLoopbackHttpForFixtures = false, gateway = false } = {}) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new SmokeInputError(`${label} must be an absolute URL`);
  }
  const localFixture =
    allowLoopbackHttpForFixtures &&
    !gateway &&
    url.protocol === 'http:' &&
    ['127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !localFixture)
    throw new SmokeInputError(
      `${label} must be https (HTTP is only allowed for explicit loopback fixtures)`,
    );
  if (url.username || url.password || url.search || url.hash)
    throw new SmokeInputError(`${label} must not contain credentials, query or fragment`);
  return url;
}

function gatewayPath(value, label, base) {
  if (!nonEmpty(value) || !value.startsWith('/') || value.startsWith('//') || value.includes('\\'))
    throw new SmokeInputError(`${label} must be a root-relative gateway path`);
  const url = new URL(value, base);
  if (url.origin !== base.origin || url.username || url.password || url.hash)
    throw new SmokeInputError(`${label} must stay on the gateway origin`);
}

export function validateTarget(target, { allowLoopbackHttpForFixtures = false } = {}) {
  if (!isObject(target) || target.schema !== TARGET_SCHEMA)
    throw new SmokeInputError(`target must declare schema ${TARGET_SCHEMA}`);
  const base = endpoint(target.gatewayUrl, 'gatewayUrl', { gateway: true });
  if (
    !Array.isArray(target.hostnames) ||
    target.hostnames.length === 0 ||
    !target.hostnames.every(nonEmpty)
  )
    throw new SmokeInputError('hostnames must list every public hostname');
  if (!target.hostnames.some((host) => host.toLowerCase() === base.hostname.toLowerCase()))
    throw new SmokeInputError('hostnames must include the gateway hostname');
  if (!Number.isInteger(target.tls?.minValidDays) || target.tls.minValidDays < 1)
    throw new SmokeInputError('tls.minValidDays must be supplied by the owner (no default)');
  if (!Number.isInteger(target.timeoutMs) || target.timeoutMs < 100 || target.timeoutMs > 30000)
    throw new SmokeInputError('timeoutMs must be an explicit integer between 100 and 30000');
  if (!Array.isArray(target.owners) || target.owners.length === 0)
    throw new SmokeInputError(
      'owners must list every owner service expected ready behind the gateway',
    );
  gatewayPath(target.identity?.sessionPath, 'identity.sessionPath', base);
  gatewayPath(target.media?.privateObjectPath, 'media.privateObjectPath', base);
  if (!nonEmpty(target.payments?.owner)) throw new SmokeInputError('payments.owner is required');
  if (!Array.isArray(target.alerts?.requiredAlerts) || target.alerts.requiredAlerts.length === 0)
    throw new SmokeInputError('alerts.requiredAlerts must name the alerts that must be loaded');
  if (!Array.isArray(target.dashboards?.uids) || target.dashboards.uids.length === 0)
    throw new SmokeInputError('dashboards.uids must name the operating dashboards');
  for (const [k, v] of [
    ['alerts.prometheusUrl', target.alerts.prometheusUrl],
    ['alerts.alertmanagerUrl', target.alerts.alertmanagerUrl],
    ['dashboards.grafanaUrl', target.dashboards.grafanaUrl],
  ])
    endpoint(v, k, { allowLoopbackHttpForFixtures });
  return target;
}

async function withDeadline(operation, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** GET without redirects; resolves {status, headers, body} or rejects with a reason. */
export function httpGet(url, { timeoutMs, ca, headers = {} }) {
  const u = new URL(url);
  const client = u.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result);
    };
    const req = client.request(
      u,
      {
        method: 'GET',
        headers: { accept: 'application/json', ...headers },
        ...(ca ? { ca } : {}),
        agent: false,
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (c) => {
          size += c.length;
          // Bounded body: smoke responses are small; refuse to buffer more.
          if (size > 1_000_000) req.destroy(new Error('response too large'));
          else chunks.push(c);
        });
        res.once('end', () =>
          finish(null, {
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
        res.once('error', (error) => finish(error));
        res.once('aborted', () => finish(new Error('response aborted')));
      },
    );
    // An inactivity timeout permits endless slow-drip responses. This is a
    // wall-clock deadline covering DNS, connection, TLS, headers and body.
    timer = setTimeout(() => {
      const error = new Error('timeout');
      finish(error);
      req.destroy(error);
    }, timeoutMs);
    req.once('error', (error) => finish(error));
    req.end();
  });
}

function json(body) {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

export function tlsProbe(host, port, { timeoutMs, ca, minValidDays, now }) {
  return new Promise((resolve) => {
    let settled = false;
    let timer;
    const socket = tls.connect({
      host,
      port,
      servername: host,
      ...(ca ? { ca } : {}),
      rejectUnauthorized: true,
    });
    const done = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    };
    timer = setTimeout(() => done({ status: 'FAILED', reason: 'timeout' }), timeoutMs);
    socket.once('error', (e) => done({ status: 'FAILED', reason: e.code ?? e.message }));
    socket.once('secureConnect', () => {
      const cert = socket.getPeerCertificate();
      const validTo = Date.parse(cert.valid_to);
      const remainingDays = (validTo - now) / 86_400_000;
      done(
        remainingDays >= minValidDays
          ? {
              status: 'PASSED',
              validTo: new Date(validTo).toISOString(),
              protocol: socket.getProtocol(),
            }
          : {
              status: 'FAILED',
              reason: `certificate expires in ${remainingDays.toFixed(1)} days`,
              validTo: new Date(validTo).toISOString(),
            },
      );
    });
  });
}

async function check(name, fn) {
  try {
    return { check: name, ...(await fn()) };
  } catch (error) {
    return {
      check: name,
      status: 'FAILED',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * @param {object} target carwash.smoke-target/v1
 * @param {object} io { lookup, httpGet, tlsProbe, now(): epoch ms, readSecretRef(ref): string|null, ca?: Buffer }
 */
export async function runSmoke(target, io) {
  const allowLoopbackHttpForFixtures = io.allowLoopbackHttpForFixtures === true;
  validateTarget(target, { allowLoopbackHttpForFixtures });
  const timeoutMs = target.timeoutMs;
  const base = new URL(target.gatewayUrl);
  const get = (url, headers) =>
    withDeadline(() => io.httpGet(url, { timeoutMs, ca: io.ca, headers }), timeoutMs);
  const at = (p) => new URL(p, base).toString();
  const results = [];

  for (const host of target.hostnames)
    results.push(
      await check(`dns ${host}`, async () => {
        const addresses = await withDeadline(() => io.lookup(host, { all: true }), timeoutMs);
        return addresses.length
          ? { status: 'PASSED', addresses: addresses.length }
          : { status: 'FAILED', reason: 'no address' };
      }),
    );
  for (const host of target.hostnames)
    results.push(
      await check(`tls ${host}`, () =>
        withDeadline(
          () =>
            io.tlsProbe(host, Number(base.port || 443), {
              timeoutMs,
              ca: io.ca,
              minValidDays: target.tls.minValidDays,
              now: io.now(),
            }),
          timeoutMs,
        ),
      ),
    );

  results.push(
    await check('gateway live', async () => {
      const r = await get(at('/health/live'));
      const body = json(r.body);
      if (r.status !== 200) return { status: 'FAILED', reason: `HTTP ${r.status}` };
      // The foundation gateway reports businessReady:false; that is not a launch.
      if (body?.businessReady !== true)
        return { status: 'FAILED', reason: 'gateway reports businessReady:false' };
      return { status: 'PASSED' };
    }),
  );

  let dependencies;
  results.push(
    await check('gateway ready', async () => {
      const r = await get(at('/health/ready'));
      const body = json(r.body);
      dependencies = isObject(body?.dependencies) ? body.dependencies : undefined;
      return r.status === 200 && body?.ready === true
        ? { status: 'PASSED' }
        : { status: 'FAILED', reason: `HTTP ${r.status} ready=${String(body?.ready)}` };
    }),
  );
  for (const owner of target.owners)
    results.push(
      await check(`owner ready ${owner}`, async () =>
        dependencies === undefined
          ? { status: 'FAILED', reason: 'gateway readiness did not report dependencies' }
          : dependencies[owner] === true
            ? { status: 'PASSED' }
            : {
                status: 'FAILED',
                reason: dependencies[owner] === undefined ? 'not routed by gateway' : 'not ready',
              },
      ),
    );
  results.push(
    await check(`payment provider ready (${target.payments.owner})`, async () =>
      dependencies?.[target.payments.owner] === true
        ? { status: 'PASSED' }
        : { status: 'FAILED', reason: 'payment owner not ready behind gateway' },
    ),
  );

  results.push(
    await check('identity session denies anonymous', async () => {
      const r = await get(at(target.identity.sessionPath));
      return r.status === 401
        ? { status: 'PASSED' }
        : { status: 'FAILED', reason: `anonymous session request returned HTTP ${r.status}` };
    }),
  );
  results.push(
    await check('private media denies anonymous', async () => {
      const r = await get(at(target.media.privateObjectPath));
      return r.status === 401 || r.status === 403
        ? { status: 'PASSED' }
        : { status: 'FAILED', reason: `anonymous media request returned HTTP ${r.status}` };
    }),
  );

  results.push(
    await check('alertmanager ready', async () => {
      const r = await get(new URL('/api/v2/status', target.alerts.alertmanagerUrl).toString());
      const body = json(r.body);
      return r.status === 200 && body?.cluster?.status === 'ready'
        ? { status: 'PASSED' }
        : { status: 'FAILED', reason: `HTTP ${r.status} cluster=${String(body?.cluster?.status)}` };
    }),
  );
  results.push(
    await check('required alert rules loaded', async () => {
      const r = await get(
        new URL('/api/v1/rules?type=alert', target.alerts.prometheusUrl).toString(),
      );
      const body = json(r.body);
      if (r.status !== 200 || body?.status !== 'success')
        return { status: 'FAILED', reason: `HTTP ${r.status}` };
      const loaded = new Set(
        (body.data?.groups ?? []).flatMap((g) =>
          (g.rules ?? []).filter((x) => x.type === 'alerting').map((x) => x.name),
        ),
      );
      const missing = target.alerts.requiredAlerts.filter((a) => !loaded.has(a));
      return missing.length
        ? { status: 'FAILED', reason: `missing alerts ${missing.join(', ')}` }
        : { status: 'PASSED' };
    }),
  );
  const token = target.dashboards.tokenRef ? io.readSecretRef(target.dashboards.tokenRef) : null;
  for (const uid of target.dashboards.uids)
    results.push(
      await check(`dashboard ${uid}`, async () => {
        if (!token)
          return { status: 'NOT_AUTHORIZED', reason: 'no dashboard read token reference resolved' };
        const r = await get(
          new URL(
            `/api/dashboards/uid/${encodeURIComponent(uid)}`,
            target.dashboards.grafanaUrl,
          ).toString(),
          {
            authorization: `Bearer ${token}`,
          },
        );
        return r.status === 200 && json(r.body)?.dashboard?.uid === uid
          ? { status: 'PASSED' }
          : { status: 'FAILED', reason: `HTTP ${r.status}; expected dashboard uid ${uid}` };
      }),
    );

  const passed = results.every((r) => r.status === 'PASSED');
  return {
    schema: 'carwash.production-smoke-report/v1',
    fixtureOnly: allowLoopbackHttpForFixtures,
    target: base.origin,
    ranAt: new Date(io.now()).toISOString(),
    verdict: passed ? (allowLoopbackHttpForFixtures ? 'PASSED_FIXTURE_ONLY' : 'PASSED') : 'FAILED',
    results,
    // Not covered by this read-only smoke; each needs its own owner-approved receipt.
    pendingSeparately: [
      'customer booking safe path (owner-approved, executed by the reviewed runbook with a real session)',
    ],
  };
}

export function defaultIo({ ca, readSecretRef, allowLoopbackHttpForFixtures = false } = {}) {
  return {
    lookup,
    httpGet,
    tlsProbe,
    now: () => Date.now(),
    ca,
    allowLoopbackHttpForFixtures,
    readSecretRef: readSecretRef ?? (() => null),
  };
}
