import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WEB_RUNTIME = Object.freeze({
  app: 'operator-web',
  stage: 'foundation-only',
  businessReady: false,
});

/**
 * Origins allowed for presigned object-store traffic (evidence upload PUT and
 * short-lived thumbnail GET). Configured per deployment; never a wildcard.
 */
export function parseMediaOrigins(value = '') {
  const origins = [];
  for (const raw of String(value)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)) {
    let url;
    try {
      url = new URL(raw);
    } catch {
      throw new Error('INVALID_MEDIA_ORIGIN');
    }
    const loopback = url.protocol === 'http:' && url.hostname === '127.0.0.1';
    if (
      (url.protocol !== 'https:' && !loopback) ||
      url.origin !== raw ||
      url.username ||
      url.password
    ) {
      throw new Error('INVALID_MEDIA_ORIGIN');
    }
    origins.push(url.origin);
  }
  return origins;
}

/** Content-Security-Policy of the operator document and assets. */
export function contentSecurityPolicy(mediaOrigins = []) {
  const media = mediaOrigins.length ? ' ' + mediaOrigins.join(' ') : '';
  return (
    "default-src 'none'; script-src 'self'; style-src 'self'; " +
    "img-src 'self' blob:" +
    media +
    "; connect-src 'self'" +
    media +
    '; ' +
    "base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
  );
}

/**
 * Static delivery of the built operator UI. Business data is never served
 * here: `/api/operator/*` belongs to the gateway (requested in
 * docs/production/C/contract-requests/CR-P03-C5-operator-gateway.md).
 */
export function createWebHandler({
  documentRoot = new URL('./dist/', import.meta.url),
  mediaOrigins = [],
} = {}) {
  const root = path.resolve(
    documentRoot instanceof URL ? fileURLToPath(documentRoot) : documentRoot,
  );
  const policy = contentSecurityPolicy(mediaOrigins);
  return async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', policy);
    const send = (code, type, content) => {
      response.writeHead(code, { 'Content-Type': type });
      response.end(request.method === 'HEAD' ? undefined : content);
    };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      send(405, 'application/json', JSON.stringify({ code: 'METHOD_NOT_ALLOWED' }));
      return;
    }
    let pathname;
    try {
      pathname = decodeURIComponent((request.url ?? '/').split('?')[0]);
    } catch {
      send(400, 'application/json', JSON.stringify({ code: 'INVALID_PATH' }));
      return;
    }
    if (pathname === '/health/live') {
      send(200, 'application/json', JSON.stringify({ ...WEB_RUNTIME, status: 'alive' }));
      return;
    }
    if (pathname === '/health/ready') {
      send(
        503,
        'application/json',
        JSON.stringify({ ...WEB_RUNTIME, ready: false, code: 'FOUNDATION_NOT_READY' }),
      );
      return;
    }
    // Only the entry document and flat, fingerprinted Vite assets are public.
    // No fallback routes or directory traversal into configuration/source files.
    const asset = /^\/assets\/([a-zA-Z0-9][a-zA-Z0-9._-]*\.(?:js|css|svg|png|webp))$/.exec(
      pathname,
    );
    if (pathname !== '/' && pathname !== '/index.html' && !asset) {
      send(404, 'application/json', JSON.stringify({ code: 'NOT_FOUND' }));
      return;
    }
    const filename = asset ? path.join(root, 'assets', asset[1]) : path.join(root, 'index.html');
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.webp': 'image/webp',
    };
    try {
      const content = await readFile(filename);
      send(200, types[path.extname(filename)] ?? 'application/octet-stream', content);
    } catch {
      send(
        503,
        'application/json',
        JSON.stringify({ code: 'BOOT_ARTIFACT_UNAVAILABLE', businessReady: false }),
      );
    }
  };
}

/** Stateless runtime; readiness stays 503 until business readiness is accepted. */
export function createWebRuntime(options = {}) {
  return createServer(createWebHandler(options));
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? '3000');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('INVALID_PORT');
  const server = createWebRuntime({
    mediaOrigins: parseMediaOrigins(process.env.OPERATOR_MEDIA_ORIGINS ?? ''),
  });
  server.listen(port, process.env.HOST ?? '127.0.0.1');
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      server.close(() => {
        process.exitCode = 0;
      });
      setTimeout(() => server.closeAllConnections(), 5_000).unref();
    });
  }
}
