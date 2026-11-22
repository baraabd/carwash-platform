/* global window, document, localStorage, sessionStorage */
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { startCustomerStack } from './_customer-stack.mjs';
import { ROOT } from './_support.mjs';

const own = createRequire(path.join(ROOT, 'apps/customer-web/package.json'));
const { parseCustomerProfileV1 } = own('@carwash/contracts/customer-v1');
const { parseVehicleV1 } = own('@carwash/contracts/vehicle-v1');
const { parsePage } = own('@carwash/contracts/common');

const responseFor = (page, method, path) =>
  page.waitForResponse(
    (response) =>
      response.request().method() === method &&
      new URL(response.url()).pathname === `/api/v1${path}`,
  );
const sheet = (page) => page.locator('dialog[open]');

async function openProfile(page) {
  await page.locator('[data-account-row="profile"]').click();
  await expect(sheet(page)).toBeVisible();
}

async function readReceipt(page) {
  await expect(page.getByRole('button', { name: 'حفظت الرمز، متابعة', exact: true })).toBeVisible();
  // No traces, screenshots, storage snapshots or assertion messages contain this
  // real one-time secret. The fixture server/route APIs are never intercepted.
  let code;
  try {
    code = await sheet(page).locator('input[readonly]').inputValue();
  } catch {
    throw new Error('Recovery receipt could not be read; sensitive values omitted');
  }
  assert.equal(
    typeof code === 'string' && /^[A-Za-z0-9_-]{43}$/.test(code),
    true,
    'Identity must provide a valid recovery receipt',
  );
  await page.getByRole('button', { name: 'حفظت الرمز، متابعة', exact: true }).click();
  return code;
}

async function instrument(page, seen, crashes) {
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.pathname.startsWith('/api/v1/'))
      seen.push({
        path: url.pathname,
        method: response.request().method(),
        status: response.status(),
      });
  });
  page.on('pageerror', (error) => crashes.push(error.name));
  await page.addInitScript(() => {
    window.__customerCspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      window.__customerCspViolations.push(event.violatedDirective);
    });
  });
}

async function assertPrivateStorageEmpty(page) {
  const storage = await page.evaluate(() => ({
    local: localStorage.length,
    session: sessionStorage.length,
  }));
  assert.deepEqual(storage, { local: 0, session: 0 });
}

