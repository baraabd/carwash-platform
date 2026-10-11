import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * TEST DOUBLE of Identity's `GET /internal/v1/identity/session`, served over a
 * real local HTTP listener so Wallet's production Identity adapter (timeout,
 * status mapping, body bound, strict parsing) runs end to end. It is not
 * Identity: real Identity-to-Wallet acceptance waits on Lane E grants.
 */
export type StubMode = 'normal' | 'error-500' | 'hang';

export interface StubSession {
  readonly subject: string;
  readonly kind: 'account' | 'guest';
  readonly permissions: readonly string[];
}

export interface IdentityStub {
  readonly origin: string;
  mode: StubMode;
  close(): Promise<void>;
}

/** Each token is a syntactically valid JWT-shaped string. */
export function tokenFor(name: string): string {
  return `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(name).toString('base64url')}.c2lnbmF0dXJl`;
}

export const SUBJECTS = {
  technician: 'be6f7a8b-9c0d-4ebf-9a2b-5c6d7e8f9a0b',
  otherTechnician: 'cf7a8b9c-0d1e-4fc0-8b3c-6d7e8f9a0b1c',
  finance: '9c4d5e6f-7a8b-4c9d-be0f-3a4b5c6d7e8f',
  customer: '6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f',
  guest: '7a2b3c4d-5e6f-4a7b-9c8d-1e2f3a4b5c6d',
} as const;

const COLLECTOR = ['work.read:assigned', 'work.execute:assigned', 'billing.cash.collect'];

export const SESSIONS: Record<string, StubSession> = {
  technician: { subject: SUBJECTS.technician, kind: 'account', permissions: COLLECTOR },
  'other-technician': {
    subject: SUBJECTS.otherTechnician,
    kind: 'account',
    permissions: COLLECTOR,
  },
  finance: { subject: SUBJECTS.finance, kind: 'account', permissions: ['billing.read'] },
  customer: {
    subject: SUBJECTS.customer,
    kind: 'account',
    permissions: ['profile.read:self', 'bookings.read:self'],
  },
  /** Holds the collect grant on a guest session: never a cash holder. */
  'guest-collector': { subject: SUBJECTS.guest, kind: 'guest', permissions: COLLECTOR },
};

export const TOKENS = {
  technician: tokenFor('technician'),
  otherTechnician: tokenFor('other-technician'),
  finance: tokenFor('finance'),
  customer: tokenFor('customer'),
  guestCollector: tokenFor('guest-collector'),
  unknown: tokenFor('unknown'),
};

function bearer(request: IncomingMessage): string | undefined {
  const value = request.headers.authorization;
  return value?.startsWith('Bearer ') ? value.slice(7) : undefined;
}

export async function startIdentityStub(
  sessions: Record<string, StubSession> = SESSIONS,
): Promise<IdentityStub> {
  const byToken = new Map(Object.entries(sessions).map(([name, s]) => [tokenFor(name), s]));
  const hanging = new Set<ServerResponse>();
  const state = { mode: 'normal' as StubMode };
  const server: Server = createServer((request, response) => {
    if (state.mode === 'hang') {
      hanging.add(response);
      return;
    }
    if (state.mode === 'error-500') {
      response.writeHead(500, { 'content-type': 'application/json' }).end('{}');
      return;
    }
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
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}/`,
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
