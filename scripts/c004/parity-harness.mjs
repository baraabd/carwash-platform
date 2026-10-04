// Reference-vs-candidate comparison helpers for customer booking screens.
// Same methodology as scripts/c003/browser-acceptance.mjs: one Chromium build,
// the F010 rendering contract, the approved HTML served read-only.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, loadRegistry } from '../f010/reference-registry.mjs';
import { comparePngBuffers } from '../f010/pixel-compare.mjs';
import { captureStable } from './stable-capture.mjs';

export const contract = loadRegistry(ROOT).rendering;

const REFERENCE_STORAGE_KEY = 'washgo.payments.sy.v6';
const GEOMETRY_TOLERANCE_PX = 0.5;
// Starting a renderer for a new context can stall for tens of seconds on a busy
// Windows host (observed right after a build). This only bounds how long a page
// may take to load; it does not relax any comparison.
const NAVIGATION_TIMEOUT_MS = 120_000;

export const STYLE_PROPERTIES = [
  'display',
  'position',
  'direction',
  'text-align',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'font-synthesis-weight',
  'font-synthesis-style',
  'line-height',
  'letter-spacing',
  'white-space',
  'text-decoration-line',
  'color',
  'background-color',
  'background-image',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-left-radius',
  'border-bottom-right-radius',
  'box-shadow',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'gap',
  'opacity',
  'transform',
  'stroke-width',
  'fill',
  'stroke',
  'filter',
  'clip-path',
  'overflow-x',
  'overflow-y',
  'z-index',
  'cursor',
  'accent-color',
];

/** Session state in the shape the approved prototype persists and reloads. */
export function referenceStorageFor(state, { screen, step }) {
  const draftLike = (source) => ({
    type: source.vehicleType,
    carId: null,
    carName: source.carName,
    plate: source.plate,
    color: source.color,
    saveVehicle: source.saveVehicle ?? true,
    service: source.service,
    extras: [...source.extras],
    address: source.address,
    addressLabel: source.addressLabel,
    locationNote: source.locationNote,
    place: null,
    saveAddress: true,
    date: source.slot?.date ?? '',
    time: source.slot?.time ?? null,
    name: source.contactName,
    phone: source.contactPhone,
    note: source.note,
    paymentMethod: source.paymentMethod,
  });
  return {
    version: 6,
    screen,
    step,
    draftStep: state.draftStep,
    motion: 'system',
    editing: false,
    draft: { ...draftLike(state.draft), touched: state.draft.touched },
    cars: [],
    addresses: [],
    orders: state.orders.map((order) => ({
      ...draftLike(order),
      touched: true,
      id: order.id,
      createdAt: '2026-09-18T07:00:00.000Z',
      stage: order.stage,
      rating: 0,
    })),
    profile: { ...state.profile },
    activeOrderId: null,
    filter: 'active',
  };
}

const fixedClock = `(() => {
  const fixed = ${JSON.stringify(contract.fixedTime)};
  const NativeDate = Date;
  class FixedDate extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [fixed])); }
    static now() { return new NativeDate(fixed).getTime(); }
  }
  Object.setPrototypeOf(FixedDate, NativeDate);
  Object.defineProperty(window, 'Date', { value: FixedDate });
})();`;

export const screenshotOptions = Object.freeze({
  fullPage: true,
  animations: 'disabled',
  caret: 'hide',
  style: `
    html { scrollbar-width: none !important; }
    *::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }
    *, *::before, *::after { animation: none !important; transition: none !important; }
  `,
});

export async function newContext(
  browser,
  width,
  { reducedMotion = contract.reducedMotion, height = contract.height } = {},
) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: contract.deviceScaleFactor,
    locale: contract.locale,
    timezoneId: contract.timezoneId,
    colorScheme: contract.colorScheme,
    reducedMotion,
  });
  await context.addInitScript({ content: fixedClock });
  return context;
}

