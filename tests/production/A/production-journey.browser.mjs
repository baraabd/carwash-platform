/* global document, sessionStorage */
/**
 * Actual production bundle in Chromium with explicit owner HTTP transport doubles.
 * This verifies UI/route/reload/retry behavior, not owner integration, OTP delivery,
 * financial settlement, deployed infrastructure or production readiness.
 */
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { createWebRuntime } from '../../../infra/web-runtime.mjs';
import { apiError } from '../../../packages/contracts/dist/common.js';
import {
  harness,
  id,
  instant,
  session,
  address,
  booking,
  money,
  response,
} from '../../../apps/customer-web/test/support/journey-fixture.mjs';
import { harness as membershipHarness } from '../../../apps/customer-web/test/support/membership-fixture.mjs';

const appRoot = resolve(import.meta.dirname, '../../../apps/customer-web');
const appRequire = createRequire(resolve(appRoot, 'package.json'));
const { build } = await import(appRequire.resolve('vite'));
const buildRoot = mkdtempSync(resolve(tmpdir(), 'customer-journey-build-'));
const evidence =
  process.env.CUSTOMER_JOURNEY_EVIDENCE_DIR ??
  mkdtempSync(resolve(tmpdir(), 'customer-journey-evidence-'));
mkdirSync(evidence, { recursive: true });
const report = {
  scope:
    'Production React bundle + real Chromium + owner HTTP transport doubles; no live service or financial evidence',
  source:
    process.env.CUSTOMER_SOURCE_SHA ??
    process.env.C014_SOURCE_SHA ??
    process.env.GITHUB_SHA ??
    'local-working-tree',
  browserVersion: null,
  tests: [],
  screenshots: [],
};
const saveReport = () =>
  writeFileSync(
    resolve(evidence, 'production-journey.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
saveReport();
let server, browser;

async function screen(page, name) {
  const file = `${name}.png`;
  await page.screenshot({ path: resolve(evidence, file), fullPage: true, animations: 'disabled' });
  report.screenshots.push(file);
  saveReport();
}
async function contextFor(h, { anonymous = false, account = false, membership = null } = {}) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: 'ar-SY',
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const failures = [];
  const violations = [];
  let auth = anonymous
    ? null
    : account
      ? { ...session, principalKind: 'account', roles: ['customer'] }
      : session;
  const challenge = { challengeId: id(880), expiresIn: 300, resendAfter: 60 };
  page.on('pageerror', (error) => failures.push(error.message));
  await page.clock.setFixedTime(new Date(instant));
  await page.addInitScript(() => {
    globalThis.__journeyCsp = [];
    document.addEventListener('securitypolicyviolation', (event) =>
      globalThis.__journeyCsp.push(event.violatedDirective),
    );
  });
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    const json = request.postData() ? JSON.parse(request.postData()) : null;
    const fulfill = (body, status = 200, headers = {}) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
        headers,
      });
    const unauthorized = () =>
      fulfill(
        apiError('AUTH_REQUIRED', 'AUTH_REQUIRED', {
          requestId: 'browser-double',
          correlationId: 'browser-double',
        }),
        401,
      );
    if (path === '/api/v1/auth/session') return auth ? fulfill(auth) : unauthorized();
    if (path === '/api/v1/auth/logout') {
      auth = null;
      return fulfill(null);
    }
    if (path === '/api/v1/auth/csrf')
      return fulfill({ csrfToken: 'test_csrf_token_12345678901234567890' }, 200, {
        'set-cookie': 'wg_csrf=test_csrf_token_12345678901234567890; Path=/; SameSite=Lax',
      });
    if (path === '/api/v1/auth/login' || path === '/api/v1/auth/register')
      return fulfill(challenge, 202);
    if (path === '/api/v1/auth/challenges/verify') {
      assert.equal(json.challengeId, challenge.challengeId);
      assert.equal(json.code, '123456');
      auth = { ...session, principalKind: 'account', roles: ['customer'] };
      return fulfill(auth);
    }
    if (path === '/api/v1/customer/profile')
      return auth
        ? fulfill({
            customerId: id(5),
            principal: { kind: auth.principalKind, subjectId: auth.subject },
            revision: 1,
            status: 'ACTIVE',
            contact: {
              displayName: 'عميل اختبار المتصفح',
              phone: '+963912345678',
              phoneVerification: 'unverified',
            },
            preferences: { locale: 'ar' },
            createdAt: instant,
            updatedAt: instant,
          })
        : unauthorized();
    if (path === '/api/v1/customer/vehicles')
      return fulfill({ items: [], nextCursor: null, asOf: instant });
    if (path === '/api/v1/customer/addresses')
      return fulfill({ items: [address], nextCursor: null, asOf: instant });
    try {
      const owner =
        membership &&
        (path.includes('/subscription') || path.startsWith('/api/v1/customer/payments/'))
          ? membership
          : h;
      const response = await owner.options.fetch(request.url(), {
        method: request.method(),
        headers: request.headers(),
        body: request.postData() ?? undefined,
        credentials: 'same-origin',
        signal: new AbortController().signal,
      });
      const value = JSON.parse(await response.text());
      if (auth?.principalKind === 'account' && value?.beneficiary?.subjectId === auth.subject)
        value.beneficiary = { kind: 'account', subjectId: auth.subject };
      return route.fulfill({
        status: response.status,
        contentType: 'application/json',
        body: JSON.stringify(value),
      });
    } catch (error) {
      if (error.message.startsWith('Unexpected ')) violations.push(error.message);
      return route.abort('failed');
    }
  });
  return {
    context,
    page,
    assertClean: async () => {
      assert.deepEqual(failures, []);
      assert.deepEqual(violations, []);
      assert.deepEqual(await page.evaluate(() => globalThis.__journeyCsp), []);
    },
  };
}
async function sevenSteps(page, origin, capture = false, useSubscription = false) {
  await page.goto(`${origin}/#/book/0`);
  await expect(page.locator('[data-booking-step="vehicle"] .signature-car')).toHaveCount(4);
  await expect(page.locator('.primary-next')).toBeEnabled();
  if (capture) await screen(page, 'production-step-1-vehicle');
  await page.locator('.primary-next').click();
  await expect(page.locator('[data-booking-step="care"]')).toBeVisible();
  await page.locator('.service-option').first().click();
  await expect(page.locator('.primary-next')).toBeEnabled();
  await expect(page.locator('#footer-price')).toContainText('1,250.5');
  if (capture) await screen(page, 'production-step-2-care');
  await page.locator('.primary-next').click();
  await expect(page.locator('[data-booking-step="location"]')).toBeVisible();
  await page.locator('.saved-address-chips button').first().click();
  await expect(page.locator('.primary-next')).toBeEnabled();
  await expect(page.getByText('الخدمة متاحة لهذا الموقع.')).toBeVisible();
  if (capture) await screen(page, 'production-step-3-location');
  await page.locator('.primary-next').click();
  await expect(page.locator('.times .time')).toHaveCount(1);
  await page.locator('.times .time').first().click();
  await expect(page.locator('.primary-next')).toBeEnabled();
  if (capture) await screen(page, 'production-step-4-time');
  await page.locator('.primary-next').click();
  await expect(page.locator('#name')).toHaveValue('عميل اختبار المتصفح');
  await expect(page.locator('#phone')).toHaveValue('+963912345678');
  if (capture) await screen(page, 'production-step-5-contact');
  await page.locator('.primary-next').click();
  if (useSubscription) await page.locator('.pay-option').filter({ hasText: 'اشتراك #' }).click();
  else await page.locator('.pay-option').filter({ hasText: 'شام كاش' }).click();
  await expect(page.locator('.primary-next')).toBeEnabled();
  if (capture) await screen(page, 'production-step-6-payment');
  await page.locator('.primary-next').click();
  await expect(page.locator('[data-booking-step="review"]')).toBeVisible();
  await expect(page.locator('.primary-next')).toHaveText(/تأكيد الحجز/);
  if (capture) await screen(page, 'production-step-7-review');
}

