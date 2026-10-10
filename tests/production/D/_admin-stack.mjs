/**
 * The admin console on real services, for the P04-D browser journeys:
 * one origin serving the built admin-web bundle and the real Gateway (with
 * the candidate route patches), the real Identity, Reporting, Booking,
 * Dispatch, Billing, Communications and Support HTTP adapters, PostgreSQL 16
 * and Redis. Declared doubles: Booking's upstream owners (Booking's own test
 * doubles) and Billing's Pricing quote upstream.
 */
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, appDsn, context, migrationDsn, sql } from '../../integration/_support.mjs';
import { hardenPrivileges, migrateDeploy } from '../../../scripts/acceptance/lib/migrations.mjs';
import { bearer, startIdentity } from './_identity.mjs';

export const owned = (service) =>
  createRequire(path.join(ROOT, 'services', service, 'package.json'));
export const dist = (service, file) =>
  owned(service)(path.join(ROOT, 'services', service, 'dist', file));

export function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server.address().port));
  });
}

async function nestService(service, env) {
  for (const [name, value] of Object.entries(env)) process.env[name] = value;
  const own = owned(service);
  own('reflect-metadata');
  const { createHttpApplication } = own('./dist/transport/http/create-app.js');
  const app = await createHttpApplication();
  await app.listen(env.PORT ? Number(env.PORT) : 0, '127.0.0.1');
  const port = Number(new URL(await app.getUrl()).port);
  return { app, port, origin: `http://127.0.0.1:${port}` };
}

function ingressHandler(gatewayPort, webPort) {
  return (req, res) => {
    const upstream = httpRequest(
      {
        host: '127.0.0.1',
        port: req.url?.startsWith('/api/') ? gatewayPort : webPort,
        method: req.method,
        path: req.url,
        headers: req.headers,
      },
      (reply) => {
        res.writeHead(reply.statusCode ?? 502, reply.headers);
        reply.pipe(res);
      },
    );
    upstream.on('error', () => {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'INGRESS_UPSTREAM_DOWN' } }));
    });
    req.pipe(upstream);
  };
}

/** Billing's Pricing upstream: answers the published quote shape for known quotes. */
async function startQuoteDouble() {
  const quotes = new Map();
  const server = createServer((req, res) => {
    const prefix = '/internal/v1/pricing/quotes/';
    const quote = req.url?.startsWith(prefix) ? quotes.get(req.url.slice(prefix.length)) : null;
    if (req.method !== 'GET' || !quote || !/^Bearer .{20,}/.test(req.headers.authorization ?? '')) {
      res
        .writeHead(404, { 'content-type': 'application/json' })
        .end('{"error":{"code":"NOT_FOUND"}}');
      return;
    }
    const money = { currency: 'SYP', amountMinor: quote.amountMinor, scale: 2 };
    res.writeHead(200, { 'content-type': 'application/json' }).end(
      JSON.stringify({
        quoteId: quote.quoteId,
        revision: 1,
        status: 'USABLE',
        beneficiary: { kind: 'account', subjectId: quote.owner },
        vehicleType: 'SEDAN',
        zoneId: null,
        currency: 'SYP',
        lines: [
          {
            lineId: randomUUID(),
            kind: 'PACKAGE',
            definitionId: randomUUID(),
            quantity: 1,
            unitPrice: money,
            amount: money,
          },
        ],
        total: money,
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      }),
    );
  });
  const port = await listen(server);
  return { quotes, origin: `http://127.0.0.1:${port}`, close: () => server.close() };
}

/**
 * Billing's ledger helpers are not executable by its hardened runtime identity
 * on main (CR-D-P04-05; Lane B #125 fixes it). Proven refused first, then
 * exactly the requested grant is applied as the migration identity.
 */
async function grantBillingLedgerHelpers() {
  const refused = await sql(
    appDsn(context, 'billing'),
    "SELECT app.billing_assert_obligation_ledger('00000000-0000-4000-8000-000000000000'::uuid)",
  );
  if (refused.ok) return 'NOT_NEEDED';
  assert.match(refused.message ?? '', /permission denied for function/);
  const granted = await sql(
    migrationDsn(context, 'billing'),
    'GRANT EXECUTE ON FUNCTION app.billing_assert_obligation_ledger(uuid), ' +
      'app.billing_assert_custody_holder(uuid, char(3)), app.billing_assert_handover(uuid) ' +
      'TO cw_billing_app',
  );
  assert.ok(granted.ok, granted.message ?? 'grant failed');
  return 'APPLIED';
}

