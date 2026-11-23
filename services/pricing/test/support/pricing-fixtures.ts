import type { CurrencyPolicy } from '../../src/domain';
import type { Clock, PolicyProvider } from '../../src/ports';

/**
 * TEST-ONLY policy, catalog and prices. None of these values is an approved
 * currency policy (B-03), rate (B-04) or TTL (B-05); they must never be used
 * to configure a real environment. SYP is used only because pricing.v1 Money
 * has a closed currency list.
 */
export const TEST_POLICY: CurrencyPolicy = {
  revision: 'test-policy-1',
  currency: 'SYP',
  minorUnitExponent: 2,
  maxAmountMinor: 100_000_000_000n,
};
export const TEST_TTL_SECONDS = 900;

export const ADMIN_SUBJECT = '0a0a0a0a-0000-4000-8000-00000000000a';
export const CUSTOMER_SUBJECT = '1c1c1c1c-0000-4000-8000-00000000001c';
export const OTHER_CUSTOMER_SUBJECT = '2d2d2d2d-0000-4000-8000-00000000002d';
export const GUEST_SUBJECT = '3e3e3e3e-0000-4000-8000-00000000003e';

export const DEF = {
  exterior: '11111111-1111-4111-8111-111111111111',
  fullCare: '22222222-2222-4222-8222-222222222222',
  tyreShine: '33333333-3333-4333-8333-333333333333',
  retired: '44444444-4444-4444-8444-444444444444',
  unknown: '55555555-5555-4555-8555-555555555555',
};

export const CUSTOMER = { kind: 'account', subjectId: CUSTOMER_SUBJECT } as const;
export const GUEST = { kind: 'guest', subjectId: GUEST_SUBJECT } as const;

function definition(
  definitionId: string,
  kind: 'PACKAGE' | 'EXTRA',
  code: string,
  vehicleTypes: string[],
  status: 'PUBLISHED' | 'RETIRED' = 'PUBLISHED',
) {
  return {
    definitionId,
    kind,
    code,
    name: { ar: 'اختبار', en: null },
    description: { ar: 'وصف اختبار', en: null },
    durationMinutes: 30,
    vehicleTypes,
    status,
    sortOrder: 0,
    revision: 1,
  };
}

/** A catalog.v1 CatalogV1 body as the Catalog owner publishes it. */
export function catalogBody(catalogRevision = 1): Record<string, unknown> {
  return {
    catalogRevision,
    publishedAt: '2026-10-01T08:00:00.000Z',
    items: [
      definition(DEF.exterior, 'PACKAGE', 'exterior', ['sedan', 'suv']),
      definition(DEF.fullCare, 'PACKAGE', 'full-care', ['sedan', 'suv', 'large', 'pickup']),
      definition(DEF.tyreShine, 'EXTRA', 'tyre-shine', ['sedan', 'suv']),
      definition(DEF.retired, 'EXTRA', 'old-wax', ['sedan'], 'RETIRED'),
    ],
  };
}

export function syp(amountMinor: string) {
  return { currency: 'SYP', amountMinor, scale: 2 };
}

/** A complete PublishPriceBookRequestV1 for catalogBody(). */
export function priceBookRequest(expectedPriceBookRevision = 1): Record<string, unknown> {
  return {
    expectedPriceBookRevision,
    currency: 'SYP',
    entries: [
      { definitionId: DEF.exterior, vehicleType: null, unitPrice: syp('500000') },
      { definitionId: DEF.exterior, vehicleType: 'suv', unitPrice: syp('650000') },
      { definitionId: DEF.fullCare, vehicleType: null, unitPrice: syp('1500000') },
      { definitionId: DEF.tyreShine, vehicleType: null, unitPrice: syp('75000') },
    ],
  };
}

export function quoteRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    beneficiary: CUSTOMER,
    vehicleType: 'suv',
    zoneId: null,
    selections: [
      { definitionId: DEF.exterior, quantity: 1 },
      { definitionId: DEF.tyreShine, quantity: 2 },
    ],
    ...overrides,
  };
}

export class FixedClock implements Clock {
  constructor(private current: Date) {}
  now(): Date {
    return new Date(this.current.getTime());
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export class FixedPolicy implements PolicyProvider {
  policy: CurrencyPolicy | null = TEST_POLICY;
  ttl: number | null = TEST_TTL_SECONDS;
  currencyPolicy(): CurrencyPolicy | null {
    return this.policy;
  }
  quoteTtlSeconds(): number | null {
    return this.ttl;
  }
}
