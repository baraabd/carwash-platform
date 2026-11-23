import { createHash } from 'node:crypto';
import { WorkforceError } from '../domain';

/**
 * Opaque keyset cursor for listCapacityResources.
 *
 * Content: the last returned operator id (keyset position, so concurrent
 * inserts or removals never duplicate or skip an existing resource) and a
 * short digest of the query it belongs to (zone and window), so a cursor can
 * never be replayed against another query. `limit` may change between pages.
 * Encoding: base64url of a closed JSON object; only the canonical encoding of
 * a well-formed cursor is accepted. Clients never construct or inspect it.
 */
const CURSOR_VERSION = 1;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SCOPE = /^[0-9a-f]{16}$/;

export function cursorScope(query: {
  readonly zoneId: string;
  readonly from: Date;
  readonly to: Date;
}): string {
  return createHash('sha256')
    .update(`${query.zoneId}|${query.from.toISOString()}|${query.to.toISOString()}`, 'utf8')
    .digest('hex')
    .slice(0, 16);
}

export function encodeCursor(scope: string, afterOperatorId: string): string {
  if (!SCOPE.test(scope) || !UUID.test(afterOperatorId)) throw new Error('INVALID_CURSOR_STATE');
  return Buffer.from(
    JSON.stringify({ v: CURSOR_VERSION, s: scope, a: afterOperatorId }),
    'utf8',
  ).toString('base64url');
}

function rejected(): never {
  throw new WorkforceError('INVALID_CURSOR', 'The cursor does not belong to this query.');
}

/** Returns the keyset position, or refuses the cursor with INVALID_CURSOR. */
export function decodeCursor(cursor: string, scope: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    return rejected();
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return rejected();
  const keys = Object.keys(parsed).sort();
  if (keys.join(',') !== 'a,s,v') return rejected();
  const v: unknown = Reflect.get(parsed, 'v');
  const s: unknown = Reflect.get(parsed, 's');
  const a: unknown = Reflect.get(parsed, 'a');
  if (v !== CURSOR_VERSION || s !== scope || typeof a !== 'string' || !UUID.test(a)) {
    return rejected();
  }
  // Only the exact encoding this service issues is accepted.
  if (encodeCursor(scope, a) !== cursor) return rejected();
  return a;
}
