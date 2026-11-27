import {
  boolean,
  closed,
  integer,
  list,
  oneOf,
  optionalText,
  parseNonNegativeMoney,
  parsePrincipalRef,
  parseRevision,
  parseUtc,
  text,
  uuid,
  type Money,
  type PaymentMethod,
} from '@carwash/contracts/common';
import { parseVehicleSnapshotV1 } from '@carwash/contracts/vehicle-v1';
import { parseAddressSnapshotV1 } from '@carwash/contracts/customer-v1';
import { parseQuoteLineV1 } from '@carwash/contracts/pricing-v1';

const METHODS = ['CASH_ON_COMPLETION', 'SHAM_CASH', 'SYRIATEL_CASH'] as const;
const STATUSES = [
  'PENDING_CONFIRMATION',
  'CONFIRMED',
  'ASSIGNED',
  'EN_ROUTE',
  'ARRIVED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'EXPIRED',
  'REJECTED',
] as const;
export function isProductionBookingId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function slot(value: unknown, path: string) {
  const v = closed(value, path, ['holdId', 'zoneId', 'startsAt', 'endsAt']);
  const startsAt = parseUtc(v.startsAt, `${path}.startsAt`);
  const endsAt = parseUtc(v.endsAt, `${path}.endsAt`);
  if (Date.parse(endsAt) <= Date.parse(startsAt)) throw new Error('slot interval');
  return {
    holdId: uuid(v.holdId, `${path}.holdId`),
    zoneId: uuid(v.zoneId, `${path}.zoneId`),
    startsAt,
    endsAt,
  };
}

/** Consumer mirror of Booking's public change-view, never its internal saga. */
export function parseBookingChange(value: unknown, path = '$') {
  const v = closed(value, path, [
    'changeId',
    'bookingId',
    'kind',
    'state',
    'reason',
    'refusal',
    'attention',
    'requestedAt',
    'completedAt',
    'from',
    'to',
    'settlement',
  ]);
  return {
    changeId: uuid(v.changeId, `${path}.changeId`),
    bookingId: uuid(v.bookingId, `${path}.bookingId`),
    kind: oneOf(v.kind, `${path}.kind`, ['CANCELLATION', 'RESCHEDULE'] as const),
    state: oneOf(v.state, `${path}.state`, [
      'IN_PROGRESS',
      'COMPLETED',
      'REFUSED',
      'FAILED',
    ] as const),
    reason: optionalText(v.reason, `${path}.reason`, { max: 80 }),
    refusal: optionalText(v.refusal, `${path}.refusal`, { max: 80 }),
    attention: boolean(v.attention, `${path}.attention`),
    requestedAt: parseUtc(v.requestedAt, `${path}.requestedAt`),
    completedAt: v.completedAt === null ? null : parseUtc(v.completedAt, `${path}.completedAt`),
    from: slot(v.from, `${path}.from`),
    to: v.to === null ? null : slot(v.to, `${path}.to`),
    settlement:
      v.settlement === null
        ? null
        : oneOf(v.settlement, `${path}.settlement`, [
            'PENDING',
            'VOIDED',
            'REFUND_PENDING',
            'NOTHING_DUE',
            'ENTITLEMENT_RELEASED',
          ] as const),
  };
}
export type ProductionBookingChange = ReturnType<typeof parseBookingChange>;

