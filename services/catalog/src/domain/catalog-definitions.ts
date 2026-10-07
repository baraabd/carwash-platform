/**
 * Catalog definitions: vehicle categories, wash packages and add-ons with their
 * durations and explicit compatibility relations.
 *
 * Catalog never owns money. A definition snapshot carries no amount, so a price
 * can only come from Pricing against an exact catalog revision.
 *
 * `normalizeDefinitions` is the single entry point for untrusted input. It
 * rejects unknown fields instead of stripping them, validates every reference
 * and returns a canonical, deterministically ordered snapshot so the same
 * definitions always produce the same fingerprint.
 */

export const DEFINITION_ID = /^[a-z][a-z0-9-]{1,47}$/;

export const LIMITS = {
  categories: 20,
  packages: 50,
  addons: 100,
  features: 10,
  labelLength: 80,
  descriptionLength: 280,
  featureLength: 60,
  packageMinutes: { min: 1, max: 600 },
  addonMinutes: { min: 1, max: 240 },
  categoryExtraMinutes: { min: 0, max: 240 },
  sortOrder: { min: 0, max: 10_000 },
} as const;

export interface VehicleCategoryDefinition {
  readonly id: string;
  readonly labelAr: string;
  readonly labelEn: string | null;
  readonly extraDurationMinutes: number;
  readonly sortOrder: number;
}

export interface AddonDefinition {
  readonly id: string;
  readonly labelAr: string;
  readonly labelEn: string | null;
  readonly durationMinutes: number;
  readonly sortOrder: number;
  readonly allowedCategoryIds: readonly string[];
}

export interface PackageDefinition {
  readonly id: string;
  readonly labelAr: string;
  readonly labelEn: string | null;
  readonly descriptionAr: string | null;
  readonly durationMinutes: number;
  readonly sortOrder: number;
  readonly featuresAr: readonly string[];
  readonly allowedCategoryIds: readonly string[];
  /** Add-ons that are part of the package and never charged separately. */
  readonly includedAddonIds: readonly string[];
  /** Add-ons the customer may choose in addition to the package. */
  readonly optionalAddonIds: readonly string[];
}

export interface CatalogDefinitions {
  readonly categories: readonly VehicleCategoryDefinition[];
  readonly packages: readonly PackageDefinition[];
  readonly addons: readonly AddonDefinition[];
}

/** Structural defects: the request itself is malformed. */
export type DefinitionShapeCode = 'DEFINITIONS_MALFORMED';

/** Semantic defects: well-formed, but the definitions contradict each other. */
export type DefinitionRuleCode =
  | 'DUPLICATE_ID'
  | 'UNKNOWN_REFERENCE'
  | 'ADDON_BOTH_INCLUDED_AND_OPTIONAL'
  | 'INCLUDED_ADDON_CATEGORY_MISMATCH'
  | 'EMPTY_CATEGORY_SET'
  | 'NO_PACKAGES';

export class CatalogDefinitionError extends Error {
  constructor(
    readonly code: DefinitionShapeCode | DefinitionRuleCode,
    readonly path: string,
  ) {
    super(code);
    this.name = 'CatalogDefinitionError';
  }
}

type Json = Record<string, unknown>;

function malformed(path: string): never {
  throw new CatalogDefinitionError('DEFINITIONS_MALFORMED', path);
}

function record(value: unknown, path: string, keys: readonly string[]): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) malformed(path);
  const object = value as Json;
  for (const key of Object.keys(object)) if (!keys.includes(key)) malformed(`${path}.${key}`);
  for (const key of keys) if (!(key in object)) malformed(`${path}.${key}`);
  return object;
}

function list(value: unknown, path: string, max: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length > max) malformed(path);
  return value;
}

function integer(value: unknown, path: string, range: { min: number; max: number }): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) malformed(path);
  if (value < range.min || value > range.max) malformed(path);
  return value;
}

function text(value: unknown, path: string, max: number): string {
  if (typeof value !== 'string') malformed(path);
  const normalized = value.normalize('NFC');
  // Labels are shown verbatim; surrounding whitespace or control characters
  // would make two visually equal definitions fingerprint differently.
  if (normalized.length < 1 || normalized.length > max || normalized.trim() !== normalized)
    malformed(path);
  if (/\p{Cc}/u.test(normalized)) malformed(path);
  return normalized;
}

function optionalText(value: unknown, path: string, max: number): string | null {
  return value === null ? null : text(value, path, max);
}

function id(value: unknown, path: string): string {
  if (typeof value !== 'string' || !DEFINITION_ID.test(value)) malformed(path);
  return value;
}

function idSet(value: unknown, path: string, max: number): string[] {
  const ids = list(value, path, max).map((entry, index) => id(entry, `${path}[${index}]`));
  if (new Set(ids).size !== ids.length) throw new CatalogDefinitionError('DUPLICATE_ID', path);
  return ids.sort();
}

