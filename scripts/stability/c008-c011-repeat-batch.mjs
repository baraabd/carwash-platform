// Predeclared repeat batch for the two intermittent acceptance cases of PR #36:
//
//   A. C011 `contact-errors-corrected@320` — the reference kept the number's error
//      after the correction sequence (run 37105992192, attempt 1).
//   B. C008 `sheet-map-zoomed-panned-tapped@768` — one pixel differed after zoom,
//      pan and tap (same run, attempt 2; also main push run 37050062833).
//
// Each case runs REPEATS times, sequentially, each repetition in a fresh browser
// context, with no retry of a failed repetition. Every repetition's result and
// diagnostics are kept in `repeat-batch.json`; the batch fails if any repetition
// fails. It does not import the acceptance runners (no side effects); it restates
// the exact steps of the two states and applies the repaired procedures as the
// pass criterion, while recording the unrepaired behaviour as diagnostics.
//
// Case B also records a paired rule evaluation (PR #39): at the runner's timing,
// eight captures of each page are replayed through the previous stop rule (two
// equal captures of six) and the current one (three of eight). Only the current
// rule is part of the pass criterion; the previous rule's outcome is a diagnostic.
// A passing batch is finite evidence about this runner, not proof of stability.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { startReferenceServer } from '../f010/reference-server.mjs';
import { initialSessionState } from '../../apps/customer-web/src/app/initialSession.ts';
import {
  compareSnapshots,
  contract,
  newContext,
  openCandidate,
  openReference,
  referenceStorageFor,
  screenshotOptions,
  settle,
  snapshot,
} from '../c004/parity-harness.mjs';
import { comparePngBuffers } from '../f010/pixel-compare.mjs';
import { DEFAULT_MAX_CAPTURES, captureStable } from '../c004/stable-capture.mjs';
import { fillConfirmed, focusLanded } from '../c011/contact-input-helpers.mjs';

const origin = process.env.STABILITY_ORIGIN ?? 'http://127.0.0.1:4174';
const REPEATS = Number(process.env.STABILITY_REPEATS ?? 10);
assert.ok(Number.isSafeInteger(REPEATS) && REPEATS > 0 && REPEATS <= 50, 'REPEATS must be 1-50');
const evidence = process.env.STABILITY_EVIDENCE_DIR
  ? resolve(process.env.STABILITY_EVIDENCE_DIR)
  : mkdtempSync(resolve(tmpdir(), 'washgo-stability-'));
mkdirSync(evidence, { recursive: true });

async function openPair(context, server, scenario, hash, path, ready) {
  const state = initialSessionState(`#/?scenario=${scenario}`);
  const storage = referenceStorageFor(state, { screen: 'booking', step: Number(hash.slice(-1)) });
  storage.cars = state.vehicles.map((vehicle) => ({ ...vehicle }));
  storage.addresses = state.addresses.map((record) => ({ ...record }));
  storage.draft.carId = state.draft.carId;
  storage.draft.place = state.draft.place ? { ...state.draft.place } : null;
  storage.draft.saveAddress = state.draft.saveAddress;
  storage.draft.date = state.draft.scheduleDay ?? '';
  storage.draft.time = state.draft.slot?.time ?? null;
  const reference = await openReference(context, server, storage, hash);
  await reference.page.locator(ready).first().waitFor();
  const candidate = await openCandidate(context, origin, `${path}?scenario=${scenario}`, ready);
  await candidate.page.locator('.booking-footer').waitFor();
  return { reference, candidate };
}

/** Records input events and replacements of the main content, with timestamps. */
const instrument = () => {
  const log = [];
  globalThis.__trace = log;
  const at = () => Math.round(globalThis.performance.now());
  globalThis.document.addEventListener(
    'input',
    (event) => {
      const target = event.target;
      log.push({
        t: at(),
        kind: 'input',
        id: target.id,
        value: target.value,
        connected: target.isConnected,
        mark: target.dataset?.traceMark ?? null,
      });
    },
    true,
  );
  globalThis.document.addEventListener(
    'focusin',
    (event) => log.push({ t: at(), kind: 'focus', id: event.target.id || event.target.className }),
    true,
  );
  const main = globalThis.document.querySelector('#main, main');
  new globalThis.MutationObserver((records) => {
    for (const record of records) {
      const removedForm = [...record.removedNodes].some(
        (node) =>
          node.nodeType === 1 &&
          (node.matches?.('.field, .page-heading') || node.querySelector?.('#phone')),
      );
      if (removedForm) log.push({ t: at(), kind: 'main-replaced' });
    }
  }).observe(main, { childList: true, subtree: true });
};

