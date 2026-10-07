/** node:test's spec footer must describe a nonempty, complete successful run. */
export function testResults(output, code, signal) {
  const counts = Object.fromEntries(
    ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map((name) => {
      const matches = [...output.matchAll(new RegExp(`^ℹ ${name} (\\d+)$`, 'gm'))];
      return [name, matches.length === 1 ? Number(matches[0][1]) : null];
    }),
  );
  const accepted =
    code === 0 &&
    !signal &&
    Object.values(counts).every(Number.isSafeInteger) &&
    counts.tests > 0 &&
    counts.pass === counts.tests &&
    ['fail', 'cancelled', 'skipped', 'todo'].every((name) => counts[name] === 0);
  return { ...counts, accepted };
}
