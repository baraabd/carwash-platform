import {
  DEFINITION_KINDS,
  DEFINITION_STATUSES,
  VEHICLE_TYPES,
  normalizeUuid,
  type CatalogDefinition,
  type CatalogView,
  type VehicleType,
} from '../../domain';
import { CatalogUnavailable, type CatalogReader } from '../../ports';
import { boundedText } from '../http/bounded-text';

/**
 * Reads the currently published Catalog through the PUBLISHED catalog.v1
 * `getPublished` route (`GET /internal/v1/catalog/definitions`, access:
 * public). Pricing never reads Catalog's database or imports its code, and
 * forwards no user credential (the route is public).
 *
 * The body is checked against the catalog.v1 CatalogV1 shape (closed keys,
 * revision, UTC instant, unique ids/codes, closed enums); only the fields
 * Pricing needs are kept. A timeout, redirect, non-200, oversize or malformed
 * body is CatalogUnavailable: never a guessed or partial catalog. The call is
 * a safe GET made once per price book publication; it is not retried here (the
 * administrator retries the idempotent publication with the same key).
 */
export const CATALOG_DEFINITIONS_PATH = '/internal/v1/catalog/definitions';
const MAX_RESPONSE_BYTES = 1_048_576;
const MAX_DEFINITIONS = 200;
const MAX_REVISION = 2_147_483_647;
const CODE = /^[a-z][a-z0-9-]{1,39}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DEFINITION_KEYS = [
  'definitionId',
  'kind',
  'code',
  'name',
  'description',
  'durationMinutes',
  'vehicleTypes',
  'status',
  'sortOrder',
  'revision',
]
  .sort()
  .join(',');

export interface CatalogReaderConfig {
  /** null when not configured: price book publication then fails closed. */
  readonly origin: URL | null;
  readonly timeoutMs: number;
}

export function catalogReaderConfigFromEnv(env: NodeJS.ProcessEnv): CatalogReaderConfig {
  const rawTimeout = env.CATALOG_TIMEOUT_MS ?? '2000';
  const timeoutMs = Number(rawTimeout);
  if (!/^[0-9]+$/.test(rawTimeout) || timeoutMs < 100 || timeoutMs > 10_000)
    throw new Error('CATALOG_TIMEOUT_MS_INVALID');
  const raw = env.CATALOG_ORIGIN;
  if (raw === undefined || raw === '') return { origin: null, timeoutMs };
  const origin = new URL(raw);
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname);
  if (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && loopback))
    throw new Error('CATALOG_ORIGIN_HTTPS_REQUIRED');
  if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/')
    throw new Error('CATALOG_ORIGIN_INVALID');
  return { origin, timeoutMs };
}

function isInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function isLocalized(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    Object.keys(v).sort().join(',') === 'ar,en' &&
    typeof v.ar === 'string' &&
    v.ar.length > 0 &&
    (v.en === null || typeof v.en === 'string')
  );
}

function parseDefinition(
  value: unknown,
): { readonly definition: CatalogDefinition; readonly code: string } | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).sort().join(',') !== DEFINITION_KEYS) return null;
  const definitionId = normalizeUuid(v.definitionId);
  const kind = DEFINITION_KINDS.find((k) => k === v.kind);
  const status = DEFINITION_STATUSES.find((s) => s === v.status);
  if (definitionId === null || !kind || !status) return null;
  if (typeof v.code !== 'string' || !CODE.test(v.code)) return null;
  if (!isLocalized(v.name) || !isLocalized(v.description)) return null;
  if (!isInteger(v.durationMinutes, 5, 480) || !isInteger(v.sortOrder, 0, 10_000)) return null;
  if (!isInteger(v.revision, 1, MAX_REVISION)) return null;
  if (!Array.isArray(v.vehicleTypes) || v.vehicleTypes.length === 0) return null;
  const vehicleTypes: VehicleType[] = [];
  for (const entry of v.vehicleTypes) {
    const type = VEHICLE_TYPES.find((t) => t === entry);
    if (!type || vehicleTypes.includes(type)) return null;
    vehicleTypes.push(type);
  }
  return {
    definition: { definitionId, kind, status, durationMinutes: v.durationMinutes, vehicleTypes },
    code: v.code,
  };
}

/** catalog.v1 CatalogV1 -> Pricing's view, or null when the body is not a valid CatalogV1. */
export function parseCatalogV1Body(value: unknown): CatalogView | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).sort().join(',') !== 'catalogRevision,items,publishedAt') return null;
  if (!isInteger(v.catalogRevision, 1, MAX_REVISION)) return null;
  if (typeof v.publishedAt !== 'string' || !UTC.test(v.publishedAt)) return null;
  const publishedAt = new Date(v.publishedAt);
  if (Number.isNaN(publishedAt.getTime()) || publishedAt.toISOString() !== v.publishedAt)
    return null;
  if (!Array.isArray(v.items) || v.items.length > MAX_DEFINITIONS) return null;
  const items = v.items.map(parseDefinition);
  const definitions: CatalogDefinition[] = [];
  const codes = new Set<string>();
  for (const item of items) {
    if (!item || codes.has(item.code)) return null;
    codes.add(item.code);
    definitions.push(item.definition);
  }
  if (new Set(definitions.map((d) => d.definitionId)).size !== definitions.length) return null;
  return { catalogRevision: v.catalogRevision, publishedAt, definitions };
}

export class CatalogV1HttpReader implements CatalogReader {
  constructor(
    private readonly config: CatalogReaderConfig,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async current(correlationId: string): Promise<CatalogView> {
    if (!this.config.origin) throw new CatalogUnavailable();
    let response: Response;
    try {
      response = await this.fetcher(new URL(CATALOG_DEFINITIONS_PATH, this.config.origin), {
        method: 'GET',
        headers: { accept: 'application/json', 'x-correlation-id': correlationId },
        redirect: 'error',
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch {
      throw new CatalogUnavailable();
    }
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new CatalogUnavailable();
    }
    let view: CatalogView | null;
    try {
      const text = await boundedText(response, MAX_RESPONSE_BYTES);
      view = text === null ? null : parseCatalogV1Body(JSON.parse(text));
    } catch {
      view = null;
    }
    if (!view) throw new CatalogUnavailable();
    return view;
  }
}
