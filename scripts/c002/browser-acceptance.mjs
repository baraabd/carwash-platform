import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { startReferenceServer } from '../f010/reference-server.mjs';

const origin = process.env.C002_ORIGIN ?? 'http://127.0.0.1:4174';
const widths = [320, 390, 430, 768, 1024];
const routes = [
  '/',
  '/book/0',
  '/book/1',
  '/book/2',
  '/book/3',
  '/book/4',
  '/book/5',
  '/book/6',
  '/orders',
  '/garage',
  '/account',
  '/pay/demo-order',
  '/order/demo-order',
];

const browser = await chromium.launch({ headless: true, args: ['--font-render-hinting=none'] });
const reference = await startReferenceServer();
try {
  for (const width of widths) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      deviceScaleFactor: 1,
      locale: 'ar-SY',
      timezoneId: 'Asia/Damascus',
      colorScheme: 'light',
      reducedMotion: 'reduce',
    });
    try {
      const page = await context.newPage();
      const response = await page.goto(`${origin}/#/`, { waitUntil: 'networkidle' });
      assert.equal(response?.status(), 200);
      const shell = await page.locator('[data-c002-shell]').boundingBox();
      const header = await page.locator('.app-header').boundingBox();
      const main = await page.locator('.main').boundingBox();
      assert.ok(shell && header && main);
      assert.ok(shell.width <= 482);
      assert.ok(Math.abs(header.width - shell.width) <= 2);
      assert.ok(Math.abs(main.width - shell.width) <= 2);
      const overflow = await page.evaluate(
        () => globalThis.document.documentElement.scrollWidth - globalThis.innerWidth,
      );
      assert.ok(overflow <= 1, `horizontal overflow at ${width}: ${overflow}`);

      const referencePage = await context.newPage();
      await referencePage.goto(`${reference.origin}/customer`, { waitUntil: 'load' });
      const referenceApp = await referencePage.locator('.app').boundingBox();
      const referenceHeader = await referencePage.locator('.app-header').boundingBox();
      const referenceMain = await referencePage.locator('.main').boundingBox();
      const candidateNav = await page.locator('.bottom-nav').boundingBox();
      const referenceNav = await referencePage.locator('.bottom-nav').boundingBox();
      assert.ok(referenceApp && referenceHeader && referenceMain && candidateNav && referenceNav);
      for (const [label, actual, expected] of [
        ['app x', shell.x, referenceApp.x],
        ['app y', shell.y, referenceApp.y],
        ['app width', shell.width, referenceApp.width],
        ['header x', header.x, referenceHeader.x],
        ['header y', header.y, referenceHeader.y],
        ['header width', header.width, referenceHeader.width],
        ['header height', header.height, referenceHeader.height],
        ['main x', main.x, referenceMain.x],
        ['main y', main.y, referenceMain.y],
        ['main width', main.width, referenceMain.width],
        ['bottom nav x', candidateNav.x, referenceNav.x],
        ['bottom nav width', candidateNav.width, referenceNav.width],
        ['bottom nav height', candidateNav.height, referenceNav.height],
      ]) {
        assert.ok(
          Math.abs(actual - expected) <= 2,
          `${label} drift at ${width}: ${actual} vs ${expected}`,
        );
      }
      await referencePage.close();

      await page.keyboard.press('Tab');
      assert.equal(
        await page.evaluate(() => globalThis.document.activeElement?.classList.contains('skip')),
        true,
      );
    } finally {
      await context.close();
    }
  }

  const context = await browser.newContext({
    viewport: { width: 390, height: 900 },
    locale: 'ar-SY',
  });
  try {
    const page = await context.newPage();
    for (const route of routes) {
      await page.goto(`${origin}/#${route}`, { waitUntil: 'networkidle' });
      assert.ok(await page.locator('[data-customer-route]').count(), `missing route ${route}`);
      const before = page.url();
      await page.reload({ waitUntil: 'networkidle' });
      assert.equal(page.url(), before, `reload changed route ${route}`);
    }
    await page.goto(`${origin}/#/`, { waitUntil: 'networkidle' });
    await page.getByRole('link', { name: 'حجوزاتي' }).click();
    assert.match(page.url(), /#\/orders$/);
    await page.goBack();
    assert.match(page.url(), /#\/$/);
    await page.goForward();
    assert.match(page.url(), /#\/orders$/);
  } finally {
    await context.close();
  }
  console.log('C002 browser acceptance passed');
} finally {
  await reference.close();
  await browser.close();
}