const contactState = (page) =>
  page.evaluate(() => {
    const doc = globalThis.document;
    const phone = doc.querySelector('#phone');
    return {
      name: doc.querySelector('#name')?.value ?? null,
      phone: phone?.value ?? null,
      phoneMark: phone?.dataset.traceMark ?? null,
      errors: [...doc.querySelectorAll('.main .error')].map((node) => node.id),
      nameInvalid: doc.querySelector('#name')?.getAttribute('aria-invalid') ?? null,
      phoneInvalid: phone?.getAttribute('aria-invalid') ?? null,
      active: doc.activeElement?.id || doc.activeElement?.className || null,
      t: Math.round(globalThis.performance.now()),
    };
  });

/** Case A: the exact steps of `contact-errors-corrected`, with a state record after each. */
async function contactCase(page) {
  const steps = [];
  const record = async (step) => steps.push({ step, ...(await contactState(page)) });
  await page.evaluate(instrument);
  await page.locator('.primary-next').click();
  await page.locator('#error-phone').waitFor();
  // Diagnostic, recorded before the repair waits: is the page's own focus move
  // to the first invalid field still pending when the message is already shown?
  await record('after refused Next');
  // Mark the elements so a replacement before or after filling is visible.
  await page.evaluate(() => {
    globalThis.document.querySelector('#name').dataset.traceMark = 'name-1';
    globalThis.document.querySelector('#phone').dataset.traceMark = 'phone-1';
  });
  // The repaired procedure of the acceptance: wait for that focus, then fill once
  // each and require the value and the cleared message.
  await focusLanded(page, 'name');
  await fillConfirmed('#name', 'سامر', { errorShown: false })(page);
  await record('after name fill');
  await fillConfirmed('#phone', '0912 345 678', { errorShown: false })(page);
  await record('after phone fill');
  await page.locator('.primary-next').focus();
  await page.waitForTimeout(500);
  await record('settled');
  return { steps, trace: await page.evaluate(() => globalThis.__trace) };
}

const mapPoint = async (page, fx, fy) => {
  const box = await page.locator('#location-map').boundingBox();
  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
};

/** Case B: the exact steps of `sheet-map-zoomed-panned-tapped`. */
async function mapCase(page) {
  await page.locator('.location-picker').click();
  await page.locator('dialog.sheet[open]').waitFor();
  await page.locator('#location-map').waitFor();
  const zoom = page.getByRole('button', { name: 'تكبير الخريطة' });
  await zoom.click();
  await zoom.click();
  const from = await mapPoint(page, 0.5, 0.6);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 23, from.y - 11, { steps: 4 });
  await page.mouse.move(from.x + 46, from.y - 22, { steps: 4 });
  await page.mouse.up();
  const tap = await mapPoint(page, 0.36, 0.7);
  await page.mouse.click(tap.x, tap.y);
}

const mapGeometry = (page) =>
  page.evaluate(() => {
    const doc = globalThis.document;
    const rect = (node) => {
      const box = node.getBoundingClientRect();
      return [box.x, box.y, box.width, box.height];
    };
    const pin = doc.querySelector('#map-pin');
    const world = doc.querySelector('#map-world');
    const sheet = doc.querySelector('dialog.sheet[open]');
    return {
      pinStyle: [pin.style.left, pin.style.top],
      pinRect: rect(pin),
      worldTransform: world.style.transform,
      worldComputed: globalThis.getComputedStyle(world).transform,
      worldRect: rect(world),
      mapRect: rect(doc.querySelector('#location-map')),
      sheetScrollTop: sheet.scrollTop,
      scrollY: globalThis.scrollY,
      dpr: globalThis.devicePixelRatio,
    };
  });

/** Positions of pixels above the threshold (at most 20), using the page's canvas. */
async function diffPositions(browser, left, right, threshold) {
  const page = await browser.newPage({ viewport: { width: 16, height: 16 } });
  try {
    return await page.evaluate(
      async ({ a, b, threshold: limit }) => {
        const load = async (base64) =>
          globalThis.createImageBitmap(
            await (await fetch(`data:image/png;base64,${base64}`)).blob(),
          );
        const [x, y] = await Promise.all([load(a), load(b)]);
        if (x.width !== y.width || x.height !== y.height) return { sameSize: false };
        const canvas = new globalThis.OffscreenCanvas(x.width, x.height);
        const context = canvas.getContext('2d');
        context.drawImage(x, 0, 0);
        const da = context.getImageData(0, 0, x.width, x.height).data;
        context.clearRect(0, 0, x.width, x.height);
        context.drawImage(y, 0, 0);
        const db = context.getImageData(0, 0, y.width, y.height).data;
        const hits = [];
        for (let i = 0; i < da.length; i += 4) {
          const changed = [0, 1, 2, 3].some((k) => Math.abs(da[i + k] - db[i + k]) > limit);
          if (changed && hits.length < 20) {
            hits.push([
              (i / 4) % x.width,
              Math.floor(i / 4 / x.width),
              [...da.slice(i, i + 4)],
              [...db.slice(i, i + 4)],
            ]);
          }
        }
        return { sameSize: true, hits };
      },
      { a: left.toString('base64'), b: right.toString('base64'), threshold },
    );
  } finally {
    await page.close();
  }
}

