/**
 * P02-D2 admin operations console: browser journeys on real services.
 *
 * One machine runs headless Chromium against:
 *   - the built admin-web bundle, served by apps/admin-web/server.mjs;
 *   - the REAL Gateway (apps/api-gateway), with the routes and query support
 *     proposed in CR-D-P02-01, so this suite needs a CANDIDATE tree that applies
 *     docs/production/D/P02_CANDIDATE_GATEWAY.patch. On a tree without them the
 *     suite stops at its first assertion with GATEWAY_ROUTES_MISSING;
 *   - the REAL Identity, Workforce and Reporting HTTP adapters on the acceptance
 *     PostgreSQL. Reporting must include P02-D1.
 * A test-only ingress puts the bundle and `/api/*` on one origin, which is what
 * the deployment ingress does. It forwards bytes and does not decide anything.
 *
 * Projection rows are written through Reporting's own compiled projector (the
 * inbox effect path) because no producer publishes the contracts yet
 * (CR-D-P02-03). Workforce records are created through Workforce's own HTTP API.
 *
 *   node scripts/production/D/run-real-infra.mjs --browser [--evidence <file>]
 */
/* global document, getComputedStyle -- page.evaluate callbacks run in the browser */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { ROOT, appDsn, context } from '../../integration/_support.mjs';
import { STAFF_PASSWORD, account, bearer, staff, startIdentity } from './_identity.mjs';
import { comparePngBuffers } from '../../../scripts/f010/pixel-compare.mjs';

const require = createRequire(path.join(ROOT, 'package.json'));
const EVIDENCE = path.join(ROOT, 'docs', 'production', 'D', 'evidence', 'p02-d2');
const TIMEZONE = 'Asia/Damascus';
const SYRIA_OFFSET_MS = 3 * 3_600_000; // Syria has kept UTC+3 all year since 2022.

/* --------------------------------- stack --------------------------------- */

function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server.address().port));
  });
}

async function nestService(service, env) {
  for (const [name, value] of Object.entries(env)) process.env[name] = value;
  const own = createRequire(path.join(ROOT, 'services', service, 'package.json'));
  own('reflect-metadata');
  const { createHttpApplication } = own('./dist/transport/http/create-app.js');
  const app = await createHttpApplication();
  await app.listen(env.PORT ? Number(env.PORT) : 0, '127.0.0.1');
  const port = Number(new URL(await app.getUrl()).port);
  return { app, port, origin: `http://127.0.0.1:${port}` };
}

/** Same-origin ingress: `/api/*` to the Gateway, everything else to admin-web. */
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

async function startStack() {
  const { createWebRuntime } = await import(
    pathToFileURL(path.join(ROOT, 'apps', 'admin-web', 'server.mjs')).href
  );
  const web = createWebRuntime({ documentRoot: path.join(ROOT, 'apps', 'admin-web', 'dist') });
  const webPort = await listen(web);
  // Reserve the public origin first: Identity and the Gateway must know it.
  const front = createServer();
  const port = await listen(front);
  const origin = `http://127.0.0.1:${port}`;
  const identity = await startIdentity({ cookieSecure: false, origins: [origin] });
  const env = {
    workforce: {
      DATABASE_URL: appDsn(context, 'workforce'),
      IDENTITY_URL: identity.base,
      WORKFORCE_SERVICE_CLIENTS: '',
    },
    reporting: {
      DATABASE_URL: appDsn(context, 'reporting'),
      IDENTITY_ORIGIN: identity.base,
      REPORTING_READS_PER_MINUTE: '600',
    },
  };
  const services = {
    workforce: await nestService('workforce', { ...env.workforce, PORT: '' }),
    reporting: await nestService('reporting', { ...env.reporting, PORT: '' }),
  };
  const gatewayRequire = createRequire(path.join(ROOT, 'apps', 'api-gateway', 'package.json'));
  gatewayRequire('reflect-metadata');
  const { createGatewayApplication, loadGatewayConfig } = gatewayRequire('./dist/index.js');
  const gateway = await createGatewayApplication(
    loadGatewayConfig({
      GATEWAY_UPSTREAMS: JSON.stringify({
        identity: identity.base,
        workforce: services.workforce.origin,
        reporting: services.reporting.origin,
      }),
      IDENTITY_ISSUER: 'https://identity.washgo.invalid',
      IDENTITY_AUDIENCE: 'washgo-web',
      GATEWAY_INSECURE_LOOPBACK_COOKIES: 'true',
      GATEWAY_ALLOWED_ORIGINS: origin,
      GATEWAY_TIMEOUT_MS: '3000',
    }),
  );
  await gateway.listen(0, '127.0.0.1');
  const gatewayPort = Number(new URL(await gateway.getUrl()).port);
  front.on('request', ingressHandler(gatewayPort, webPort));
  return {
    origin,
    identity,
    workforceOrigin: services.workforce.origin,
    /** Simulates an owner outage. */
    async stopService(name) {
      await services[name].app.close();
    },
    /** Brings the owner back on the same address the Gateway knows. */
    async startService(name) {
      services[name] = await nestService(name, {
        ...env[name],
        PORT: String(services[name].port),
      });
    },
    async stop() {
      for (const server of [front, web]) {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
      for (const app of [gateway, services.reporting.app, services.workforce.app, identity.app])
        await app.close().catch(() => {});
    },
  };
}

/* -------------------------------- fixtures -------------------------------- */

const reportingRequire = createRequire(path.join(ROOT, 'services', 'reporting', 'package.json'));
const rdist = (file) => reportingRequire(path.join(ROOT, 'services', 'reporting', 'dist', file));

function projectionClient() {
  const { PrismaClient } = rdist('generated/prisma/client.js');
  const { PrismaPg } = reportingRequire('@prisma/adapter-pg');
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: appDsn(context, 'reporting') }, { schema: 'app' }),
  });
}

