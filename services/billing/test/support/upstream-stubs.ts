import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * TEST DOUBLES of Identity's `GET /internal/v1/identity/session` and Pricing's
 * pricing.v1 `GET /internal/v1/pricing/quotes/:quoteId`, served over real local
 * HTTP listeners so Billing's production adapters (timeouts, status mapping,
 * body bounds, strict parsing) run end to end. They are not Identity or
 * Pricing: they prove the consumer side only. Real cross-service acceptance is
 * pending on Lane E (contracts, workload identity) and Pricing's pricing.v1
 * conformance.
 */
export type StubMode = 'normal' | 'error-500' | 'hang' | 'garbage' | 'oversized';

export interface StubSession {
  readonly subject: string;
  readonly kind: 'account' | 'guest';
  readonly permissions: readonly string[];
}

export interface StubQuote {
  readonly ownerToken: string;
  readonly status: 'USABLE' | 'EXPIRED' | 'REVOKED';
  readonly currency: 'SYP' | 'USD';
  readonly totalMinor: string;
  /** Override the wire scale to simulate a contract-violating upstream. */
  readonly scale?: number;
}

export interface Stub {
  readonly origin: string;
  readonly calls: {
    path: string;
    authorization: string | undefined;
    correlationId: string | undefined;
  }[];
  mode: StubMode;
  close(): Promise<void>;
}

/** Each token is a syntactically valid JWT-shaped string. */
export function tokenFor(name: string): string {
  const part = Buffer.from(name).toString('base64url');
  return `eyJhbGciOiJSUzI1NiJ9.${part}.c2lnbmF0dXJl`;
}

function bearer(request: IncomingMessage): string | undefined {
  const value = request.headers.authorization;
  return value?.startsWith('Bearer ') ? value.slice(7) : undefined;
}

async function serve(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<Stub> {
  const calls: Stub['calls'] = [];
  const hanging = new Set<ServerResponse>();
  const state = { mode: 'normal' as StubMode };
  const server: Server = createServer((request, response) => {
    const correlation = request.headers['x-correlation-id'];
    calls.push({
      path: request.url ?? '',
      authorization: request.headers.authorization,
      correlationId: typeof correlation === 'string' ? correlation : undefined,
    });
    if (state.mode === 'hang') {
      hanging.add(response);
      return;
    }
    if (state.mode === 'error-500') {
      response.writeHead(500, { 'content-type': 'application/json' }).end('{}');
      return;
    }
    if (state.mode === 'garbage') {
      response.writeHead(200, { 'content-type': 'application/json' }).end('{"subject":"x"');
      return;
    }
    if (state.mode === 'oversized') {
      response
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ padding: 'x'.repeat(20_000) }));
      return;
    }
    handler(request, response);
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

export function startIdentityStub(sessions: Record<string, StubSession>): Promise<Stub> {
  const byToken = new Map(Object.entries(sessions).map(([name, s]) => [tokenFor(name), s]));
  return serve((request, response) => {
    if (request.url !== '/internal/v1/identity/session' || request.method !== 'GET') {
      response.writeHead(404).end();
      return;
    }
    const token = bearer(request);
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
        principalKind: session.kind,
        roles: [],
        permissions: session.permissions,
      }),
    );
  });
}

export interface PricingStub extends Stub {
  readonly quotes: Map<string, StubQuote>;
}

/** Answers with the published QuoteV1 shape; non-owners get 404 like Pricing. */
export async function startPricingStub(): Promise<PricingStub> {
  const quotes = new Map<string, StubQuote>();
  const stub = await serve((request, response) => {
    const prefix = '/internal/v1/pricing/quotes/';
    const url = request.url ?? '';
    const quote = url.startsWith(prefix) ? quotes.get(url.slice(prefix.length)) : undefined;
    const token = bearer(request);
    if (request.method !== 'GET' || !quote || !token || tokenFor(quote.ownerToken) !== token) {
      response
        .writeHead(404, { 'content-type': 'application/json' })
        .end('{"error":{"code":"NOT_FOUND"}}');
      return;
    }
    const quoteId = url.slice(prefix.length);
    const money = {
      currency: quote.currency,
      amountMinor: quote.totalMinor,
      scale: quote.scale ?? 2,
    };
    response.writeHead(200, { 'content-type': 'application/json' }).end(
      JSON.stringify({
        quoteId,
        revision: 1,
        status: quote.status,
        beneficiary: { kind: 'account', subjectId: '00000000-0000-4000-8000-000000000000' },
        vehicleType: 'SEDAN',
        zoneId: null,
        currency: quote.currency,
        lines: [
          {
            lineId: '11111111-1111-4111-8111-111111111111',
            kind: 'PACKAGE',
            definitionId: '22222222-2222-4222-8222-222222222222',
            quantity: 1,
            unitPrice: money,
            amount: money,
          },
        ],
        total: money,
        catalogRevision: 1,
        priceBookRevision: 1,
        issuedAt: '2026-10-08T10:00:00.000Z',
        expiresAt: '2026-10-08T10:30:00.000Z',
      }),
    );
  });
  return Object.assign(stub, { quotes });
}