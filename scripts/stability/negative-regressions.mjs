// Negative regressions for the PR #36 acceptance repairs. Each case proves that
// the repaired procedure still FAILS when it should:
//
//   1. a page that never settles fails the stable capture;
//   2. two settled but different pages fail the unchanged strict comparator;
//   3. a deliberate one-pixel difference above the channel threshold fails
//      (and the threshold itself is unchanged: a difference of exactly 8 passes);
//   4. a field that ends with the wrong value fails the confirmed fill, without
//      a second attempt;
//   5. a message that is not removed fails the confirmed fill;
//   6. an error while keeping diagnostics cannot hide the primary failure;
//   7. the stable capture of one page never depends on another page;
//   8. a transient held for two captures (main push run 37127326124) is not accepted.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { comparePixels, contract, screenshotOptions } from '../c004/parity-harness.mjs';
import { comparePngBuffers } from '../f010/pixel-compare.mjs';
import { captureStable } from '../c004/stable-capture.mjs';
import { fillConfirmed, withFailureEvidence } from '../c011/contact-input-helpers.mjs';

const evidence = mkdtempSync(resolve(tmpdir(), 'washgo-negative-'));
const results = [];
const check = async (name, run) => {
  await run();
  results.push(name);
};

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 64, height: 64 } });
  const pageWith = async (html) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><body style="margin:0;background:#fff">${html}</body>`);
    return page;
  };

  await check('a page that never settles fails', async () => {
    let frame = 0;
    await assert.rejects(
      captureStable(async () => Buffer.from([frame++])),
      /did not settle: no 3 consecutive captures matched in 8/,
    );
    assert.equal(frame, 8, 'bounded at eight captures');
  });

  await check('a page that settles returns the first repeated frame', async () => {
    const frames = ['a', 'b', 'b', 'b', 'c'].map((value) => Buffer.from(value));
    let index = 0;
    const settled = await captureStable(async () => frames[index++]);
    assert.equal(settled.image.toString(), 'b');
    assert.equal(settled.captures, 4);
  });

  await check('a transient held for two captures is not accepted', async () => {
    // The shape of main push run 37127326124: two equal transient frames, then the
    // settled frame. Two equal captures would have accepted the transient.
    const frames = ['settled', 'transient', 'transient', 'settled', 'settled', 'settled'].map(
      (value) => Buffer.from(value),
    );
    let index = 0;
    const settled = await captureStable(async () => frames[index++]);
    assert.equal(settled.image.toString(), 'settled');
    assert.equal(settled.captures, 6);
    await assert.rejects(
      captureStable(async () => Buffer.from('x'), { settledFrames: 1 }),
      /settledFrames must be an integer of at least 2/,
    );
    await assert.rejects(
      captureStable(async () => Buffer.from('x'), { maxCaptures: 2 }),
      /maxCaptures must be an integer of at least settledFrames/,
    );
  });

  await check('the stable frame of one page ignores the other page', async () => {
    // The capture function only ever sees its own page's frames.
    const own = [Buffer.from('x'), Buffer.from('x'), Buffer.from('x')];
    let index = 0;
    const settled = await captureStable(async () => own[index++]);
    assert.equal(settled.image.toString(), 'x');
    // Its only inputs are this page's capture function and a predicate over two of
    // this page's own frames: no expected image or second page is accepted.
    assert.equal(captureStable.length, 1);
  });

  await check('a one-pixel change within one page keeps it unsettled', async () => {
    const page = await pageWith(
      '<div id="dot" style="position:absolute;left:5px;top:5px;width:1px;height:1px;background:rgb(100,100,100)"></div>',
    );
    // The page changes one pixel by more than the threshold between the first
    // two captures, then stays still: the first frame must not be accepted.
    let captures = 0;
    const unchanged = async (previous, next) => {
      const compared = await comparePngBuffers(browser, previous, next, contract.channelThreshold);
      return compared.changedPixels === 0;
    };
    const settled = await captureStable(
      async () => {
        captures += 1;
        if (captures === 2) {
          await page.evaluate(() => {
            globalThis.document.querySelector('#dot').style.background = 'rgb(140,100,100)';
          });
        }
        return page.screenshot(screenshotOptions);
      },
      { unchanged },
    );
    assert.equal(settled.captures, 4, 'settled only once three captures agree');
  });

  await check('stable but different pages fail', async () => {
    const left = await pageWith('<div style="width:64px;height:64px;background:#fff"></div>');
    const right = await pageWith('<div style="width:64px;height:64px;background:#000"></div>');
    await assert.rejects(
      comparePixels(browser, left, right, evidence, 'negative-different'),
      /pixels differ from the approved reference/,
    );
  });

  await check('a one-pixel difference above the channel threshold fails', async () => {
    assert.equal(contract.channelThreshold, 8, 'inherited threshold unchanged');
    assert.equal(contract.allowedDiffRatio, 0, 'inherited ratio unchanged');
    const pixel = (red) =>
      `<div style="position:absolute;left:10px;top:10px;width:1px;height:1px;background:rgb(${red},100,100)"></div>`;
    const base = await pageWith(pixel(100));
    const nine = await pageWith(pixel(109));
    await assert.rejects(
      comparePixels(browser, base, nine, evidence, 'negative-one-pixel'),
      /: 1 pixels differ from the approved reference/,
    );
    const eight = await pageWith(pixel(108));
    const same = await comparePixels(browser, base, eight, evidence, 'threshold-eight');
    assert.equal(same.changedPixels, 0, 'a difference of exactly 8 stays within the threshold');
  });

  await check('a wrong final value fails the confirmed fill, once', async () => {
    const page = await pageWith(
      `<input id="phone"><script>
        globalThis.__inputs = 0;
        document.querySelector('#phone').addEventListener('input', (event) => {
          globalThis.__inputs += 1;
          event.target.value = event.target.value.slice(0, 4);
        });
      </script>`,
    );
    await assert.rejects(
      fillConfirmed('#phone', '0912 345 678', { errorShown: false, timeout: 500 })(page),
      /#phone: expected value "0912 345 678" with message cleared, page holds .*"value":"0912"/,
    );
    assert.equal(await page.evaluate(() => globalThis.__inputs), 1, 'the fill was not repeated');
  });

  await check('a message that is not removed fails the confirmed fill', async () => {
    const page = await pageWith('<input id="phone"><p id="error-phone">error</p>');
    await assert.rejects(
      fillConfirmed('#phone', '0912345678', { errorShown: false, timeout: 500 })(page),
      /page holds .*"error":true/,
    );
  });

  await check('diagnostic errors cannot hide the primary failure', async () => {
    const logged = [];
    await assert.rejects(
      withFailureEvidence(
        async () => {
          throw new Error('primary: snapshot differs');
        },
        async () => {
          throw new Error('screenshot failed');
        },
        (message) => logged.push(message),
      ),
      /primary: snapshot differs/,
    );
    assert.deepEqual(logged, ['could not keep all failure evidence: screenshot failed']);
  });

  await context.close();
  assert.ok(screenshotOptions.fullPage, 'the shared full-page capture options are used');
  console.log(`Negative regressions passed: ${results.length} cases.\n- ${results.join('\n- ')}`);
} finally {
  await browser.close();
}
