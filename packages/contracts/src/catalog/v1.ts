import type { OwnerContract } from '../common/route';
import { VEHICLE_TYPES, type VehicleType } from '../common/vehicle-type';
import { parseRevision } from '../common/protocol';
import { parseUtc, type UtcTimestamp } from '../common/time';
import {
  ContractViolation,
  closed,
  integer,
  list,
  oneOf,
  optionalText,
  text,
  uuid,
} from '../common/wire';

/**
 * catalog.v1 — owner: Catalog service (Lane B).
 * Package/extra definitions only. Catalog never carries prices; Pricing owns money.
 */
export const CATALOG_V1 = {
  id: 'catalog.v1',
  owner: 'catalog',
  prefix: '/internal/v1/catalog',
  routes: {
    getPublished: { method: 'GET', path: '/definitions', access: 'public' },
    getDefinition: { method: 'GET', path: '/definitions/:definitionId', access: 'public' },
    publish: {
      method: 'POST',
      path: '/publications',
      access: 'permission:catalog.publish',
      idempotent: true,
    },
  },
  reasons: ['DEFINITION_RETIRED', 'DUPLICATE_CODE'],
} as const satisfies OwnerContract;

export { VEHICLE_TYPES, type VehicleType };

export const DEFINITION_KINDS = ['PACKAGE', 'EXTRA'] as const;
export type DefinitionKind = (typeof DEFINITION_KINDS)[number];

const CODE = /^[a-z][a-z0-9-]{1,39}$/;
const REASON_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
export const MAX_DEFINITIONS = 200;

export interface LocalizedTextV1 {
  readonly ar: string;
  readonly en: string | null;
}

export interface DefinitionDraftV1 {
  readonly definitionId: string;
  readonly kind: DefinitionKind;
  readonly code: string;
  readonly name: LocalizedTextV1;
  readonly description: LocalizedTextV1;
  readonly durationMinutes: number;
  readonly vehicleTypes: readonly VehicleType[];
  readonly status: 'PUBLISHED' | 'RETIRED';
  readonly sortOrder: number;
}

export interface DefinitionV1 extends DefinitionDraftV1 {
  readonly revision: number;
}

export interface CatalogV1 {
  readonly catalogRevision: number;
  readonly publishedAt: UtcTimestamp;
  readonly items: readonly DefinitionV1[];
}

export interface PublishCatalogRequestV1 {
  readonly expectedCatalogRevision: number;
  readonly definitions: readonly DefinitionDraftV1[];
  readonly reasonCode: string;
}

function localized(value: unknown, path: string, max: number): LocalizedTextV1 {
  const v = closed(value, path, ['ar', 'en']);
  return {
    ar: text(v.ar, `${path}.ar`, { max }),
    en: optionalText(v.en, `${path}.en`, { max }),
  };
}

function vehicleTypes(value: unknown, path: string): VehicleType[] {
  const types = list(value, path, VEHICLE_TYPES.length, (entry, p) =>
    oneOf(entry, p, VEHICLE_TYPES),
  );
  if (types.length === 0) throw new ContractViolation('EMPTY_LIST', path);
  if (new Set(types).size !== types.length) throw new ContractViolation('DUPLICATE_ITEM', path);
  return types;
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

function draftFields(v: Record<string, unknown>, path: string): DefinitionDraftV1 {
  return {
    definitionId: uuid(v.definitionId, `${path}.definitionId`),
    kind: oneOf(v.kind, `${path}.kind`, DEFINITION_KINDS),
    code: text(v.code, `${path}.code`, { max: 40, pattern: CODE }),
    name: localized(v.name, `${path}.name`, 80),
    description: localized(v.description, `${path}.description`, 500),
    durationMinutes: integer(v.durationMinutes, `${path}.durationMinutes`, 5, 480),
    vehicleTypes: vehicleTypes(v.vehicleTypes, `${path}.vehicleTypes`),
    status: oneOf(v.status, `${path}.status`, ['PUBLISHED', 'RETIRED'] as const),
    sortOrder: integer(v.sortOrder, `${path}.sortOrder`, 0, 10_000),
  };
}

export function parseDefinitionDraftV1(value: unknown, path = '$'): DefinitionDraftV1 {
  return draftFields(closed(value, path, DRAFT_KEYS), path);
}

export function parseDefinitionV1(value: unknown, path = '$'): DefinitionV1 {
  const v = closed(value, path, [...DRAFT_KEYS, 'revision']);
  return { ...draftFields(v, path), revision: parseRevision(v.revision, `${path}.revision`) };
}

function uniqueDefinitions<T extends DefinitionDraftV1>(items: readonly T[], path: string): void {
  if (new Set(items.map((d) => d.definitionId)).size !== items.length) {
    throw new ContractViolation('DUPLICATE_DEFINITION', path);
  }
  if (new Set(items.map((d) => d.code)).size !== items.length) {
    throw new ContractViolation('DUPLICATE_CODE', path);
  }
}

export function parseCatalogV1(value: unknown, path = '$'): CatalogV1 {
  const v = closed(value, path, ['catalogRevision', 'publishedAt', 'items']);
  const items = list(v.items, `${path}.items`, MAX_DEFINITIONS, parseDefinitionV1);
  uniqueDefinitions(items, `${path}.items`);
  return {
    catalogRevision: parseRevision(v.catalogRevision, `${path}.catalogRevision`),
    publishedAt: parseUtc(v.publishedAt, `${path}.publishedAt`),
    items,
  };
}

export function parsePublishCatalogRequestV1(value: unknown): PublishCatalogRequestV1 {
  const v = closed(value, '$', ['expectedCatalogRevision', 'definitions', 'reasonCode']);
  const definitions = list(v.definitions, '$.definitions', MAX_DEFINITIONS, parseDefinitionDraftV1);
  if (definitions.length === 0) throw new ContractViolation('EMPTY_LIST', '$.definitions');
  uniqueDefinitions(definitions, '$.definitions');
  return {
    expectedCatalogRevision: parseRevision(v.expectedCatalogRevision, '$.expectedCatalogRevision'),
    definitions,
    reasonCode: text(v.reasonCode, '$.reasonCode', { max: 64, pattern: REASON_CODE }),
  };
}
