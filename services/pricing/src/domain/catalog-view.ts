/**
 * Pricing's own minimal view of ONE published Catalog revision (catalog.v1
 * `GET /definitions`): only the fields needed to validate a price book and a
 * quote selection. Names, descriptions and sort order are Catalog's business
 * and are deliberately not copied.
 *
 * The view is obtained through a port from the Catalog OWNER API (never its
 * database or code) and stored immutably with the price book it validated, so
 * issuing a quote never needs a synchronous call to Catalog.
 */
export const VEHICLE_TYPES = ['sedan', 'suv', 'large', 'pickup'] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const DEFINITION_KINDS = ['PACKAGE', 'EXTRA'] as const;
export type DefinitionKind = (typeof DEFINITION_KINDS)[number];

export const DEFINITION_STATUSES = ['PUBLISHED', 'RETIRED'] as const;
export type DefinitionStatus = (typeof DEFINITION_STATUSES)[number];

export interface CatalogDefinition {
  readonly definitionId: string;
  readonly kind: DefinitionKind;
  readonly durationMinutes: number;
  readonly vehicleTypes: readonly VehicleType[];
  readonly status: DefinitionStatus;
}

export interface CatalogView {
  readonly catalogRevision: number;
  readonly publishedAt: Date;
  /** Sorted by definitionId so the stored form and its fingerprint are canonical. */
  readonly definitions: readonly CatalogDefinition[];
}

export function isVehicleType(value: unknown): value is VehicleType {
  return VEHICLE_TYPES.some((type) => type === value);
}

export function definitionOf(
  view: CatalogView,
  definitionId: string,
): CatalogDefinition | undefined {
  return view.definitions.find((d) => d.definitionId === definitionId);
}

/** Canonical (sorted, copied) form used for storage and fingerprints. */
export function canonicalCatalogView(view: CatalogView): CatalogView {
  return {
    catalogRevision: view.catalogRevision,
    publishedAt: new Date(view.publishedAt.getTime()),
    definitions: [...view.definitions]
      .map((d) => ({
        definitionId: d.definitionId,
        kind: d.kind,
        durationMinutes: d.durationMinutes,
        vehicleTypes: [...d.vehicleTypes].sort(),
        status: d.status,
      }))
      .sort((a, b) =>
        a.definitionId < b.definitionId ? -1 : a.definitionId > b.definitionId ? 1 : 0,
      ),
  };
}
