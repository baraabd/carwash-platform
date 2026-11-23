/* global document, window, localStorage, Event -- browser code inside page.evaluate() */
/**
 * P05-C2 operator-web journeys in a real Chromium, through the gateway harness
 * (requested routes, CR-P05-C1 §3), against the FIXTURE DOUBLES of the
 * Workforce profile routes and Billing custody
 * (support/operator-profile-double.mjs). Proves the browser client: closed
 * reads, revision-fenced and keyed mutations, refusals, the revoked
 * technician, offline read cache and reconnect. NOT evidence of the real
 * services; those are proven by services/workforce suites and the P05-C
 * integration candidate.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  launch,
  newOperatorContext,
  openApp,
  startStack,
  watch,
} from './support/operator-browser.mjs';
import { TECHNICIAN_SUBJECT } from './support/operator-api-fixture.mjs';

const CACHE_KEY = 'washgo-operator-profile-cache-v1';
const OFFLINE_ACTION = 'لا يمكن الحفظ دون اتصال. لم يتغيّر شيء.';
const NOT_ACTIVE = 'الحساب موقوف أو غير نشط حاليًا؛ لا يمكن استلام مهام جديدة.';
const CONFLICT = 'تغيّرت المهمة على الخادم. عُرضت أحدث حالة؛ راجعها ثم أعد المحاولة.';

let stack;
let browser;

test.before(async () => {
  stack = await startStack();
  browser = await launch();
});

test.after(async () => {
  await browser?.close();
  await stack?.close();
});

async function session(width = 390) {
  const context = await newOperatorContext(browser, stack.gateway.origin, { width });
  const page = await context.newPage();
  const problems = watch(page);
  await openApp(page, stack.gateway.origin);
  return { context, page, problems };
}

async function openProfile(page) {
  await page.locator('nav [data-action="profile"]').click();
  await page.waitForSelector('[data-pn="PN-01"]', { timeout: 15_000 });
}

async function waitToast(page, text) {
  await page.waitForFunction((t) => document.querySelector('#toast')?.textContent === t, text, {
    timeout: 15_000,
  });
}
const mutations = (path) =>
  stack.fixture.requests.filter((r) => r.method !== 'GET' && path.test(r.path));

function assertNoProblems(problems) {
  assert.deepEqual(
    problems.filter((p) => !/status of 40[0-9]/.test(p)),
    [],
    'no page errors and no CSP violations',
  );
}

test('profile: readiness, verification, skills, availability, area and equipment from the server only', async () => {
  stack.fixture.control.reset();
  const { context, page, problems } = await session();
  try {
    await openProfile(page);
    const pn1 = await page.locator('[data-pn="PN-01"]').innerText();
    assert.match(pn1, /أحمد/);
    assert.match(pn1, /جاهز لاستلام مهام جديدة/);
    assert.match(pn1, /موثّق حتى/);
    assert.match(pn1, /غسيل خارجي/);
    const pn2 = await page.locator('[data-pn="PN-02"]').innerText();
    assert.match(pn2, /3 أيام في الأسبوع/);
    assert.match(pn2, /المنطقة الأساسية و1 مناطق إضافية/);
    assert.equal(
      await page.locator('[data-pn="PN-03"] [data-action="profile-equipment"]').count(),
      3,
    );
    // Only reference classes: every PN element uses classes found in the reference CSS.
    const classes = await page.evaluate(() => {
      const css = [...document.styleSheets]
        .flatMap((s) => [...s.cssRules])
        .map((r) => r.cssText)
        .join('\n');
      const used = new Set();
      for (const el of document.querySelectorAll('[data-pn], [data-pn] *')) {
        for (const c of el.classList) used.add(c);
      }
      return [...used].filter((c) => !css.includes(`.${c}`));
    });
    assert.deepEqual(classes, [], 'PN sections use only classes defined by the reference CSS');
    // Offline cache: own profile and custody only, bound to the subject.
    const cached = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key) ?? 'null'),
      CACHE_KEY,
    );
    assert.ok(cached, 'read cache written after a confirmed read');
    assert.deepEqual(Object.keys(cached).sort(), ['custody', 'profile', 'savedAt', 'subject', 'v']);
    assert.equal(cached.subject, TECHNICIAN_SUBJECT);
    const text = JSON.stringify(cached);
    for (const seed of ['WG-2041', 'customer', 'phone', 'address', 'plate', 'bookingId']) {
      assert.equal(text.includes(seed), false, `no job/customer data (${seed}) in the cache`);
    }
    // Collections: Billing custody figures (PN-04), labelled as custody, not earnings.
    await page.locator('nav [data-action="collections"]').click();
    const pn4 = await page.locator('[data-pn="PN-04"]').first().innerText();
    assert.match(pn4, /نقد بعهدتك/);
    assert.match(pn4, /30[,٬.]?000/);
    assertNoProblems(problems);
  } finally {
    await context.close();
  }
});

test('weekly availability: add a window (revision-fenced, keyed), stale revision refused, apply once', async () => {
  stack.fixture.control.reset();
  const { context, page, problems } = await session();
  try {
    await openProfile(page);
    await page.locator('[data-action="profile-schedule"]').click();
    await page.locator('#sheet[open] [data-action="schedule-day"][data-weekday="2"]').click();
    await page.fill('#schedule-from', '09:00');
    await page.fill('#schedule-to', '13:30');
    await page.locator('#sheet[open] [data-action="schedule-add"]').click();
    await waitToast(page, 'أُضيفت الفترة إلى أوقات توفّرك.');
    const [put] = mutations(/\/me\/schedule$/);
    assert.equal(put.body.expectedRevision, 1);
    assert.ok(put.key, 'Idempotency-Key sent');
    assert.ok(
      put.body.windows.some((w) => w.weekday === 2 && w.startMinute === 540 && w.endMinute === 810),
    );
    assert.match(await page.locator('#sheet-body').innerText(), /09:00–13:30/);

    // Operations (or another device) changed the schedule: the stale write is refused and re-read.
    stack.fixture.control.profile.bumpSchedule();
    await page.locator('#sheet[open] [data-action="schedule-day"][data-weekday="4"]').click();
    await page.fill('#schedule-from', '18:00');
    await page.fill('#schedule-to', '20:00');
    await page.locator('#sheet[open] [data-action="schedule-add"]').click();
    await waitToast(page, CONFLICT);
    assert.equal(mutations(/\/me\/schedule$/).length, 2);

    // Invalid local input never reaches the server.
    await page.fill('#schedule-from', '10:00');
    await page.fill('#schedule-to', '10:05');
    await page.locator('#sheet[open] [data-action="schedule-add"]').click();
    await page.waitForSelector('#schedule-error:not([hidden])');
    assert.equal(mutations(/\/me\/schedule$/).length, 2);

    // Apply the coming week: shifts are created once; repeating creates nothing new.
    await page.locator('#sheet[open] [data-action="schedule-apply"]').click();
    await waitToast(page, 'فُعّل الأسبوع القادم. راجع الورديات القادمة.');
    const created = stack.fixture.control.profile.shifts().length;
    assert.ok(created > 0);
    await page.locator('#sheet[open] [data-action="schedule-apply"]').click();
    await waitToast(page, 'فُعّل الأسبوع القادم. راجع الورديات القادمة.');
    assert.equal(stack.fixture.control.profile.shifts().length, created, 'no duplicate shifts');
    assertNoProblems(problems);
  } finally {
    await context.close();
  }
});

test('exceptions: add a day off, overlap refused, cancel', async () => {
  stack.fixture.control.reset();
  const { context, page, problems } = await session();
  try {
    await openProfile(page);
    await page.locator('[data-action="profile-exceptions"]').click();
    await page
      .locator('#sheet[open] [data-action="exception-reason"][data-reason="SICKNESS"]')
      .click();
    await page.locator('#sheet[open] [data-action="exception-save"]').click();
    await waitToast(page, 'حُفظ الاستثناء. لن تُسند إليك مهام جديدة خلاله.');
    const [created] = mutations(/\/me\/availability-exceptions$/);
    assert.equal(created.body.reason, 'SICKNESS');
    assert.ok(Date.parse(created.body.endsAt) > Date.parse(created.body.startsAt));
    assert.equal(stack.fixture.control.profile.exceptions().length, 1);
    // The same day again overlaps: refused by the server, nothing stored.
    await page.locator('#sheet[open] [data-action="exception-save"]').click();
    await waitToast(page, 'يوجد استثناء آخر في هذه الفترة.');
    assert.equal(stack.fixture.control.profile.exceptions().length, 1);
    await page.locator('#sheet[open] [data-action="exception-cancel"]').click();
    await waitToast(page, 'أُلغي الاستثناء.');
    assert.equal(stack.fixture.control.profile.exceptions()[0].status, 'CANCELLED');
    assert.match(await page.locator('#sheet-body').innerText(), /لا توجد إجازات/);
    assertNoProblems(problems);
  } finally {
    await context.close();
  }
});

test('unavailable equipment: a required item down shows the technician why no new work arrives', async () => {
  stack.fixture.control.reset();
  const { context, page, problems } = await session();
  try {
    await openProfile(page);
    await page.locator('[data-action="profile-equipment"][data-kind="SERVICE_VEHICLE"]').click();
    await page
      .locator('#sheet[open] [data-action="equipment-status"][data-status="UNAVAILABLE"]')
      .click();
    await page
      .locator('#sheet[open] [data-action="equipment-issue"][data-issue="MAINTENANCE"]')
      .click();
    await page.locator('#sheet[open] [data-action="equipment-save"]').click();
    await waitToast(page, 'حُفظت حالة المعدّة.');
    const [put] = mutations(/\/me\/equipment\/SERVICE_VEHICLE\/status$/);
    assert.deepEqual(put.body, {
      status: 'UNAVAILABLE',
      issue: 'MAINTENANCE',
      expectedRevision: 1,
    });
    await page.keyboard.press('Escape');
    assert.match(await page.locator('[data-pn="PN-01"]').innerText(), /معدّة مطلوبة غير متاحة/);
    assert.match(await page.locator('[data-pn="PN-03"]').innerText(), /غير متاحة/);
    // A stale equipment revision (another reporter) is refused and re-read.
    stack.fixture.control.profile.setEquipment('PRESSURE_WASHER', 'DEGRADED', 'MAINTENANCE');
    await page.locator('[data-action="profile-equipment"][data-kind="PRESSURE_WASHER"]').click();
    // The sheet was opened from the pre-change read, so it saves with the old revision.
    await page
      .locator('#sheet[open] [data-action="equipment-status"][data-status="READY"]')
      .click();
    await page.locator('#sheet[open] [data-action="equipment-save"]').click();
    await waitToast(page, CONFLICT);
    const stale = mutations(/\/me\/equipment\/PRESSURE_WASHER\/status$/);
    assert.equal(stale[0].body.expectedRevision, 1);
    assert.match(await page.locator('[data-pn="PN-03"]').innerText(), /تعمل بمشكلة/);
    assertNoProblems(problems);
  } finally {
    await context.close();
  }
});

test('revoked technician: suspension is shown and readiness cannot be switched on', async () => {
  stack.fixture.control.reset();
  stack.fixture.control.setAvailability('ON_BREAK');
  stack.fixture.control.profile.suspend(true);
  const { context, page, problems } = await session();
  try {
    await page.locator('[data-action="ready"]').click();
    await waitToast(page, NOT_ACTIVE);
    assert.equal(stack.fixture.state.availability.status, 'ON_BREAK', 'no state change');
    assert.equal(
      await page.locator('[data-action="ready"]').getAttribute('aria-checked'),
      'false',
      'the switch shows the server state, not the request',
    );
    await openProfile(page);
    assert.match(await page.locator('[data-pn="PN-01"]').innerText(), /الحساب موقوف مؤقتًا/);
    assertNoProblems(problems);
  } finally {
    await context.close();
  }
});

test('reconnect: API down shows the cached own profile as stale, refuses edits, then recovers', async () => {
  stack.fixture.control.reset();
  const { context, page, problems } = await session();
  try {
    await openProfile(page); // confirmed read -> cache written
    await page.route('**/api/operator/**', (route) => route.abort('internetdisconnected'));
    await page.reload({ waitUntil: 'load' });
    await page.locator('nav [data-action="profile"]').click();
    await page.waitForSelector('[data-pn="PN-01"]', { timeout: 15_000 });
    const status = await page.locator('#storage-warning').innerText();
    assert.match(status, /يُعرض ملفك كما أكّده الخادم آخر مرة/);
    const before = stack.fixture.requests.length;
    await page.locator('[data-action="profile-equipment"][data-kind="VACUUM"]').click();
    await page
      .locator('#sheet[open] [data-action="equipment-status"][data-status="UNAVAILABLE"]')
      .click();
    await page.locator('#sheet[open] [data-action="equipment-save"]').click();
    await waitToast(page, OFFLINE_ACTION);
    assert.equal(stack.fixture.requests.length, before, 'nothing sent, nothing queued');
    // Network back: the app that started without a session boots again by itself.
    await page.unroute('**/api/operator/**');
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForFunction(
      () => document.querySelector('#storage-warning')?.hidden === true,
      null,
      {
        timeout: 20_000,
      },
    );
    assert.ok(
      stack.fixture.requests.slice(before).some((r) => r.path.endsWith('/me/profile')),
      'fresh profile read after reconnect',
    );
    assertNoProblems(problems.filter((p) => !/ERR_INTERNET_DISCONNECTED|Failed to fetch/.test(p)));
  } finally {
    await context.close();
  }
});

test('revoked session: a 401 clears the offline cache', async () => {
  stack.fixture.control.reset();
  const { context, page } = await session();
  try {
    await openProfile(page);
    assert.ok(await page.evaluate((k) => localStorage.getItem(k), CACHE_KEY));
    await context.clearCookies();
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelector('#storage-warning')?.hidden === false);
    assert.equal(await page.evaluate((k) => localStorage.getItem(k), CACHE_KEY), null);
    assert.match(await page.locator('#storage-warning').innerText(), /انتهت الجلسة/);
  } finally {
    await context.close();
  }
});