test(
  'production browser persists guest profile and garage through real Gateway owners, reload and recovery',
  { timeout: 180000 },
  async (t) => {
    const stack = await startCustomerStack();
    let browser;
    t.after(async () => {
      await browser?.close();
      await stack.stop();
    });
    browser = await chromium.launch({ headless: true });
    const original = await browser.newContext({
      viewport: { width: 390, height: 844 },
      locale: 'ar-SY',
      reducedMotion: 'reduce',
    });
    const page = await original.newPage();
    const seen = [];
    const crashes = [];
    await instrument(page, seen, crashes);
    const profileName = 'عميل اختبار المتصفح';
    const firstName = 'سيارة اختبار المتصفح';
    const updatedName = 'السيارة بعد التعديل';

    // A crafted scenario URL must still open the production anonymous account.
    await page.goto(`${stack.origin}/#/account?scenario=home-returning-customer`);
    await openProfile(page);
    await expect(page.getByRole('button', { name: 'متابعة كضيف', exact: true })).toBeEnabled();
    assert.equal(
      seen.some((entry) => entry.method === 'POST' && entry.path.endsWith('/guest-sessions')),
      false,
      'visiting the application never silently creates an identity',
    );
    const createdGuest = responseFor(page, 'POST', '/auth/guest-sessions');
    await page.getByRole('button', { name: 'متابعة كضيف', exact: true }).click();
    assert.equal((await createdGuest).status(), 201);
    const recoveryCode = await readReceipt(page);
    await sheet(page).locator('input[name="profileName"]').fill(profileName);
    await sheet(page).locator('input[name="profilePhone"]').fill('+963912345678');
    const savedProfile = responseFor(page, 'PUT', '/customer/profile');
    await sheet(page).getByRole('button', { name: 'حفظ البيانات', exact: false }).click();
    assert.equal((await savedProfile).status(), 201);
    await expect(sheet(page)).toHaveCount(0);
    await expect(page.locator('.profile-hero h2')).toHaveText(profileName);
    const session = await (
      await original.request.get(`${stack.origin}/api/v1/auth/session`)
    ).json();
    assert.equal(session.principalKind, 'guest');
    assert.deepEqual(session.roles, []);
    const cookies = await original.cookies();
    assert.equal(
      cookies.some((cookie) => cookie.name === 'wg_access' && cookie.httpOnly),
      true,
    );
    assert.equal(
      cookies.some((cookie) => cookie.name === 'wg_refresh' && cookie.httpOnly),
      true,
    );
    assert.equal(
      cookies.some((cookie) => cookie.name === 'wg_csrf' && !cookie.httpOnly),
      true,
    );
    await assertPrivateStorageEmpty(page);
    await page.reload();
    await expect(page.locator('.profile-hero h2')).toHaveText(profileName);
    await openProfile(page);
    await sheet(page).locator('input[name="profilePhone"]').fill('');
    const updatedProfile = responseFor(page, 'PATCH', '/customer/profile');
    await sheet(page).getByRole('button', { name: 'حفظ البيانات', exact: false }).click();
    assert.equal((await updatedProfile).status(), 200);
    await expect(sheet(page)).toHaveCount(0);

    await page.locator('[data-account-row="garage-tab"]').click();
    await expect(page).toHaveURL(`${stack.origin}/#/garage`);
    await page.locator('[data-garage-action="add"]').click();
    await expect(sheet(page)).toBeVisible();
    await sheet(page).locator('.car-option:has(input[name="carType"][value="suv"])').click();
    await sheet(page).locator('input[name="carName"]').fill(firstName);
    await sheet(page).locator('input[name="plate"]').fill('ab 12');
    await sheet(page).locator('input[name="color"]').fill('أبيض');
    const createdVehicle = responseFor(page, 'POST', '/customer/vehicles');
    await sheet(page).getByRole('button', { name: 'حفظ السيارة', exact: false }).click();
    assert.equal((await createdVehicle).status(), 201);
    await expect(sheet(page)).toHaveCount(0);
    await expect(page.locator('.garage-card h3')).toHaveText(firstName);
    await expect(page.locator('.garage-card .plate-mini')).toHaveText('AB 12');
    await expect(
      page.getByRole('button', { name: 'احجز لهذه السيارة', exact: true }),
    ).toBeDisabled();
    const vehicleId = await page.locator('.garage-card').getAttribute('data-vehicle-id');
    assert.equal(
      /^[0-9a-f-]{36}$/.test(vehicleId ?? ''),
      true,
      'garage uses the owner-issued vehicle ID',
    );
    await page.reload();
    await expect(page.locator('.garage-card h3')).toHaveText(firstName);
    assert.equal(await page.locator('.garage-card').getAttribute('data-vehicle-id'), vehicleId);

    await page.getByRole('button', { name: `تعديل ${firstName}`, exact: true }).click();
    await sheet(page).locator('input[name="carName"]').fill(updatedName);
    await sheet(page).locator('input[name="plate"]').fill('');
    await sheet(page).locator('input[name="color"]').fill('أسود');
    const editedVehicle = responseFor(page, 'PATCH', `/customer/vehicles/${vehicleId}`);
    await sheet(page).getByRole('button', { name: 'حفظ السيارة', exact: false }).click();
    assert.equal((await editedVehicle).status(), 200);
    await expect(sheet(page)).toHaveCount(0);
    await expect(page.locator('.garage-card h3')).toHaveText(updatedName);
    await expect(page.locator('.garage-card .plate-mini')).toHaveCount(0);

    // A second real browser starts without cookies or personal data. Recovering
    // rotates the secret and revokes the first browser's still-live session.
    const recovered = await browser.newContext({
      viewport: { width: 390, height: 844 },
      locale: 'ar-SY',
      reducedMotion: 'reduce',
    });
    const next = await recovered.newPage();
    await instrument(next, seen, crashes);
    await next.goto(`${stack.origin}/#/account`);
    await openProfile(next);
    await next.getByRole('button', { name: 'لدي رمز استعادة', exact: true }).click();
    try {
      await sheet(next).locator('input[name="recoveryCode"]').fill(recoveryCode);
    } catch {
      throw new Error('Recovery code entry failed; sensitive values omitted');
    }
    const recoveryResponse = responseFor(next, 'POST', '/auth/guest-sessions/recover');
    await sheet(next).getByRole('button', { name: 'استعادة الجلسة', exact: true }).click();
    assert.equal((await recoveryResponse).status(), 200);
    const rotatedCode = await readReceipt(next);
    assert.equal(rotatedCode !== recoveryCode, true, 'recovery rotates the one-time secret');
    await expect(sheet(next).locator('input[name="profileName"]')).toHaveValue(profileName);
    await sheet(next).getByRole('button', { name: 'إغلاق النافذة', exact: true }).click();
    await next.locator('[data-account-row="garage-tab"]').click();
    await expect(next.locator('.garage-card h3')).toHaveText(updatedName);
    const ownerProfileResponse = await recovered.request.get(
      `${stack.origin}/api/v1/customer/profile`,
    );
    assert.equal(ownerProfileResponse.status(), 200);
    const ownerProfile = parseCustomerProfileV1(await ownerProfileResponse.json());
    assert.equal(ownerProfile.contact.displayName, profileName);
    assert.equal(ownerProfile.contact.phone, null);
    assert.equal(ownerProfile.contact.phoneVerification, 'unverified');
    assert.equal(ownerProfile.revision, 2);
    const garageResponse = await recovered.request.get(
      `${stack.origin}/api/v1/customer/vehicles?limit=10`,
    );
    assert.equal(garageResponse.status(), 200);
    const garage = parsePage(await garageResponse.json(), '$', parseVehicleV1);
    assert.equal(garage.items.length, 1);
    assert.equal(garage.items[0].vehicleId, vehicleId);
    assert.equal(garage.items[0].nickname, updatedName);
    assert.equal(garage.items[0].plate, null);
    assert.equal(garage.items[0].revision, 2);
    await assertPrivateStorageEmpty(next);

    await page.reload();
    await expect(page.locator('.garage-card')).toHaveCount(0);
    await page.goto(`${stack.origin}/#/account`);
    await openProfile(page);
    await expect(page.getByRole('button', { name: 'متابعة كضيف', exact: true })).toBeEnabled();
    assert.equal(
      (await original.request.get(`${stack.origin}/api/v1/customer/profile`)).status(),
      401,
    );

    await next.getByRole('button', { name: `حذف ${updatedName}`, exact: true }).click();
    const archived = responseFor(next, 'POST', `/customer/vehicles/${vehicleId}/archive`);
    await sheet(next).getByRole('button', { name: 'حذف السيارة', exact: true }).click();
    assert.equal((await archived).status(), 200);
    await expect(next.locator('.garage-card')).toHaveCount(0);
    await next.reload();
    await expect(next.locator('.garage-card')).toHaveCount(0);
    const finalGarage = await recovered.request.get(
      `${stack.origin}/api/v1/customer/vehicles?limit=10`,
    );
    assert.equal(finalGarage.status(), 200);
    assert.deepEqual(parsePage(await finalGarage.json(), '$', parseVehicleV1).items, []);
    await next.goto(`${stack.origin}/#/account`);
    await openProfile(next);
    const logout = responseFor(next, 'POST', '/auth/logout');
    await sheet(next).getByRole('button', { name: 'إنهاء الجلسة', exact: true }).click();
    assert.equal((await logout).status(), 204);
    await expect(next.getByRole('button', { name: 'متابعة كضيف', exact: true })).toBeEnabled();
    await assertPrivateStorageEmpty(next);
    assert.equal(
      (await recovered.request.get(`${stack.origin}/api/v1/customer/profile`)).status(),
      401,
    );

    assert.deepEqual(crashes, [], 'production browser has no unhandled exceptions');
    assert.deepEqual(
      await page.evaluate(() => window.__customerCspViolations),
      [],
      'original browser CSP permits the real application',
    );
    assert.deepEqual(
      await next.evaluate(() => window.__customerCspViolations),
      [],
      'recovered browser CSP permits the real application',
    );
    assert.equal(
      seen.some(
        (entry) =>
          entry.path === '/api/v1/customer/vehicles' &&
          entry.method === 'POST' &&
          entry.status === 201,
      ),
      true,
    );
    assert.equal(
      seen.some(
        (entry) =>
          entry.path === '/api/v1/customer/profile' &&
          entry.method === 'PUT' &&
          entry.status === 201,
      ),
      true,
    );
  },
);
