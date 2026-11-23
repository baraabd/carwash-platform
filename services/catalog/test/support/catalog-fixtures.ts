/**
 * TEST-ONLY catalog.v1 definitions. The shape mirrors the approved journey
 * (wash packages and extras) but none of these values is an approved business
 * definition and they must never be seeded into a real environment.
 */
export interface WireDefinition {
  definitionId: string;
  kind: 'PACKAGE' | 'EXTRA';
  code: string;
  name: { ar: string; en: string | null };
  description: { ar: string; en: string | null };
  durationMinutes: number;
  vehicleTypes: string[];
  status: 'PUBLISHED' | 'RETIRED';
  sortOrder: number;
}

/** A deterministic v4 UUID per (namespace, n). */
export function fixtureId(n: number, namespace = 0): string {
  const ns = namespace.toString(16).padStart(4, '0');
  return `0000${ns}-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

/** Codes must be unique per test run when the database is shared. */
export function definitionsFixture(namespace = 0, prefix = 'fx'): WireDefinition[] {
  return [
    {
      definitionId: fixtureId(1, namespace),
      kind: 'PACKAGE',
      code: `${prefix}-exterior`,
      name: { ar: 'غسيل خارجي', en: 'Exterior' },
      description: { ar: 'غسيل الهيكل والزجاج', en: null },
      durationMinutes: 35,
      vehicleTypes: ['suv', 'sedan'],
      status: 'PUBLISHED',
      sortOrder: 0,
    },
    {
      definitionId: fixtureId(2, namespace),
      kind: 'PACKAGE',
      code: `${prefix}-full`,
      name: { ar: 'غسيل كامل', en: null },
      description: { ar: 'غسيل داخلي وخارجي', en: 'Interior and exterior' },
      durationMinutes: 90,
      vehicleTypes: ['sedan', 'suv', 'large', 'pickup'],
      status: 'PUBLISHED',
      sortOrder: 1,
    },
    {
      definitionId: fixtureId(3, namespace),
      kind: 'EXTRA',
      code: `${prefix}-tyre-shine`,
      name: { ar: 'تلميع الإطارات', en: null },
      description: { ar: 'تلميع الإطارات الأربعة', en: null },
      durationMinutes: 10,
      vehicleTypes: ['sedan'],
      status: 'PUBLISHED',
      sortOrder: 2,
    },
  ];
}

export function publishBody(
  expectedCatalogRevision: number,
  definitions: WireDefinition[],
  reasonCode = 'INITIAL_PUBLICATION',
): Record<string, unknown> {
  return { expectedCatalogRevision, definitions, reasonCode };
}

export const ADMIN_SUBJECT = '1d8b2c4e-5f60-4a7b-8c9d-0e1f2a3b4c5d';
export const CUSTOMER_SUBJECT = '2e9c3d5f-6071-4b8c-9dae-1f2a3b4c5d6e';
export const OTHER_ADMIN_SUBJECT = '3fad4e60-7182-4c9d-aebf-2a3b4c5d6e7f';
