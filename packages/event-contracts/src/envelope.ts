/**
 * Shared structural rules for every versioned external event contract.
 *
 * Structural validation is NOT authentication and NOT authorization.
 * Producer identity is established by the broker ACL, never by the `producer`
 * field inside the payload.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CANONICAL_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function asObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('EXPECTED_OBJECT');
  }
  return value as Record<string, unknown>;
}

export function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) {
    throw new Error('UNEXPECTED_EVENT_FIELDS');
  }
}

export function asUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error('INVALID_UUID');
  return value;
}

export function asCanonicalUtc(value: unknown): string {
  if (typeof value !== 'string' || !CANONICAL_UTC.test(value)) throw new Error('INVALID_TIMESTAMP');
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new Error('INVALID_TIMESTAMP');
  }
  return value;
}

export function asAggregateVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error('INVALID_AGGREGATE_VERSION');
  }
  return value;
}
