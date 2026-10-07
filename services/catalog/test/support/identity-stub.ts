import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * TEST DOUBLE of Identity's `GET /internal/v1/identity/session`, served over a
 * real local HTTP listener so the production adapter (timeouts, status mapping,
 * body bounds) is exercised end to end. It is not Identity: it proves the
 * consumer side only. Real Identity-to-Catalog acceptance stays pending on E.
 */
export interface StubSession {
  readonly subject: string;
  readonly permissions: readonly string[];
}

export interface IdentityStub {
  readonly origin: string;
  readonly calls: { authorization: string | undefined; correlationId: string | undefined }[];
  /** Overrides the next responses, e.g. to simulate an outage. */
  mode: 'normal' | 'error-500' | 'hang' | 'garbage';
  close(): Promise<void>;
}

/** Each token is a syntactically valid JWT-shaped string mapped to a session. */
export function tokenFor(name: string): string {
  const part = Buffer.from(name).toString('base64url');
  return `eyJhbGciOiJSUzI1NiJ9.${part}.c2lnbmF0dXJl`;
}

export async function startIdentityStub(
  sessions: Record<string, StubSession>,
): Promise<IdentityStub> {
  const byToken = new Map(Object.entries(sessions).map(([name, s]) => [tokenFor(name), s]));
  const calls: IdentityStub['calls'] = [];
  const hanging = new Set<import('node:http').ServerResponse>();
  const state = { mode: 'normal' as IdentityStub['mode'] };
  const server: Server = createServer((request, response) => {
    const authorization = request.headers.authorization;
    const correlation = request.headers['x-correlation-id'];
    calls.push({
      authorization,
      correlationId: typeof correlation === 'string' ? correlation : undefined,
    });
    if (request.url !== '/internal/v1/identity/session' || request.method !== 'GET') {
      response.writeHead(404).end();
      return;
    }
    if (state.mode === 'hang') {
      hanging.add(response);
      return;
    }
    if (state.mode === 'error-500') {
      response.writeHead(500, { 'content-type': 'application/json' }).end('{}');
      return;
    }
    if (state.mode === 'garbage') {
      response.writeHead(200, { 'content-type': 'application/json' }).end('{"subject":"x"}');
      return;
    }
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
    const session = token ? byToken.get(token) : undefined;
    if (!session) {
      response
        .writeHead(401, { 'content-type': 'application/json' })
        .end('{"error":{"code":"AUTH_REQUIRED"}}');
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' }).end(
      JSON.stringify({
        subject: session.subject,
        sessionId: '0b1c2d3e-4f50-4617-8829-3a4b5c6d7e8f',
        authVersion: 1,
        roles: [],
        permissions: session.permissions,
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}/`,
    calls,
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
