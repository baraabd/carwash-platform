/**
 * Half-open UTC intervals [startsAt, endsAt) and the one operation the
 * capacity projection needs: removing blocked intervals from working ones.
 */
export interface Interval {
  readonly startsAt: Date;
  readonly endsAt: Date;
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.startsAt.getTime() < b.endsAt.getTime() && b.startsAt.getTime() < a.endsAt.getTime();
}

/**
 * `base` minus every interval of `blocked`. The result keeps the order of
 * `base` and never contains an empty piece. Inputs need not be sorted.
 */
export function subtractIntervals<T extends Interval>(
  base: readonly T[],
  blocked: readonly Interval[],
): T[] {
  const cuts = [...blocked].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const out: T[] = [];
  for (const piece of base) {
    let start = piece.startsAt.getTime();
    const end = piece.endsAt.getTime();
    for (const cut of cuts) {
      const cutStart = cut.startsAt.getTime();
      const cutEnd = cut.endsAt.getTime();
      if (cutEnd <= start || cutStart >= end) continue;
      if (cutStart > start) {
        out.push({ ...piece, startsAt: new Date(start), endsAt: new Date(cutStart) });
      }
      start = Math.max(start, cutEnd);
      if (start >= end) break;
    }
    if (start < end) out.push({ ...piece, startsAt: new Date(start), endsAt: new Date(end) });
  }
  return out;
}