/** Local 09:00 + minutes in Damascus today, as a UTC instant. */
function damascusToday(minutes) {
  const now = new Date(Date.now() + SYRIA_OFFSET_MS);
  return (
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 9, 0) -
    SYRIA_OFFSET_MS +
    minutes * 60_000
  );
}

const iso = (ms) => new Date(ms).toISOString();

function envelope(eventType, producer, aggregate, data, occurredAt) {
  return {
    eventId: randomUUID(),
    eventType,
    envelopeVersion: 2,
    producer,
    occurredAt: iso(occurredAt),
    correlationId: randomUUID(),
    causationId: null,
    traceparent: null,
    aggregate,
    actor: { kind: 'service', id: producer },
    data,
  };
}

async function project(client, events) {
  const { OperationsProjector, parseOperationsEvent } = rdist('application/operations.service.js');
  const { PrismaOperationsWriter } = rdist('infrastructure/persistence/prisma-operations.store.js');
  const { sha256Hex } = rdist('infrastructure/persistence/prisma-projection.store.js');
  const projector = new OperationsProjector(sha256Hex, { now: () => new Date() });
  for (const event of events)
    await client.$transaction((tx) =>
      projector.apply(new PrismaOperationsWriter(tx), parseOperationsEvent(event).fact),
    );
}

function confirmed(bookingId, occurredAt) {
  return {
    eventId: randomUUID(),
    eventType: 'booking.confirmed.v1',
    schemaVersion: 1,
    producer: 'booking',
    occurredAt: iso(occurredAt),
    correlationId: randomUUID(),
    aggregateVersion: 1,
    data: { bookingId, customerId: randomUUID() },
  };
}

function committed(bookingId, startsAt, zoneId) {
  return envelope(
    'scheduling.hold-changed.v1',
    'scheduling',
    { type: 'hold', id: randomUUID(), version: 2 },
    {
      state: 'COMMITTED',
      zoneId,
      startsAt: iso(startsAt),
      endsAt: iso(startsAt + 3_600_000),
      bookingId,
    },
    Date.now() - 60_000,
  );
}