const results = { repeats: REPEATS, viewport: {}, cases: { contact: [], map: [] } };
const save = () =>
  writeFileSync(resolve(evidence, 'repeat-batch.json'), `${JSON.stringify(results, null, 2)}\n`);
const browser = await chromium.launch({ headless: true, args: ['--font-render-hinting=none'] });
const server = await startReferenceServer();
let failures = 0;
try {
  for (let index = 0; index < REPEATS; index += 1) {
    const context = await newContext(browser, 320);
    const entry = { index };
    try {
      const pair = await openPair(
        context,
        server,
        'booking-contact-ready',
        '#book/4',
        '/book/4',
        '#name',
      );
      entry.reference = await contactCase(pair.reference.page);
      entry.candidate = await contactCase(pair.candidate.page);
      const selectors = ['.main .error', '.main .input', '.main .field'];
      try {
        compareSnapshots(
          await snapshot(pair.reference.page, selectors),
          await snapshot(pair.candidate.page, selectors),
          selectors,
          `contact#${index}`,
        );
        entry.passed = true;
      } catch (error) {
        entry.passed = false;
        entry.failure = String(error.message).slice(0, 2000);
      }
    } catch (error) {
      entry.passed = false;
      entry.failure = `run error: ${String(error.message).slice(0, 2000)}`;
    } finally {
      await context.close();
    }
    if (!entry.passed) failures += 1;
    results.cases.contact.push(entry);
    save();
  }

  for (let index = 0; index < REPEATS; index += 1) {
    const context = await newContext(browser, 768);
    const entry = { index };
    try {
      const pair = await openPair(
        context,
        server,
        'booking-location-sample-work',
        '#book/2',
        '/book/2',
        '.location-picker',
      );
      for (const page of [pair.reference.page, pair.candidate.page]) await mapCase(page);
      for (const page of [pair.reference.page, pair.candidate.page]) {
        await page.waitForTimeout(320);
        await settle(page);
      }
      entry.geometry = {
        reference: await mapGeometry(pair.reference.page),
        candidate: await mapGeometry(pair.candidate.page),
      };
      // Paired rule evaluation, at the acceptance runner's timing (right after its
      // waits, before any other capture): eight back-to-back captures of each page,
      // reference first as in comparePixels, with the comparator call between
      // captures that captureStable makes. Both stop rules are replayed on the SAME
      // recorded sequences, so they differ only in the rule. The rule only reads a
      // prefix of the sequence, so a replay returns what a live call would have
      // returned from those captures.
      const unchangedPair = async (previous, next) => {
        const compared = await comparePngBuffers(
          browser,
          previous,
          next,
          contract.channelThreshold,
        );
        return compared.sameDimensions && compared.changedPixels === 0;
      };
      const record = async (page) => {
        const frames = [await page.screenshot(screenshotOptions)];
        for (let shot = 1; shot < DEFAULT_MAX_CAPTURES; shot += 1) {
          frames.push(await page.screenshot(screenshotOptions));
          await unchangedPair(frames[shot - 1], frames[shot]);
        }
        return frames;
      };
      const recorded = {
        reference: await record(pair.reference.page),
        candidate: await record(pair.candidate.page),
      };
      const replay = (frames) => {
        let next = 0;
        return async () => frames[next++];
      };
      const evaluateRule = async (options) => {
        const outcome = {};
        try {
          const reference = await captureStable(replay(recorded.reference), {
            unchanged: unchangedPair,
            ...options,
          });
          const candidate = await captureStable(replay(recorded.candidate), {
            unchanged: unchangedPair,
            ...options,
          });
          const compared = await comparePngBuffers(
            browser,
            reference.image,
            candidate.image,
            contract.channelThreshold,
          );
          Object.assign(outcome, {
            referenceCaptures: reference.captures,
            candidateCaptures: candidate.captures,
            changedPixels: compared.changedPixels,
            passed: compared.sameDimensions && compared.changedPixels === 0,
          });
        } catch (error) {
          Object.assign(outcome, { passed: false, error: String(error.message).slice(0, 500) });
        }
        return outcome;
      };
      entry.paired = {
        previousRule: await evaluateRule({ settledFrames: 2, maxCaptures: 6 }),
        currentRule: await evaluateRule({}),
      };
      if (!entry.paired.previousRule.passed || !entry.paired.currentRule.passed) {
        recorded.reference.forEach((frame, shot) =>
          writeFileSync(resolve(evidence, `map-${index}.paired.reference.${shot}.png`), frame),
        );
        recorded.candidate.forEach((frame, shot) =>
          writeFileSync(resolve(evidence, `map-${index}.paired.candidate.${shot}.png`), frame),
        );
      }
      // Four back-to-back captures of each page: is each page stable on its own?
      const shots = { reference: [], candidate: [] };
      for (let shot = 0; shot < 4; shot += 1) {
        shots.reference.push(await pair.reference.page.screenshot(screenshotOptions));
        shots.candidate.push(await pair.candidate.page.screenshot(screenshotOptions));
      }
      entry.intra = {};
      for (const side of ['reference', 'candidate']) {
        entry.intra[side] = [];
        for (let shot = 1; shot < 4; shot += 1) {
          const compared = await comparePngBuffers(
            browser,
            shots[side][shot - 1],
            shots[side][shot],
            contract.channelThreshold,
          );
          entry.intra[side].push(compared.changedPixels);
        }
      }
      entry.cross = [];
      for (let shot = 0; shot < 4; shot += 1) {
        const compared = await comparePngBuffers(
          browser,
          shots.reference[shot],
          shots.candidate[shot],
          contract.channelThreshold,
        );
        entry.cross.push(compared.changedPixels);
      }
      entry.crossPositions = await diffPositions(
        browser,
        shots.reference[0],
        shots.candidate[0],
        contract.channelThreshold,
      );
      // Diagnostic only: did the FIRST raw captures differ (the original failure)?
      entry.firstCaptureDiffered = entry.cross[0] !== 0;
      if (entry.firstCaptureDiffered) {
        writeFileSync(resolve(evidence, `map-${index}.reference.first.png`), shots.reference[0]);
        writeFileSync(resolve(evidence, `map-${index}.candidate.first.png`), shots.candidate[0]);
      }
      // Pass criterion: the repaired procedure — each page settles on its own, then
      // one strict comparison of the two settled frames.
      const unchanged = async (previous, next) => {
        const compared = await comparePngBuffers(
          browser,
          previous,
          next,
          contract.channelThreshold,
        );
        return compared.sameDimensions && compared.changedPixels === 0;
      };
      const settledReference = await captureStable(
        () => pair.reference.page.screenshot(screenshotOptions),
        { unchanged },
      );
      const settledCandidate = await captureStable(
        () => pair.candidate.page.screenshot(screenshotOptions),
        { unchanged },
      );
      const settled = await comparePngBuffers(
        browser,
        settledReference.image,
        settledCandidate.image,
        contract.channelThreshold,
      );
      entry.settled = {
        referenceCaptures: settledReference.captures,
        candidateCaptures: settledCandidate.captures,
        changedPixels: settled.changedPixels,
      };
      entry.passed =
        entry.paired.currentRule.passed && settled.sameDimensions && settled.changedPixels === 0;
      if (!entry.passed) {
        writeFileSync(
          resolve(evidence, `map-${index}.reference.settled.png`),
          settledReference.image,
        );
        writeFileSync(
          resolve(evidence, `map-${index}.candidate.settled.png`),
          settledCandidate.image,
        );
      }
    } catch (error) {
      entry.passed = false;
      entry.failure = `run error: ${String(error.message).slice(0, 2000)}`;
    } finally {
      await context.close();
    }
    if (!entry.passed) failures += 1;
    results.cases.map.push(entry);
    save();
  }
  results.failures = failures;
  const count = (rule) => results.cases.map.filter((entry) => entry.paired?.[rule]?.passed).length;
  results.paired = {
    repetitions: results.cases.map.length,
    previousRulePassed: count('previousRule'),
    currentRulePassed: count('currentRule'),
  };
  save();
  console.log(`Repeat batch: ${REPEATS} × 2 cases, ${failures} failed. Evidence: ${evidence}`);
  console.log(
    `Paired map rules: previous ${results.paired.previousRulePassed}/${results.paired.repetitions}, current ${results.paired.currentRulePassed}/${results.paired.repetitions}`,
  );
  assert.equal(failures, 0, `${failures} repetitions failed; see repeat-batch.json`);
} finally {
  await server.close();
  await browser.close();
}
