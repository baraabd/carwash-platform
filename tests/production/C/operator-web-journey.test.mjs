/* global document, window, localStorage, Event -- browser code inside page.evaluate() */
/**
 * P03-C5 operator-web journeys in a real Chromium, through the gateway
 * harness, against the FIXTURE DOUBLES of dispatch/booking/workforce/media/
 * identity (support/operator-api-fixture.mjs). This proves the browser client
 * (requests, idempotency, UNKNOWN policy, conflict and loss handling, media
 * flow, exact cash) against the documented shapes. It is NOT evidence of the
 * real services; real-service journeys run in the P03-C integration candidate.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  generateJpeg,
  launch,
  newOperatorContext,
  openApp,
  startStack,
  watch,
} from './support/operator-browser.mjs';

const PENDING_UNKNOWN = 'لم يتأكد حفظ آخر إجراء بعد. ستُعاد المحاولة بالطلب نفسه عند عودة الاتصال.';
const PENDING_CONFLICT = 'تغيّرت المهمة على الخادم. عُرضت أحدث حالة؛ راجعها ثم أعد المحاولة.';
const PENDING_LOST = 'لم تعد هذه المهمة مسندة إليك. أُزيلت من قائمتك.';

let stack;
let browser;
let files;

test.before(async () => {
  stack = await startStack();
  browser = await launch();
  const dir = mkdtempSync(join(tmpdir(), 'washgo-operator-journey-'));
  files = {
    before: join(dir, 'before.jpg'),
    after: join(dir, 'after.jpg'),
    big: join(dir, 'big.jpg'),
    svg: join(dir, 'vector.svg'),
  };
  writeFileSync(files.before, await generateJpeg(browser, { width: 1600, height: 1200, hue: 30 }));
  writeFileSync(files.after, await generateJpeg(browser, { width: 1200, height: 900, hue: 140 }));
  writeFileSync(files.svg, '<svg xmlns="http://www.w3.org/2000/svg"/>');
});

test.after(async () => {
  await browser?.close();
  await stack?.close();
});

let logMark = 0;
const gatewayLog = () => stack.gateway.log.slice(logMark);

async function session() {
  logMark = stack.gateway.log.length;
  const context = await newOperatorContext(browser, stack.gateway.origin, { width: 390 });
  const page = await context.newPage();
  const problems = watch(page);
  await openApp(page, stack.gateway.origin);
  return { context, page, problems };
}

const heading = (page) => page.locator('#main h1').first().textContent();
const toastText = (page) => page.locator('#toast').textContent();
const id = (key) => stack.fixture.control.bookingIdOf(key);

async function openJob(page, key) {
  if (await page.locator('[data-action="task-menu"]').count())
    await page.locator('header [data-action="home"]').click();
  await page
    .locator(`[data-action="open-job"][data-id="${id(key)}"]`)
    .first()
    .click();
}

async function expectHeading(page, text) {
  await page.waitForFunction((t) => document.querySelector('#main h1')?.textContent === t, text, {
    timeout: 15_000,
  });
}

function mutationsOf(path) {
  return stack.fixture.requests.filter((r) => r.method !== 'GET' && path.test(r.path));
}

function assertNoProblems(problems) {
  assert.deepEqual(
    problems.filter((p) => !/status of 40[49]/.test(p)),
    [],
    'no page errors and no CSP violations',
  );
}

test('full cash journey: accept, depart, arrive, photos, checklist, finish, exact cash close', async () => {
  stack.fixture.control.reset();
  const { context, page, problems } = await session();
  try {
    await openJob(page, 'WG-2041');
    await expectHeading(page, 'مهمة جديدة، لمعة جديدة.');
    // C3: Booking refuses the technician view before acceptance (no car/amount yet).
    assert.equal(await page.locator('.vehicle-showcase').count(), 0);
    await page.locator('[data-action="primary"]').click();
    await expectHeading(page, 'جاهز للانطلاق؟');
    assert.equal(
      await page.locator('.vehicle-showcase').count(),
      1,
      'booking view is readable once assigned',
    );
    await page.waitForTimeout(460); // reference primary() 450 ms client lock
    await page.locator('[data-action="primary"]').click();
    await expectHeading(page, 'في الطريق إلى اللمعة.');
    await page.waitForTimeout(460);
    await page.locator('[data-action="primary"]').click();
    await page.locator('#sheet[open] [data-action="arrived-confirm"]').click();
    await expectHeading(page, 'قبل اللمعة.');
    assert.equal(stack.fixture.control.taskOf('WG-2041').arrivalMethod, 'MANUAL_CONFIRMATION');
    assert.equal(
      await page.locator('[data-action="primary"]').isDisabled(),
      true,
      'start needs one before photo',
    );

    // Rejected locally exactly like the reference: SVG is refused before any upload.
    const reservesBefore = mutationsOf(/\/media\/uploads$/).length;
    await page.setInputFiles('#main input[data-upload="before"]', files.svg);
    await page.waitForFunction(() =>
      document.querySelector('#toast')?.textContent.includes('HEIC وSVG'),
    );
    assert.equal(mutationsOf(/\/media\/uploads$/).length, reservesBefore);

    await page.setInputFiles('#main input[data-upload="before"]', files.before);
    await page.waitForFunction(() => document.querySelector('.photo-grid img')?.complete, null, {
      timeout: 20_000,
    });
    const task = stack.fixture.control.taskOf('WG-2041');
    const objectId = task.evidence.BEFORE[0].mediaObjectId;
    const object = stack.fixture.control.object(objectId);
    const bytes = stack.fixture.control.storedBytes(objectId);
    assert.equal(object.status, 'AVAILABLE');
    assert.equal(object.contentType, 'image/jpeg');
    assert.ok(object.claimed, 'evidence object claimed by dispatch');
    assert.equal(
      createHash('sha256').update(bytes).digest('hex'),
      object.sha256,
      'browser SHA-256 equals stored bytes',
    );
    assert.ok(
      bytes.length <= 850000 && bytes[0] === 0xff && bytes[1] === 0xd8,
      're-encoded JPEG within reference limit',
    );
    const dims = await page.evaluate(async () => {
      const img = document.querySelector('.photo-grid img');
      return [img.naturalWidth, img.naturalHeight];
    });
    assert.deepEqual(dims, [1000, 750], 'longest side scaled to 1000 px');
    for (const path of [/\/media\/uploads$/, /\/finalize$/, /\/evidence\/BEFORE\/0$/]) {
      for (const request of mutationsOf(path))
        assert.match(request.key ?? '', /^[0-9a-f-]{36}$/, `Idempotency-Key on ${path}`);
    }
    assert.equal(await page.locator('.pill.success').first().textContent(), '1 / 2 صور');

    await page.fill('#condition-note', 'خدش موجود مسبقًا على الباب');
    await page.locator('#main h1').click();
    await page.waitForFunction(() => true);
    await expectCondition(
      () => stack.fixture.control.taskOf('WG-2041').conditionNote === 'خدش موجود مسبقًا على الباب',
    );

    await page.waitForTimeout(460);
    await page.locator('[data-action="primary"]').click();
    await expectHeading(page, 'كل تفصيلة، بعناية.');
    for (let index = 0; index < 4; index += 1) {
      assert.equal(
        await page.locator('[data-action="primary"]').isDisabled(),
        true,
        'checklist gate',
      );
      await page.locator(`[data-action="check"][data-index="${index}"]`).click();
      await page.waitForFunction(
        (i) =>
          document
            .querySelector(`[data-action="check"][data-index="${i}"]`)
            ?.getAttribute('aria-checked') === 'true',
        index,
      );
    }
    await page.waitForTimeout(460);
    await page.locator('[data-action="primary"]').click();
    await expectHeading(page, 'دع النتيجة تتحدث.');
    await page.setInputFiles('#main input[data-upload="after"]', files.after);
    await page.waitForFunction(
      () =>
        document.querySelectorAll('.photo-grid img').length === 1 &&
        document.querySelector('#comparison img'),
      null,
      { timeout: 20_000 },
    );
    await page.waitForTimeout(460);
    await page.locator('[data-action="primary"]').click();
    await page.locator('#sheet[open] [data-action="finish-wash-confirm"]').click();
    await expectHeading(page, 'اللمعة اكتملت. وقت التسليم.');

    await page.locator('[data-action="cash-dialog"]').first().click();
    const confirm = page.locator('#cash-confirm');
    for (const amount of ['1000', '100', '1100', '1050.5', '']) {
      await page.fill('#cash-amount', amount);
      await page.check('#cash-check');
      assert.equal(
        await confirm.isDisabled(),
        true,
        `amount ${JSON.stringify(amount)} must be blocked`,
      );
      await page.uncheck('#cash-check');
    }
    await page.fill('#cash-amount', '١٬٠٥٠');
    assert.equal(await confirm.isDisabled(), true, 'explicit receipt checkbox required');
    await page.check('#cash-check');
    assert.equal(await confirm.isDisabled(), false, 'Arabic digits for the exact total');
    await confirm.click();
    await expectHeading(page, 'لمعة تستحق المشاهدة.');
    const closed = stack.fixture.control.taskOf('WG-2041');
    assert.equal(closed.stage, 'CLOSED');
    assert.deepEqual(closed.collection.amount, {
      currency: 'SYP',
      amountMinor: '105000',
      scale: 2,
    });
    assert.equal(closed.collection.outcome, 'CASH_COLLECTED');

    for (const request of mutationsOf(/\/internal\/v1\/dispatch\/tasks\//)) {
      assert.match(request.key ?? '', /^[0-9a-f-]{36}$/, `Idempotency-Key on ${request.path}`);
      if (!request.path.endsWith('/notes'))
        assert.ok(
          Number.isInteger(request.body.expectedRevision),
          `expectedRevision on ${request.path}`,
        );
    }
    const stored = await page.evaluate(() =>
      Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)]),
    );
    // Only UI preferences may be stored (written when a preference or filter changes).
    for (const [key, value] of stored) {
      assert.equal(key, 'washgo-operator-preferences-v1');
      assert.deepEqual(Object.keys(JSON.parse(value)).sort(), [
        'collectionFilter',
        'motion',
        'taskFilter',
      ]);
    }
    assert.doesNotMatch(JSON.stringify(stored), /token|https?:|objects/i);
    assertNoProblems(problems);
  } finally {
    await context.close();
  }
});

async function expectCondition(check, timeout = 10_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.fail('condition not reached');
}

async function seedWithPhotos(key, stage, extra = {}) {
  const c = stack.fixture.control;
  const before = c.putObject(await generateJpeg(browser, { hue: 20 }));
  const after = c.putObject(await generateJpeg(browser, { hue: 200 }));
  return c.seedTask(key, {
    stage,
    checked: ['exterior', 'wheels', 'interior', 'quality'],
    evidence: { BEFORE: [before, null], AFTER: [after, null] },
    ...extra,
  });
}

test('cash not collected, then a late collection with the exact amount', async () => {
  stack.fixture.control.reset();
  await seedWithPhotos('WG-2041', 'FINISHED');
  const { context, page, problems } = await session();
  try {
    await openJob(page, 'WG-2041');
    await page.locator('[data-action="cash-issue"]').click();
    await page.fill('#issue-reason', 'ab');
    await page.locator('[data-action="save-issue"]').click();
    assert.equal(
      await page.locator('#issue-error').textContent(),
      'أضف ملاحظة واضحة من 3 أحرف على الأقل.',
    );
    await page.fill('#issue-reason', 'العميل سيدفع لاحقًا');
    await page.locator('[data-action="save-issue"]').click();
    await expectHeading(page, 'لمعة تستحق المشاهدة.');
    let task = stack.fixture.control.taskOf('WG-2041');
    assert.equal(task.collection.outcome, 'CASH_NOT_COLLECTED');
    assert.equal(task.collection.reason, 'العميل سيدفع لاحقًا');
    assert.match(await page.locator('#main').textContent(), /لم يُحصّل · للمتابعة/);
    await page.locator('#main [data-action="cash-dialog"]').click();
    await page.fill('#cash-amount', '1050');
    await page.check('#cash-check');
    await page.locator('#cash-confirm').click();
    await page.waitForFunction(() =>
      /تم التحصيل/.test(document.querySelector('#main').textContent),
    );
    task = stack.fixture.control.taskOf('WG-2041');
    assert.deepEqual(task.collection.lateAmount, {
      currency: 'SYP',
      amountMinor: '105000',
      scale: 2,
    });
    assert.equal(task.stage, 'CLOSED', 'late declaration never reopens work');
    assertNoProblems(problems);
  } finally {
    await context.close();
  }
});

test('release before departure and decline of an offer', async () => {
  const c = stack.fixture.control;
  c.reset();
  c.seedTask('WG-2042', { stage: 'ACCEPTED' });
  const { context, page, problems } = await session();
  try {
    await openJob(page, 'WG-2042');
    await page.locator('[data-action="defer"]').click();
    await page.fill('#issue-reason', 'عطل في المعدات');
    await page.locator('[data-action="save-issue"]').click();
    await expectHeading(page, 'أُعيدت المهمة للجدول.');
    const released = c.taskOf('WG-2042');
    assert.equal(released.stage, 'RELEASED');
    assert.equal(released.releaseReason, 'عطل في المعدات');
    assert.equal(
      await page.locator('.dock-hint span').first().textContent(),
      'لم تُنفذ هذه الخدمة',
    );

    await page.locator('[data-action="home"]').first().click();
    const offer = c.offerOf('WG-2043');
    await openJob(page, 'WG-2043');
    await page.locator('[data-action="defer"]').click();
    await page.fill('#issue-reason', 'المسافة بعيدة جدًا');
    await page.locator('[data-action="save-issue"]').click();
    await page.waitForFunction(() => document.documentElement.dataset.view === 'home');
    const declined = stack.fixture.state.offers.get(offer.offerId);
    assert.equal(declined.status, 'DECLINED');
    assert.equal(declined.declineNote, 'المسافة بعيدة جدًا');
    assert.equal(
      await page.locator(`[data-action="open-job"][data-id="${id('WG-2043')}"]`).count(),
      0,
    );
    assertNoProblems(problems);
  } finally {
    await context.close();
  }
});

test('refresh mid-task restores the server state', async () => {
  const c = stack.fixture.control;
  c.reset();
  const before = c.putObject(await generateJpeg(browser, { hue: 60 }));
  c.seedTask('WG-2041', { stage: 'IN_SERVICE', evidence: { BEFORE: [before, null] } });
  const { context, page, problems } = await session();
  try {
    await openJob(page, 'WG-2041');
    for (const index of [0, 1]) {
      await page.locator(`[data-action="check"][data-index="${index}"]`).click();
      await page.waitForFunction(
        (i) =>
          document
            .querySelector(`[data-action="check"][data-index="${i}"]`)
            ?.getAttribute('aria-checked') === 'true',
        index,
      );
    }
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#main .hero'));
    await openJob(page, 'WG-2041');
    await expectHeading(page, 'كل تفصيلة، بعناية.');
    const states = await page.$$eval('[data-action="check"]', (els) =>
      els.map((e) => e.getAttribute('aria-checked')),
    );
    assert.deepEqual(states, ['true', 'true', 'false', 'false']);
    assert.equal(
      await page.locator('.dock-hint span').first().textContent(),
      'أكمل قائمة العناية · 2 / 4',
    );
    assertNoProblems(problems);
  } finally {
    await context.close();
  }
});

test('lost response after the server applied it: UNKNOWN, then the same Idempotency-Key, one effect', async () => {
  const c = stack.fixture.control;
  c.reset();
  c.seedTask('WG-2041', { stage: 'ACCEPTED' });
  const { context, page, problems } = await session();
  try {
    await openJob(page, 'WG-2041');
    // A 1 s window also drops Chromium's own transparent resends on reused keep-alive
    // sockets, so the failure reaches the application; its own retry comes after 1.5 s.
    stack.gateway.injectFault({
      method: 'POST',
      path: /\/tasks\/[^/]+\/depart$/,
      mode: 'drop-after-upstream',
      windowMs: 1000,
    });
    await page.locator('[data-action="primary"]').click();
    await page.waitForFunction(
      (t) => document.querySelector('#storage-warning')?.textContent === t,
      PENDING_UNKNOWN,
    );
    await expectHeading(page, 'في الطريق إلى اللمعة.');
    await page.waitForFunction(
      () => document.querySelector('#storage-warning')?.hidden === true,
      null,
      { timeout: 15_000 },
    );
    const departs = gatewayLog().filter((e) => e.method === 'POST' && /\/depart$/.test(e.path));
    assert.ok(departs.length >= 2, 'dropped attempt(s) + application retry');
    assert.equal(
      new Set(departs.map((e) => e.idempotencyKey)).size,
      1,
      'every attempt carries the same key',
    );
    assert.equal(departs.at(-1).fault, null);
    assert.equal(departs.at(-1).status, 200);
    const effects = stack.fixture.effects.filter((e) => /\/depart$/.test(e.path));
    assert.equal(effects.length, 1, 'server applied the departure exactly once');
    assert.ok(
      stack.fixture.requests.filter((r) => /\/depart$/.test(r.path) && r.replayed).length >= 1,
      'later attempts were replays',
    );
    assertNoProblems(problems);
  } finally {
    await context.close();
  }
});

test('network failure before the server: UNKNOWN is never shown as success, retry applies once', async () => {
  const c = stack.fixture.control;
  c.reset();
  const before = c.putObject(await generateJpeg(browser, { hue: 90 }));
  c.seedTask('WG-2041', { stage: 'ARRIVED', evidence: { BEFORE: [before, null] } });
  const { context, page, problems } = await session();
  try {
    await openJob(page, 'WG-2041');
    stack.gateway.injectFault({
      method: 'POST',
      path: /\/tasks\/[^/]+\/start$/,
      mode: 'drop-before-upstream',
      windowMs: 1000,
    });
    await page.locator('[data-action="primary"]').click();
    await page.waitForFunction(
      (t) => document.querySelector('#storage-warning')?.textContent === t,
      PENDING_UNKNOWN,
    );
    assert.equal(await heading(page), 'قبل اللمعة.', 'no optimistic advance while UNKNOWN');
    assert.equal(c.taskOf('WG-2041').stage, 'ARRIVED');
    await expectHeading(page, 'كل تفصيلة، بعناية.');
    const starts = gatewayLog().filter((e) => /\/start$/.test(e.path));
    assert.ok(starts.length >= 2);
    assert.equal(new Set(starts.map((e) => e.idempotencyKey)).size, 1, 'same key on every attempt');
    assert.equal(
      stack.fixture.requests.filter((r) => /\/start$/.test(r.path)).length,
      1,
      'dropped attempts never reached the server',
    );
    assert.equal(stack.fixture.effects.filter((e) => /\/start$/.test(e.path)).length, 1);
    assertNoProblems(problems);
  } finally {
    await context.close();
  }
});

test('revision conflict (412 REVISION_CONFLICT) re-reads and re-renders; availability conflict (409 CONFLICT/REVISION_CONFLICT) too', async () => {
  const c = stack.fixture.control;
  c.reset();
  const before = c.putObject(await generateJpeg(browser, { hue: 100 }));
  const task = c.seedTask('WG-2041', { stage: 'IN_SERVICE', evidence: { BEFORE: [before, null] } });
  const { context, page, problems } = await session();
  try {
    await openJob(page, 'WG-2041');
    c.touchTask(task.taskId);
    await page.evaluate(() => (document.querySelector('#toast').textContent = ''));
    await page.locator('[data-action="check"][data-index="0"]').click();
    await page.waitForFunction(
      (t) => document.querySelector('#toast')?.textContent === t,
      PENDING_CONFLICT,
    );
    assert.equal(
      await page.locator('[data-action="check"][data-index="0"]').getAttribute('aria-checked'),
      'false',
    );
    const statuses = gatewayLog()
      .filter((e) => /checklist\/exterior$/.test(e.path))
      .map((e) => e.status);
    assert.deepEqual(statuses, [412]);
    await page.locator('[data-action="check"][data-index="0"]').click();
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-action="check"][data-index="0"]')
          ?.getAttribute('aria-checked') === 'true',
    );

    await page.locator('header [data-action="home"]').click();
    c.setAvailability('ON_BREAK'); // another device changed readiness
    await page.evaluate(() => (document.querySelector('#toast').textContent = ''));
    await page.locator('[data-action="ready"]').click();
    await page.waitForFunction(
      (t) => document.querySelector('#toast')?.textContent === t,
      PENDING_CONFLICT,
    );
    assert.equal(
      await page.locator('[data-action="ready"]').getAttribute('aria-checked'),
      'false',
      're-read server readiness',
    );
    await page.locator('[data-action="ready"]').click();
    await page.waitForFunction(
      () =>
        document.querySelector('[data-action="ready"]')?.getAttribute('aria-checked') === 'true',
    );
    assert.equal(stack.fixture.state.availability.status, 'AVAILABLE');
    assert.equal(await toastText(page), 'الجاهزية مفعّلة.');
    assertNoProblems(problems);
  } finally {
    await context.close();
  }
});

test('reassignment: a withdrawn task disappears on reconnect and on a refused mutation', async () => {
  const c = stack.fixture.control;
  c.reset();
  const first = c.seedTask('WG-2041', { stage: 'ACCEPTED' });
  const second = c.seedTask('WG-2042', { stage: 'ACCEPTED' });
  const { context, page, problems } = await session();
  try {
    await openJob(page, 'WG-2041');
    c.withdrawTask(first.taskId);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForFunction(() => document.documentElement.dataset.view === 'home');
    assert.equal(await toastText(page), PENDING_LOST);
    assert.equal(
      await page.locator(`[data-action="open-job"][data-id="${id('WG-2041')}"]`).count(),
      0,
    );

    await openJob(page, 'WG-2042');
    c.withdrawTask(second.taskId);
    await page.locator('[data-action="primary"]').click();
    await page.waitForFunction(() => document.documentElement.dataset.view === 'home');
    assert.equal(await toastText(page), PENDING_LOST);
    const refused = gatewayLog()
      .filter((e) => /\/depart$/.test(e.path))
      .map((e) => e.status);
    assert.deepEqual(refused, [409], '409 CONFLICT reason TASK_CLOSED');
    assertNoProblems(problems);
  } finally {
    await context.close();
  }
});

test('unauthenticated session shows the pending state and never renders jobs', async () => {
  stack.fixture.control.reset();
  const context = await browser.newContext({
    viewport: { width: 390, height: 900 },
    locale: 'ar-SY',
    timezoneId: 'Asia/Damascus',
  });
  try {
    const page = await context.newPage();
    await page.goto(`${stack.gateway.origin}/`);
    await page.waitForFunction(
      () =>
        document.querySelector('#storage-warning')?.hidden === false &&
        /سجّل الدخول/.test(document.querySelector('#storage-warning').textContent),
    );
    assert.equal(await page.locator('.job-card').count(), 0);
  } finally {
    await context.close();
  }
});
