import {
  contactSnapshot,
  invalid,
  isPaymentMethod,
  uuidField,
  type ContactSnapshot,
  type PaymentMethod,
} from '../domain';

/**
 * Normalized `POST /bookings` command. It names
 * the records the customer selected in the seven approved screens by id and
 * revision; Booking reads the authoritative values from their owners and keeps
 * immutable snapshots. Only the contact (screen 5) and an optional one-time
 * vehicle are typed values.
 * On the wire, paymentMethod is required for DIRECT and optional for a selected
 * subscription. For covered bookings it is inapplicable: the normalized legacy
 * field is only a storage/event compatibility value and never a payment claim.
 */
export interface CreateBookingCommand {
  readonly subscription?: { readonly subscriptionId: string; readonly expectedRevision: number };
  readonly quote: { readonly quoteId: string; readonly revision: number };
  readonly hold: { readonly holdId: string; readonly revision: number };
  readonly vehicle:
    | { readonly source: 'saved'; readonly vehicleId: string; readonly revision: number }
    | { readonly source: 'inline'; readonly inline: unknown };
  readonly address: { readonly addressId: string; readonly revision: number };
  readonly contact: ContactSnapshot;
  readonly paymentMethod: PaymentMethod;
}

function object(
  value: unknown,
  field: string,
  allowed: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalid(`${field} must be an object.`);
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key) && !optional.includes(key))
      throw invalid(`${field} has unexpected field ${key.slice(0, 40)}.`);
  }
  for (const key of allowed) {
    if (!Object.hasOwn(record, key)) throw invalid(`${field}.${key} is required.`);
  }
  return record;
}

/** Positive revision, same bound as the published `parseRevision` (<= 2^31-1). */
function revision(value: unknown, field: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > 2_147_483_647
  ) {
    throw invalid(`${field} must be a positive integer.`);
  }
  return value;
}

export function parseCreateBooking(body: unknown): CreateBookingCommand {
  const v = object(
    body,
    'body',
    ['quote', 'hold', 'vehicle', 'address', 'contact'],
    ['subscription', 'paymentMethod'],
  );
  const quote = object(v.quote, 'quote', ['quoteId', 'revision']);
  const hold = object(v.hold, 'hold', ['holdId', 'revision']);
  const address = object(v.address, 'address', ['addressId', 'revision']);
  const contact = object(v.contact, 'contact', ['name', 'phone', 'notes']);
  const subscription =
    v.subscription === undefined
      ? null
      : object(v.subscription, 'subscription', ['subscriptionId', 'expectedRevision']);
  const hasPaymentMethod = Object.hasOwn(v, 'paymentMethod');
  if (!hasPaymentMethod && subscription === null)
    throw invalid('body.paymentMethod is required for a direct booking.');
  if (hasPaymentMethod && !isPaymentMethod(v.paymentMethod))
    throw invalid('paymentMethod is not supported.');
  // The existing database and event schema require this legacy column. Only
  // financialSource controls funding: the subscription path never creates debt
  // or requests collection from this compatibility value. Normalize all covered
  // inputs alike so an omitted/ignored method cannot change their request hash.
  const paymentMethod: PaymentMethod =
    subscription === null ? (v.paymentMethod as PaymentMethod) : 'CASH_ON_COMPLETION';

  const rawVehicle = v.vehicle;
  if (typeof rawVehicle !== 'object' || rawVehicle === null || Array.isArray(rawVehicle)) {
    throw invalid('vehicle must be an object.');
  }
  const source = (rawVehicle as Record<string, unknown>).source;
  let vehicle: CreateBookingCommand['vehicle'];
  if (source === 'saved') {
    const saved = object(rawVehicle, 'vehicle', ['source', 'vehicleId', 'revision']);
    vehicle = {
      source: 'saved',
      vehicleId: uuidField(saved.vehicleId, 'vehicle.vehicleId'),
      revision: revision(saved.revision, 'vehicle.revision'),
    };
  } else if (source === 'inline') {
    const inline = object(rawVehicle, 'vehicle', ['source', 'inline']);
    vehicle = { source: 'inline', inline: inline.inline };
  } else {
    throw invalid('vehicle.source must be saved or inline.');
  }

  return {
    ...(subscription === null
      ? {}
      : {
          subscription: {
            subscriptionId: uuidField(subscription.subscriptionId, 'subscription.subscriptionId'),
            expectedRevision: revision(
              subscription.expectedRevision,
              'subscription.expectedRevision',
            ),
          },
        }),
    quote: {
      quoteId: uuidField(quote.quoteId, 'quote.quoteId'),
      revision: revision(quote.revision, 'quote.revision'),
    },
    hold: {
      holdId: uuidField(hold.holdId, 'hold.holdId'),
      revision: revision(hold.revision, 'hold.revision'),
    },
    vehicle,
    address: {
      addressId: uuidField(address.addressId, 'address.addressId'),
      revision: revision(address.revision, 'address.revision'),
    },
    contact: contactSnapshot({ name: contact.name, phone: contact.phone, notes: contact.notes }),
    paymentMethod,
  };
}

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/;

export function idempotencyKey(value: unknown): string {
  if (typeof value !== 'string' || !IDEMPOTENCY_KEY.test(value)) {
    throw invalid('A valid Idempotency-Key header is required.');
  }
  return value;
}
