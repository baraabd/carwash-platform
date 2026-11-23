/* global document */
/**
 * P06-C operator-web journeys for changes made by OTHER actors while the
 * technician's app is open: an assignment race on a live offer, a revoked
 * eligibility flag on field work, and the background re-read that brings a
 * reassignment or a new offer to the screen. Real Chromium, gateway harness,
 * FIXTURE DOUBLES (support/operator-api-fixture.mjs) whose refusals follow the
 * Dispatch provider (409 OFFER_NOT_LIVE, C4 attention semantics). The same
 * behaviours against the real services are in p06c-real-services.test.mjs.
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

const PENDING_LOST = 'لم تعد هذه المهمة مسندة إليك. أُزيلت من قائمتك.';
const PENDING_ATTENTION =
  'تحتاج هذه المهمة مراجعة الإدارة لأن أهليتك للمهام تغيّرت. لم تُلغَ المهمة.';

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

let logMark = 0;
const gatewayLog = () => stack.gateway.log.slice(logMark);
const id = (key) => stack.fixture.control.bookingIdOf(key);
const toastText = (page) => page.locator('#toast').textContent();

async function session({ clock = false } = {}) {
  logMark = stack.gateway.log.length;
  const context = await newOperatorContext(browser, stack.gateway.origin, { width: 390 });
  const page = await context.newPage();
  const problems = watch(page);
  if (clock) await page.clock.install();
  await openApp(page, stack.gateway.origin);
  return { context, page, problems };
}

async function openJob(page, key) {
  await page
    .locator(`[data-action="open-job"][data-id="${id(key)}"]`)
    .first()
    .click();
}

const atHome = (page) =>
  page.waitForFunction(() => document.documentElement.dataset.view === 'home');

async function expectHeading(page, text) {
  await page.waitForFunction((t) => document.querySelector('#main h1')?.textContent === t, text, {
    timeout: 15_000,
  });
}

function assertNoProblems(problems) {
  assert.deepEqual(
    problems.filter((p) => !/status of 40[49]/.test(p)),
    [],
    'no page errors and no CSP violations',
  );
}

test('assignment race: an offer withdrawn before acceptance is refused (409 OFFER_NOT_LIVE) and leaves as a lost job', async () => {
  const c = stack.fixture.control;
  c.reset();
  const offer = c.offerOf('WG-2041');
  const { context, page, problems } = await session();
  try {
    await openJob(page, 'WG-2041');
    c.withdrawOffer(offer.offerId);
    await page.locator('[data-action="primary"]').click();
    await atHome(page);
    assert.equal(await toastText(page), PENDING_LOST);
    assert.deepEqual(
      gatewayLog()
        .filter((e) => /\/offers\/[^/]+\/accept$/.test(e.path))
        .map((e) => e.status),
      [409],
    );
    assert.equal(
      await page.locator(`[data-action="open-job"][data-id="${id('WG-2041')}"]`).count(),
      0,
    );
    assert.equal(c.taskOf('WG-2041'), undefined, 'no task was created');
    assertNoProblems(problems);
  } finally {
    await context.close();
  }
});

test('revoked eligibility: a flagged field task shows the attention state and is never cancelled', async () => {
  const c = stack.fixture.control;
  c.reset();
  const task = c.seedTask('WG-2041', { stage: 'EN_ROUTE' });
  c.flagIneligible(task.taskId);
  const { context, page, problems } = await session();
  try {
    await openJob(page, 'WG-2041');
    await expectHeading(page, 'في الطريق إلى اللمعة.');
    await page.waitForFunction((text) => {
      const el = document.querySelector('#storage-warning');
      return el && !el.hidden && el.textContent === text;
    }, PENDING_ATTENTION);
    // Dispatch flags the task for operations; the field work itself continues.
    await page.waitForTimeout(460);
    await page.locator('[data-action="primary"]').click();
    await page.locator('#sheet[open] [data-action="arrived-confirm"]').click();
    await expectHeading(page, 'قبل اللمعة.');
    assert.equal(c.taskOf('WG-2041').stage, 'ARRIVED');
    await page.locator('header [data-action="home"]').click();
    await atHome(page);
    assert.equal(
      await page.locator('#storage-warning').isHidden(),
      true,
      'the flag belongs to the task view only',
    );
    assertNoProblems(problems);
  } finally {
    await context.close();
  }
});

test('background re-read: a reassignment and a new offer reach the open app without user action, never under an open sheet', async () => {
  const c = stack.fixture.control;
  c.reset();
  const first = c.seedTask('WG-2041', { stage: 'ACCEPTED' });
  const { context, page, problems } = await session({ clock: true });
  const jobReads = () =>
    gatewayLog().filter((e) => e.method === 'GET' && /\/jobs$/.test(e.path)).length;
  try {
    // An open sheet holds the re-read back: nothing moves under the user's hand.
    await page.locator('[data-action="notifications"]').first().click();
    await page.locator('#sheet[open]').waitFor();
    const held = jobReads();
    await page.clock.fastForward(31_000);
    await page.waitForTimeout(500);
    assert.equal(jobReads(), held, 'no re-read while a sheet is open');
    await page.locator('#sheet [data-action="close-sheet"]').click();

    await openJob(page, 'WG-2041');
    c.withdrawTask(first.taskId);
    await page.clock.fastForward(31_000);
    await atHome(page);
    assert.equal(await toastText(page), PENDING_LOST);

    c.offerAgain('WG-2041');
    await page.clock.fastForward(31_000);
    await page
      .locator(`[data-action="open-job"][data-id="${id('WG-2041')}"]`)
      .first()
      .waitFor({ timeout: 15_000 });
    assertNoProblems(problems);
  } finally {
    await context.close();
  }
});
