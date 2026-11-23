import { createServer } from 'node:http';
import path from 'node:path';
import { ROOT, require } from '../_support.mjs';

/** Explicit Pricing double only for Scheduling capacity/restart/broker suites. */
export const { DeclaredQuotes } = require(
  path.join(ROOT, 'services/scheduling/dist-tests/test/support/quotes.js'),
);

export async function declaredPricingHttp() {
  const quotes = new DeclaredQuotes();
  const credentials = new Map();
  const server = createServer((req, res) => {
    const match = /^\/internal\/v1\/pricing\/quotes\/([^/]+)$/.exec(req.url ?? '');
    const id = match?.[1];
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    if (req.method !== 'GET' || !id || credentials.get(id) !== token) {
      res.writeHead(404, { 'content-type': 'application/json' }).end('{}');
      return;
    }
    const wire = quotes.wire(id);
    res
      .writeHead(wire ? 200 : 404, { 'content-type': 'application/json' })
      .end(JSON.stringify(wire ?? {}));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    register(request, token) {
      quotes.register({ ...request, startsAt: new Date(request.startsAt) });
      credentials.set(request.quoteRef.quoteId, token);
      return request;
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