/** Consumer mirror of services/booking's booking-view. Reject drift, never coerce it to success. */
export function parseProductionBooking(value: unknown, path = '$') {
  const v = closed(
    value,
    path,
    [
      'bookingId',
      'revision',
      'status',
      'confirmation',
      'rejectionReason',
      'beneficiary',
      'paymentMethod',
      'slot',
      'quote',
      'total',
      'vehicle',
      'address',
      'contact',
      'createdAt',
      'updatedAt',
      'confirmedAt',
      'schedule',
      'cancellation',
      'pendingChange',
    ],
    ['financialSource', 'entitlementReservationId', 'obligationId'],
  );
  const q = closed(v.quote, `${path}.quote`, [
    'quoteId',
    'revision',
    'catalogRevision',
    'priceBookRevision',
    'durationMinutes',
    'lines',
  ]);
  const s = closed(v.slot, `${path}.slot`, ['holdId', 'zoneId', 'startsAt', 'endsAt', 'committed']);
  const c = closed(v.contact, `${path}.contact`, ['name', 'phone', 'notes']);
  const total = parseNonNegativeMoney(v.total, `${path}.total`);
  const lines = list(q.lines, `${path}.quote.lines`, 100, parseQuoteLineV1);
  if (
    !lines.length ||
    new Set(lines.map((line) => line.lineId)).size !== lines.length ||
    lines.some(
      (line) => line.amount.currency !== total.currency || line.amount.scale !== total.scale,
    ) ||
    lines.reduce((sum, line) => sum + BigInt(line.amount.amountMinor), 0n) !==
      BigInt(total.amountMinor)
  )
    throw new Error('booking quote total');
  const schedule =
    v.schedule === null
      ? null
      : closed(v.schedule, `${path}.schedule`, [
          'revision',
          'holdId',
          'zoneId',
          'startsAt',
          'endsAt',
        ]);
  const cancellation =
    v.cancellation === null
      ? null
      : closed(v.cancellation, `${path}.cancellation`, ['reason', 'cancelledAt']);
  const bookingId = uuid(v.bookingId, `${path}.bookingId`);
  const financialSource =
    v.financialSource === undefined
      ? 'DIRECT'
      : oneOf(v.financialSource, `${path}.financialSource`, ['DIRECT', 'SUBSCRIPTION'] as const);
  const entitlementReservationId =
    v.entitlementReservationId === undefined || v.entitlementReservationId === null
      ? null
      : uuid(v.entitlementReservationId, `${path}.entitlementReservationId`);
  const obligationId =
    v.obligationId === undefined || v.obligationId === null
      ? null
      : uuid(v.obligationId, `${path}.obligationId`);
  const confirmation = oneOf(v.confirmation, `${path}.confirmation`, [
    'PENDING',
    'CONFIRMED',
    'REJECTED',
    'NEEDS_ATTENTION',
  ] as const);
  if (financialSource === 'DIRECT' && entitlementReservationId !== null)
    throw new Error('direct entitlement');
  if (
    financialSource === 'SUBSCRIPTION' &&
    (obligationId !== null || (confirmation === 'CONFIRMED' && entitlementReservationId === null))
  )
    throw new Error('subscription funding');
  const pendingChange =
    v.pendingChange === null ? null : parseBookingChange(v.pendingChange, `${path}.pendingChange`);
  if (pendingChange && pendingChange.bookingId !== bookingId) throw new Error('foreign change');
  return {
    bookingId,
    financialSource,
    entitlementReservationId,
    obligationId,
    revision: parseRevision(v.revision, `${path}.revision`),
    status: oneOf(v.status, `${path}.status`, STATUSES),
    confirmation,
    rejectionReason: optionalText(v.rejectionReason, `${path}.rejectionReason`, { max: 80 }),
    beneficiary: parsePrincipalRef(v.beneficiary, `${path}.beneficiary`),
    paymentMethod: oneOf(v.paymentMethod, `${path}.paymentMethod`, METHODS),
    slot: {
      ...slot(
        { holdId: s.holdId, zoneId: s.zoneId, startsAt: s.startsAt, endsAt: s.endsAt },
        `${path}.slot`,
      ),
      committed: boolean(s.committed, `${path}.slot.committed`),
    },
    quote: {
      quoteId: uuid(q.quoteId, `${path}.quote.quoteId`),
      revision: parseRevision(q.revision, `${path}.quote.revision`),
      catalogRevision: parseRevision(q.catalogRevision, `${path}.quote.catalogRevision`),
      priceBookRevision: parseRevision(q.priceBookRevision, `${path}.quote.priceBookRevision`),
      durationMinutes:
        q.durationMinutes === null
          ? null
          : integer(q.durationMinutes, `${path}.quote.durationMinutes`, 5, 480),
      lines,
    },
    total,
    vehicle: parseVehicleSnapshotV1(v.vehicle, `${path}.vehicle`),
    address: parseAddressSnapshotV1(v.address, `${path}.address`),
    contact: {
      name: text(c.name, `${path}.contact.name`, { min: 2, max: 80 }),
      phone: text(c.phone, `${path}.contact.phone`, { max: 16, pattern: /^\+[1-9]\d{7,14}$/ }),
      notes: optionalText(c.notes, `${path}.contact.notes`, { max: 500 }),
    },
    createdAt: parseUtc(v.createdAt, `${path}.createdAt`),
    updatedAt: parseUtc(v.updatedAt, `${path}.updatedAt`),
    confirmedAt: v.confirmedAt === null ? null : parseUtc(v.confirmedAt, `${path}.confirmedAt`),
    schedule:
      schedule === null
        ? null
        : {
            ...slot(
              {
                holdId: schedule.holdId,
                zoneId: schedule.zoneId,
                startsAt: schedule.startsAt,
                endsAt: schedule.endsAt,
              },
              `${path}.schedule`,
            ),
            revision: parseRevision(schedule.revision, `${path}.schedule.revision`),
          },
    cancellation:
      cancellation === null
        ? null
        : {
            reason: text(cancellation.reason, `${path}.cancellation.reason`, { max: 80 }),
            cancelledAt: parseUtc(cancellation.cancelledAt, `${path}.cancellation.cancelledAt`),
          },
    pendingChange,
  };
}
export type ProductionBooking = ReturnType<typeof parseProductionBooking>;

