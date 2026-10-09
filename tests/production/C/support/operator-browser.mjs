/* global document -- browser code inside page.evaluate() */
/**
 * Shared browser setup for the operator-web suites: fixture doubles + gateway
 * harness + Chromium with the F010 rendering contract
 * (docs/design/f010-reference-manifest.json "rendering").
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { startOperatorFixture, TECHNICIAN_TOKEN } from './operator-api-fixture.mjs';
import { ACCESS_COOKIE, startOperatorGateway } from './operator-gateway.mjs';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
export const RENDERING = JSON.parse(
  readFileSync(`${ROOT}docs/design/f010-reference-manifest.json`, 'utf8'),
).rendering;
export const AXE_SOURCE = readFileSync(
  createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
  'utf8',
);

export function assertBuilt() {
  if (!existsSync(`${ROOT}apps/operator-web/dist/index.html`)) {
    throw new Error('Build operator-web first: pnpm --filter @carwash/operator-web run build');
  }
}

/** Same deterministic clock/random init as scripts/f010/browser-acceptance.mjs. */
export const deterministicInit = (fixed = RENDERING.fixedTime) => `(() => {
  const fixed = ${JSON.stringify(fixed)};
  const NativeDate = Date;
  class FixedDate extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [fixed])); }
    static now() { return new NativeDate(fixed).getTime(); }
  }
  Object.setPrototypeOf(FixedDate, NativeDate);
  Object.defineProperty(window, 'Date', { value: FixedDate });
  let seed = 0x6d2b79f5;
  Math.random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
})();`;

/**
 * F010 launch flags plus software rasterisation. Measured on this host: with
 * GPU raster, two loads of the SAME page differed by 2-3 anti-aliased pixels
 * (reference vs reference and candidate vs candidate); with these flags 14/14
 * reloads were pixel-identical. Reference and candidate always share the flags.
 */
export const LAUNCH_ARGS = Object.freeze([
  '--font-render-hinting=none',
  '--disable-gpu',
  '--disable-gpu-rasterization',
  '--disable-partial-raster',
]);

export async function launch() {
  return chromium.launch({ headless: true, args: [...LAUNCH_ARGS] });
}

/**
 * Start fixture + harness. `fixedClock` makes the fixture clock advance from
 * the F010 fixed instant (visual suite); otherwise real time is used.
 */
export async function startStack({ fixedClock = false, exposeOfferBooking = false } = {}) {
  assertBuilt();
  const t0 = Date.now();
  const fixedStart = Date.parse(RENDERING.fixedTime);
  const clock = fixedClock ? () => new Date(fixedStart + (Date.now() - t0)) : () => new Date();
  const fixture = await startOperatorFixture({ clock, exposeOfferBooking });
  const gateway = await startOperatorGateway({
    upstreams: fixture.upstreams,
    mediaOrigins: [fixture.storeOrigin],
  });
  fixture.control.allowStoreOrigin(gateway.origin);
  return {
    fixture,
    gateway,
    async close() {
      await gateway.close();
      await fixture.close();
    },
  };
}

export async function newOperatorContext(
  browser,
  origin,
  { width = 390, deterministic = false, reducedMotion = 'reduce' } = {},
) {
  const context = await browser.newContext({
    viewport: { width, height: RENDERING.height },
    deviceScaleFactor: RENDERING.deviceScaleFactor,
    locale: RENDERING.locale,
    timezoneId: RENDERING.timezoneId,
    colorScheme: RENDERING.colorScheme,
    reducedMotion,
  });
  if (deterministic) await context.addInitScript({ content: deterministicInit() });
  await context.addCookies([
    {
      name: ACCESS_COOKIE,
      value: TECHNICIAN_TOKEN,
      url: origin,
      httpOnly: true,
      sameSite: 'Strict',
    },
  ]);
  return context;
}

/** Attach console/page error and CSP violation collectors. */
export function watch(page) {
  const problems = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    const text = message.text();
    if (message.type() === 'error' && !/Failed to load resource/.test(text))
      problems.push(`console: ${text}`);
    if (/Content Security Policy/i.test(text)) problems.push(`csp: ${text}`);
  });
  return problems;
}

export async function openApp(page, origin) {
  await page.goto(`${origin}/`, { waitUntil: 'load' });
  await page.waitForFunction(
    () => document.querySelector('#main .hero, #main .empty, #main .heading') !== null,
  );
  await page.evaluate(async () => {
    if (document.fonts) await document.fonts.ready;
  });
}

/** A real JPEG produced by the browser's own encoder (deterministic per Chromium build). */
export async function generateJpeg(browser, { width = 640, height = 480, hue = 120 } = {}) {
  const page = await browser.newPage();
  try {
    const base64 = await page.evaluate(
      ({ width, height, hue }) => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        const gradient = ctx.createLinearGradient(0, 0, width, height);
        gradient.addColorStop(0, `hsl(${hue}, 45%, 35%)`);
        gradient.addColorStop(1, `hsl(${(hue + 60) % 360}, 55%, 75%)`);
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = '#f4f7ee';
        ctx.fillRect(width * 0.2, height * 0.45, width * 0.6, height * 0.25);
        ctx.fillStyle = '#16352b';
        ctx.beginPath();
        ctx.arc(width * 0.32, height * 0.72, height * 0.08, 0, Math.PI * 2);
        ctx.arc(width * 0.68, height * 0.72, height * 0.08, 0, Math.PI * 2);
        ctx.fill();
        return canvas.toDataURL('image/jpeg', 0.9).split(',')[1];
      },
      { width, height, hue },
    );
    return Buffer.from(base64, 'base64');
  } finally {
    await page.close();
  }
}
