import {
  DispatchError,
  type CapacityResource,
  type CapacityShift,
  type Eligibility,
  type JobWindow,
} from '../../domain';
import type { WorkforceCapacity } from '../../ports';
import type { ServiceHttp } from '../http/service-http';

/**
 * Consumer of the PUBLISHED workforce.v1 `listCapacityResources`
 * (`GET /internal/v1/workforce/capacity-resources`, `service:workforce.capacity.read`).
 *
 * `@carwash/contracts` is not a declared dependency of this service (the
 * lockfile is Lane E's), so the page and item parsers below are local closed
 * mirrors of `parsePage` / `parseCapacityResourceV1`; their parity with the
 * published parsers is asserted by tests/production/C/dispatch-workforce-contract.test.mjs.
 * Anything the published parser would reject is treated as UNAVAILABLE.
 */
const PATH = '/internal/v1/workforce/capacity-resources';
const PAGE_LIMIT = 100;
/** Bounded scan: at most this many pages per lookup (10 000 resources). */
const MAX_PAGES = 100;
const MAX_ZONES = 20;
const MAX_SHIFTS = 100;
const MAX_REVISION = 2_147_483_647;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const CURSOR = /^[A-Za-z0-9_-]{1,512}$/;

class Malformed extends Error {}

function closed(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Malformed();
  const record = value as Record<string, unknown>;
  const present = Object.keys(record);
  if (present.length !== keys.length || !keys.every((key) => present.includes(key))) {
    throw new Malformed();
  }
  return record;
}

function utc(value: unknown): Date {
  if (typeof value !== 'string' || !UTC.test(value)) throw new Malformed();
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) throw new Malformed();
  return date;
}

function uuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new Malformed();
  return value.toLowerCase();
}

function revisionOf(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAX_REVISION
  ) {
    throw new Malformed();
  }
  return value;
}

function list<T>(value: unknown, max: number, item: (entry: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > max) throw new Malformed();
  return value.map(item);
}

export function parseCapacityResource(value: unknown): CapacityResource {
  const v = closed(value, [
    'resourceId',
    'revision',
    'eligibility',
    'eligibilityRevision',
    'zoneIds',
    'shifts',
  ]);
  const zoneIds = list(v.zoneIds, MAX_ZONES, uuid);
  if (zoneIds.length === 0 || new Set(zoneIds).size !== zoneIds.length) throw new Malformed();
  const shifts = list(v.shifts, MAX_SHIFTS, (entry): CapacityShift => {
    const s = closed(entry, ['startsAt', 'endsAt']);
    const startsAt = utc(s.startsAt);
    const endsAt = utc(s.endsAt);
    if (endsAt.getTime() <= startsAt.getTime()) throw new Malformed();
    return { startsAt, endsAt };
  });
  for (let i = 1; i < shifts.length; i += 1) {
    const previous = shifts[i - 1];
    const current = shifts[i];
    if (previous && current && current.startsAt.getTime() < previous.endsAt.getTime()) {
      throw new Malformed();
    }
  }
  const eligibility: Eligibility =
    v.eligibility === 'ELIGIBLE'
      ? 'ELIGIBLE'
      : v.eligibility === 'INELIGIBLE'
        ? 'INELIGIBLE'
        : (() => {
            throw new Malformed();
          })();
  return {
    resourceId: uuid(v.resourceId),
    revision: revisionOf(v.revision),
    eligibility,
    eligibilityRevision: revisionOf(v.eligibilityRevision),
    zoneIds,
    shifts,
  };
}

export function parseCapacityPage(value: unknown): {
  readonly items: CapacityResource[];
  readonly nextCursor: string | null;
} {
  const v = closed(value, ['items', 'nextCursor', 'asOf']);
  utc(v.asOf);
  const items = list(v.items, PAGE_LIMIT, parseCapacityResource);
  if (v.nextCursor !== null && (typeof v.nextCursor !== 'string' || !CURSOR.test(v.nextCursor))) {
    throw new Malformed();
  }
  return { items, nextCursor: v.nextCursor };
}

export class WorkforceCapacityClient implements WorkforceCapacity {
  constructor(private readonly http: ServiceHttp) {}

  async findResource(
    job: JobWindow,
    resourceId: string,
    correlationId: string,
  ): Promise<CapacityResource | null> {
    let cursor: string | null = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const query = new URLSearchParams({
        zoneId: job.zoneId,
        from: job.startsAt.toISOString(),
        to: job.endsAt.toISOString(),
        limit: String(PAGE_LIMIT),
        ...(cursor === null ? {} : { cursor }),
      });
      const outcome = await this.http.request('GET', `${PATH}?${query.toString()}`, correlationId);
      if (outcome.kind !== 'ok') throw unavailable();
      let parsed: ReturnType<typeof parseCapacityPage>;
      try {
        parsed = parseCapacityPage(outcome.body);
      } catch {
        throw unavailable();
      }
      const found = parsed.items.find((item) => item.resourceId === resourceId);
      if (found) return found;
      if (parsed.nextCursor === null) return null;
      cursor = parsed.nextCursor;
    }
    // Not seen within the bounded scan: unknown, never "not eligible" by guess.
    throw unavailable();
  }
}

function unavailable(): DispatchError {
  return new DispatchError('ELIGIBILITY_UNAVAILABLE', 'Workforce eligibility is unavailable.');
}
