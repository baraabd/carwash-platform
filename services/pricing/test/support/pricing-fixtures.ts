import type { CatalogSnapshot, CurrencyPolicy } from '../../src/domain';
import {
  CatalogUnavailable,
  type CatalogRevisionReader,
  type PolicyProvider,
} from '../../src/ports';

/**
 * TEST-ONLY policy, catalog view and rates. None of these values is an approved
 * currency policy (B-03), rate (B-04) or TTL (B-05); they must never be used to
 * configure a real environment.
 */
export const TEST_POLICY: CurrencyPolicy = {
  revision: 'test-policy-1',
  currency: 'XTS', // ISO 4217 code reserved for testing
  minorUnitExponent: 2,
  maxAmountMinor: 900_000_000_000_000_000n,
};

export const TEST_TTL_SECONDS = 900;

export function snapshotFixture(
  revision = 1,
  effectiveFrom = new Date('2026-01-01T00:00:00.000Z'),
): CatalogSnapshot {
  return {
    revision,
    effectiveFrom,
    definitionsFingerprint: 'a'.repeat(64),
    categories: [
      { id: 'sedan', extraDurationMinutes: 0 },
      { id: 'suv', extraDurationMinutes: 10 },
    ],
    packages: [
      {
        id: 'exterior',
        durationMinutes: 35,
        allowedCategoryIds: ['sedan', 'suv'],
        includedAddonIds: [],
        optionalAddonIds: ['interior-fresh', 'tyre-shine'],
      },
      {
        id: 'full-care',
        durationMinutes: 95,
        allowedCategoryIds: ['sedan', 'suv'],
        includedAddonIds: ['tyre-shine'],
        optionalAddonIds: [],
      },
    ],
    addons: [
      { id: 'interior-fresh', durationMinutes: 5, allowedCategoryIds: ['sedan'] },
      { id: 'tyre-shine', durationMinutes: 10, allowedCategoryIds: ['sedan', 'suv'] },
    ],
  };
}

export function ratesFixture(): { kind: string; definitionId: string; amountMinor: string }[] {
  return [
    { kind: 'PACKAGE', definitionId: 'exterior', amountMinor: '50000' },
    { kind: 'PACKAGE', definitionId: 'full-care', amountMinor: '150000' },
    { kind: 'VEHICLE', definitionId: 'sedan', amountMinor: '0' },
    { kind: 'VEHICLE', definitionId: 'suv', amountMinor: '20000' },
    { kind: 'ADDON', definitionId: 'interior-fresh', amountMinor: '10000' },
    { kind: 'ADDON', definitionId: 'tyre-shine', amountMinor: '15000' },
  ];
}

/** TEST DOUBLE of the Catalog owner read (the production adapter waits for E). */
export class FakeCatalogReader implements CatalogRevisionReader {
  readonly snapshots = new Map<number, CatalogSnapshot>();
  down = false;
  read(revision: number): Promise<CatalogSnapshot | null> {
    if (this.down) return Promise.reject(new CatalogUnavailable());
    return Promise.resolve(this.snapshots.get(revision) ?? null);
  }
}

export class FixedPolicy implements PolicyProvider {
  constructor(
    public policy: CurrencyPolicy | null = TEST_POLICY,
    public ttl: number | null = TEST_TTL_SECONDS,
  ) {}
  currencyPolicy(): CurrencyPolicy | null {
    return this.policy;
  }
  quoteTtlSeconds(): number | null {
    return this.ttl;
  }
}

export class FixedClock {
  constructor(public current: Date) {}
  now(): Date {
    return new Date(this.current.getTime());
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export const ADMIN_SUBJECT = '1d8b2c4e-5f60-4a7b-8c9d-0e1f2a3b4c5d';
export const CUSTOMER_SUBJECT = '2e9c3d5f-6071-4b8c-9dae-1f2a3b4c5d6e';
export const OTHER_CUSTOMER_SUBJECT = '4a0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d';