export function parseProductionBookings(value: unknown) {
  // Booking's current owner view is intentionally not common Page<T> (no asOf).
  const v = closed(value, '$', ['items', 'nextCursor']);
  const items = list(v.items, '$.items', 100, parseProductionBooking);
  if (new Set(items.map((item) => item.bookingId)).size !== items.length)
    throw new Error('duplicate booking');
  return {
    items,
    nextCursor: v.nextCursor === null ? null : text(v.nextCursor, '$.nextCursor', { max: 512 }),
  };
}

export function parseBookingChanges(value: unknown): readonly ProductionBookingChange[] {
  const v = closed(value, '$', ['items']);
  return list(v.items, '$.items', 100, parseBookingChange);
}

/** Display exact minor units without passing through binary floating point. */
export function formatMoney(value: Money): string {
  const negative = value.amountMinor.startsWith('-');
  const minor = (negative ? value.amountMinor.slice(1) : value.amountMinor).padStart(
    value.scale + 1,
    '0',
  );
  const whole = (value.scale ? minor.slice(0, -value.scale) : minor).replace(
    /\B(?=(\d{3})+(?!\d))/g,
    ',',
  );
  const fraction = value.scale ? minor.slice(-value.scale).replace(/0+$/, '') : '';
  return `${negative ? '−' : ''}${whole}${fraction ? `.${fraction}` : ''} ${value.currency === 'SYP' ? 'ل.س' : 'USD'}`;
}

export const PAYMENT_LABELS: Readonly<Record<PaymentMethod, string>> = {
  CASH_ON_COMPLETION: 'كاش بعد الغسيل',
  SHAM_CASH: 'شام كاش',
  SYRIATEL_CASH: 'سيريتل كاش',
};
export const BOOKING_LABELS: Readonly<Record<ProductionBooking['status'], string>> = {
  PENDING_CONFIRMATION: 'جارٍ تأكيد الحجز',
  CONFIRMED: 'تم تأكيد الحجز',
  ASSIGNED: 'تم تعيين الفني',
  EN_ROUTE: 'الفني في الطريق',
  ARRIVED: 'وصل الفني',
  IN_PROGRESS: 'العناية جارية',
  COMPLETED: 'اكتملت الغسلة',
  CANCELLED: 'ملغي',
  EXPIRED: 'انتهت صلاحية الحجز',
  REJECTED: 'تعذّر تأكيد الحجز',
};
