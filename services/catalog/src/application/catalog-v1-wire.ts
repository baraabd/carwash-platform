import {
  DEFINITION_KINDS,
  DEFINITION_STATUSES,
  MAX_DEFINITIONS,
  VEHICLE_TYPES,
  canonicalVehicleTypes,
  type CatalogSnapshot,
  type Definition,
  type DefinitionDraft,
  type LocalizedText,
} from '../domain';

/**
 * catalog.v1 wire shapes, produced and accepted by the owner.
 *
 * Catalog may not depend on @carwash/contracts until Lane E adds it to the
 * lockfile, so the request rules below restate the published
 * `parsePublishCatalogRequestV1` exactly (closed objects, NFC text measured in
 * code points, no control characters, lowercase UUIDs). The provider suite in
 * tests/production/B runs the PUBLISHED parsers against every response and the
 * same request corpus, so any drift fails acceptance.
 *
 * One deliberate superset: `expectedCatalogRevision: 0` is accepted when no
 * catalog exists yet. The published parser requires >= 1, which makes the very
 * first publication unexpressible; contract request CR-B-P06-01 asks E to allow
 * 0. A 0 against an existing catalog is an ordinary REVISION_CONFLICT.
 */

export class WireViolation extends Error {
  constructor(
    readonly code: string,
    readonly path: string,
  ) {
    super(`${code} at ${path}`);
    this.name = 'WireViolation';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODE = /^[a-z][a-z0-9-]{1,39}$/;
const REASON_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
export const MAX_REVISION = 2_147_483_647;

function closed(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new WireViolation('EXPECTED_OBJECT', path);
  const v = value as Record<string, unknown>;
  for (const key of keys)
    if (!Object.hasOwn(v, key)) throw new WireViolation('MISSING_FIELD', `${path}.${key}`);
  for (const key of Object.keys(v))
    if (!keys.includes(key)) throw new WireViolation('UNEXPECTED_FIELD', `${path}.${key}`);
  return v;
}

function uuid(value: unknown, path: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new WireViolation('INVALID_UUID', path);
  return value.toLowerCase();
}

/** C0 controls except TAB/LF/CR, plus DEL. */
function hasControlCharacter(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if ((code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) || code === 0x7f)
      return true;
  }
  return false;
}

function text(value: unknown, path: string, max: number, pattern?: RegExp): string {
  if (typeof value !== 'string') throw new WireViolation('EXPECTED_STRING', path);
  const normalized = value.normalize('NFC');
  const length = [...normalized].length;
  if (length < 1 || length > max) throw new WireViolation('INVALID_LENGTH', path);
  if (hasControlCharacter(normalized)) throw new WireViolation('INVALID_CHARACTERS', path);
  if (pattern && !pattern.test(normalized)) throw new WireViolation('INVALID_FORMAT', path);
  return normalized;
}

function optionalText(value: unknown, path: string, max: number): string | null {
  return value === null || value === undefined ? null : text(value, path, max);
}

function integer(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
    throw new WireViolation('INVALID_INTEGER', path);
  return value;
}

function oneOf<const T extends readonly string[]>(
  value: unknown,
  path: string,
  allowed: T,
): T[number] {
  if (typeof value !== 'string' || !allowed.includes(value))
    throw new WireViolation('INVALID_ENUM', path);
  return value;
}

function list<T>(
  value: unknown,
  path: string,
  max: number,
  item: (entry: unknown, path: string) => T,
): T[] {
  if (!Array.isArray(value)) throw new WireViolation('EXPECTED_ARRAY', path);
  if (value.length > max) throw new WireViolation('TOO_MANY_ITEMS', path);
  return value.map((entry, index) => item(entry, `${path}[${index}]`));
}

function localized(value: unknown, path: string, max: number): LocalizedText {
  const v = closed(value, path, ['ar', 'en']);
  return { ar: text(v.ar, `${path}.ar`, max), en: optionalText(v.en, `${path}.en`, max) };
}

const DRAFT_KEYS = [
  'definitionId',
  'kind',
  'code',
  'name',
  'description',
  'durationMinutes',
  'vehicleTypes',
  'status',
  'sortOrder',
] as const;

function draft(value: unknown, path: string): DefinitionDraft {
  const v = closed(value, path, DRAFT_KEYS);
  const types = list(v.vehicleTypes, `${path}.vehicleTypes`, VEHICLE_TYPES.length, (entry, p) =>
    oneOf(entry, p, VEHICLE_TYPES),
  );
  if (types.length === 0) throw new WireViolation('EMPTY_LIST', `${path}.vehicleTypes`);
  if (new Set(types).size !== types.length)
    throw new WireViolation('DUPLICATE_ITEM', `${path}.vehicleTypes`);
  return {
    definitionId: uuid(v.definitionId, `${path}.definitionId`),
    kind: oneOf(v.kind, `${path}.kind`, DEFINITION_KINDS),
    code: text(v.code, `${path}.code`, 40, CODE),
    name: localized(v.name, `${path}.name`, 80),
    description: localized(v.description, `${path}.description`, 500),
    durationMinutes: integer(v.durationMinutes, `${path}.durationMinutes`, 5, 480),
    vehicleTypes: canonicalVehicleTypes(types),
    status: oneOf(v.status, `${path}.status`, DEFINITION_STATUSES),
    sortOrder: integer(v.sortOrder, `${path}.sortOrder`, 0, 10_000),
  };
}

export interface PublishRequest {
  readonly expectedCatalogRevision: number;
  readonly drafts: readonly DefinitionDraft[];
  readonly reasonCode: string;
}

export function parsePublishRequest(value: unknown): PublishRequest {
  const v = closed(value, '$', ['expectedCatalogRevision', 'definitions', 'reasonCode']);
  const drafts = list(v.definitions, '$.definitions', MAX_DEFINITIONS, draft);
  if (drafts.length === 0) throw new WireViolation('EMPTY_LIST', '$.definitions');
  if (new Set(drafts.map((d) => d.definitionId)).size !== drafts.length)
    throw new WireViolation('DUPLICATE_DEFINITION', '$.definitions');
  if (new Set(drafts.map((d) => d.code)).size !== drafts.length)
    throw new WireViolation('DUPLICATE_CODE', '$.definitions');
  return {
    expectedCatalogRevision: integer(
      v.expectedCatalogRevision,
      '$.expectedCatalogRevision',
      0,
      MAX_REVISION,
    ),
    drafts,
    reasonCode: text(v.reasonCode, '$.reasonCode', 64, REASON_CODE),
  };
}

/** Accepts the UUID spellings the contract accepts; returns the lowercase form. */
export function parseDefinitionId(value: string): string | null {
  return UUID.test(value) ? value.toLowerCase() : null;
}

/** catalog.v1 DefinitionV1. */
export interface DefinitionView {
  readonly definitionId: string;
  readonly revision: number;
  readonly kind: Definition['kind'];
  readonly code: string;
  readonly name: LocalizedText;
  readonly description: LocalizedText;
  readonly durationMinutes: number;
  readonly vehicleTypes: readonly Definition['vehicleTypes'][number][];
  readonly status: Definition['status'];
  readonly sortOrder: number;
}

/** catalog.v1 CatalogV1. */
export interface CatalogView {
  readonly catalogRevision: number;
  readonly publishedAt: string;
  readonly items: readonly DefinitionView[];
}

export function definitionView(d: Definition): DefinitionView {
  return {
    definitionId: d.definitionId,
    revision: d.revision,
    kind: d.kind,
    code: d.code,
    name: { ar: d.name.ar, en: d.name.en },
    description: { ar: d.description.ar, en: d.description.en },
    durationMinutes: d.durationMinutes,
    vehicleTypes: [...d.vehicleTypes],
    status: d.status,
    sortOrder: d.sortOrder,
  };
}

export function catalogView(snapshot: CatalogSnapshot): CatalogView {
  return {
    catalogRevision: snapshot.catalogRevision,
    publishedAt: snapshot.publishedAt.toISOString(),
    items: snapshot.items.map(definitionView),
  };
}