try {
  await build({
    root: appRoot,
    mode: 'production',
    logLevel: 'error',
    build: { outDir: buildRoot, emptyOutDir: true },
  });
  server = createWebRuntime({ documentRoot: buildRoot });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CUSTOMER_BROWSER_EXECUTABLE
      ? { executablePath: process.env.CUSTOMER_BROWSER_EXECUTABLE }
      : {}),
  });
  report.browserVersion = browser.version();
  saveReport();

  const h = harness();
  const first = await contextFor(h);
  try {
    await sevenSteps(first.page, origin, true);
    await first.page.locator('.primary-next').click();
    await expect(first.page).toHaveURL(new RegExp(`#/order/${id(60)}$`));
    await expect(first.page.getByRole('heading', { name: 'جارٍ تأكيد الحجز' })).toBeVisible();
    await screen(first.page, 'production-booking-pending');
    h.state.order = {
      ...h.state.order,
      revision: 2,
      status: 'CONFIRMED',
      confirmation: 'CONFIRMED',
      confirmedAt: instant,
      slot: { ...h.state.order.slot, committed: true },
    };
    await first.page.reload();
    await expect(first.page.getByRole('heading', { name: 'تم تأكيد الحجز' })).toBeVisible();
    await first.page.getByRole('button', { name: 'تفاصيل الدفع والمتابعة' }).click();
    await expect(first.page.getByRole('heading', { name: 'بانتظار التحويل' })).toBeVisible();
    await expect(first.page.locator('.qr-button,img[src^="data:"],canvas')).toHaveCount(0);
    await first.page.getByRole('button', { name: 'أرسلت التحويل · طلب مراجعة' }).click();
    await first.page.locator('input[name="providerReference"]').fill('ABC-1234');
    await first.page.getByRole('button', { name: 'إرسال للمراجعة', exact: true }).click();
    await expect(first.page.getByRole('heading', { name: 'بانتظار مطابقة العملية' })).toBeVisible();
    assert.equal(h.state.obligation.verified.amountMinor, '0');
    await screen(first.page, 'production-payment-under-review');
    h.state.obligation = {
      ...h.state.obligation,
      revision: 4,
      status: 'SETTLED',
      financialStatus: 'PAID',
      verified: money(),
      outstanding: money('0'),
      activeIntent: { ...h.state.obligation.activeIntent, status: 'SUCCEEDED' },
      attempts: h.state.obligation.attempts.map((item) => ({
        ...item,
        status: 'MATCHED',
        reconciledAt: instant,
      })),
    };
    await first.page.reload();
    await expect(first.page.getByRole('heading', { name: 'الدفع موثّق' })).toBeVisible();
    await screen(first.page, 'production-payment-owner-confirmed');
    await first.page.goto(`${origin}/#/orders`);
    await expect(first.page.locator('.booking-card')).toHaveCount(1);
    await screen(first.page, 'production-orders-persisted');
    assert.equal(
      h.requests.filter(
        (request) => request.path.endsWith('/bookings') && request.method === 'POST',
      ).length,
      1,
    );
    assert.deepEqual(await first.page.evaluate(() => Object.keys(sessionStorage)), []);
    await first.assertClean();
    report.tests.push(
      'Seven screens → pending owner receipt → confirmed reload → wallet review → externally confirmed payment reload → persisted orders',
    );
    saveReport();
  } finally {
    await first.context.close();
  }

  const lost = harness();
  const recovery = await contextFor(lost);
  try {
    await sevenSteps(recovery.page, origin);
    lost.state.override = (request) => {
      if (request.path.endsWith('/bookings') && request.method === 'POST') {
        lost.state.bookingKeys.set(request.headers['idempotency-key'], booking());
        throw new Error('simulated response loss after commit');
      }
      return null;
    };
    await recovery.page.locator('.primary-next').click();
    await expect(
      recovery.page.getByRole('button', { name: 'التحقّق من الحجز السابق' }),
    ).toBeVisible();
    const keys = await recovery.page.evaluate(() => Object.keys(sessionStorage));
    assert.equal(keys.length, 1);
    assert.ok(keys[0].startsWith('washgo.pending-booking.v1:'));
    await recovery.page.reload();
    await expect(recovery.page).toHaveURL(new RegExp(`#/order/${id(60)}$`));
    await expect(recovery.page.getByRole('heading', { name: 'جارٍ تأكيد الحجز' })).toBeVisible();
    assert.equal(
      lost.requests.filter(
        (request) => request.path.endsWith('/bookings') && request.method === 'POST',
      ).length,
      1,
    );
    assert.deepEqual(await recovery.page.evaluate(() => Object.keys(sessionStorage)), []);
    await recovery.assertClean();
    report.tests.push(
      'Lost create response → opaque-key reload recovery → original persisted order, one POST only',
    );
    saveReport();
  } finally {
    await recovery.context.close();
  }

  const auth = await contextFor(harness(), { anonymous: true });
  try {
    await auth.page.goto(`${origin}/#/account`);
    await auth.page.locator('[data-account-row="profile"]').click();
    await auth.page.getByRole('button', { name: 'تسجيل الدخول أو إنشاء حساب' }).click();
    await auth.page.locator('input[name="email"]').fill('browser@example.test');
    await auth.page.locator('input[name="password"]').fill('A-long-browser-test-password');
    await auth.page.getByRole('button', { name: 'متابعة الدخول', exact: true }).click();
    await expect(auth.page.locator('input[name="otp"]')).toBeVisible();
    await expect(auth.page.locator('input[name="password"]')).toHaveCount(0);
    await auth.page.locator('input[name="otp"]').fill('123456');
    await auth.page.getByRole('button', { name: 'تأكيد الرمز', exact: true }).click();
    await expect(auth.page.locator('input[name="profileName"]')).toHaveValue('عميل اختبار المتصفح');
    assert.deepEqual(await auth.page.evaluate(() => Object.keys(sessionStorage)), []);
    await auth.assertClean();
    report.tests.push(
      'Anonymous account → email/password challenge → OTP → owner session and profile, no credential storage',
    );
    saveReport();
  } finally {
    await auth.context.close();
  }

  const member = membershipHarness();
  const coveredBooking = harness();
  member.state.override = (request) => {
    if (request.path.endsWith('/subscriptions') && member.state.purchase.status !== 'ACTIVATED')
      return response({ items: [], nextCursor: null, asOf: instant });
    if (request.path.endsWith('/eligibility'))
      return response({
        subscriptionId: id(94),
        revision: 9,
        eligible: true,
        reason: null,
        checkedAt: instant,
      });
    return null;
  };
  const memberships = await contextFor(coveredBooking, { account: true, membership: member });
  try {
    const page = memberships.page;
    await page.goto(`${origin}/#/account`);
    await page.locator('[data-account-row="subscriptions"]').click();
    await page.getByRole('button', { name: 'مراجعة السعر والشراء', exact: true }).click();
    await expect(page.locator('[aria-label="مراجعة شراء الخطة"]')).toContainText('4,902');
    await page.getByRole('button', { name: 'تأكيد طلب شراء الاشتراك', exact: true }).click();
    await expect(page.locator('[aria-label="متابعة شراء الاشتراك"]')).toContainText(
      'بانتظار الدفع',
    );
    await page.getByLabel('رقم عملية التحويل', { exact: true }).fill('MEMBER-1234');
    await page.getByRole('button', { name: 'إرسال رقم العملية للمطابقة', exact: true }).click();
    await expect(page.locator('[aria-label="متابعة شراء الاشتراك"]')).toContainText(
      'بانتظار مطابقة العملية',
    );
    assert.equal(member.state.purchase.status, 'PENDING_PAYMENT');
    assert.equal(member.state.obligation.verified.amountMinor, '0');
    await screen(page, 'production-membership-payment-under-review');
    member.state.purchase = {
      ...member.state.purchase,
      status: 'ACTIVATED',
      subscriptionId: id(94),
      revision: 3,
    };
    member.state.subscription = { ...member.state.subscription, planVersion: 3 };
    member.state.obligation = {
      ...member.state.obligation,
      status: 'SETTLED',
      financialStatus: 'PAID',
      verified: money('490200'),
      outstanding: money('0'),
      activeIntent: { ...member.state.obligation.activeIntent, status: 'SUCCEEDED' },
      attempts: member.state.obligation.attempts.map((item) => ({
        ...item,
        status: 'MATCHED',
        reconciledAt: instant,
      })),
    };
    await page.getByRole('button', { name: 'تحديث حالة الشراء والدفع', exact: true }).click();
    await expect(page.locator('[aria-label="متابعة شراء الاشتراك"]')).toContainText(
      'الاشتراك مفعّل',
    );
    await page.getByRole('button', { name: 'طلب تجميد', exact: true }).click();
    await page.getByRole('button', { name: 'تأكيد طلب تجميد', exact: true }).click();
    await expect(page.locator('[data-customer-memberships]')).toContainText(
      'الطلب بانتظار المراجعة',
    );
    assert.equal(member.state.subscription.status, 'ACTIVE');
    assert.equal(member.state.subscription.expiresAt, '2026-12-27T08:00:00.000Z');
    await screen(page, 'production-membership-change-pending');
    await page.getByRole('button', { name: 'إغلاق النافذة', exact: true }).click();
    await sevenSteps(page, origin, false, true);
    coveredBooking.state.order = {
      ...coveredBooking.state.order,
      financialSource: 'SUBSCRIPTION',
      obligationId: null,
      entitlementReservationId: null,
    };
    await page.locator('.primary-next').click();
    await expect(page.getByRole('heading', { name: 'جارٍ تأكيد الحجز' })).toBeVisible();
    await expect(page.locator('[aria-label="تغطية الحجز"]')).toContainText('من رصيد الاشتراك');
    const covered = coveredBooking.requests.find(
      (request) => request.path.endsWith('/bookings') && request.method === 'POST',
    );
    assert.deepEqual(covered.body.subscription, { subscriptionId: id(94), expectedRevision: 9 });
    assert.equal(Object.hasOwn(covered.body, 'paymentMethod'), false);
    assert.equal(
      coveredBooking.requests.some((request) => request.path.endsWith('/obligation')),
      false,
    );
    const persisted = await page.evaluate(() => Object.entries(sessionStorage));
    assert.equal(persisted.length, 1);
    assert.ok(persisted[0][0].startsWith('washgo.subscription-recovery.v1:'));
    assert.deepEqual(JSON.parse(persisted[0][1]), { pendingKey: null, purchaseId: id(93) });
    await screen(page, 'production-covered-booking-owner-pending');
    await memberships.assertClean();
    report.tests.push(
      'Owner membership quote → purchase → payment claim remains review → explicit owner activation → pending freeze request → owner eligibility → covered booking without direct debt',
    );
    saveReport();
  } finally {
    await memberships.context.close();
  }
  process.stdout.write(
    `${JSON.stringify({ ok: true, evidence, browserVersion: report.browserVersion, scope: report.scope, tests: report.tests }, null, 2)}\n`,
  );
} catch (error) {
  report.failure = error.message;
  saveReport();
  throw error;
} finally {
  await browser?.close();
  if (server) {
    server.closeAllConnections();
    await new Promise((resolveClose) => server.close(resolveClose));
  }
  rmSync(buildRoot, { recursive: true, force: true });
}
