// Input helpers for the C011 browser acceptance. No side effects on import.
//
// Evidence (PR #36, stability batch run 37110056565): on the Linux runner, when
// the refused Next's message is already shown, the approved reference has not
// yet moved focus to the first invalid field — it does that in a later animation
// frame (`requestAnimationFrame(... el.focus())` in validate()). A fill that
// starts before that frame races the reference's own focus move: if the focus
// lands between the fill focusing the number field and inserting its text, the
// text goes into the name field and the number keeps its error — which matches
// the failure of run 37105992192 attempt 1. The helpers below remove the race
// and make any misdirected input fail loudly instead of comparing a wrong state.

/** The field's live value (property, not attribute), message state and focus. */
export const fieldState = (page, selector) =>
  page.evaluate((target) => {
    const input = globalThis.document.querySelector(target);
    return {
      value: input?.value ?? null,
      error: input ? globalThis.document.querySelector(`#error-${input.id}`) !== null : null,
      focused: globalThis.document.activeElement === input,
    };
  }, selector);

/** Resolves once the page has moved focus to the element with this id. */
export const focusLanded = (page, id, timeout = 5000) =>
  page.waitForFunction((target) => globalThis.document.activeElement?.id === target, id, {
    timeout,
  });

/**
 * Fills a field ONCE, then requires the expected value and message state. A
 * failed fill is never repeated: the mismatch is reported with what the page
 * actually holds.
 */
export const fillConfirmed =
  (selector, value, { errorShown, timeout = 5000 }) =>
  async (page) => {
    await page.locator(selector).fill(value);
    try {
      await page.waitForFunction(
        ({ target, expected, shown }) => {
          const input = globalThis.document.querySelector(target);
          const hasError = globalThis.document.querySelector(`#error-${input?.id}`) !== null;
          return input?.value === expected && hasError === shown;
        },
        { target: selector, expected: value, shown: errorShown },
        { timeout },
      );
    } catch {
      const actual = await fieldState(page, selector);
      throw new Error(
        `${selector}: expected value ${JSON.stringify(value)} with message ${errorShown ? 'shown' : 'cleared'}, page holds ${JSON.stringify(actual)}`,
      );
    }
  };

/** Requires the demo values in the live fields; a timeout is an error, not ignored. */
export const demoFilled = (page, timeout = 5000) =>
  page.waitForFunction(
    () =>
      globalThis.document.querySelector('#name')?.value === 'سامر التجريبي' &&
      globalThis.document.querySelector('#phone')?.value === '0900000000',
    undefined,
    { timeout },
  );

/**
 * Runs `check`; if it fails, runs `keepEvidence` and rethrows the ORIGINAL
 * failure. An error while keeping evidence is logged and never replaces it.
 */
export async function withFailureEvidence(check, keepEvidence, log = console.error) {
  try {
    return await check();
  } catch (failure) {
    try {
      await keepEvidence();
    } catch (diagnosticError) {
      log(`could not keep all failure evidence: ${diagnosticError.message}`);
    }
    throw failure;
  }
}
