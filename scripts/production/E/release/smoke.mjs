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

export function validateTarget(target) {
  if (!isObject(target) || target.schema !== TARGET_SCHEMA)
    throw new SmokeInputError(`target must declare schema ${TARGET_SCHEMA}`);
  let base;
  try {
    base = new URL(target.gatewayUrl);
  } catch {
    throw new SmokeInputError('gatewayUrl must be an absolute URL');
  }
  if (base.protocol !== 'https:') throw new SmokeInputError('gatewayUrl must be https');
  if (
    !Array.isArray(target.hostnames) ||
    target.hostnames.length === 0 ||
    !target.hostnames.every(nonEmpty)
  )
    throw new SmokeInputError('hostnames must list every public hostname');
  if (!Number.isInteger(target.tls?.minValidDays) || target.tls.minValidDays < 1)
    throw new SmokeInputError('tls.minValidDays must be supplied by the owner (no default)');
  if (!Number.isInteger(target.timeoutMs) || target.timeoutMs < 100 || target.timeoutMs > 30000)
    throw new SmokeInputError('timeoutMs must be an explicit integer between 100 and 30000');
  if (!Array.isArray(target.owners) || target.owners.length === 0)
    throw new SmokeInputError(
      'owners must list every owner service expected ready behind the gateway',
    );
  if (!nonEmpty(target.identity?.sessionPath))
    throw new SmokeInputError('identity.sessionPath is required');
  if (!nonEmpty(target.media?.privateObjectPath))
    throw new SmokeInputError('media.privateObjectPath is required');
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
    try {
      new URL(v);
    } catch {
      throw new SmokeInputError(`${k} must be an absolute URL`);
    }
  return target;
}

/** GET without redirects; resolves {status, headers, body} or rejects with a reason. */
export function httpGet(url, { timeoutMs, ca, headers = {} }) {
  const u = new URL(url);
  const client = u.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
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
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
        res.on('error', reject);
      },
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
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
    const socket = tls.connect({
      host,
      port,
      servername: host,
      ...(ca ? { ca } : {}),
      rejectUnauthorized: true,
    });
    const done = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs, () => done({ status: 'FAILED', reason: 'timeout' }));
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
  validateTarget(target);
  const timeoutMs = target.timeoutMs;
  const base = new URL(target.gatewayUrl);
  const get = (url, headers) => io.httpGet(url, { timeoutMs, ca: io.ca, headers });
  const at = (p) => new URL(p, base).toString();
  const results = [];

  for (const host of target.hostnames)
    results.push(
      await check(`dns ${host}`, async () => {
        const addresses = await io.lookup(host, { all: true });
        return addresses.length
          ? { status: 'PASSED', addresses: addresses.length }
          : { status: 'FAILED', reason: 'no address' };
      }),
    );
  for (const host of target.hostnames)
    results.push(
      await check(`tls ${host}`, () =>
        io.tlsProbe(host, Number(base.port || 443), {
          timeoutMs,
          ca: io.ca,
          minValidDays: target.tls.minValidDays,
          now: io.now(),
        }),
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
        return r.status === 200
          ? { status: 'PASSED' }
          : { status: 'FAILED', reason: `HTTP ${r.status}` };
      }),
    );

  const passed = results.every((r) => r.status === 'PASSED');
  return {
    schema: 'carwash.production-smoke-report/v1',
    target: base.origin,
    ranAt: new Date(io.now()).toISOString(),
    verdict: passed ? 'PASSED' : 'FAILED',
    results,
    // Not covered by this read-only smoke; each needs its own owner-approved receipt.
    pendingSeparately: [
      'customer booking safe path (owner-approved, executed by the reviewed runbook with a real session)',
    ],
  };
}

export function defaultIo({ ca, readSecretRef } = {}) {
  return {
    lookup,
    httpGet,
    tlsProbe,
    now: () => Date.now(),
    ca,
    readSecretRef: readSecretRef ?? (() => null),
  };
}
