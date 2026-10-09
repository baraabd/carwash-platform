import { randomUUID } from 'node:crypto';
import {
  money,
  type AddressSnapshot,
  type Booking,
  type ContactSnapshot,
  type PrincipalRef,
  type QuoteSnapshot,
  type RequestedSlot,
  type SlotSnapshot,
  type VehicleSnapshot,
} from '../../src/domain';

/**
 * Deterministic builders shared by unit and integration suites. Wire builders
 * produce the PUBLISHED owner shapes (pricing.v1 QuoteV1, scheduling.v1 HoldV1,
 * vehicle.v1 / customer.v1 snapshots); tests/production/C/booking-contract-parity
 * proves they are accepted by the published parsers.
 */
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

export function principal(kind: 'account' | 'guest' = 'account'): PrincipalRef {
  return { kind, subjectId: randomUUID() };
}

export const CONTACT: ContactSnapshot = { name: 'سارة أحمد', phone: '+963912345678', notes: null };

export function quoteWire(input: {
  readonly quoteId?: string;
  readonly beneficiary: PrincipalRef;
  readonly zoneId?: string | null;
  readonly now: Date;
  readonly status?: 'USABLE' | 'EXPIRED' | 'REVOKED';
  readonly revision?: number;
  readonly vehicleType?: 'sedan' | 'suv' | 'large' | 'pickup';
}) {
  return {
    quoteId: input.quoteId ?? randomUUID(),
    revision: input.revision ?? 1,
    status: input.status ?? 'USABLE',
    beneficiary: input.beneficiary,
    vehicleType: input.vehicleType ?? 'sedan',
    zoneId: input.zoneId ?? null,
    currency: 'SYP',
    lines: [
      {
        lineId: randomUUID(),
        kind: 'PACKAGE',
        definitionId: randomUUID(),
        quantity: 1,
        unitPrice: { currency: 'SYP', amountMinor: '7500000', scale: 2 },
        amount: { currency: 'SYP', amountMinor: '7500000', scale: 2 },
      },
      {
        lineId: randomUUID(),
        kind: 'EXTRA',
        definitionId: randomUUID(),
        quantity: 2,
        unitPrice: { currency: 'SYP', amountMinor: '1000000', scale: 2 },
        amount: { currency: 'SYP', amountMinor: '2000000', scale: 2 },
      },
      {
        lineId: randomUUID(),
        kind: 'DISCOUNT',
        definitionId: null,
        quantity: 1,
        unitPrice: { currency: 'SYP', amountMinor: '500000', scale: 2 },
        amount: { currency: 'SYP', amountMinor: '-500000', scale: 2 },
      },
    ],
    total: { currency: 'SYP', amountMinor: '9000000', scale: 2 },
    catalogRevision: 3,
    priceBookRevision: 7,
    issuedAt: new Date(input.now.getTime() - MINUTE).toISOString(),
    expiresAt: new Date(input.now.getTime() + 30 * MINUTE).toISOString(),
  };
}

export function holdWire(input: {
  readonly holdId?: string;
  readonly beneficiary: PrincipalRef;
  readonly zoneId: string;
  readonly startsAt: Date;
  readonly now: Date;
  readonly state?: 'HELD' | 'COMMITTED' | 'RELEASED' | 'EXPIRED';
  readonly revision?: number;
  readonly bookingId?: string | null;
}) {
  return {
    holdId: input.holdId ?? randomUUID(),
    revision: input.revision ?? 1,
    state: input.state ?? 'HELD',
    beneficiary: input.beneficiary,
    zoneId: input.zoneId,
    startsAt: input.startsAt.toISOString(),
    endsAt: new Date(input.startsAt.getTime() + HOUR).toISOString(),
    expiresAt: new Date(input.now.getTime() + 10 * MINUTE).toISOString(),
    bookingId: input.bookingId ?? null,
    createdAt: input.now.toISOString(),
    updatedAt: input.now.toISOString(),
  };
}

export function vehicleWire(vehicleId: string, revision: number, now: Date) {
  return {
    snapshotSchemaVersion: 1,
    source: 'saved',
    vehicleId,
    vehicleRevision: revision,
    type: 'sedan',
    make: 'Kia',
    model: 'Rio',
    color: 'أبيض',
    plate: null,
    capturedAt: now.toISOString(),
  };
}

export function addressWire(addressId: string, revision: number, now: Date) {
  return {
    snapshotSchemaVersion: 1,
    addressId,
    addressRevision: revision,
    location: {
      mode: 'coordinates',
      point: { latitude: '36.202105', longitude: '37.134260' },
      description: 'قرب الدوار',
    },
    details: 'الطابق الثاني',
    capturedAt: now.toISOString(),
  };
}

export function quoteSnapshot(
  beneficiary: PrincipalRef,
  now: Date,
  zoneId: string | null = null,
): QuoteSnapshot {
  return {
    quoteId: randomUUID(),
    revision: 1,
    beneficiary,
    vehicleType: 'sedan',
    zoneId,
    currency: 'SYP',
    lines: [
      {
        lineId: randomUUID(),
        kind: 'PACKAGE',
        definitionId: randomUUID(),
        quantity: 1,
        unitPrice: money('SYP', 9_000_000n),
        amount: money('SYP', 9_000_000n),
      },
    ],
    total: money('SYP', 9_000_000n),
    catalogRevision: 3,
    priceBookRevision: 7,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 30 * MINUTE).toISOString(),
  };
}

export function vehicleSnapshot(now: Date): VehicleSnapshot {
  return {
    snapshotSchemaVersion: 1,
    source: 'saved',
    vehicleId: randomUUID(),
    vehicleRevision: 2,
    type: 'sedan',
    make: 'Kia',
    model: 'Rio',
    color: null,
    plate: null,
    capturedAt: now.toISOString(),
  };
}

export function addressSnapshot(now: Date): AddressSnapshot {
  return {
    snapshotSchemaVersion: 1,
    addressId: randomUUID(),
    addressRevision: 1,
    location: { mode: 'manual', description: 'حلب، الفرقان' },
    details: null,
    capturedAt: now.toISOString(),
  };
}

export function requestedSlot(now: Date, zoneId: string = randomUUID()): RequestedSlot {
  const startsAt = new Date(now.getTime() + 3 * HOUR);
  return {
    holdId: randomUUID(),
    holdRevision: 1,
    zoneId,
    startsAt,
    endsAt: new Date(startsAt.getTime() + HOUR),
  };
}

export function committedSlot(booking: Booking): SlotSnapshot {
  const r = booking.requestedSlot;
  return { holdId: r.holdId, zoneId: r.zoneId, startsAt: r.startsAt, endsAt: r.endsAt };
}
