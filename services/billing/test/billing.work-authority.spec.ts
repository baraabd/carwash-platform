import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingHttpHeaders, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  DispatchWorkAuthority,
  dispatchWorkConfigFromEnv,
} from '../src/infrastructure/work/dispatch-work.authority';
import { MAX_RESPONSE_BYTES } from '../src/infrastructure/http/bounded-fetch';
import { WorkAuthorityUnavailable } from '../src/ports';
import { tokenFor } from './support/upstream-stubs';

const BOOKING = randomUUID();
const TECHNICIAN = randomUUID();
const CORRELATION = randomUUID();
const BEARER = `Bearer ${tokenFor('technician')}`;

function work(overrides: Record<string, unknown> = {}) {
  return {
    bookingId: BOOKING,
    assignmentId: randomUUID(),
    assignmentRevision: 3,
    technicianSubjectId: TECHNICIAN,
    workState: 'COMPLETED',
    taskId: randomUUID(),
    taskStage: 'CLOSED',
    taskRevision: 8,
    ...overrides,
  };
}

/** Local HTTP double only; these tests do not claim to run Dispatch. */
async function upstream() {
  const calls: { method: string | undefined; path: string; headers: IncomingHttpHeaders }[] = [];
  const state: {
    status: number;
    body: unknown;
    raw: string | null;
    contentType: string;
    declaredLength: string | null;
    hang: boolean;
  } = {
    status: 200,
    body: work(),
    raw: null,
    contentType: 'application/json',
    declaredLength: null,
    hang: false,
  };
  const hanging = new Set<ServerResponse>();
  const server = createServer((request, response) => {
    calls.push({ method: request.method, path: request.url ?? '', headers: request.headers });
    if (state.hang) {
      hanging.add(response);
      return;
    }
    response.writeHead(state.status, {
      'content-type': state.contentType,
      ...(state.declaredLength === null ? {} : { 'content-length': state.declaredLength }),
      ...(state.status === 302 ? { location: '/must-not-follow' } : {}),
    });
    response.end(state.raw ?? JSON.stringify(state.body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    calls,
    state,
    authority: new DispatchWorkAuthority({
      origin: new URL(`http://127.0.0.1:${port}/`),
      timeoutMs: 100,
    }),
    async close() {
      for (const response of hanging) response.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

test('Dispatch authority reads the assigned work route with the caller credential and correlation', async (t) => {
  const stub = await upstream();
  t.after(() => stub.close());
  const view = work();
  stub.state.body = view;
  assert.deepEqual(await stub.authority.evidenceFor(BOOKING, BEARER, CORRELATION), {
    bookingId: BOOKING,
    assignmentId: view.assignmentId,
    assignmentRevision: 3,
    technicianSubject: TECHNICIAN,
    workState: 'COMPLETED',
    taskId: view.taskId,
    taskStage: 'CLOSED',
    taskRevision: 8,
  });
  assert.equal(stub.calls.length, 1);
  assert.equal(stub.calls[0]?.method, 'GET');
  assert.equal(stub.calls[0]?.path, `/internal/v1/dispatch/me/bookings/${BOOKING}/work`);
  assert.equal(stub.calls[0]?.headers.authorization, BEARER);
  assert.equal(stub.calls[0]?.headers['x-correlation-id'], CORRELATION);
  assert.equal(stub.calls[0]?.headers['x-auth-subject'], undefined);
  assert.equal(stub.calls[0]?.headers['x-service-token'], undefined);
});

test('Dispatch authority preserves incomplete work; it never upgrades it to completion', async (t) => {
  const stub = await upstream();
  t.after(() => stub.close());
  for (const [taskStage, workState] of [
    ['ACCEPTED', 'NOT_STARTED'],
    ['DOCUMENTING', 'IN_PROGRESS'],
    ['FINISHED', 'COMPLETED'],
    ['CLOSED', 'COMPLETED'],
    ['CANCELLED', 'CANCELLED'],
  ]) {
    stub.state.body = work({ taskStage, workState });
    const evidence = await stub.authority.evidenceFor(BOOKING, BEARER, CORRELATION);
    assert.equal(evidence?.taskStage, taskStage);
    assert.equal(evidence?.workState, workState);
  }
  stub.state.body = work({
    taskId: null,
    taskStage: null,
    taskRevision: null,
    workState: 'NOT_STARTED',
  });
  assert.equal((await stub.authority.evidenceFor(BOOKING, BEARER, CORRELATION))?.taskId, null);
});

test('Dispatch authority fails closed on denied access, errors and redirects without retries', async (t) => {
  const stub = await upstream();
  t.after(() => stub.close());
  stub.state.status = 404;
  assert.equal(await stub.authority.evidenceFor(BOOKING, BEARER, CORRELATION), null);
  for (const status of [200, 201, 204, 301, 302, 401, 403, 409, 429, 500, 503]) {
    stub.state.status = status;
    stub.state.body = status === 200 ? { workState: 'COMPLETED' } : {};
    const before = stub.calls.length;
    await assert.rejects(
      stub.authority.evidenceFor(BOOKING, BEARER, CORRELATION),
      WorkAuthorityUnavailable,
    );
    assert.equal(stub.calls.length, before + 1, `status ${status}: no retries/redirect follow`);
  }
});

test('Dispatch authority rejects foreign bindings, inconsistent task states and malformed contract fields', async (t) => {
  const stub = await upstream();
  t.after(() => stub.close());
  for (const malformed of [
    null,
    [],
    work({ bookingId: randomUUID() }),
    work({ assignmentId: 'untrusted' }),
    work({ assignmentRevision: 0 }),
    work({ assignmentRevision: Number.MAX_SAFE_INTEGER + 1 }),
    work({ technicianSubjectId: null }),
    work({ workState: 'PAID' }),
    work({ taskStage: 'IN_SERVICE' }),
    work({ taskId: null }),
    work({ taskRevision: null }),
    work({ taskRevision: -1 }),
    work({ quoteId: randomUUID() }),
  ]) {
    stub.state.body = malformed;
    await assert.rejects(
      stub.authority.evidenceFor(BOOKING, BEARER, CORRELATION),
      WorkAuthorityUnavailable,
    );
  }
  stub.state.raw = '{truncated';
  await assert.rejects(
    stub.authority.evidenceFor(BOOKING, BEARER, CORRELATION),
    WorkAuthorityUnavailable,
  );
  stub.state.raw = null;
  stub.state.body = work();
  stub.state.contentType = 'text/html';
  await assert.rejects(
    stub.authority.evidenceFor(BOOKING, BEARER, CORRELATION),
    WorkAuthorityUnavailable,
  );
});

test('Dispatch authority bounds both response size and wait time', async (t) => {
  const stub = await upstream();
  t.after(() => stub.close());
  stub.state.raw = 'x'.repeat(MAX_RESPONSE_BYTES + 1);
  for (const declaredLength of [null, String(MAX_RESPONSE_BYTES + 1)]) {
    stub.state.declaredLength = declaredLength;
    await assert.rejects(
      stub.authority.evidenceFor(BOOKING, BEARER, CORRELATION),
      WorkAuthorityUnavailable,
    );
  }
  stub.state.hang = true;
  const start = performance.now();
  await assert.rejects(
    stub.authority.evidenceFor(BOOKING, BEARER, CORRELATION),
    WorkAuthorityUnavailable,
  );
  assert.ok(performance.now() - start < 2_000, 'bounded timeout');
});

test('Dispatch authority validates configuration and never calls a network on absent authority or invalid input', async () => {
  assert.deepEqual(dispatchWorkConfigFromEnv({}), { origin: null, timeoutMs: 2_000 });
  assert.equal(
    dispatchWorkConfigFromEnv({ BILLING_DISPATCH_ORIGIN: 'https://dispatch.example/' }).origin
      ?.hostname,
    'dispatch.example',
  );
  for (const origin of [
    'http://dispatch.example/',
    'https://user:secret@dispatch.example/',
    'https://dispatch.example/path',
    'https://dispatch.example/?token=x',
  ]) {
    assert.throws(() => dispatchWorkConfigFromEnv({ BILLING_DISPATCH_ORIGIN: origin }));
  }
  for (const timeout of ['0', '99', '10001', 'NaN', '1.5']) {
    assert.throws(() => dispatchWorkConfigFromEnv({ BILLING_DISPATCH_TIMEOUT_MS: timeout }));
  }
  let calls = 0;
  const fetcher: typeof fetch = () => {
    calls++;
    return Promise.reject(new Error('NETWORK_MUST_NOT_BE_CALLED'));
  };
  const missing = new DispatchWorkAuthority({ origin: null, timeoutMs: 100 }, fetcher);
  await assert.rejects(missing.evidenceFor(BOOKING, BEARER, CORRELATION), WorkAuthorityUnavailable);
  const configured = new DispatchWorkAuthority(
    { origin: new URL('https://dispatch.example/'), timeoutMs: 100 },
    fetcher,
  );
  await assert.rejects(
    configured.evidenceFor('../../foreign', BEARER, CORRELATION),
    WorkAuthorityUnavailable,
  );
  await assert.rejects(
    configured.evidenceFor(BOOKING, 'forged', CORRELATION),
    WorkAuthorityUnavailable,
  );
  assert.equal(calls, 0);
});
