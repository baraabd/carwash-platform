import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { ROOT, APP_IDS, loadRegistry, verifyRegisteredReferences } from './reference-registry.mjs';

export async function startReferenceServer({ host = '127.0.0.1', port = 0 } = {}) {
  if (host !== '127.0.0.1') throw new Error('F010_REFERENCE_SERVER_MUST_BIND_LOOPBACK');
  const verified = verifyRegisteredReferences({ allowRegistration: true });
  if (!verified.ok)
    throw new Error(`F010_REFERENCE_VERIFICATION_FAILED:${verified.errors.join('|')}`);
  const manifest = loadRegistry(ROOT);
  const html = new Map(
    APP_IDS.map((id) => [
      id,
      readFileSync(new URL(`../../${manifest.references[id].canonicalHtml}`, import.meta.url)),
    ]),
  );

  const server = createServer((request, response) => {
    const method = request.method ?? '';
    if (!['GET', 'HEAD'].includes(method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' });
      response.end();
      return;
    }
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    if (pathname === '/healthz') {
      const body = Buffer.from('ok\n');
      response.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Length': body.length,
        'Cache-Control': 'no-store',
      });
      response.end(method === 'HEAD' ? undefined : body);
      return;
    }
    const match = /^\/(customer|technician|admin)(?:\/index\.html)?$/.exec(pathname);
    if (!match) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(method === 'HEAD' ? undefined : 'Not found');
      return;
    }
    const body = html.get(match[1]);
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    response.end(method === 'HEAD' ? undefined : body);
  });

  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('F010_REFERENCE_SERVER_NO_PORT');
  return {
    origin: `http://${host}:${address.port}`,
    close: () =>
      new Promise((resolvePromise, reject) =>
        server.close((error) => (error ? reject(error) : resolvePromise())),
      ),
  };
}
