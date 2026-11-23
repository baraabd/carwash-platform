import { createServer } from 'node:http';

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/**
 * Fault injection is limited to the two Booking-owned Billing commands on the
 * explicitly started loopback test server. Incoming URLs never become outbound
 * destinations. No secret headers/bodies are retained in evidence.
 */
export async function billingFaultProxy(origin) {
  if (
    typeof origin !== 'string' ||
    !/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(origin) ||
    Number(origin.slice(origin.lastIndexOf(':') + 1)) > 65535
  ) {
    throw new Error('BILLING_PROXY_LOOPBACK_ORIGIN_REQUIRED');
  }
  const createTarget = origin + '/internal/v1/billing/booking-obligations';
  const compensateTarget = origin + '/internal/v1/billing/booking-obligations/compensations';
  const state = {
    loseCreate: 0,
    loseCompensation: 0,
    rejectCreate: false,
    rejectCompensation: false,
    pending: null,
  };
  const calls = { create: 0, compensate: 0 };
  const server = createServer((request, response) => {
    void (async () => {
      if (request.method !== 'POST') {
        response
          .writeHead(405, { allow: 'POST', 'content-type': 'application/json' })
          .end('{"error":{"code":"METHOD_NOT_ALLOWED"}}');
        return;
      }
      const create = request.url === '/internal/v1/billing/booking-obligations';
      const compensate = request.url === '/internal/v1/billing/booking-obligations/compensations';
      if (!create && !compensate) {
        response
          .writeHead(404, { 'content-type': 'application/json' })
          .end('{"error":{"code":"NOT_FOUND"}}');
        return;
      }
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      if (create) calls.create += 1;
      if (compensate) calls.compensate += 1;
      if ((create && state.rejectCreate) || (compensate && state.rejectCompensation)) {
        response
          .writeHead(503, { 'content-type': 'application/json' })
          .end('{"error":{"code":"UPSTREAM_UNAVAILABLE"}}');
        return;
      }
      const gate = create ? state.pending : null;
      if (gate) state.pending = null;
      const headers = Object.fromEntries(
        Object.entries(request.headers).filter(
          ([name, value]) =>
            value !== undefined &&
            !['host', 'connection', 'content-length', 'transfer-encoding'].includes(name),
        ),
      );
      const remote = await fetch(create ? createTarget : compensateTarget, {
        method: 'POST',
        headers,
        ...(body.length ? { body } : {}),
        redirect: 'error',
        signal: globalThis.AbortSignal.timeout(6000),
      });
      const bytes = await remote.arrayBuffer();
      if (gate) {
        gate.entered.resolve({
          bookingId: JSON.parse(body.toString('utf8')).bookingId,
          status: remote.status,
        });
        await gate.release.promise;
      }
      if ((create && state.loseCreate > 0) || (compensate && state.loseCompensation > 0)) {
        if (create) state.loseCreate -= 1;
        else state.loseCompensation -= 1;
        response.destroy();
        return;
      }
      response
        .writeHead(remote.status, {
          'content-type': remote.headers.get('content-type') ?? 'application/json',
          'idempotency-replayed': remote.headers.get('idempotency-replayed') ?? 'false',
        })
        .end(Buffer.from(bytes));
    })().catch(() => {
      response.destroy();
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    state,
    calls,
    pauseNextCreate() {
      const gate = { entered: deferred(), release: deferred() };
      state.pending = gate;
      return { entered: gate.entered.promise, release: () => gate.release.resolve() };
    },
    async close() {
      state.pending?.release.resolve();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
