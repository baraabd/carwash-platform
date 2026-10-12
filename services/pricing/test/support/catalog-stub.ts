import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { catalogBody } from './pricing-fixtures';

/**
 * TEST DOUBLE of the Catalog owner's PUBLISHED catalog.v1 `GET /definitions`,
 * served over a real local HTTP listener so the production adapter (timeout,
 * status mapping, body bound, closed-shape parse) is exercised end to end. It
 * is not Catalog: real Pricing-to-Catalog acceptance needs the deployed
 * Catalog owner serving catalog.v1 (see P06-B2 blockers).
 */
export interface CatalogStub {
  readonly origin: string;
  readonly calls: { correlationId: string | undefined; authorization: string | undefined }[];
  body: Record<string, unknown>;
  mode: 'normal' | 'error-500' | 'hang' | 'garbage' | 'redirect';
  close(): Promise<void>;
}

export async function startCatalogStub(): Promise<CatalogStub> {
  const calls: CatalogStub['calls'] = [];
  const hanging = new Set<ServerResponse>();
  const state = { mode: 'normal' as CatalogStub['mode'], body: catalogBody() };
  const server: Server = createServer((request, response) => {
    const correlation = request.headers['x-correlation-id'];
    calls.push({
      correlationId: typeof correlation === 'string' ? correlation : undefined,
      authorization: request.headers.authorization,
    });
    if (request.url !== '/internal/v1/catalog/definitions' || request.method !== 'GET') {
      response.writeHead(404).end();
      return;
    }
    switch (state.mode) {
      case 'hang':
        hanging.add(response);
        return;
      case 'error-500':
        response.writeHead(500, { 'content-type': 'application/json' }).end('{}');
        return;
      case 'garbage':
        response
          .writeHead(200, { 'content-type': 'application/json' })
          .end('{"catalogRevision":1,"items":[]}');
        return;
      case 'redirect':
        response.writeHead(302, { location: 'http://127.0.0.1:1/' }).end();
        return;
      default:
        response
          .writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify(state.body));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}/`,
    calls,
    get body() {
      return state.body;
    },
    set body(value) {
      state.body = value;
    },
    get mode() {
      return state.mode;
    },
    set mode(value) {
      state.mode = value;
    },
    async close() {
      for (const response of hanging) response.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
