/* global AbortSignal -- Node global */
/**
 * TEST HARNESS — a double of the REQUESTED gateway routes for operator-web
 * (docs/production/C/contract-requests/CR-P03-C5-operator-gateway.md). It is
 * not apps/api-gateway and grants nothing in production.
 *
 * - Serves the BUILT apps/operator-web/dist through the app's own
 *   `createWebHandler` (same CSP and static rules as the runtime).
 * - Maps `/api/operator/*` to configurable upstream base URLs exactly per the
 *   C5 table; anything else under /api is 404.
 * - Injects `Authorization: Bearer <token>` from the test cookie
 *   (`wg_access`, the loopback form of the gateway's `__Host-wg_access`).
 * - Mirrors the gateway's unsafe-request rules: JSON object body, same Origin,
 *   no cross-site fetch.
 * - Fault injection for evidence of the UNKNOWN policy: drop the connection
 *   before or after the upstream handled the request.
 *
 * The upstreams can be the fixture doubles or real services; the harness is
 * reused unchanged in the P03-C integration candidate.
 */
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createWebHandler } from '../../../../apps/operator-web/server.mjs';

export const HARNESS_LABEL = 'operator-gateway harness (test double of requested routes)';
export const ACCESS_COOKIE = 'wg_access';

const DIST = fileURLToPath(new URL('../../../../apps/operator-web/dist/', import.meta.url));

const PATHS = {
  identity: '/internal/v1/identity',
  workforce: '/internal/v1/workforce',
  dispatch: '/internal/v1/dispatch',
  booking: '/internal/v1/booking',
  media: '/internal/v1/media',
};

const SEG = '([A-Za-z0-9][A-Za-z0-9._:-]{0,127})';

/** The C5 table: [method(s), browser path regex, upstream, upstream path builder]. */
export const ROUTES = Object.freeze([
  [['GET'], /^\/api\/operator\/session$/, 'identity', () => `${PATHS.identity}/session`],
  [
    ['GET', 'PUT'],
    /^\/api\/operator\/availability$/,
    'workforce',
    () => `${PATHS.workforce}/me/availability`,
  ],
  [['GET'], /^\/api\/operator\/jobs$/, 'dispatch', () => `${PATHS.dispatch}/me/jobs`],
  [
    ['GET'],
    new RegExp(`^/api/operator/tasks/${SEG}$`),
    'dispatch',
    (m) => `${PATHS.dispatch}/me/tasks/${m[1]}`,
  ],
  [
    ['POST'],
    new RegExp(`^/api/operator/offers/${SEG}/(accept|decline)$`),
    'dispatch',
    (m) => `${PATHS.dispatch}/offers/${m[1]}/${m[2]}`,
  ],
  [
    ['POST', 'PUT', 'DELETE'],
    new RegExp(
      `^/api/operator/tasks/${SEG}/(depart|arrive|start|document|finish|close|cash-collection|release|notes|condition-note|checklist/[a-z]{1,32}|evidence/(?:BEFORE|AFTER)/[01])$`,
    ),
    'dispatch',
    (m) => `${PATHS.dispatch}/tasks/${m[1]}/${m[2]}`,
  ],
  [
    ['GET'],
    new RegExp(`^/api/operator/bookings/${SEG}$`),
    'booking',
    (m) => `${PATHS.booking}/bookings/${m[1]}/technician-view`,
  ],
  [['POST'], /^\/api\/operator\/media\/uploads$/, 'media', () => `${PATHS.media}/uploads`],
  [
    ['POST'],
    new RegExp(`^/api/operator/media/objects/${SEG}/(upload-url|finalize|read-url)$`),
    'media',
    (m) => `${PATHS.media}/objects/${m[1]}/${m[2]}`,
  ],
]);

