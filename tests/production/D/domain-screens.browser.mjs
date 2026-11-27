/* global document */
/** Real production bundle and Chromium; synthetic owner HTTP doubles, not live settlement evidence. */
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { createWebRuntime } from '../../../infra/web-runtime.mjs';

const id = (n) => `${String(n).padStart(8, '0')}-1234-4123-8123-123456789012`;
const instant = '2026-11-27T08:00:00.000Z';
const money = (amountMinor = '10000') => ({ currency: 'SYP', amountMinor, scale: 2 });
const appRoot = resolve(import.meta.dirname, '../../../apps/admin-web');
const appRequire = createRequire(resolve(appRoot, 'package.json'));
const { build } = await import(appRequire.resolve('vite'));
const buildRoot = mkdtempSync(resolve(tmpdir(), 'admin-domains-build-'));
const evidence =
  process.env.ADMIN_DOMAINS_EVIDENCE_DIR ??
  mkdtempSync(resolve(tmpdir(), 'admin-domains-evidence-'));
mkdirSync(evidence, { recursive: true });
const report = {
  source: process.env.ADMIN_SOURCE_SHA ?? process.env.GITHUB_SHA ?? 'local-working-tree',
  scope:
    'Production admin bundle + Chromium + synthetic owner HTTP doubles; no live service, database, broker or financial evidence',
  browserVersion: null,
  tests: [],
  screenshots: [],
};
const save = () =>
  writeFileSync(
    resolve(evidence, 'admin-domain-screens.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
save();
const staff = {
  subject: id(90),
  principalKind: 'account',
  roles: ['super-admin'],
  permissions: [
    'operations.dispatch',
    'billing.read',
    'billing.reconcile',
    'billing.refund',
    'billing.treasury.receive',
    'support.cases.read',
    'catalog.publish',
    'pricing.prices.publish',
    'subscription.manage',
  ],
};
let catalog = null;
const publicationReceipts = new Map();
const priceBook = {
  state: 'UNPUBLISHED',
  priceBook: null,
  nextExpectedPriceBookRevision: 1,
  policyCurrency: 'SYP',
  asOf: instant,
};
let handover = {
  handoverId: id(30),
  revision: 1,
  holder: id(31),
  status: 'PENDING',
  receiptCount: 1,
  receiptIds: [id(32)],
  declared: money(),
  counted: null,
  shortage: null,
  overage: null,
  treasuryReference: null,
  receivedBy: null,
  receivedAt: null,
  settlementReference: null,
  reconciledBy: null,
  reconciledAt: null,
  cancelledBy: null,
  cancelledAt: null,
  createdAt: instant,
  updatedAt: instant,
};
let support = {
  authority: [{ owner: 'support', reads: 'cases' }],
  case: {
    caseId: id(10),
    kind: 'BOOKING_CANCELLATION',
    status: 'OPEN',
    subject: { type: 'booking', id: id(11), parentId: null },
    summary: 'حالة إلغاء تجريبية لا تحتوي بيانات عميل',
    snapshot: { owner: 'booking', readAt: instant, state: { status: 'CONFIRMED' } },
    openedBy: id(12),
    openedAt: instant,
    revision: 1,
    updatedAt: instant,
  },
  decisions: [],
  events: [],
};
const subscription = {
  subscriptionId: id(40),
  revision: 3,
  status: 'ACTIVE',
  beneficiary: { kind: 'account', subjectId: id(41) },
  planId: id(42),
  planVersion: 1,
  purchaseId: id(43),
  units: { total: 4, reserved: 0, consumed: 0, available: 4 },
  startsAt: instant,
  expiresAt: '2026-12-27T08:00:00.000Z',
  frozenAt: null,
  cancelledAt: null,
  updatedAt: instant,
};
const plan = {
  planId: id(42),
  version: 1,
  status: 'PUBLISHED',
  name: 'خطة شهرية',
  units: 4,
  validityDays: 30,
  price: money(),
  packageIds: [id(1)],
  vehicleTypes: ['sedan'],
  publishedAt: instant,
  contentHash: 'a'.repeat(64),
};
let changes = [
  {
    changeId: id(44),
    subscriptionId: id(40),
    expectedRevision: 3,
    action: 'FREEZE',
    reason: 'CUSTOMER_REQUEST',
    requestedAt: instant,
    status: 'PENDING_REVIEW',
  },
];
let browser, server;
const requests = [],
  failures = [],
  unhandled = [];
let losePublication = true;
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
    ...(process.env.ADMIN_BROWSER_EXECUTABLE
      ? { executablePath: process.env.ADMIN_BROWSER_EXECUTABLE }
      : {}),
  });
  report.browserVersion = browser.version();
  save();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: 'ar-SY',
    reducedMotion: 'reduce',
  });
  await context.addCookies([
    { name: 'wg_csrf', value: 'browser_domain_csrf_1234567890', url: origin, sameSite: 'Lax' },
  ]);
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date(instant));
  page.on('pageerror', (error) => failures.push(error.message));
  await page.addInitScript(() => {
    globalThis.__domainCsp = [];
    document.addEventListener('securitypolicyviolation', (event) =>
      globalThis.__domainCsp.push(event.violatedDirective),
    );
  });
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname.replace('/api/v1', ''),
      body = request.postDataJSON();
    requests.push({
      path,
      method: request.method(),
      body,
      key: request.headers()['idempotency-key'],
    });
    const reply = (value) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
    if (path === '/auth/session') return reply(staff);
    if (path === '/admin/catalog') return reply(catalog);
    if (path === '/admin/catalog/current')
      return reply({
        state: catalog ? 'PUBLISHED' : 'UNPUBLISHED',
        catalog,
        expectedCatalogRevision: catalog?.catalogRevision ?? 0,
        asOf: instant,
      });
    if (path === '/admin/catalog/publications') {
      const key = request.headers()['idempotency-key'];
      if (!publicationReceipts.has(key)) {
        assert.equal(catalog?.catalogRevision ?? 0, body.expectedCatalogRevision);
        catalog = {
          catalogRevision: body.expectedCatalogRevision + 1,
          publishedAt: instant,
          items: body.definitions.map((value) => ({
            ...value,
            revision:
              (catalog?.items.find((item) => item.definitionId === value.definitionId)?.revision ??
                0) + 1,
          })),
        };
        publicationReceipts.set(key, structuredClone(catalog));
      }
      if (losePublication) {
        losePublication = false;
        return route.abort('failed');
      }
      return reply(publicationReceipts.get(key));
    }
    if (path === '/admin/price-books/current') return reply(priceBook);
    if (path === '/admin/service-zones')
      return reply({
        items: [
          { zoneId: id(20), revision: 1, name: { ar: 'منطقة اختبار', en: null }, status: 'ACTIVE' },
        ],
      });
    if (path === '/admin/serviceability')
      return reply({
        decisionId: id(21),
        decision: 'SERVICEABLE',
        zoneId: id(20),
        zoneRevision: 1,
        datasetRevision: 1,
        point: body.point,
        checkedAt: instant,
        expiresAt: '2026-11-27T09:00:00.000Z',
        reason: null,
      });
    if (path === '/admin/availability')
      return reply({
        zoneId: id(20),
        date: url.searchParams.get('date'),
        timezone: 'Asia/Damascus',
        durationMinutes: Number(url.searchParams.get('durationMinutes')),
        slots: [
          {
            startsAt: '2026-11-27T11:00:00.000Z',
            endsAt: '2026-11-27T11:30:00.000Z',
            availability: 'AVAILABLE',
          },
        ],
        earliest: { startsAt: '2026-11-27T11:00:00.000Z', endsAt: '2026-11-27T11:30:00.000Z' },
        asOf: instant,
      });
    if (path === '/admin/billing/custody/reconciliation')
      return reply({
        evaluatedAt: instant,
        consistent: true,
        holdersChecked: 1,
        holderMismatches: [],
        receiptsWithoutSettledObligation: 0,
        cashSettlementsWithoutReceipt: 0,
        handoversPending: 1,
        handoversAwaitingReconciliation: 0,
        handoversWithDiscrepancy: 0,
        treasury: [
          {
            currency: 'SYP',
            unreconciled: money('0'),
            reconciled: money('0'),
            shortageOutstanding: money('0'),
            overageSuspense: money('0'),
          },
        ],
      });
    if (path === `/admin/billing/custody/handovers/${id(30)}`) return reply(handover);
    if (path === `/admin/billing/custody/handovers/${id(30)}/treasury-receipt`) {
      handover = {
        ...handover,
        revision: 2,
        status: 'RECEIVED',
        counted: body.countedAmount,
        shortage: money('100'),
        overage: money('0'),
        treasuryReference: '…1234',
        receivedBy: staff.subject,
        receivedAt: instant,
      };
      return reply(handover);
    }
    if (path === '/admin/support')
      return reply({ authority: support.authority, items: [support.case], nextCursor: null });
    if (path === `/admin/support/${id(10)}`) return reply(support);
    if (path === `/admin/support/${id(10)}/current`)
      return reply({
        authority: [],
        current: {
          owner: 'booking',
          readAt: instant,
          booking: {
            bookingId: id(11),
            revision: 1,
            status: 'CONFIRMED',
            confirmation: 'CONFIRMED',
            startsAt: '2026-11-27T11:00:00.000Z',
            endsAt: '2026-11-27T11:30:00.000Z',
          },
        },
      });
    if (path === `/admin/support/${id(10)}/decisions`) {
      support = {
        ...support,
        case: { ...support.case, revision: 2, status: 'EXECUTING' },
        decisions: [
          {
            decisionNo: 1,
            action: body.action,
            status: 'EXECUTING',
            reason: body.reason,
            evidence: [],
            amount: null,
            window: null,
            decidedBy: staff.subject,
            decidedAt: instant,
            approval: null,
            owner: {
              operation: 'booking.cancel',
              targetId: id(11),
              commandKey: 'support_frozen_owner_command_1',
              httpStatus: 202,
              code: 'IN_PROGRESS',
              state: 'IN_PROGRESS',
              attempts: 1,
              lastSentAt: instant,
            },
          },
        ],
      };
      return reply(support);
    }
    if (path === '/admin/subscription-plans')
      return reply({
        items: [{ ...plan, packageIds: [catalog.items[0].definitionId] }],
        nextCursor: null,
        asOf: instant,
      });
    if (path === '/admin/subscription-changes') return reply({ items: changes });
    if (path === '/admin/subscription-funding-recovery') return reply({ items: [], asOf: instant });
    if (path === `/admin/subscriptions/${id(40)}`) return reply(subscription);
    if (path === `/admin/subscriptions/${id(40)}/changes/${id(44)}/decision`) {
      subscription.revision = 4;
      subscription.status = 'FROZEN';
      subscription.frozenAt = instant;
      changes = [];
      return reply({
        changeId: id(44),
        action: 'FREEZE',
        status: 'APPLIED',
        effectiveAt: instant,
        subscription,
      });
    }
    unhandled.push(`${request.method()} ${path}`);
    return route.abort('failed');
  });
  const capture = async (name) => {
    await page.screenshot({
      path: resolve(evidence, `${name}.png`),
      fullPage: true,
      animations: 'disabled',
    });
    report.screenshots.push(`${name}.png`);
    save();
  };
  await page.goto(`${origin}/#/services`);
  await expect(page.locator('#services h1')).toHaveText('الخدمات والباقات');
  await expect(page.locator('#services')).toContainText('لم يُنشر كتالوج بعد.');
  await page.getByRole('button', { name: '+ خدمة جديدة', exact: true }).click();
  await page.getByLabel('رمز الخدمة', { exact: true }).fill('essential');
  await page.getByLabel('الاسم بالعربية', { exact: true }).fill('أساسية');
  await page.getByLabel('الوصف بالعربية', { exact: true }).fill('غسيل خارجي');
  await page.getByLabel('سبب التغيير — رمز إداري').fill('INITIAL_PUBLICATION');
  await page.getByRole('button', { name: 'مراجعة النشر', exact: true }).click();
  await page.getByRole('button', { name: 'نشر الإصدار', exact: true }).click();
  await page.getByRole('button', { name: 'إعادة الطلب نفسه', exact: true }).click();
  await expect(page.locator('#services .simple h3')).toHaveText('أساسية');
  const firstPublications = requests.filter(
    (value) => value.path === '/admin/catalog/publications',
  );
  assert.equal(firstPublications.length, 2);
  assert.equal(firstPublications[0].body.expectedCatalogRevision, 0);
  assert.equal(firstPublications[0].key, firstPublications[1].key);
  assert.deepEqual(firstPublications[0].body, firstPublications[1].body);
  assert.equal(catalog.catalogRevision, 1);
  await capture('admin-services-first-publication-recovered');
  await page
    .locator('#services .simple')
    .getByRole('button', { name: 'تعديل', exact: true })
    .click();
  await page.getByLabel('الاسم بالعربية', { exact: true }).fill('أساسية محدّثة');
  await page.getByLabel('سبب التغيير — رمز إداري').fill('CATALOG_UPDATE');
  await page.getByRole('button', { name: 'مراجعة النشر', exact: true }).click();
  await page.getByRole('button', { name: 'نشر الإصدار', exact: true }).click();
  await expect(page.locator('#services .simple h3')).toHaveText('أساسية محدّثة');
  const publications = requests.filter((value) => value.path === '/admin/catalog/publications');
  assert.equal(publications.length, 3);
  assert.equal(publications[2].body.expectedCatalogRevision, 1);
  assert.equal(catalog.catalogRevision, 2);
  await capture('admin-services-publication-recovered');
  report.tests.push(
    'Explicit unpublished Catalog → first publication revision0 → lost response same-key recovery → edit owner revision1 to2',
  );

  await page.goto(`${origin}/#/coverage`);
  await page.getByLabel('خط العرض', { exact: true }).fill('33.5');
  await page.getByLabel('خط الطول', { exact: true }).fill('36.3');
  await page.getByRole('button', { name: 'التحقق من الموقع', exact: true }).click();
  await expect(page.getByText(/الموقع داخل التغطية/)).toBeVisible();
  await page.getByLabel('التاريخ', { exact: true }).fill('2026-11-27');
  await page.getByRole('button', { name: 'عرض المواعيد', exact: true }).click();
  await expect(page.locator('#coverage tbody tr')).toHaveCount(1);
  await capture('admin-coverage-owner-slots');
  report.tests.push('Explicit point → owner serviceability → zone/date availability');

  await page.goto(`${origin}/#/wallets`);
  await page.getByLabel('رقم تسليم العهدة', { exact: true }).fill(id(30));
  await page.getByRole('button', { name: 'فتح التسليم', exact: true }).click();
  await page.getByRole('button', { name: 'تسجيل استلام الخزينة', exact: true }).click();
  await page.getByLabel('المبلغ المعدود فعليًا').fill('99');
  await page.getByLabel('مرجع إيصال الخزينة').fill('TR-1234');
  await page.getByRole('button', { name: 'تأكيد التسجيل', exact: true }).click();
  await expect(
    page.locator('#modalBody').getByText('استلمتها الخزينة — بانتظار التسوية', { exact: true }),
  ).toBeVisible();
  assert.equal(handover.status, 'RECEIVED');
  assert.equal(handover.reconciledAt, null);
  await capture('admin-custody-received-not-settled');
  report.tests.push(
    'Treasury receives actual counted amount; receipt remains distinct from reconciliation',
  );
  await page.locator('#modalClose').click();

  await page.goto(`${origin}/#/disputes`);
  await page
    .locator('#disputes tbody')
    .getByRole('button', { name: 'تفاصيل', exact: true })
    .click();
  await page.getByRole('button', { name: 'تسجيل قرار', exact: true }).click();
  await page
    .getByLabel('شرح القرار — 10 أحرف على الأقل')
    .fill('راجع الموظف طلب الإلغاء والأسباب المسجلة.');
  await page.getByRole('button', { name: 'تسجيل الطلب', exact: true }).click();
  await expect(page.locator('#modalBody')).toContainText('قيد التنفيذ لدى الجهة المالكة');
  await expect(page.locator('#modalBody')).toContainText('CONFIRMED');
  await capture('admin-support-owner-pending');
  report.tests.push(
    'Support decision accepted while Booking still confirmed; no invented cancellation',
  );
  await page.locator('#modalClose').click();

  await page.goto(`${origin}/#/subscriptions`);
  await page.locator('#subscriptions').getByRole('button', { name: 'مراجعة', exact: true }).click();
  await expect(page.locator('#modalBody')).toContainText('التجميد لا يمدد الفترة المدفوعة');
  await page.getByRole('button', { name: 'تسجيل القرار', exact: true }).click();
  await expect(page.getByText('لا توجد طلبات بانتظار المراجعة.', { exact: true })).toBeVisible();
  assert.equal(subscription.status, 'FROZEN');
  assert.equal(subscription.expiresAt, '2026-12-27T08:00:00.000Z');
  await capture('admin-subscription-owner-decision');
  report.tests.push(
    'Independent subscription change review; owner changes state without extending paid expiry',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/#/services`);
  await capture('admin-services-mobile');
  assert.deepEqual(failures, []);
  assert.deepEqual(unhandled, []);
  assert.deepEqual(await page.evaluate(() => globalThis.__domainCsp), []);
  save();
  process.stdout.write(
    `${JSON.stringify({ ok: true, evidence, browserVersion: report.browserVersion, tests: report.tests, scope: report.scope }, null, 2)}\n`,
  );
  await context.close();
} catch (error) {
  report.failure = error.message;
  save();
  throw error;
} finally {
  await browser?.close();
  if (server) {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  }
  rmSync(buildRoot, { recursive: true, force: true });
}