function bySortOrder<T extends { readonly sortOrder: number; readonly id: string }>(
  a: T,
  b: T,
): number {
  return a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function uniqueIds(items: readonly { readonly id: string }[], path: string): Set<string> {
  const ids = new Set<string>();
  for (const [index, item] of items.entries()) {
    if (ids.has(item.id)) throw new CatalogDefinitionError('DUPLICATE_ID', `${path}[${index}]`);
    ids.add(item.id);
  }
  return ids;
}

function references(ids: readonly string[], known: Set<string>, path: string): void {
  for (const value of ids)
    if (!known.has(value)) throw new CatalogDefinitionError('UNKNOWN_REFERENCE', path);
}

export function normalizeDefinitions(input: unknown): CatalogDefinitions {
  const root = record(input, 'definitions', ['categories', 'packages', 'addons']);

  const categories = list(root.categories, 'categories', LIMITS.categories).map(
    (raw, index): VehicleCategoryDefinition => {
      const path = `categories[${index}]`;
      const c = record(raw, path, [
        'id',
        'labelAr',
        'labelEn',
        'extraDurationMinutes',
        'sortOrder',
      ]);
      return {
        id: id(c.id, `${path}.id`),
        labelAr: text(c.labelAr, `${path}.labelAr`, LIMITS.labelLength),
        labelEn: optionalText(c.labelEn, `${path}.labelEn`, LIMITS.labelLength),
        extraDurationMinutes: integer(
          c.extraDurationMinutes,
          `${path}.extraDurationMinutes`,
          LIMITS.categoryExtraMinutes,
        ),
        sortOrder: integer(c.sortOrder, `${path}.sortOrder`, LIMITS.sortOrder),
      };
    },
  );

  const addons = list(root.addons, 'addons', LIMITS.addons).map((raw, index): AddonDefinition => {
    const path = `addons[${index}]`;
    const a = record(raw, path, [
      'id',
      'labelAr',
      'labelEn',
      'durationMinutes',
      'sortOrder',
      'allowedCategoryIds',
    ]);
    return {
      id: id(a.id, `${path}.id`),
      labelAr: text(a.labelAr, `${path}.labelAr`, LIMITS.labelLength),
      labelEn: optionalText(a.labelEn, `${path}.labelEn`, LIMITS.labelLength),
      durationMinutes: integer(a.durationMinutes, `${path}.durationMinutes`, LIMITS.addonMinutes),
      sortOrder: integer(a.sortOrder, `${path}.sortOrder`, LIMITS.sortOrder),
      allowedCategoryIds: idSet(
        a.allowedCategoryIds,
        `${path}.allowedCategoryIds`,
        LIMITS.categories,
      ),
    };
  });

  const packages = list(root.packages, 'packages', LIMITS.packages).map(
    (raw, index): PackageDefinition => {
      const path = `packages[${index}]`;
      const p = record(raw, path, [
        'id',
        'labelAr',
        'labelEn',
        'descriptionAr',
        'durationMinutes',
        'sortOrder',
        'featuresAr',
        'allowedCategoryIds',
        'includedAddonIds',
        'optionalAddonIds',
      ]);
      return {
        id: id(p.id, `${path}.id`),
        labelAr: text(p.labelAr, `${path}.labelAr`, LIMITS.labelLength),
        labelEn: optionalText(p.labelEn, `${path}.labelEn`, LIMITS.labelLength),
        descriptionAr: optionalText(
          p.descriptionAr,
          `${path}.descriptionAr`,
          LIMITS.descriptionLength,
        ),
        durationMinutes: integer(
          p.durationMinutes,
          `${path}.durationMinutes`,
          LIMITS.packageMinutes,
        ),
        sortOrder: integer(p.sortOrder, `${path}.sortOrder`, LIMITS.sortOrder),
        // Feature order is presentation order and is preserved, not sorted.
        featuresAr: list(p.featuresAr, `${path}.featuresAr`, LIMITS.features).map((f, i) =>
          text(f, `${path}.featuresAr[${i}]`, LIMITS.featureLength),
        ),
        allowedCategoryIds: idSet(
          p.allowedCategoryIds,
          `${path}.allowedCategoryIds`,
          LIMITS.categories,
        ),
        includedAddonIds: idSet(p.includedAddonIds, `${path}.includedAddonIds`, LIMITS.addons),
        optionalAddonIds: idSet(p.optionalAddonIds, `${path}.optionalAddonIds`, LIMITS.addons),
      };
    },
  );

  const categoryIds = uniqueIds(categories, 'categories');
  const addonIds = uniqueIds(addons, 'addons');
  uniqueIds(packages, 'packages');
  if (packages.length === 0) throw new CatalogDefinitionError('NO_PACKAGES', 'packages');

  const addonById = new Map(addons.map((addon) => [addon.id, addon]));
  for (const [index, addon] of addons.entries()) {
    const path = `addons[${index}].allowedCategoryIds`;
    if (addon.allowedCategoryIds.length === 0)
      throw new CatalogDefinitionError('EMPTY_CATEGORY_SET', path);
    references(addon.allowedCategoryIds, categoryIds, path);
  }
  for (const [index, pkg] of packages.entries()) {
    const path = `packages[${index}]`;
    if (pkg.allowedCategoryIds.length === 0)
      throw new CatalogDefinitionError('EMPTY_CATEGORY_SET', `${path}.allowedCategoryIds`);
    references(pkg.allowedCategoryIds, categoryIds, `${path}.allowedCategoryIds`);
    references(pkg.includedAddonIds, addonIds, `${path}.includedAddonIds`);
    references(pkg.optionalAddonIds, addonIds, `${path}.optionalAddonIds`);
    if (pkg.includedAddonIds.some((addon) => pkg.optionalAddonIds.includes(addon)))
      throw new CatalogDefinitionError('ADDON_BOTH_INCLUDED_AND_OPTIONAL', path);
    // An included add-on is delivered on every vehicle the package accepts, so it
    // must itself be allowed for every one of those categories.
    for (const addonId of pkg.includedAddonIds) {
      const allowed = addonById.get(addonId)?.allowedCategoryIds ?? [];
      if (pkg.allowedCategoryIds.some((category) => !allowed.includes(category)))
        throw new CatalogDefinitionError(
          'INCLUDED_ADDON_CATEGORY_MISMATCH',
          `${path}.includedAddonIds`,
        );
    }
  }

  return {
    categories: [...categories].sort(bySortOrder),
    packages: [...packages].sort(bySortOrder),
    addons: [...addons].sort(bySortOrder),
  };
}