async function migrateOwners() {
  const ctx = { ...context, root: ROOT };
  for (const service of ['booking', 'dispatch', 'billing']) {
    const migrated = await migrateDeploy(ctx, service);
    assert.equal(migrated.code, 0, `${service} migrate deploy: ${migrated.stderr}`);
    const hardened = await hardenPrivileges(ctx, service);
    assert.equal(hardened.code, 0, `${service} hardening: ${hardened.stderr}`);
  }
  return grantBillingLedgerHelpers();
}

export async function startStack() {
  const billingGrant = await migrateOwners();
  const { createWebRuntime } = await import(
    pathToFileURL(path.join(ROOT, 'apps', 'admin-web', 'server.mjs')).href
  );
  const web = createWebRuntime({ documentRoot: path.join(ROOT, 'apps', 'admin-web', 'dist') });
  const webPort = await listen(web);
  const front = createServer();
  const port = await listen(front);
  const origin = `http://127.0.0.1:${port}`;
  const identity = await startIdentity({ cookieSecure: false, origins: [origin] });
  const { startOwnerDoubles, bookingEnv } = owned('booking')(
    path.join(ROOT, 'services', 'booking', 'dist-tests', 'test', 'support', 'owner-doubles.js'),
  );
  const doubles = await startOwnerDoubles();
  const quotes = await startQuoteDouble();
  const env = {
    reporting: {
      DATABASE_URL: appDsn(context, 'reporting'),
      IDENTITY_ORIGIN: identity.base,
      REPORTING_READS_PER_MINUTE: '600',
    },
    communications: {
      DATABASE_URL: appDsn(context, 'communications'),
      IDENTITY_ORIGIN: identity.base,
      COMMUNICATIONS_READS_PER_MINUTE: '600',
    },
    dispatch: {
      DATABASE_URL: appDsn(context, 'dispatch'),
      IDENTITY_URL: identity.base,
      DISPATCH_SERVICE_CLIENTS: '',
      DISPATCH_USER_REQUESTS_PER_MINUTE: '600',
    },
    booking: {
      ...bookingEnv(doubles, appDsn(context, 'booking')),
      IDENTITY_URL: identity.base,
      BOOKING_USER_REQUESTS_PER_MINUTE: '600',
      BOOKING_INLINE_SAGA_BUDGET_MS: '15000',
    },
    billing: {
      DATABASE_URL: appDsn(context, 'billing'),
      IDENTITY_SESSION_ORIGIN: identity.base,
      PRICING_ORIGIN: quotes.origin,
    },
  };
  const services = {};
  for (const name of Object.keys(env))
    services[name] = await nestService(name, { ...env[name], PORT: '' });
  // Support calls Billing and Booking on behalf of the staff member.
  env.support = {
    DATABASE_URL: appDsn(context, 'support'),
    IDENTITY_ORIGIN: identity.base,
    BILLING_ORIGIN: services.billing.origin,
    BOOKING_ORIGIN: services.booking.origin,
    SUPPORT_REQUESTS_PER_MINUTE: '600',
    SUPPORT_EXECUTION_LEASE_MS: '1000',
  };
  services.support = await nestService('support', { ...env.support, PORT: '' });
  const gatewayRequire = createRequire(path.join(ROOT, 'apps', 'api-gateway', 'package.json'));
  gatewayRequire('reflect-metadata');
  const { createGatewayApplication, loadGatewayConfig } = gatewayRequire('./dist/index.js');
  const gateway = await createGatewayApplication(
    loadGatewayConfig({
      GATEWAY_UPSTREAMS: JSON.stringify({
        identity: identity.base,
        ...Object.fromEntries(Object.entries(services).map(([n, s]) => [n, s.origin])),
      }),
      IDENTITY_ISSUER: 'https://identity.washgo.invalid',
      IDENTITY_AUDIENCE: 'washgo-web',
      GATEWAY_INSECURE_LOOPBACK_COOKIES: 'true',
      GATEWAY_ALLOWED_ORIGINS: origin,
      GATEWAY_TIMEOUT_MS: '5000',
    }),
  );
  await gateway.listen(0, '127.0.0.1');
  const gatewayPort = Number(new URL(await gateway.getUrl()).port);
  front.on('request', ingressHandler(gatewayPort, webPort));
  return {
    origin,
    identity,
    doubles,
    quotes,
    services,
    billingGrant,
    async stop() {
      for (const server of [front, web]) {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
      quotes.close();
      await doubles.close();
      for (const app of [gateway, ...Object.values(services).map((s) => s.app), identity.app])
        await app.close().catch(() => {});
    },
  };
}

/* ------------------------- owner-side fixtures ------------------------- */

export const commandKey = () => randomUUID().replaceAll('-', '');
export const ok2xx = (status) => status >= 200 && status < 300;

export async function ownerCall(
  origin,
  prefix,
  principal,
  route,
  { method = 'GET', body, key } = {},
) {
  const response = await fetch(`${origin}${prefix}${route}`, {
    method,
    headers: {
      authorization: bearer(principal),
      'x-correlation-id': randomUUID(),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(key ? { 'idempotency-key': key } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

/** A real Booking record, created by the customer through Booking's own API. */
export async function createBooking(stack, customer) {
  stack.doubles.sessions.set(customer.token, {
    subject: customer.subject,
    principalKind: 'account',
    permissions: ['bookings.create:self', 'bookings.read:self'],
  });
  const issued = stack.doubles.issue({ kind: 'account', subjectId: customer.subject });
  const created = await ownerCall(
    stack.services.booking.origin,
    '/internal/v1/booking',
    customer,
    '/bookings',
    {
      method: 'POST',
      key: commandKey(),
      body: {
        quote: { quoteId: issued.quoteId, revision: 1 },
        hold: { holdId: issued.holdId, revision: 1 },
        vehicle: { source: 'saved', vehicleId: randomUUID(), revision: 2 },
        address: { addressId: randomUUID(), revision: 1 },
        contact: { name: 'زبون اختبار', phone: '0912345678', notes: null },
        paymentMethod: 'SHAM_CASH',
      },
    },
  );
  assert.ok(ok2xx(created.status), JSON.stringify(created.body));
  return {
    bookingId: created.body.bookingId,
    status: created.body.status,
    revision: created.body.revision,
    holdId: issued.holdId,
    zoneId: issued.zoneId,
    startsAt: Date.parse(created.body.slot.startsAt),
    endsAt: Date.parse(created.body.slot.endsAt),
  };
}

/** A Billing obligation with one electronic attempt awaiting review, by `payer`. */
export async function obligationUnderReview(stack, payer, amountMinor) {
  const quoteId = randomUUID();
  stack.quotes.quotes.set(quoteId, { quoteId, owner: payer.subject, amountMinor });
  const billing = (route, init) =>
    ownerCall(stack.services.billing.origin, '/internal/v1/billing', payer, route, init);
  const created = await billing('/obligations', {
    method: 'POST',
    key: commandKey(),
    body: { quoteId },
  });
  assert.ok(ok2xx(created.status), JSON.stringify(created.body));
  const obligationId = created.body.obligationId;
  const intent = await billing(`/obligations/${obligationId}/payment-intents`, {
    method: 'POST',
    key: commandKey(),
    body: { expectedRevision: created.body.revision, method: 'SHAM_CASH' },
  });
  assert.ok(ok2xx(intent.status), JSON.stringify(intent.body));
  const attempt = await billing(`/obligations/${obligationId}/payment-attempts`, {
    method: 'POST',
    key: commandKey(),
    body: {
      expectedRevision: intent.body.revision,
      providerReference: `SC-${randomUUID().slice(0, 8)}`,
    },
  });
  assert.ok(ok2xx(attempt.status), JSON.stringify(attempt.body));
  return { obligationId, attemptId: attempt.body.attempts[0].attemptId };
}

/** Owner rows read back with the owner's runtime identity (test evidence only). */
export async function ownerRows(service, statement) {
  const result = await sql(appDsn(context, service), statement);
  assert.equal(result.ok, true, result.message);
  return result.rows;
}
