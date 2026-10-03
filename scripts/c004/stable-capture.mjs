// Bounded stable capture for full-page parity screenshots.
//
// Evidence (PR #36, stability batch run 37110056565): after the C008 zoom, pan
// and tap, the approved reference's FIRST full-page capture sometimes differed
// from its own second capture by one comparator-classified pixel, while captures
// two to four matched the candidate exactly. The page itself was not yet settled
// when it was first captured. This helper waits for a page to settle by its own
// output only:
//
// - it captures one page repeatedly and returns the first capture that the
//   `unchanged(previous, next)` predicate accepts as equal to the capture before
//   it (the harness uses the unchanged F010 comparator: zero classified pixels);
// - it never looks at the other page or at an expected image, so it cannot pick
//   a frame because it matches;
// - it is bounded: a page that does not settle within `maxCaptures` fails.
//
// The returned frames are then compared once with the unchanged strict
// comparator. Stable but different pages still fail.

export const DEFAULT_MAX_CAPTURES = 6;

/** Byte equality: the strictest possible "unchanged". */
export const sameBytes = async (previous, next) =>
  Buffer.isBuffer(previous) && Buffer.isBuffer(next) && previous.equals(next);

/**
 * @param {() => Promise<Buffer>} capture takes one capture of ONE page
 * @param {{ unchanged?: (previous: Buffer, next: Buffer) => Promise<boolean>, maxCaptures?: number }} [options]
 * @returns {Promise<{ image: Buffer, captures: number }>}
 */
export async function captureStable(
  capture,
  { unchanged = sameBytes, maxCaptures = DEFAULT_MAX_CAPTURES } = {},
) {
  if (!Number.isSafeInteger(maxCaptures) || maxCaptures < 2) {
    throw new TypeError('maxCaptures must be an integer of at least 2');
  }
  let previous = await capture();
  for (let count = 2; count <= maxCaptures; count += 1) {
    const next = await capture();
    if (await unchanged(previous, next)) return { image: next, captures: count };
    previous = next;
  }
  throw new Error(`page did not settle: no two consecutive captures matched in ${maxCaptures}`);
}
