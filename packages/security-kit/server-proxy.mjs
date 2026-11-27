import { Buffer } from 'node:buffer';
import process from 'node:process';
import { URL } from 'node:url';
import { setTimeout, clearTimeout } from 'node:timers';
import { randomUUID } from 'node:crypto';
import { isServiceOriginAllowed } from '@carwash/security-kit/service-origin';
import { apiError, API_ERROR_STATUS } from '@carwash/contracts/common';

const REQUEST_HEADERS = [
  'accept',
  'accept-language',
  'authorization',
  'cookie',
  'content-type',
  'origin',
  'sec-fetch-site',
  'sec-fetch-mode',
  'sec-fetch-dest',
  'x-csrf-token',
  'x-wg-session-binding',
  'idempotency-key',
  'if-match',
  'x-request-id',
  'x-correlation-id',
  'traceparent',
  'tracestate',
];
const RESPONSE_HEADERS = [
  'content-type',
  'etag',
  'idempotent-replayed',
  'retry-after',
  'x-request-id',
  'x-correlation-id',
  'traceparent',
];
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const API_PATH = /^\/api\/(?:v1|operator)\//;

function integer(raw, fallback, min, max) {
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new Error('INVALID_WEB_GATEWAY_BUDGET');
  return value;
}

export function loadWebGatewayConfig(env = process.env) {
  if (!env.WEB_GATEWAY_ORIGIN && !env.WEB_PUBLIC_ORIGIN) return null;
  if (!env.WEB_GATEWAY_ORIGIN || !env.WEB_PUBLIC_ORIGIN)
    throw new Error('WEB_GATEWAY_AND_PUBLIC_ORIGINS_REQUIRED');
  const gateway = new URL(env.WEB_GATEWAY_ORIGIN);
  const publicOrigin = new URL(env.WEB_PUBLIC_ORIGIN);
  if (gateway.origin !== env.WEB_GATEWAY_ORIGIN || !isServiceOriginAllowed(gateway, env))
    throw new Error('INVALID_WEB_GATEWAY_ORIGIN');
  if (
    publicOrigin.origin !== env.WEB_PUBLIC_ORIGIN ||
    publicOrigin.username ||
    publicOrigin.password ||
    (publicOrigin.protocol !== 'https:' &&
      !(
        publicOrigin.protocol === 'http:' &&
        ['127.0.0.1', '[::1]', 'localhost'].includes(publicOrigin.hostname)
      ))
  )
    throw new Error('INVALID_WEB_PUBLIC_ORIGIN');
  return Object.freeze({
    origin: gateway.origin,
    publicOrigin: publicOrigin.origin,
    publicHost: publicOrigin.host,
    secureCookies: publicOrigin.protocol === 'https:',
    timeoutMs: integer(env.WEB_GATEWAY_TIMEOUT_MS, 5_000, 100, 30_000),
    requestLimit: integer(env.WEB_GATEWAY_REQUEST_LIMIT, 262_144, 1_024, 1_048_576),
    responseLimit: integer(env.WEB_GATEWAY_RESPONSE_LIMIT, 1_048_576, 1_024, 2_097_152),
  });
}

class ProxyFault extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
  }
}

function requestIds(request) {
  const safe = (value) =>
    typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : randomUUID();
  return {
    requestId: safe(request.headers['x-request-id']),
    correlationId: safe(request.headers['x-correlation-id']),
  };
}

function json(response, status, reason, ids) {
  const code =
    status === 504
      ? 'UPSTREAM_TIMEOUT'
      : status === 502
        ? 'UPSTREAM_INVALID'
        : status === 503
          ? 'SERVICE_NOT_READY'
          : status === 403
            ? 'AUTH_CSRF'
            : 'REQUEST_INVALID';
  const message =
    status >= 500
      ? 'The Gateway response could not be confirmed.'
      : 'The request could not be accepted.';
  response.writeHead(API_ERROR_STATUS[code], {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-request-id': ids.requestId,
    'x-correlation-id': ids.correlationId,
  });
  response.end(JSON.stringify(apiError(code, message, ids, { reason })));
}

