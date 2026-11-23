import { moneyToWire, type AddressLocation, type Booking } from '../../domain';

/**
 * Wire view for the assigned technician (REQUESTED booking.v1 addition,
 * P03-C3, `docs/production/C/P03-C-interfaces.md` section C3).
 *
 * Purpose-limited and built field by field, never by spreading a snapshot:
 * no customer subject id, no quote id/revision, no catalog or price-book
 * revision, no unit price, no saga or owner-record ids. The plate stays
 * optional (approved journey). Money uses the wire form
 * `{currency, amountMinor: "<integer>", scale}`.
 */
function location(value: AddressLocation) {
  return value.mode === 'manual'
    ? { mode: 'manual' as const, description: value.description }
    : {
        mode: 'coordinates' as const,
        point: { latitude: value.point.latitude, longitude: value.point.longitude },
        description: value.description,
      };
}

export function technicianBookingView(booking: Booking) {
  const slot = booking.slot ?? booking.requestedSlot;
  const plate = booking.vehicle.plate;
  return {
    bookingId: booking.id,
    revision: booking.version,
    status: booking.status,
    slot: {
      zoneId: slot.zoneId,
      startsAt: slot.startsAt.toISOString(),
      endsAt: slot.endsAt.toISOString(),
    },
    vehicle: {
      type: booking.vehicle.type,
      make: booking.vehicle.make,
      model: booking.vehicle.model,
      color: booking.vehicle.color,
      plate: plate === null ? null : { text: plate.text, region: plate.region },
    },
    address: {
      location: location(booking.address.location),
      details: booking.address.details,
    },
    contact: {
      name: booking.contact.name,
      phone: booking.contact.phone,
      notes: booking.contact.notes,
    },
    lines: booking.quote.lines.map((line) => ({
      lineId: line.lineId,
      kind: line.kind,
      definitionId: line.definitionId,
      quantity: line.quantity,
      amount: moneyToWire(line.amount),
    })),
    total: moneyToWire(booking.total),
    paymentMethod: booking.paymentMethod,
  };
}

export type TechnicianBookingView = ReturnType<typeof technicianBookingView>;
