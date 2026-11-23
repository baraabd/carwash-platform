/**
 * Catalog definitions as published by catalog.v1: wash packages and extras with
 * their duration and eligible vehicle types. Catalog never owns money; a price
 * only ever comes from Pricing against an exact catalog revision.
 *
 * A catalog revision is a COMPLETE, immutable snapshot. Every definition ever
 * published stays in every later snapshot (retired ones with status RETIRED),
 * so a quote or booking that pinned a definition can always resolve it, and a
 * definition can disappear only through an explicit, audited retirement.
 *
 * Identity rules (also enforced by the database):
 *  - a definitionId keeps its kind and code forever;
 *  - a code is never reused by another definitionId, even after retirement;
 *  - retirement is final: a RETIRED definition never returns to PUBLISHED
 *    (re-offering a service means publishing a new definitionId).
 *
 * Each definition carries its own content `revision`: 1 when first published,
 * +1 whenever any of its published fields change, unchanged otherwise.
 */

export const VEHICLE_TYPES = ['sedan', 'suv', 'large', 'pickup'] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const DEFINITION_KINDS = ['PACKAGE', 'EXTRA'] as const;
export type DefinitionKind = (typeof DEFINITION_KINDS)[number];

export const DEFINITION_STATUSES = ['PUBLISHED', 'RETIRED'] as const;
export type DefinitionStatus = (typeof DEFINITION_STATUSES)[number];

/** catalog.v1 MAX_DEFINITIONS: the whole snapshot, retired definitions included. */
export const MAX_DEFINITIONS = 200;

export interface LocalizedText {
  readonly ar: string;
  readonly en: string | null;
}

export interface DefinitionDraft {
  readonly definitionId: string;
  readonly kind: DefinitionKind;
  readonly code: string;
  readonly name: LocalizedText;
  readonly description: LocalizedText;
  readonly durationMinutes: number;
  /** Canonical order (VEHICLE_TYPES order), so equal sets compare equal. */
  readonly vehicleTypes: readonly VehicleType[];
  readonly status: DefinitionStatus;
  readonly sortOrder: number;
}

export interface Definition extends DefinitionDraft {
  readonly revision: number;
}

export interface CatalogSnapshot {
  readonly catalogRevision: number;
  readonly publishedAt: Date;
  /** Ordered by sortOrder, then definitionId. */
  readonly items: readonly Definition[];
}

/** Rule violations a well-formed publication can still commit. */
export type PublicationRejection =
  /** expectedCatalogRevision is not the current head. */
  | 'REVISION_CONFLICT'
  /** A retired definition was republished, or a new one introduced as retired. */
  | 'DEFINITION_RETIRED'
  /** A new definitionId uses a code another definition already holds. */
  | 'DUPLICATE_CODE'
  /** A definition of the current snapshot is absent from the publication. */
  | 'DEFINITION_MISSING'
  /** An existing definitionId changed its kind or its code. */
  | 'DEFINITION_IDENTITY_CHANGED'
  /** Nothing differs from the current snapshot. */
  | 'NO_CHANGES';

export interface Rejection {
  readonly accepted: false;
  readonly reason: PublicationRejection;
  /** Request path of the offending element, e.g. "$.definitions[2]". */
  readonly field: string;
}

export interface Acceptance {
  readonly accepted: true;
  readonly catalogRevision: number;
  readonly items: readonly Definition[];
  /** Definitions that are new or whose content changed, sorted. */
  readonly changedDefinitionIds: readonly string[];
  /** Definitions first published in this revision, sorted. */
  readonly createdDefinitionIds: readonly string[];
}

export type PublicationPlan = Acceptance | Rejection;

export function canonicalVehicleTypes(types: readonly VehicleType[]): VehicleType[] {
  return VEHICLE_TYPES.filter((type) => types.includes(type));
}

function byOrder(a: DefinitionDraft, b: DefinitionDraft): number {
  return (
    a.sortOrder - b.sortOrder ||
    (a.definitionId < b.definitionId ? -1 : a.definitionId > b.definitionId ? 1 : 0)
  );
}

export function orderDefinitions<T extends DefinitionDraft>(items: readonly T[]): T[] {
  return [...items].sort(byOrder);
}

function sameContent(a: DefinitionDraft, b: DefinitionDraft): boolean {
  return (
    a.kind === b.kind &&
    a.code === b.code &&
    a.name.ar === b.name.ar &&
    a.name.en === b.name.en &&
    a.description.ar === b.description.ar &&
    a.description.en === b.description.en &&
    a.durationMinutes === b.durationMinutes &&
    a.vehicleTypes.length === b.vehicleTypes.length &&
    a.vehicleTypes.every((type, index) => b.vehicleTypes[index] === type) &&
    a.status === b.status &&
    a.sortOrder === b.sortOrder
  );
}

function reject(reason: PublicationRejection, field: string): Rejection {
  return { accepted: false, reason, field };
}

/**
 * Decides the next catalog revision. `drafts` are already structurally valid
 * (closed shape, unique ids and codes inside the request, canonical vehicle
 * type order). Pure: no clock, IO or framework.
 */
export function planPublication(input: {
  readonly current: CatalogSnapshot | null;
  readonly expectedCatalogRevision: number;
  readonly drafts: readonly DefinitionDraft[];
}): PublicationPlan {
  const head = input.current?.catalogRevision ?? 0;
  if (input.expectedCatalogRevision !== head)
    return reject('REVISION_CONFLICT', '$.expectedCatalogRevision');

  const previous = new Map((input.current?.items ?? []).map((d) => [d.definitionId, d]));
  const codes = new Map((input.current?.items ?? []).map((d) => [d.code, d.definitionId]));
  const draftIds = new Set(input.drafts.map((d) => d.definitionId));
  for (const existing of previous.values())
    if (!draftIds.has(existing.definitionId)) return reject('DEFINITION_MISSING', '$.definitions');

  const items: Definition[] = [];
  const changed: string[] = [];
  const created: string[] = [];
  for (const [index, draft] of input.drafts.entries()) {
    const field = `$.definitions[${index}]`;
    const prior = previous.get(draft.definitionId);
    if (!prior) {
      const holder = codes.get(draft.code);
      if (holder !== undefined && holder !== draft.definitionId)
        return reject('DUPLICATE_CODE', `${field}.code`);
      if (draft.status === 'RETIRED') return reject('DEFINITION_RETIRED', `${field}.status`);
      items.push({ ...draft, revision: 1 });
      changed.push(draft.definitionId);
      created.push(draft.definitionId);
      continue;
    }
    if (prior.kind !== draft.kind) return reject('DEFINITION_IDENTITY_CHANGED', `${field}.kind`);
    if (prior.code !== draft.code) return reject('DEFINITION_IDENTITY_CHANGED', `${field}.code`);
    if (prior.status === 'RETIRED' && draft.status === 'PUBLISHED')
      return reject('DEFINITION_RETIRED', `${field}.status`);
    if (sameContent(prior, draft)) {
      items.push({ ...draft, revision: prior.revision });
    } else {
      items.push({ ...draft, revision: prior.revision + 1 });
      changed.push(draft.definitionId);
    }
  }
  if (changed.length === 0) return reject('NO_CHANGES', '$.definitions');
  return {
    accepted: true,
    catalogRevision: head + 1,
    items: orderDefinitions(items),
    changedDefinitionIds: [...changed].sort(),
    createdDefinitionIds: [...created].sort(),
  };
}
