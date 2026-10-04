// Bounded stable capture for full-page parity screenshots.
//
// Evidence (PR #36, stability batch run 37110056565): after the C008 zoom, pan
// and tap, the approved reference's FIRST full-page capture sometimes differed
// from its own second capture by one comparator-classified pixel, while captures
// two to four matched the candidate exactly. The page itself was not yet settled
// when it was first captured.
//
// Evidence (main push run 37127326124, C011 job, `sheet-map-zoomed-panned-tapped@768`):
// two consecutive reference captures held that same transient pixel (255,255,255
// instead of 246,249,247 at the pin edge), so "two equal captures" accepted it. The
// stability batch of that run (repeat 18) also shows the reference deviating for one
// capture AFTER two equal captures. The candidate never showed the transient. The
// cause is not proven; the supported hypothesis is compositor re-rasterisation of the
// scaled `will-change: transform` map layer in the reference page.
//
// This helper waits for a page to settle by its own output only:
//
// - it captures one page repeatedly and returns the last of the first run of
//   `settledFrames` consecutive captures that the `unchanged(previous, next)`
//   predicate accepts as equal (the harness uses the unchanged F010 comparator:
//   zero classified pixels);
// - it never looks at the other page or at an expected image, so it cannot pick
//   a frame because it matches;
// - it is bounded: a page that does not settle within `maxCaptures` fails.
//
// The returned frames are then compared once with the unchanged strict
// comparator. Stable but different pages still fail.

export const DEFAULT_MAX_CAPTURES = 8;
/** Consecutive equal captures a page must produce before it counts as settled. */
export const DEFAULT_SETTLED_FRAMES = 3;

/** Byte equality: the strictest possible "unchanged". */
export const sameBytes = async (previous, next) =>
  Buffer.isBuffer(previous) && Buffer.isBuffer(next) && previous.equals(next);

/**
 * @param {() => Promise<Buffer>} capture takes one capture of ONE page
 * @param {{ unchanged?: (previous: Buffer, next: Buffer) => Promise<boolean>, maxCaptures?: number, settledFrames?: number }} [options]
 * @returns {Promise<{ image: Buffer, captures: number }>}
 */
export async function captureStable(
  capture,
  {
    unchanged = sameBytes,
    maxCaptures = DEFAULT_MAX_CAPTURES,
    settledFrames = DEFAULT_SETTLED_FRAMES,
  } = {},
) {
  if (!Number.isSafeInteger(settledFrames) || settledFrames < 2) {
    throw new TypeError('settledFrames must be an integer of at least 2');
  }
  if (!Number.isSafeInteger(maxCaptures) || maxCaptures < settledFrames) {
    throw new TypeError('maxCaptures must be an integer of at least settledFrames');
  }
  let previous = await capture();
  let run = 1;
  for (let count = 2; count <= maxCaptures; count += 1) {
    const next = await capture();
    run = (await unchanged(previous, next)) ? run + 1 : 1;
    if (run >= settledFrames) return { image: next, captures: count };
    previous = next;
  }
  throw new Error(
    `page did not settle: no ${settledFrames} consecutive captures matched in ${maxCaptures}`,
  );
}
