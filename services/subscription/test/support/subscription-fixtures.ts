import type { Clock } from '../../src/ports';

export const ADMIN_SUBJECT = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';
export const SECOND_ADMIN_SUBJECT = '2b3c4d5e-6f7a-4b2c-9d3e-4f5a6b7c8d9e';
export const CUSTOMER_SUBJECT = '3c4d5e6f-7a8b-4c3d-8e4f-5a6b7c8d9e0f';
export const OTHER_CUSTOMER_SUBJECT = '4d5e6f7a-8b9c-4d4e-9f5a-6b7c8d9e0f1a';
export const GUEST_SUBJECT = '5e6f7a8b-9c0d-4e5f-8a6b-7c8d9e0f1a2b';
export const READER_SUBJECT = '6f7a8b9c-0d1e-4f6a-9b7c-8d9e0f1a2b3c';

/** Booking's test service credential (32+ chars); only its digest is configured. */
export const BOOKING_TOKEN = 'booking-test-service-token-0123456789abcdef';
export const DISPATCH_TOKEN = 'dispatch-test-service-token-0123456789abcdef';

export class FixedClock implements Clock {
  constructor(private current: Date) {}
  now(): Date {
    return new Date(this.current.getTime());
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
  set(at: Date): void {
    this.current = new Date(at.getTime());
  }
}

/** Plan terms published by the test admin: a TEST fixture, never owner policy. */
export function termsFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    displayName: 'Monthly exterior care (test plan)',
    price: { currency: 'SYP', amountMinor: '4500000', scale: 2 },
    washUnits: 2,
    periodDays: 30,
    coveredPackageIds: ['exterior', 'interior'],
    available: true,
    ...overrides,
  };
}

export const DAY = 24 * 60 * 60 * 1000;