async function workforceCall(stack, principal, route, { method = 'GET', body, key } = {}) {
  const response = await fetch(`${stack.workforceOrigin}/internal/v1/workforce${route}`, {
    method,
    headers: {
      authorization: bearer(principal),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(key ? { 'idempotency-key': key } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

/** A technician with an operator profile and one pending verification case. */
async function pendingCase(stack, operations) {
  const technician = await staff(stack.identity, ['technician']);
  const created = await workforceCall(stack, operations, '/operators', {
    method: 'POST',
    body: {
      identitySubject: technician.subject,
      displayName: 'P02-D2 technician',
      homeZoneId: randomUUID(),
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const submitted = await workforceCall(stack, technician, '/me/verification-cases', {
    method: 'POST',
    body: { evidenceRefs: [randomUUID()] },
    key: randomUUID().replaceAll('-', ''),
  });
  assert.equal(submitted.status, 201, JSON.stringify(submitted.body));
  return { technician, operatorId: created.body.operatorId, caseId: submitted.body.caseId };
}

/* ------------------------------ browser helpers ----------------------------- */

const DISABLE_MOTION = `*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}`;

async function newPage(
  browser,
  stack,
  { width = 1440, height = 900, reducedMotion = 'no-preference' } = {},
) {
  const contextOptions = {
    viewport: { width, height },
    deviceScaleFactor: 1,
    locale: 'ar-SY',
    timezoneId: TIMEZONE,
    reducedMotion,
  };
  const browserContext = await browser.newContext(contextOptions);
  const page = await browserContext.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(stack.origin);
  return { page, browserContext, errors };
}

/** Sign in through the console UI; the OTP comes from Identity's captured delivery port. */
async function signInUi(page, stack, principal) {
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('البريد الإلكتروني').fill(principal.email);
  await dialog.getByLabel('كلمة المرور').fill(STAFF_PASSWORD);
  const login = page.waitForResponse((r) => r.url().endsWith('/api/v1/auth/login'));
  await dialog.getByRole('button', { name: 'متابعة' }).click();
  const { challengeId } = await (await login).json();
  await dialog.getByLabel('رمز التحقق').fill(stack.identity.delivered.get(challengeId).code);
  await dialog.getByRole('button', { name: 'تأكيد' }).click();
  await dialog.waitFor({ state: 'hidden' });
}

async function axe(page, scope = null) {
  const source = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
  // evaluate() is not subject to the page CSP; the bundle itself stays CSP-clean.
  await page.evaluate(source);
  return page.evaluate(async (selector) => {
    const result = await globalThis.axe.run(
      selector ? document.querySelector(selector) : document,
      {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
      },
    );
    return result.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.length,
      targets: v.nodes.slice(0, 5).map((n) => n.target.join(' ')),
    }));
  }, scope);
}

/* -------------------------------- the suite -------------------------------- */

/**
 * Identity budgets OTP challenges per IP (30 per 15 minutes) and every
 * account here shares 127.0.0.1, so each role set is created once per run.
 */
const principals = new Map();

async function principal(roles) {
  const key = [...roles].sort().join('+');
  if (!principals.has(key)) principals.set(key, await staff(stack.identity, roles));
  return principals.get(key);
}

let stack;
let browser;
let projections;
const report = { journeys: {}, accessibility: {}, visual: [], consoleErrors: [] };

test.before(async () => {
  stack = await startStack();
  browser = await chromium.launch({ args: ['--font-render-hinting=none', '--disable-lcd-text'] });
  projections = projectionClient();
  mkdirSync(EVIDENCE, { recursive: true });
  // The candidate must expose the requested routes; otherwise stop here.
  const probe = await fetch(`${stack.origin}/api/v1/admin/operations/freshness`);
  assert.notEqual(
    probe.status,
    404,
    'GATEWAY_ROUTES_MISSING: apply P02_CANDIDATE_GATEWAY.patch (CR-D-P02-01)',
  );
});

test.after(async () => {
  writeFileSync(path.join(EVIDENCE, 'browser-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  await projections?.$disconnect();
  await browser?.close();
  await stack?.stop();
});

test('J1: an unauthenticated visitor is asked to sign in; a wrong code is refused', async () => {
  const operations = await principal(['operations']);
  const { page, browserContext, errors } = await newPage(browser, stack);
  try {
    const dialog = page.getByRole('dialog');
    await dialog.getByText('تسجيل دخول الموظفين').waitFor();
    assert.equal(await page.locator('#bookingRows tr').count(), 0, 'no data before sign-in');
    await dialog.getByLabel('البريد الإلكتروني').fill(operations.email);
    await dialog.getByLabel('كلمة المرور').fill(STAFF_PASSWORD);
    await dialog.getByRole('button', { name: 'متابعة' }).click();
    await dialog.getByLabel('رمز التحقق').fill('000000');
    await dialog.getByRole('button', { name: 'تأكيد' }).click();
    await dialog.getByText('بيانات الدخول أو الرمز غير صحيحة.').waitFor();
    report.accessibility.signIn = await axe(page, '.modal');
    assert.deepEqual(errors, []);
    report.journeys.J1 = 'PASSED';
  } finally {
    await browserContext.close();
  }
});

test('J2: booking discovery — rows, status filter, detail, search, paging, freshness, outage', async () => {
  const operations = await principal(['operations']);
  const zoneId = randomUUID();
  const scheduled = Array.from({ length: 26 }, () => randomUUID());
  const unconfirmed = randomUUID();
  const events = [];
  scheduled.forEach((bookingId, i) => {
    events.push(confirmed(bookingId, Date.now() - 120_000));
    events.push(committed(bookingId, damascusToday(i * 10), zoneId));
  });
  events.push(committed(unconfirmed, damascusToday(300), zoneId));
  await project(projections, events);

  const { page, browserContext, errors } = await newPage(browser, stack);
  try {
    await signInUi(page, stack, operations);
    await page.waitForURL(/#\/dashboard$/);
    await page.locator('.nav button[data-screen="bookings"]').click();
    await page.waitForURL(/#\/bookings$/);
    await page.locator('#bookingRows tr[data-booking]').first().waitFor();
    assert.equal(await page.locator('.nav button.active').getAttribute('data-screen'), 'bookings');
    assert.match(await page.locator('#bookingFreshness').innerText(), /الحجوزات · محدّث/);
    assert.equal(
      await page
        .locator('#bookingFreshness [data-source="scheduling"]')
        .getAttribute('data-freshness'),
      'FRESH',
    );

    // Page through everything for today and find every seeded booking once.
    while (await page.locator('#bookingLoadMore').count()) {
      const before = await page.locator('#bookingRows tr[data-booking]').count();
      await page.locator('#bookingLoadMore').click();
      await page.waitForFunction(
        (n) => document.querySelectorAll('#bookingRows tr[data-booking]').length > n,
        before,
      );
    }
    const ids = await page
      .locator('#bookingRows tr[data-booking]')
      .evaluateAll((rows) => rows.map((r) => r.dataset.booking));
    for (const id of [...scheduled, unconfirmed])
      assert.equal(ids.filter((x) => x === id).length, 1, id);
    const first = page.locator(`#bookingRows tr[data-booking="${scheduled[0]}"]`);
    assert.equal(await first.locator('.status').innerText(), 'مجدول');
    assert.equal(await first.locator('td').nth(2).innerText(), '—', 'vehicle is not invented');

    await page.locator('#statusFilter').selectOption('SLOT_COMMITTED_UNCONFIRMED');
    await page.locator(`#bookingRows tr[data-booking="${unconfirmed}"]`).waitFor();
    assert.equal(
      await page
        .locator('#bookingRows tr[data-booking] .status')
        .evaluateAll((s) => s.every((x) => x.textContent === 'موعد بلا تأكيد')),
      true,
    );

    await page.locator(`#bookingRows tr[data-booking="${unconfirmed}"]`).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByText(`تفاصيل الحجز #${unconfirmed.slice(0, 8).toUpperCase()}`).waitFor();
    await dialog.locator('#detailDerived .detail-list').getByText('موعد بلا تأكيد').waitFor();
    await dialog.locator('#detailBooking [data-state]').waitFor();
    report.accessibility.bookingDetail = await axe(page, '.modal');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });

    await page.locator('#bookingSearch').fill(scheduled[5]);
    await page.locator('#bookingSearch').press('Enter');
    await dialog.getByText(`تفاصيل الحجز #${scheduled[5].slice(0, 8).toUpperCase()}`).waitFor();
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    await page.locator('#bookingSearch').fill('not-a-reference');
    await page.locator('#bookingSearch').press('Enter');
    await page.locator('#toast.show').getByText('أدخل رقم الحجز الكامل.').waitFor();

    report.accessibility.bookings = await axe(page);

    // Reporting outage: an explicit unavailable state, then recovery.
    await stack.stopService('reporting');
    await page.locator('#statusFilter').selectOption('');
    await page.locator('#bookingRows [data-state="UNAVAILABLE"]').waitFor();
    await stack.startService('reporting');
    await page.locator('#bookingRows [data-state="UNAVAILABLE"] button').click();
    await page.locator('#bookingRows tr[data-booking]').first().waitFor();
    assert.deepEqual(errors, []);
    report.journeys.J2 = 'PASSED';
  } finally {
    await browserContext.close();
  }
});

test('J3: technician review — approval, repeated decision refused, owner state changed', async () => {
  const operations = await principal(['operations']);
  const reviewer = await principal(['reviewer']);
  const subject = await pendingCase(stack, operations);
  const before = await workforceCall(
    stack,
    operations,
    `/operators/${subject.operatorId}/readiness`,
  );
  assert.ok(before.body.reasons.includes('VERIFICATION_REQUIRED'));

  const { page, browserContext, errors } = await newPage(browser, stack);
  try {
    await signInUi(page, stack, reviewer);
    await page.waitForURL(/#\/technicians$/);
    assert.equal(
      await page.locator('.nav button.active').getAttribute('data-screen'),
      'technicians',
    );
    await page.locator('#caseReference').fill(subject.caseId);
    await page.getByRole('button', { name: 'مراجعة' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByText('مراجعة طلب تحقق الفني').waitFor();
    report.accessibility.reviewDialog = await axe(page);
    // Validation happens before anything is sent.
    await dialog.getByRole('button', { name: 'إرسال القرار' }).click();
    await dialog.getByText('اختر تاريخ انتهاء صلاحية التحقق.').waitFor();
    const nextYear = new Date(Date.now() + 300 * 86_400_000).toISOString().slice(0, 10);
    await dialog.locator('#validUntil').fill(nextYear);
    const decision = page.waitForRequest((r) =>
      r.url().includes(`/api/v1/admin/reviews/${subject.caseId}`),
    );
    await dialog.getByRole('button', { name: 'إرسال القرار' }).click();
    const sent = await decision;
    assert.match(sent.headers()['idempotency-key'] ?? '', /^[A-Za-z0-9_-]{16,128}$/);
    assert.equal(JSON.parse(sent.postData()).decision, 'APPROVE');
    await dialog.locator('#reviewOutcome[data-state="APPROVED"]').waitFor();
    await dialog.getByRole('button', { name: 'إغلاق' }).last().click();

    const after = await workforceCall(
      stack,
      operations,
      `/operators/${subject.operatorId}/readiness`,
    );
    assert.ok(
      !after.body.reasons.includes('VERIFICATION_REQUIRED'),
      'Workforce recorded the approval',
    );

    // The same case again: Workforce refuses, the console says so.
    await page.goto(`${stack.origin}/#/technicians/review/${subject.caseId}`);
    await dialog.locator('#validUntil').fill(nextYear);
    await dialog.getByRole('button', { name: 'إرسال القرار' }).click();
    await dialog.locator('#reviewProblem[data-state="CONFLICT"]').waitFor();
    assert.deepEqual(errors, []);
    report.journeys.J3 = 'PASSED';
  } finally {
    await browserContext.close();
  }
});

test('J4: correction request, then the technician resubmits; an UNKNOWN outcome is not success', async () => {
  const operations = await principal(['operations']);
  const reviewer = await principal(['reviewer']);
  const subject = await pendingCase(stack, operations);
  const { page, browserContext } = await newPage(browser, stack);
  try {
    await signInUi(page, stack, reviewer);
    await page.goto(`${stack.origin}/#/technicians/review/${subject.caseId}`);
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('رفض أو طلب تصحيح').check();
    await dialog.locator('#rejectReason').selectOption('EVIDENCE_INCOMPLETE');
    await dialog.getByRole('button', { name: 'إرسال القرار' }).click();
    await dialog.locator('#reviewOutcome[data-state="REJECTED"]').waitFor();
    assert.match(await dialog.locator('#reviewOutcome').innerText(), /وثائق ناقصة/);
    await dialog.getByRole('button', { name: 'إغلاق' }).last().click();

    // Correction loop: the technician can submit a new case.
    const resubmitted = await workforceCall(stack, subject.technician, '/me/verification-cases', {
      method: 'POST',
      body: { evidenceRefs: [randomUUID(), randomUUID()] },
      key: randomUUID().replaceAll('-', ''),
    });
    assert.equal(resubmitted.status, 201);

    // Workforce down while deciding: the outcome is UNKNOWN, never "approved".
    await stack.stopService('workforce');
    await page.goto(`${stack.origin}/#/technicians/review/${resubmitted.body.caseId}`);
    await dialog
      .locator('#validUntil')
      .fill(new Date(Date.now() + 200 * 86_400_000).toISOString().slice(0, 10));
    const first = page.waitForRequest((r) => r.url().includes('/api/v1/admin/reviews/'));
    await dialog.getByRole('button', { name: 'إرسال القرار' }).click();
    const firstKey = (await first).headers()['idempotency-key'];
    await dialog.locator('#reviewProblem[data-state="UNKNOWN_OUTCOME"]').waitFor();
    assert.equal(await dialog.locator('#reviewOutcome').innerText(), '');
    assert.equal(
      await dialog.locator('input[value="REJECT"]').isDisabled(),
      true,
      'decision is locked',
    );

    await stack.startService('workforce');
    const retry = page.waitForRequest((r) => r.url().includes('/api/v1/admin/reviews/'));
    await dialog.getByRole('button', { name: 'إعادة إرسال القرار نفسه' }).click();
    assert.equal(
      (await retry).headers()['idempotency-key'],
      firstKey,
      'the same attempt is re-sent',
    );
    await dialog.locator('#reviewOutcome[data-state="APPROVED"]').waitFor();
    report.journeys.J4 = 'PASSED';
  } finally {
    await browserContext.close();
  }
});

test('J5: cross-role denial in the console and at the Gateway', async () => {
  const customer = await account(stack.identity);
  const technician = await principal(['technician']);
  const reviewer = await principal(['reviewer']);
  const operations = await principal(['operations']);
  const outcomes = {};

  for (const [name, who] of [
    ['customer', customer],
    ['technician', technician],
  ]) {
    const { page, browserContext } = await newPage(browser, stack);
    try {
      await signInUi(page, stack, who);
      await page.getByText('هذا الحساب لا يملك صلاحية لوحة الإدارة.').waitFor();
      assert.equal(await page.locator('#bookings.active, #technicians.active').count(), 0);
      const direct = await page.evaluate(
        async () => (await fetch('/api/v1/admin/operations/freshness')).status,
      );
      assert.equal(direct, 403, `${name} is refused by the Gateway too`);
      outcomes[name] = 'console and Gateway refuse';
    } finally {
      await browserContext.close();
    }
  }

  {
    const { page, browserContext } = await newPage(browser, stack);
    try {
      await signInUi(page, stack, reviewer);
      await page.waitForURL(/#\/technicians$/);
      await page.goto(`${stack.origin}/#/bookings`);
      await page.getByText('لا يملك هذا الحساب صلاحية هذه الشاشة.').waitFor();
      const direct = await page.evaluate(
        async () =>
          (
            await fetch(
              '/api/v1/admin/operations/bookings?from=2026-01-01T00:00:00Z&to=2026-01-02T00:00:00Z',
            )
          ).status,
      );
      assert.equal(direct, 403);
      outcomes.reviewer = 'bookings refused; technicians allowed';
    } finally {
      await browserContext.close();
    }
  }

  {
    const { page, browserContext } = await newPage(browser, stack);
    try {
      await signInUi(page, stack, operations);
      await page.goto(`${stack.origin}/#/technicians`);
      await page.locator('#joinRequests [data-state="FORBIDDEN"]').waitFor();
      // Even a hand-made request with a valid CSRF token is refused.
      const status = await page.evaluate(async (caseId) => {
        const csrf =
          document.cookie
            .split('; ')
            .find((c) => c.startsWith('wg_csrf='))
            ?.slice(8) ?? '';
        const response = await fetch(`/api/v1/admin/reviews/${caseId}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrf,
            'idempotency-key': ['p02d2', 'forged', 'decision', '000001'].join('-'),
          },
          body: JSON.stringify({ decision: 'REJECT', reason: 'EVIDENCE_INVALID' }),
        });
        return response.status;
      }, randomUUID());
      assert.equal(status, 403);
      report.accessibility.technicians = await axe(page);
      outcomes.operations = 'review decision refused';
    } finally {
      await browserContext.close();
    }
  }
  report.journeys.J5 = outcomes;
});

test('J6: language direction, reduced motion and the mobile menu', async () => {
  const operations = await principal(['operations']);
  const { page, browserContext } = await newPage(browser, stack, {
    width: 390,
    height: 844,
    reducedMotion: 'reduce',
  });
  try {
    await signInUi(page, stack, operations);
    await page.waitForURL(/#\/dashboard$/);
    assert.equal(
      await page.locator('#sidebar').evaluate((e) => getComputedStyle(e).transitionDuration),
      '0s',
    );
    await page.locator('#menuBtn').click();
    assert.equal(await page.locator('#menuBtn').getAttribute('aria-expanded'), 'true');
    await page.locator('#sidebar.open').waitFor();
    // The open menu covers the top bar at this width; choosing a screen closes it.
    await page.locator('.nav button[data-screen="bookings"]').click();
    await page.locator('#sidebar.open').waitFor({ state: 'detached' });
    await page.locator('#langBtn').click();
    assert.equal(await page.evaluate(() => document.documentElement.dir), 'ltr');
    assert.equal(
      await page.locator('.nav button[data-screen="bookings"] [data-i18n]').innerText(),
      'Bookings',
    );
    await page.reload();
    assert.equal(
      await page.evaluate(() => document.documentElement.lang),
      'en',
      'the choice is remembered',
    );
    report.journeys.J6 = 'PASSED';
  } finally {
    await browserContext.close();
  }
});

/* ------------------------------ visual evidence ----------------------------- */

const REFERENCE = path.join(ROOT, 'design', 'reference', 'approved', 'washgo-admin-prototype.html');

test('V1: reference / candidate / diff screenshots for both screens at three widths', async () => {
  const operations = await principal(['operations', 'reviewer']);
  const signedIn = await browser.newContext();
  const first = await signedIn.newPage();
  await first.goto(stack.origin);
  await signInUi(first, stack, operations);
  const storageState = await signedIn.storageState();
  await signedIn.close();
  const referenceServer = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(readFileSync(REFERENCE));
  });
  const referencePort = await listen(referenceServer);
  try {
    for (const width of [390, 768, 1440]) {
      for (const screen of ['bookings', 'technicians']) {
        const shot = async (url, prepare) => {
          const browserContext = await browser.newContext({
            viewport: { width, height: 900 },
            deviceScaleFactor: 1,
            locale: 'ar-SY',
            timezoneId: TIMEZONE,
            reducedMotion: 'reduce',
            ...(url === stack.origin ? { storageState } : {}),
          });
          const page = await browserContext.newPage();
          await page.goto(url);
          await prepare(page);
          await page.addStyleTag({ content: DISABLE_MOTION }).catch(() => {});
          await page.evaluate(() => document.fonts.ready);
          const png = await page.screenshot({ fullPage: false });
          await browserContext.close();
          return png;
        };
        const reference = await shot(`http://127.0.0.1:${referencePort}/`, async (page) => {
          await page.evaluate((id) => {
            document
              .querySelectorAll('.screen')
              .forEach((x) => x.classList.toggle('active', x.id === id));
            document
              .querySelectorAll('.nav button[data-screen]')
              .forEach((x) => x.classList.toggle('active', x.dataset.screen === id));
          }, screen);
        });
        const candidate = await shot(stack.origin, async (page) => {
          await page.goto(`${stack.origin}/#/${screen}`);
          await page.locator(`#${screen}.active`).waitFor();
          await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
        });
        const result = await comparePngBuffers(browser, reference, candidate);
        const base = `${screen}-${width}`;
        writeFileSync(path.join(EVIDENCE, `${base}-reference.png`), reference);
        writeFileSync(path.join(EVIDENCE, `${base}-candidate.png`), candidate);
        if (result.diffBase64)
          writeFileSync(
            path.join(EVIDENCE, `${base}-diff.png`),
            Buffer.from(result.diffBase64, 'base64'),
          );
        report.visual.push({
          screen,
          width,
          sameDimensions: result.sameDimensions,
          diffRatio: result.diffRatio,
          referenceSha256: createHash('sha256').update(reference).digest('hex'),
          candidateSha256: createHash('sha256').update(candidate).digest('hex'),
        });
      }
    }
  } finally {
    referenceServer.close();
  }
  // Data and the declared differences make pixel equality impossible by design;
  // this test produces evidence, it does not pass a threshold.
  assert.equal(report.visual.length, 6);
});

test('A11Y: no serious or critical WCAG 2.1 AA violations on any measured surface', () => {
  const blocking = Object.entries(report.accessibility).flatMap(([surface, violations]) =>
    violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => ({ surface, ...v })),
  );
  assert.deepEqual(blocking, [], JSON.stringify(blocking, null, 2));
});
