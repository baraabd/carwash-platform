/* global document -- page.evaluate callbacks run in the browser */
/**
 * Design review only. An isolated, cookie-free browser context serves explicit
 * synthetic API responses. It never visits a real recovery receipt or forwards
 * an API request. The separate real-owner customer journey keeps its no-capture
 * rule. No application imports this module and these images certify no flow.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect } from '@playwright/test';

export async function captureCustomerAccessReview({ browser, origin, output }) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: 'ar-SY',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  });
  const session = {
    subject: '00000000-0000-4000-8000-000000000001',
    sessionId: '00000000-0000-4000-8000-000000000002',
    authVersion: 1,
    principalKind: 'guest',
    roles: [],
    permissions: [],
  };
  const correlationId = '00000000-0000-4000-8000-000000000003';
  const errorBody = (code, reason = undefined) => ({
    error: {
      code,
      message: 'Synthetic design preview response',
      requestId: correlationId,
      correlationId,
      ...(reason ? { reason } : {}),
    },
  });
  let issued = false;
  const intercepted = [];
  const unexpectedMutations = [];
  const files = [];
  try {
    assert.deepEqual(await context.cookies(), []);
    await context.route('**/api/v1/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const method = request.method();
      const endpoint = url.pathname;
      intercepted.push({ method, endpoint });
      const send = (status, value) =>
        route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
      if (url.origin !== origin) return route.abort('blockedbyclient');
      if (method === 'GET' && endpoint === '/api/v1/auth/session')
        return issued ? send(200, session) : send(401, errorBody('AUTH_REQUIRED'));
      if (method === 'GET' && endpoint === '/api/v1/auth/csrf')
        return send(200, { csrfToken: 'DESIGN_PREVIEW_ONLY'.repeat(2) });
      if (method === 'POST' && endpoint === '/api/v1/auth/guest-sessions') {
        issued = true;
        return send(201, {
          session,
          // Deliberately constructed placeholder, never issued by Identity.
          recoveryCode: 'DESIGN_PREVIEW_ONLY_'.padEnd(43, 'X'),
          guestExpiresAt: '2027-01-01T00:00:00.000Z',
        });
      }
      if (method === 'GET' && endpoint === '/api/v1/customer/profile')
        return send(404, errorBody('NOT_FOUND', 'PROFILE_NOT_FOUND'));
      if (
        method === 'GET' &&
        ['/api/v1/customer/vehicles', '/api/v1/customer/addresses'].includes(endpoint)
      )
        return send(200, { items: [], nextCursor: null });
      if (!['GET', 'HEAD'].includes(method)) unexpectedMutations.push({ method, endpoint });
      // No fallback/continue: even unexpected APIs cannot contact an owner.
      return send(503, errorBody('DEPENDENCY_UNAVAILABLE'));
    });
    const page = await context.newPage();
    await page.goto(`${origin}/#/account`);
    await page.locator('[data-account-row="profile"]').click();
    await expect(page.getByRole('button', { name: 'متابعة كضيف', exact: true })).toBeEnabled();
    await page.evaluate(() => document.fonts.ready);
    await mkdir(output, { recursive: true });
    const capture = async (name) => {
      await page.screenshot({
        path: path.join(output, name),
        animations: 'disabled',
        caret: 'hide',
      });
      files.push(name);
    };
    await capture('guest-entry-390-candidate.png');
    await page.getByRole('button', { name: 'لدي رمز استعادة', exact: true }).click();
    await expect(page.locator('input[name="recoveryCode"]')).toHaveValue('');
    await capture('guest-recovery-390-candidate.png');
    await page.getByRole('button', { name: 'إنشاء جلسة ضيف جديدة', exact: true }).click();
    await page.getByRole('button', { name: 'متابعة كضيف', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'حفظت الرمز، متابعة', exact: true }),
    ).toBeVisible();
    await expect(page.locator('dialog[open] input[readonly]')).toHaveValue(
      'DESIGN_PREVIEW_ONLY_'.padEnd(43, 'X'),
    );
    await capture('guest-receipt-390-candidate.png');
    assert.deepEqual(unexpectedMutations, []);
    assert.deepEqual(await context.cookies(), [], 'Design preview cannot acquire owner cookies');
    const report = {
      status: 'UNAPPROVED_CUSTOMER_ACCESS_DESIGN',
      source: 'production UI in isolated browser context with explicit synthetic API responses',
      ownerJourneyEvidence: false,
      forwardedApiRequests: 0,
      containsRealCredentials: false,
      actualIdentityIssued: false,
      acceptedDesign: false,
      files,
      intercepted,
    };
    await writeFile(
      path.join(output, 'design-review.json'),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    return report;
  } finally {
    await context.close();
  }
}