function requestPath(raw) {
  const unsafeCharacter = (value) =>
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return character === '\\' || code <= 32 || code === 127;
    });
  // Do not let URL normalization turn an allowed prefix into another endpoint.
  if (!API_PATH.test(raw) || raw.includes('#') || unsafeCharacter(raw))
    throw new ProxyFault(400, 'INVALID_API_PATH');
  const path = raw.split('?', 1)[0];
  let decoded;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    throw new ProxyFault(400, 'INVALID_API_PATH');
  }
  if (
    /%(?:25|2f|5c)/i.test(path) ||
    unsafeCharacter(decoded) ||
    decoded.split('/').some((segment) => segment === '.' || segment === '..') ||
    !API_PATH.test(decoded)
  )
    throw new ProxyFault(400, 'INVALID_API_PATH');
  return raw;
}

function headersFor(request, config) {
  if (request.headers.host !== config.publicHost) throw new ProxyFault(421, 'WEB_ORIGIN_MISMATCH');
  if (
    (request.headers.origin !== undefined && request.headers.origin !== config.publicOrigin) ||
    request.headers['sec-fetch-site'] === 'cross-site'
  )
    throw new ProxyFault(403, 'AUTH_CSRF');
  const headers = {};
  for (const name of REQUEST_HEADERS) {
    const value = request.headers[name];
    if (value === undefined) continue;
    if (Array.isArray(value) || (request.headersDistinct?.[name]?.length ?? 1) !== 1)
      throw new ProxyFault(400, 'AMBIGUOUS_REQUEST_HEADER');
    headers[name] = value;
  }
  // Host, Forwarded, X-Forwarded-*, X-Auth-* and X-Service-* never cross this
  // boundary. Gateway and Identity authenticate the unchanged browser context.
  return headers;
}

function requestBody(request, limit, signal) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    const clean = () => {
      request.off('data', data);
      request.off('end', end);
      request.off('error', failed);
      request.off('aborted', aborted);
      signal.removeEventListener('abort', timedOut);
    };
    const failed = (error) => {
      clean();
      request.resume();
      reject(error);
    };
    const aborted = () => failed(new ProxyFault(400, 'REQUEST_ABORTED'));
    const timedOut = () => failed(new ProxyFault(504, 'GATEWAY_TIMEOUT'));
    const data = (chunk) => {
      size += chunk.length;
      if (size > limit) failed(new ProxyFault(413, 'REQUEST_TOO_LARGE'));
      else chunks.push(chunk);
    };
    const end = () => {
      clean();
      resolve(size === 0 ? undefined : Buffer.concat(chunks, size));
    };
    request.on('data', data);
    request.once('end', end);
    request.once('error', failed);
    request.once('aborted', aborted);
    signal.addEventListener('abort', timedOut, { once: true });
    if (signal.aborted) timedOut();
  });
}

async function responseBody(response, limit) {
  const chunks = [];
  let size = 0;
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new ProxyFault(502, 'GATEWAY_RESPONSE_TOO_LARGE');
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, size);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function checkedCookies(cookies, secure) {
  for (const cookie of cookies) {
    const name = /^([^=]+)=/.exec(cookie)?.[1];
    const prefix = secure ? '__Host-wg_' : '(?:__Host-wg_|wg_)';
    if (
      !name ||
      !new RegExp(`^${prefix}(access|refresh|csrf|pre)$`).test(name) ||
      /;\s*domain\s*=/i.test(cookie) ||
      !/;\s*path=\/(?:;|$)/i.test(cookie) ||
      !/;\s*samesite=(?:lax|strict)(?:;|$)/i.test(cookie) ||
      (secure && !/;\s*secure(?:;|$)/i.test(cookie)) ||
      (!name.endsWith('csrf') && !/;\s*httponly(?:;|$)/i.test(cookie))
    )
      throw new ProxyFault(502, 'INVALID_GATEWAY_COOKIE');
  }
  return cookies;
}

