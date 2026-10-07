/**
 * Pricing's own minimal view of ONE immutable Catalog revision: only the IDs,
 * durations and compatibility needed to validate rates and selections. It is
 * obtained through a port from the Catalog owner (never from Catalog's
 * database or code) and stored with the price version that was validated
 * against it, so quoting never needs a synchronous call to Catalog.
 */
export interface SnapshotCategory {
  readonly id: string;
  readonly extraDurationMinutes: number;
}

export interface SnapshotPackage {
  readonly id: string;
  readonly durationMinutes: number;
  readonly allowedCategoryIds: readonly string[];
  readonly includedAddonIds: readonly string[];
  readonly optionalAddonIds: readonly string[];
}

export interface SnapshotAddon {
  readonly id: string;
  readonly durationMinutes: number;
  readonly allowedCategoryIds: readonly string[];
}

export interface CatalogSnapshot {
  readonly revision: number;
  readonly effectiveFrom: Date;
  readonly definitionsFingerprint: string;
  readonly categories: readonly SnapshotCategory[];
  readonly packages: readonly SnapshotPackage[];
  readonly addons: readonly SnapshotAddon[];
}

/** Add-ons that can ever be charged: optional for at least one package. */
export function chargeableAddonIds(snapshot: CatalogSnapshot): Set<string> {
  return new Set(snapshot.packages.flatMap((p) => p.optionalAddonIds));
}
