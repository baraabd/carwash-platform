import { invalid, isUuid } from '../domain';
import type { BookingCursor } from '../ports';

/** Bounded keyset pagination; a cursor never supplies an owner or changes the authorization filter. */
export function bookingListQuery(raw: Readonly<Record<string, unknown>>): {
  readonly limit: number;
  readonly after: BookingCursor | null;
} {
  if (Object.keys(raw).some((name) => name !== 'limit' && name !== 'cursor'))
    throw invalid('Unknown booking list parameter.');
  const limit =
    raw.limit === undefined
      ? 20
      : typeof raw.limit === 'string' && /^[1-9][0-9]{0,2}$/.test(raw.limit)
        ? Number(raw.limit)
        : NaN;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw invalid('Invalid page size.');
  if (raw.cursor === undefined) return { limit, after: null };
  if (typeof raw.cursor !== 'string' || !/^[A-Za-z0-9_-]{8,200}$/.test(raw.cursor))
    throw invalid('Invalid page cursor.');
  try {
    const decoded = Buffer.from(raw.cursor, 'base64url');
    if (decoded.toString('base64url') !== raw.cursor) throw new Error('noncanonical');
    const value = JSON.parse(decoded.toString('utf8')) as Record<string, unknown>;
    if (
      !value ||
      Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'createdAt,id' ||
      typeof value.createdAt !== 'string' ||
      typeof value.id !== 'string' ||
      !isUuid(value.id)
    )
      throw new Error('shape');
    const createdAt = new Date(value.createdAt);
    if (createdAt.toISOString() !== value.createdAt) throw new Error('instant');
    return { limit, after: { createdAt, id: value.id.toLowerCase() } };
  } catch {
    throw invalid('Invalid page cursor.');
  }
}

export function bookingCursor(value: BookingCursor): string {
  return Buffer.from(
    JSON.stringify({ createdAt: value.createdAt.toISOString(), id: value.id }),
  ).toString('base64url');
}