function cookieValue(header, name) {
  for (const part of String(header ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function errorBody(code) {
  return JSON.stringify({
    error: {
      code,
      reason: null,
      message: 'gateway harness',
      requestId: randomUUID(),
      correlationId: randomUUID(),
      retryable: false,
      retryAfterMs: null,
      issues: [],
    },
  });
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/**
 * @param {{upstreams: Record<'identity'|'workforce'|'dispatch'|'booking'|'media', string>,
 *          mediaOrigins?: string[], documentRoot?: string, timeoutMs?: number}} options
 */
export async function startOperatorGateway({
  upstreams,
  mediaOrigins = [],
  documentRoot = DIST,
  timeoutMs = 20_000,
}) {
  for (const name of Object.keys(PATHS)) {
    if (!upstreams?.[name]) throw new Error(`UPSTREAM_REQUIRED:${name}`);
  }
  const statics = createWebHandler({ documentRoot, mediaOrigins });
  const faults = [];
  const log = [];
  let origin = '';

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (!url.pathname.startsWith('/api/')) return statics(request, response);
    const method = request.method ?? 'GET';
    const send = (status, body) => {
      response.writeHead(status, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      });
      response.end(body);
    };
    let match = null;
    let route = null;
    for (const candidate of ROUTES) {
      const m = candidate[1].exec(url.pathname);
      if (m) {
        match = m;
        route = candidate;
        break;
      }
    }
    if (!route || url.search) return send(404, errorBody('NOT_FOUND'));
    if (!route[0].includes(method)) return send(405, errorBody('REQUEST_INVALID'));
    const unsafe = method !== 'GET';
    const raw = await readBody(request);
    if (unsafe) {
      let body;
      try {
        body = JSON.parse(raw.toString('utf8'));
      } catch {
        body = null;
      }
      const json = String(request.headers['content-type'] ?? '')
        .toLowerCase()
        .startsWith('application/json');
      if (!json || typeof body !== 'object' || body === null || Array.isArray(body)) {
        return send(400, errorBody('REQUEST_INVALID'));
      }
      if (request.headers.origin && request.headers.origin !== origin)
        return send(403, errorBody('AUTH_CSRF'));
      if (request.headers['sec-fetch-site'] === 'cross-site')
        return send(403, errorBody('AUTH_CSRF'));
    }
    const now = Date.now();
    const fault = faults.find(
      (f) =>
        (f.times > 0 || (f.until !== null && now < f.until)) &&
        f.method === method &&
        f.path.test(url.pathname),
    );
    const entry = {
      method,
      path: url.pathname,
      idempotencyKey: request.headers['idempotency-key'] ?? null,
      fault: fault?.mode ?? null,
    };
    log.push(entry);
    if (fault && fault.times > 0) fault.times -= 1;
    if (fault?.mode === 'drop-before-upstream') {
      request.socket.destroy();
      return;
    }
    const headers = { accept: 'application/json' };
    const token = cookieValue(request.headers.cookie, ACCESS_COOKIE);
    if (token) headers.authorization = `Bearer ${token}`;
    for (const name of ['content-type', 'idempotency-key', 'x-correlation-id']) {
      if (typeof request.headers[name] === 'string') headers[name] = request.headers[name];
    }
    let upstream;
    try {
      upstream = await fetch(`${upstreams[route[2]]}${route[3](match)}`, {
        method,
        headers,
        body: unsafe ? raw : undefined,
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return send(503, errorBody('DEPENDENCY_UNAVAILABLE'));
    }
    const text = await upstream.text();
    entry.status = upstream.status;
    if (fault?.mode === 'drop-after-upstream') {
      request.socket.destroy();
      return;
    }
    response.writeHead(upstream.status, {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
      'cache-control': 'no-store',
    });
    response.end(text);
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    label: HARNESS_LABEL,
    origin,
    log,
    /**
     * Drop the connection for matching requests, `times` times or for `windowMs`.
     * A window is needed to reach the application: Chromium transparently resends a
     * request whose reused keep-alive socket closed before any response.
     */
    injectFault({ method, path, mode = 'drop-after-upstream', times = 0, windowMs = 0 }) {
      if (!['drop-after-upstream', 'drop-before-upstream'].includes(mode))
        throw new Error('UNKNOWN_FAULT');
      faults.push({
        method,
        path,
        mode,
        times,
        until: windowMs > 0 ? Date.now() + windowMs : null,
      });
    },
    async close() {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