/** Collects page errors, console errors and any request that is not a loopback GET. */
export function watchPage(page, label) {
  const problems = [];
  const requests = [];
  page.on('pageerror', (error) => problems.push(`${label} pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`${label} console.error: ${message.text()}`);
  });
  page.on('request', (request) => {
    requests.push(`${request.method()} ${request.url()}`);
    const url = new URL(request.url());
    const local =
      url.hostname === '127.0.0.1' || ['data:', 'blob:', 'about:'].includes(url.protocol);
    if (!local) problems.push(`${label} external request: ${request.url()}`);
    if (request.method() !== 'GET') {
      problems.push(`${label} non-GET request: ${request.method()} ${request.url()}`);
    }
  });
  return { problems, requests };
}

export async function settle(page) {
  await page.evaluate(async () => {
    if (globalThis.document.fonts) await globalThis.document.fonts.ready;
  });
  await page.waitForTimeout(80);
}

/**
 * Opens the approved prototype with a seeded session. Storage writes are then
 * refused, which puts the prototype in its own approved "this session only" state
 * — the truthful counterpart of the candidate's in-memory session.
 */
export async function openReference(context, server, storage, hash) {
  const page = await context.newPage();
  const watch = watchPage(page, 'reference');
  await page.addInitScript(
    ({ key, value }) => {
      globalThis.localStorage.setItem(key, value);
      globalThis.Storage.prototype.setItem = () => {
        throw new globalThis.DOMException('storage disabled for parity run', 'QuotaExceededError');
      };
    },
    { key: REFERENCE_STORAGE_KEY, value: JSON.stringify(storage) },
  );
  const response = await page.goto(`${server.origin}/customer${hash}`, {
    waitUntil: 'load',
    timeout: NAVIGATION_TIMEOUT_MS,
  });
  assert.equal(response?.status(), 200);
  await settle(page);
  return { page, ...watch };
}

export async function openCandidate(context, origin, hashPath, readySelector) {
  const page = await context.newPage();
  const watch = watchPage(page, 'candidate');
  const response = await page.goto(`${origin}/#${hashPath}`, {
    waitUntil: 'networkidle',
    timeout: NAVIGATION_TIMEOUT_MS,
  });
  assert.equal(response?.status(), 200);
  await page.locator(readySelector).first().waitFor();
  await settle(page);
  return { page, ...watch };
}

/** Geometry, computed style and text regions of every element matching the selectors. */
export function snapshot(page, selectors) {
  return page.evaluate(
    ({ selectors: list, properties }) => {
      const doc = globalThis.document;
      const elements = {};
      for (const selector of list) {
        elements[selector] = [...doc.querySelectorAll(selector)].map((element) => {
          const rect = element.getBoundingClientRect();
          const style = globalThis.getComputedStyle(element);
          return {
            rect: {
              x: rect.x + globalThis.scrollX,
              y: rect.y + globalThis.scrollY,
              width: rect.width,
              height: rect.height,
            },
            style: Object.fromEntries(
              properties.map((name) => [name, style.getPropertyValue(name)]),
            ),
          };
        });
      }
      const text = (root) => (root?.innerText ?? '').replace(/\s+/g, ' ').trim();
      return {
        elements,
        mainText: text(doc.querySelector('.main')),
        headerText: text(doc.querySelector('.app-header')),
        footerText: text(doc.querySelector('.booking-footer')),
        scrollWidth: doc.documentElement.scrollWidth,
        scrollHeight: doc.documentElement.scrollHeight,
        scrollY: globalThis.scrollY,
        innerWidth: globalThis.innerWidth,
        lang: doc.documentElement.lang,
        dir: doc.documentElement.dir,
        title: doc.title,
      };
    },
    { selectors, properties: STYLE_PROPERTIES },
  );
}

