import {
  money,
  moneyFromWire,
  moneyToWire,
  type AddressSnapshot,
  type Booking,
  type BookingStatus,
  type CancellationReason,
  type ContactSnapshot,
  type Currency,
  type PaymentMethod,
  type PrincipalKind,
  type QuoteLineSnapshot,
  type QuoteSnapshot,
  type RejectionReason,
  type VehicleSnapshot,
} from '../../domain';

/**
 * JSONB codecs for the immutable snapshot columns. Money is stored in its wire
 * form (integer string + scale), never as a JSON number, so no amount ever
 * passes through binary floating point.
 */
export function quoteToJson(quote: QuoteSnapshot): Record<string, unknown> {
  return {
    ...quote,
    lines: quote.lines.map((line) => ({
      ...line,
      unitPrice: moneyToWire(line.unitPrice),
      amount: moneyToWire(line.amount),
    })),
    total: moneyToWire(quote.total),
  };
}

export function quoteFromJson(value: unknown): QuoteSnapshot {
  const v = value as Record<string, unknown> & { lines: Record<string, unknown>[] };
  return {
    quoteId: v.quoteId as string,
    revision: v.revision as number,
    beneficiary: v.beneficiary as QuoteSnapshot['beneficiary'],
    vehicleType: v.vehicleType as QuoteSnapshot['vehicleType'],
    zoneId: v.zoneId as string | null,
    currency: v.currency as Currency,
    lines: v.lines.map((line): QuoteLineSnapshot => ({
      lineId: line.lineId as string,
      kind: line.kind as QuoteLineSnapshot['kind'],
      definitionId: line.definitionId as string | null,
      quantity: line.quantity as number,
      unitPrice: moneyFromWire(line.unitPrice, 'unitPrice'),
      amount: moneyFromWire(line.amount, 'amount'),
    })),
    total: moneyFromWire(v.total, 'total'),
    catalogRevision: v.catalogRevision as number,
    priceBookRevision: v.priceBookRevision as number,
    issuedAt: v.issuedAt as string,
    expiresAt: v.expiresAt as string,
  };
}

export interface BookingRow {
  id: string;
  principal_kind: string;
  principal_subject: string;
  status: string;
  rejection_reason: string | null;
  payment_method: string;
  contact: unknown;
  vehicle_snapshot: unknown;
  address_snapshot: unknown;
  quote_snapshot: unknown;
  currency: string;
  total_minor: bigint;
  hold_id: string;
  hold_revision: number;
  zone_id: string;
  requested_starts_at: Date;
  requested_ends_at: Date;
  slot_starts_at: Date | null;
  slot_ends_at: Date | null;
  version: number;
  created_at: Date;
  updated_at: Date;
  confirmed_at: Date | null;
  cancellation_reason: string | null;
  cancelled_at: Date | null;
  schedule_revision: number;
  schedule_hold_id: string | null;
  schedule_starts_at: Date | null;
  schedule_ends_at: Date | null;
}

export const BOOKING_COLUMNS = `b.id::text, b.principal_kind, b.principal_subject::text, b.status,
  b.rejection_reason, b.payment_method, b.contact, b.vehicle_snapshot, b.address_snapshot,
  b.quote_snapshot, b.currency, b.total_minor, b.hold_id::text, b.hold_revision, b.zone_id::text,
  b.requested_starts_at, b.requested_ends_at, b.slot_starts_at, b.slot_ends_at, b.version,
  b.created_at, b.updated_at, b.confirmed_at, b.cancellation_reason, b.cancelled_at,
  b.schedule_revision, b.schedule_hold_id::text, b.schedule_starts_at, b.schedule_ends_at`;

export function toBooking(row: BookingRow): Booking {
  const slot =
    row.slot_starts_at !== null && row.slot_ends_at !== null
      ? {
          holdId: row.hold_id,
          zoneId: row.zone_id,
          startsAt: row.slot_starts_at,
          endsAt: row.slot_ends_at,
        }
      : null;
  return {
    id: row.id,
    beneficiary: { kind: row.principal_kind as PrincipalKind, subjectId: row.principal_subject },
    status: row.status as BookingStatus,
    rejectionReason: row.rejection_reason as RejectionReason | null,
    paymentMethod: row.payment_method as PaymentMethod,
    contact: row.contact as ContactSnapshot,
    vehicle: row.vehicle_snapshot as VehicleSnapshot,
    address: row.address_snapshot as AddressSnapshot,
    quote: quoteFromJson(row.quote_snapshot),
    requestedSlot: {
      holdId: row.hold_id,
      holdRevision: row.hold_revision,
      zoneId: row.zone_id,
      startsAt: row.requested_starts_at,
      endsAt: row.requested_ends_at,
    },
    slot,
    rescheduledSlot:
      row.schedule_hold_id !== null &&
      row.schedule_starts_at !== null &&
      row.schedule_ends_at !== null
        ? {
            holdId: row.schedule_hold_id,
            zoneId: row.zone_id,
            startsAt: row.schedule_starts_at,
            endsAt: row.schedule_ends_at,
          }
        : null,
    scheduleRevision: row.schedule_revision,
    cancellation:
      row.cancelled_at !== null && row.cancellation_reason !== null
        ? {
            reason: row.cancellation_reason as CancellationReason,
            cancelledAt: row.cancelled_at,
          }
        : null,
    total: money(row.currency as Currency, row.total_minor),
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    confirmedAt: row.confirmed_at,
  };
}
