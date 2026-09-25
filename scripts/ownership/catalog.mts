import { readFileSync } from 'node:fs';
import path from 'node:path';
import { validateSchema } from './schema.mjs';
export const serviceIds = [
  'identity',
  'customer',
  'vehicle',
  'catalog',
  'pricing',
  'booking',
  'scheduling',
  'dispatch',
  'workforce',
  'billing',
  'wallet',
  'subscription',
  'media',
  'communications',
  'reviews',
  'support',
  'geo',
  'reporting',
  'configuration',
] as const;
export const appAudiences = {
  'customer-web': 'customer',
  'operator-web': 'technician',
  'admin-web': 'admin',
} as const;
export const sharedZones = {
  'event-contracts': 'contracts',
  contracts: 'contracts',
  'api-clients': 'contracts',
  ui: 'ui',
  'design-tokens': 'ui',
  observability: 'technical',
  'service-kit': 'technical',
  'platform-messaging': 'technical',
  'security-kit': 'technical',
  'test-utils': 'test',
  'eslint-config': 'config',
  tsconfig: 'config',
} as const;
export interface WorkspaceDefinition {
  readonly id: string;
  readonly path: string;
  readonly packageName: string;
  readonly owner: string;
}
interface Surface {
  readonly api: { readonly prefix: string };
  readonly events: { readonly published: readonly string[] };
  readonly forbiddenDependencies: readonly string[];
  readonly deployment: { readonly artifact: string };
}
export interface ServiceDefinition extends WorkspaceDefinition, Surface {
  readonly database: string;
  readonly runtimeRole: string;
  readonly migrationRole: string;
  readonly owns: readonly string[];
}
export interface Catalog {
  readonly schemaVersion: 2;
  readonly services: readonly ServiceDefinition[];
  readonly gateway: WorkspaceDefinition & Surface;
  readonly apps: readonly (WorkspaceDefinition & { readonly audience: string })[];
  readonly sharedPackages: readonly (WorkspaceDefinition & {
    readonly zone: string;
    readonly version: string;
  })[];
  readonly legacyPrototypeLocations: readonly { readonly path: string; readonly futureDataOwner: string }[];
}
export interface CatalogResult {
  readonly errors: readonly string[];
  readonly catalog?: Catalog;
}
function sameMembers(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}
export function catalogDefinitions(catalog: Catalog): WorkspaceDefinition[] {
  return [...catalog.services, catalog.gateway, ...catalog.apps, ...catalog.sharedPackages];
}
export function validateCatalogValue(value: unknown, schema: unknown): CatalogResult {
  const errors = validateSchema(schema, value);
  if (errors.length) return { errors };
  // The local schema establishes every structural field used below.
  const catalog = value as Catalog;
  if (
    !sameMembers(
      catalog.services.map((entry) => entry.id),
      serviceIds,
    )
  )
    errors.push('services: expected the 19 F001 data-owner IDs exactly once');
  if (
    !sameMembers(
      catalog.apps.map((entry) => entry.id),
      Object.keys(appAudiences),
    )
  )
    errors.push('apps: expected exactly customer, technician/operator and admin workspaces');
  if (
    !sameMembers(
      catalog.sharedPackages.map((entry) => entry.id),
      Object.keys(sharedZones),
    )
  )
    errors.push('sharedPackages: expected the controlled F001 shared zones exactly once');
  const definitions = catalogDefinitions(catalog);
  const register = (label: string, values: readonly string[]): void => {
    if (new Set(values).size !== values.length) errors.push(`${label}: duplicate ownership allocation`);
  };
  for (const field of ['path', 'packageName', 'owner'] as const)
    register(
      field,
      definitions.map((entry) => entry[field]),
    );
  register(
    'database',
    catalog.services.map((entry) => entry.database),
  );
  register(
    'database roles',
    catalog.services.flatMap((entry) => [entry.runtimeRole, entry.migrationRole]),
  );
  register(
    'data resource',
    catalog.services.flatMap((entry) => entry.owns),
  );
  register(
    'event publisher',
    [...catalog.services, catalog.gateway].flatMap((entry) => entry.events.published),
  );
  register(
    'deployment artifact',
    [...catalog.services, catalog.gateway].map((entry) => entry.deployment.artifact),
  );
  const backendNames = [...catalog.services, catalog.gateway].map((entry) => entry.packageName);
  for (const service of catalog.services) {
    if (
      service.path !== `services/${service.id}` ||
      service.packageName !== `@carwash/${service.id}` ||
      service.owner !== `domain:${service.id}`
    )
      errors.push(`${service.id}: inconsistent canonical owner/path/package`);
    if (
      service.database !== `cw_${service.id}` ||
      service.runtimeRole !== `cw_${service.id}_app` ||
      service.migrationRole !== `cw_${service.id}_migrate`
    )
      errors.push(`${service.id}: noncanonical reserved database identity`);
    if (service.api.prefix !== `/internal/v1/${service.id}`)
      errors.push(`${service.id}: public API namespace belongs to a different owner`);
    if (service.events.published.some((event) => !event.startsWith(`${service.id}.`)))
      errors.push(`${service.id}: cannot publish another owner's events`);
  }
  for (const backend of [...catalog.services, catalog.gateway]) {
    if (
      !sameMembers(
        backend.forbiddenDependencies,
        backendNames.filter((name) => name !== backend.packageName),
      )
    )
      errors.push(`${backend.id}: must forbid every other backend implementation`);
  }
  if (catalog.gateway.events.published.length) errors.push('gateway: may not publish business events');
  for (const app of catalog.apps) {
    const audience = appAudiences[app.id as keyof typeof appAudiences];
    if (
      app.path !== `apps/${app.id}` ||
      app.packageName !== `@carwash/${app.id}` ||
      app.audience !== audience ||
      app.owner !== `experience:${audience}`
    )
      errors.push(`${app.id}: inconsistent app identity/audience`);
  }
  for (const shared of catalog.sharedPackages) {
    if (
      shared.path !== `packages/${shared.id}` ||
      shared.packageName !== `@carwash/${shared.id}` ||
      shared.zone !== sharedZones[shared.id as keyof typeof sharedZones] ||
      shared.owner !== `platform:${shared.id}`
    )
      errors.push(`${shared.id}: inconsistent controlled shared zone`);
  }
  const mandatorySplits: Record<string, string> = {
    vehicles: 'vehicle',
    price_versions: 'pricing',
    quotes: 'pricing',
    reservations: 'scheduling',
    assignments: 'dispatch',
    ledger: 'billing',
    subscriptions: 'subscription',
    entitlement_reservations: 'subscription',
  };
  for (const [resource, id] of Object.entries(mandatorySplits)) {
    if (!catalog.services.some((entry) => entry.id === id && entry.owns.includes(resource)))
      errors.push(`${resource}: must have exactly the F001 owner ${id}`);
  }
  const expectedLegacy = [
    'services/catalog/src/domain/quote.ts:pricing',
    'services/booking/src/domain/lifecycle.ts:booking',
    'services/billing/src/domain/ledger.ts:billing',
  ];
  if (
    !sameMembers(
      catalog.legacyPrototypeLocations.map((entry) => `${entry.path}:${entry.futureDataOwner}`),
      expectedLegacy,
    )
  )
    errors.push('legacyPrototypeLocations: preserve and disclose the three original pure prototypes');
  return errors.length ? { errors } : { errors, catalog };
}
export function readCatalog(root: string): CatalogResult {
  try {
    return validateCatalogValue(
      JSON.parse(readFileSync(path.join(root, 'architecture/service-catalog.json'), 'utf8')),
      JSON.parse(readFileSync(path.join(root, 'architecture/service-catalog.schema.json'), 'utf8')),
    );
  } catch (error) {
    return { errors: [error instanceof Error ? error.message : 'Cannot read catalog/schema'] };
  }
}