// The production CSS minifier rewrites a zero gradient position (`0%`) as the
// unitless `0`, which Chromium serialises as `0px`. Zero is the same offset in
// either unit, so only that spelling is normalised; the pixel comparison still
// proves the gradient renders identically. (Same rule as the C003 acceptance.)
function canonicalStyle(property, value) {
  return property === 'background-image' ? value.replace(/(?<![\d.])0(?:px|%)/g, '0') : value;
}

export function compareSnapshots(reference, candidate, selectors, label) {
  const drift = [];
  for (const selector of selectors) {
    const expected = reference.elements[selector];
    const actual = candidate.elements[selector];
    if (expected.length !== actual.length) {
      drift.push(`${selector}: count ${actual.length} vs reference ${expected.length}`);
      continue;
    }
    expected.forEach((expectedElement, index) => {
      for (const side of ['x', 'y', 'width', 'height']) {
        const delta = Math.abs(actual[index].rect[side] - expectedElement.rect[side]);
        if (delta > GEOMETRY_TOLERANCE_PX) {
          drift.push(
            `${selector}[${index}] ${side}: ${actual[index].rect[side]} vs reference ${expectedElement.rect[side]}`,
          );
        }
      }
      for (const property of STYLE_PROPERTIES) {
        if (
          canonicalStyle(property, actual[index].style[property]) !==
          canonicalStyle(property, expectedElement.style[property])
        ) {
          drift.push(
            `${selector}[${index}] ${property}: "${actual[index].style[property]}" vs reference "${expectedElement.style[property]}"`,
          );
        }
      }
    });
  }
  for (const key of [
    'mainText',
    'headerText',
    'footerText',
    'scrollHeight',
    'scrollY',
    'lang',
    'dir',
    'title',
  ]) {
    if (reference[key] !== candidate[key]) {
      drift.push(`${key}: "${candidate[key]}" vs reference "${reference[key]}"`);
    }
  }
  assert.deepEqual(drift, [], `${label}: drift against the approved reference`);
}

/**
 * Full-page pixel comparison under the F010 thresholds; writes the three PNGs.
 * Each page is captured until it settles on its own (see stable-capture.mjs);
 * the two settled frames are then compared once, strictly.
 */
export async function comparePixels(browser, reference, candidate, evidence, label) {
  // A page has settled when two consecutive captures of THAT page have no pixel
  // the unchanged comparator would classify as different.
  const unchanged = async (previous, next) => {
    const compared = await comparePngBuffers(browser, previous, next, contract.channelThreshold);
    return compared.sameDimensions && compared.changedPixels === 0;
  };
  const referenceFrame = await captureStable(() => reference.screenshot(screenshotOptions), {
    unchanged,
  }).catch((error) => {
    throw new Error(`${label}: reference ${error.message}`);
  });
  const candidateFrame = await captureStable(() => candidate.screenshot(screenshotOptions), {
    unchanged,
  }).catch((error) => {
    throw new Error(`${label}: candidate ${error.message}`);
  });
  const referencePng = referenceFrame.image;
  const candidatePng = candidateFrame.image;
  const pixels = await comparePngBuffers(
    browser,
    referencePng,
    candidatePng,
    contract.channelThreshold,
  );
  writeFileSync(resolve(evidence, `${label}.reference.png`), referencePng);
  writeFileSync(resolve(evidence, `${label}.candidate.png`), candidatePng);
  if (pixels.diffBuffer) writeFileSync(resolve(evidence, `${label}.diff.png`), pixels.diffBuffer);
  assert.equal(pixels.sameDimensions, true, `${label}: screenshot dimensions differ`);
  assert.ok(
    pixels.diffRatio <= contract.allowedDiffRatio,
    `${label}: ${pixels.changedPixels} pixels differ from the approved reference`,
  );
  return {
    changedPixels: pixels.changedPixels,
    diffRatio: pixels.diffRatio,
    referenceCaptures: referenceFrame.captures,
    candidateCaptures: candidateFrame.captures,
  };
}