/** Fixed Gateway transport only: no authentication, business decisions or owner URLs. */
export function createWebGateway({ env = process.env } = {}) {
  const config = loadWebGatewayConfig(env);
  return {
    configured: config !== null,
    async ready() {
      if (!config) return false;
      const controller = new globalThis.AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs);
      timer.unref();
      try {
        const response = await globalThis.fetch(config.origin + '/health/ready', {
          redirect: 'manual',
          signal: controller.signal,
          headers: { accept: 'application/json' },
        });
        if (response.status !== 200) {
          await response.body?.cancel();
          return false;
        }
        const body = JSON.parse((await responseBody(response, 65_536)).toString('utf8'));
        return body.service === 'api-gateway' && body.ready === true && body.businessReady === true;
      } catch {
        return false;
      } finally {
        clearTimeout(timer);
      }
    },
    async handle(request, response) {
      if (!API_PATH.test(request.url ?? '')) return false;
      const ids = requestIds(request);
      if (!config) {
        json(response, 503, 'GATEWAY_NOT_CONFIGURED', ids);
        return true;
      }
      const controller = new globalThis.AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs);
      timer.unref();
      const disconnected = () => {
        if (!response.writableFinished) controller.abort();
      };
      response.once('close', disconnected);
      try {
        if (!METHODS.has(request.method)) throw new ProxyFault(405, 'METHOD_NOT_ALLOWED');
        const path = requestPath(request.url);
        const headers = headersFor(request, config);
        headers['x-request-id'] = ids.requestId;
        headers['x-correlation-id'] = ids.correlationId;
        const body = await requestBody(request, config.requestLimit, controller.signal);
        if (body && (request.method === 'GET' || request.method === 'HEAD'))
          throw new ProxyFault(400, 'UNEXPECTED_REQUEST_BODY');
        const upstream = await globalThis.fetch(config.origin + path, {
          method: request.method,
          headers,
          ...(body ? { body } : {}),
          signal: controller.signal,
          redirect: 'manual',
        });
        if (upstream.status >= 300 && upstream.status < 400) {
          await upstream.body?.cancel();
          throw new ProxyFault(502, 'GATEWAY_REDIRECT_REFUSED');
        }
        const content = await responseBody(upstream, config.responseLimit);
        if (
          content.length &&
          !/^application\/json(?:;|$)/i.test(upstream.headers.get('content-type') ?? '')
        )
          throw new ProxyFault(502, 'INVALID_GATEWAY_RESPONSE');
        if (content.length) {
          try {
            JSON.parse(content.toString('utf8'));
          } catch {
            throw new ProxyFault(502, 'INVALID_GATEWAY_RESPONSE');
          }
        } else if (request.method !== 'HEAD' && upstream.status !== 204) {
          throw new ProxyFault(502, 'INVALID_GATEWAY_RESPONSE');
        }
        const cookies = checkedCookies(upstream.headers.getSetCookie(), config.secureCookies);
        for (const name of RESPONSE_HEADERS) {
          const value = upstream.headers.get(name);
          if (value !== null) response.setHeader(name, value);
        }
        if (cookies.length) response.setHeader('set-cookie', cookies);
        response.writeHead(upstream.status);
        response.end(request.method === 'HEAD' ? undefined : content);
      } catch (error) {
        if (!response.destroyed && !response.headersSent) {
          response.setHeader('connection', 'close');
          if (error instanceof ProxyFault) json(response, error.status, error.message, ids);
          else json(response, controller.signal.aborted ? 504 : 502, 'GATEWAY_UNAVAILABLE', ids);
        }
      } finally {
        clearTimeout(timer);
        response.off('close', disconnected);
      }
      return true;
    },
  };
}
