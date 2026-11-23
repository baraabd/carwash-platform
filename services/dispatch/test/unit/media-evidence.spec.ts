import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import test, { after, before } from 'node:test';
import { DispatchError } from '../../src/domain';
import { ServiceHttp } from '../../src/infrastructure/http/service-http';
import { MediaEvidenceClient } from '../../src/infrastructure/media/media-evidence.client';

const objectId = randomUUID();
const claimRef = randomUUID();
const ownerSubjectId = randomUUID();
const correlationId = randomUUID();
let response: { status: number; body: unknown };
let server: Server;
let client: MediaEvidenceClient;
const seen: { path: string; key: string | undefined; body: unknown }[] = [];

before(async () => {
  server = createServer((request, result) => {
    let body = '';
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8');
    });
    request.on('end', () => {
      seen.push({
        path: request.url ?? '',
        key: request.headers['idempotency-key'] as string | undefined,
        body: body ? (JSON.parse(body) as unknown) : null,
      });
      result
        .writeHead(response.status, { 'content-type': 'application/json' })
        .end(JSON.stringify(response.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  client = new MediaEvidenceClient(
    new ServiceHttp({
      baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      credential: { clientId: 'dispatch', token: 't'.repeat(40) },
      timeoutMs: 500,
    }),
  );
});

after(() => new Promise<void>((resolve) => server.close(() => resolve())));

const object = () => ({
  objectId,
  ownerSubjectId,
  status: 'AVAILABLE',
  purpose: 'WORK_EVIDENCE',
  contentType: 'image/jpeg',
});

const unavailable = (error: unknown) =>
  error instanceof DispatchError && error.code === 'EVIDENCE_UNAVAILABLE';

test('Media inspection refuses a valid object response for a different id', async () => {
  response = { status: 200, body: object() };
  assert.equal((await client.inspect(objectId, correlationId))?.objectId, objectId);
  response = { status: 200, body: { ...object(), objectId: randomUUID() } };
  await assert.rejects(client.inspect(objectId, correlationId), unavailable);
  response = { status: 404, body: {} };
  assert.equal(await client.inspect(objectId, correlationId), null);
});

test('Media claim requires the exact object, claim and holder receipt before evidence is linked', async () => {
  const receipt = {
    ...object(),
    claimed: true,
    claim: { claimRef, holder: 'dispatch.task-evidence', claimedAt: new Date().toISOString() },
  };
  for (const status of [200, 201]) {
    response = { status, body: receipt };
    await client.claim(objectId, claimRef, correlationId);
  }
  for (const body of [
    {},
    { ...receipt, objectId: randomUUID() },
    { ...receipt, claimed: false },
    { ...receipt, claim: { ...receipt.claim, claimRef: randomUUID() } },
    { ...receipt, claim: { ...receipt.claim, holder: 'another.holder' } },
  ]) {
    response = { status: 200, body };
    await assert.rejects(client.claim(objectId, claimRef, correlationId), unavailable);
  }
});

test('a successful HTTP response does not finish a fence without this object being revoked', async () => {
  const key = `evidence-fence-${claimRef}`;
  const revoke = () => client.revokeOwnerAccess(objectId, claimRef, key, correlationId);
  for (const body of [
    {},
    { ...object(), ownerAccess: 'GRANTED' },
    { ...object(), ownerAccess: 'REVOKED', objectId: randomUUID() },
  ]) {
    response = { status: 200, body };
    assert.deepEqual(await revoke(), { kind: 'FAILED', code: 'MEDIA_UPSTREAM_INVALID' });
  }
  response = { status: 200, body: { ...object(), ownerAccess: 'REVOKED' } };
  assert.deepEqual(await revoke(), { kind: 'FENCED' });
  assert.deepEqual(
    await revoke(),
    { kind: 'FENCED' },
    'lost acknowledgement replays the same revocation',
  );
  assert.deepEqual(seen.at(-1), {
    path: `/internal/v1/media/objects/${objectId}/claims/${claimRef}/owner-access`,
    key,
    body: { access: 'REVOKED', reason: 'TASK_ENDED' },
  });
  response = { status: 404, body: {} };
  assert.deepEqual(await revoke(), { kind: 'FAILED', code: 'MEDIA_HTTP_404' });
});
