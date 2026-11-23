import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ApplicationError } from '../../src/application';
import { HttpIdentityAuthorizer } from '../../src/infrastructure/identity/http-identity-authorizer';

/** A loopback stand-in for Identity's /session answering a fixed view. */
async function identityAnswering(view: unknown): Promise<{ server: Server; origin: string }> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(view));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { server, origin: `http://127.0.0.1:${port}` };
}

const base = {
  subject: randomUUID(),
  sessionId: randomUUID(),
  authVersion: 1,
  permissions: ['profile.read:self', 'profile.write:self'],
};

async function authorize(view: unknown) {
  const { server, origin } = await identityAnswering(view);
  try {
    return await new HttpIdentityAuthorizer({ origin, timeoutMs: 2_000 }).authorize(
      { authorization: 'Bearer token', correlationId: randomUUID() },
      'read',
    );
  } finally {
    server.close();
  }
}

const unavailable = (error: unknown) =>
  error instanceof ApplicationError && error.code === 'DEPENDENCY_UNAVAILABLE';

test('session: the principal kind comes from Identity, guests included', async () => {
  const guest = await authorize({ ...base, principalKind: 'guest', roles: [] });
  assert.deepEqual(guest.principal, { kind: 'guest', subject: base.subject });
  const account = await authorize({ ...base, principalKind: 'account', roles: ['customer'] });
  assert.equal(account.principal.kind, 'account');
});

test('session: a view without a valid kind or roles, or a guest with roles, fails closed', async () => {
  await assert.rejects(authorize({ ...base, roles: [] }), unavailable);
  await assert.rejects(authorize({ ...base, principalKind: 'staff', roles: [] }), unavailable);
  await assert.rejects(authorize({ ...base, principalKind: 'account' }), unavailable);
  await assert.rejects(
    authorize({ ...base, principalKind: 'guest', roles: ['admin'] }),
    unavailable,
  );
});
