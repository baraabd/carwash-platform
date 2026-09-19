import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyReference } from './check-design-reference.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const verified = verifyReference(root);
if (!verified.ok) { console.error(verified); process.exit(1); }
const html = readFileSync(resolve(root, 'apps/customer-web/prototype/index.html'));
const port = Number(process.env.PORT || 4173);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be 1024..65535');
const server = createServer((req, res) => {
  const path = new URL(req.url || '/', 'http://127.0.0.1').pathname;
  if (!['GET', 'HEAD'].includes(req.method || '')) { res.writeHead(405).end(); return; }
  if (path !== '/' && path !== '/index.html') { res.writeHead(404).end('Not found'); return; }
  res.writeHead(200, {'Content-Type':'text/html; charset=utf-8', 'Content-Length': html.length,
    'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer'});
  res.end(req.method === 'HEAD' ? undefined : html);
});
server.on('error', e => { console.error(e.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`Unchanged local prototype: http://127.0.0.1:${port}\nNo real bookings or payments. Ctrl+C to stop.`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
