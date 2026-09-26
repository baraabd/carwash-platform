import { createServer } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const own = createRequire(path.join(ROOT, 'apps/api-gateway/package.json'));
export const gateway = own('./dist/index.js');
export const ORIGIN = 'https://customer.washgo.invalid';
/** Explicit test-only business owner. It is never wired into application runtime. */
export async function stub(owner, handler) {
  const calls = [];
  const state = { handler };
  const server = createServer((request, response) => {
    void (async () => {
      let text = '';
      for await (const chunk of request) text += chunk;
      const call = {
        path: request.url,
        method: request.method,
        headers: request.headers,
        body: text ? JSON.parse(text) : null,
      };
      calls.push(call);
      response.setHeader('content-type', 'application/json');
      if (state.handler) return state.handler(call, response);
      response.end(JSON.stringify({ owner, path: request.url, testStub: true }));
    })().catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end('{}');
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    calls,
    state,
    base: `http://127.0.0.1:${server.address().port}`,
    async close() {
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    },
  };
}
export function config(identity, origins = {}, extra = {}) {
  return {
    origins: { identity, ...origins },
    issuer: 'https://identity.washgo.invalid',
    audience: 'washgo-web',
    cookiePrefix: '__Host-wg_',
    timeoutMs: 500,
    responseLimit: 65536,
    allowedOrigins: [ORIGIN],
    ...extra,
  };
}
export async function start(config) {
  const app = await gateway.createGatewayApplication(config);
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  return {
    app,
    base,
    async close() {
      await app.close();
    },
  };
}
export async function request(base, path, options = {}) {
  const response = await fetch(base + path, options);
  const raw = await response.text();
  return { status: response.status, headers: response.headers, body: raw ? JSON.parse(raw) : null };
}
