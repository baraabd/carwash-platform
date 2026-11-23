import {
  extraFixtures,
  packageFixtures,
  vehicleFixtures,
  type VehicleFixture,
} from '../../fixtures/customerCatalogFixture.ts';
import type { BookingDraft, CareExtraId } from '../../state/bookingDraft.ts';
import { paymentMethodDefinition, type PaymentMethodDefinition } from '../../state/paymentStep.ts';
import { dateLabel, timeLabel } from '../../state/scheduling.ts';

/**
 * The approved receipt (the reference's `summary()` and `paymentSummary()`), shared
 * by Review (an unsent draft) and the post-confirmation handoff (a session order).
 * A pure function of the choices it is given; every value is plain text.
 */

export const NO_PLATE_TEXT = 'بدون لوحة في هذا النموذج';
export const NO_EXTRAS_TEXT = 'بدون إضافات';
export const PLACE_FALLBACK_LABEL = 'المكان';
export const TECHNICIAN_NOTE_HEADING = 'ملاحظتك للفني';

/**
 * C014 wording for a wallet method, not a quote: the reference promises a QR after
 * review («QR بعد المراجعة · التحقق قبل بدء الخدمة»); no QR exists in this build.
 * No wider than the line it replaces, so it wraps the same way.
 */
export const WALLET_PAYMENT_DETAIL = 'المحفظة غير مفعّلة بعد · لا تحويل الآن';

/** The choices a receipt shows: a draft, or an order confirmed from one. */
export type ReceiptSource = Pick<
  BookingDraft,
  | 'vehicleType'
  | 'carName'
  | 'color'
  | 'plate'
  | 'service'
  | 'extras'
  | 'addressLabel'
  | 'address'
  | 'locationNote'
  | 'slot'
  | 'contactName'
  | 'contactPhone'
  | 'note'
  | 'paymentMethod'
>;

export interface ReceiptView {
  readonly vehicle: {
    readonly art: VehicleFixture['art'];
    readonly packageName: string;
    /** «اسم السيارة · اللون», or the name alone when no colour was given. */
    readonly carLine: string;
    /** The plate as stored, or null for the approved no-plate fallback. */
    readonly plate: string | null;
  };
  readonly care: { readonly packageName: string; readonly extras: string };
  readonly place: {
    readonly label: string;
    readonly address: string;
    /** The access note of the address (`locationNote`), unrelated to the technician note. */
    readonly accessNote: string | null;
  };
  readonly time: { readonly when: string; readonly detail: string };
  readonly contact: { readonly name: string; readonly phone: string };
  readonly payment: {
    readonly icon: PaymentMethodDefinition['icon'] | 'wallet';
    readonly name: string;
    readonly detail: string;
  };
  /** The technician note (`note`), or null when there is none. */
  readonly technicianNote: string | null;
}

/** The reference's `carName()`: the trimmed, capped name, or the size's name. */
function carName(source: Pick<ReceiptSource, 'carName' | 'vehicleType'>): string {
  return source.carName.trim().slice(0, 60) || vehicleFixtures[source.vehicleType].name;
}

/**
 * The add-ons the receipt lists: the choices as they are, in order, as the
 * reference's `summary()` lists `d.extras`. Only ids without a catalog entry are
 * skipped, because they have no name to show. What is CHARGED is decided by the
 * bill (`illustrativeCost`), which counts each add-on once and never one the package
 * includes; the receipt does not hide a choice to make the two lists agree.
 */
function receiptExtras(source: Pick<ReceiptSource, 'extras'>): readonly CareExtraId[] {
  return source.extras.filter((extra) => Object.hasOwn(extraFixtures, extra));
}

/** `minutes` is the illustrative duration the caller already holds (quoted or recorded). */
export function buildReceiptView(source: ReceiptSource, minutes: number): ReceiptView {
  const packageName = packageFixtures[source.service].name;
  const extras = receiptExtras(source);
  const method = paymentMethodDefinition(source.paymentMethod);
  return {
    vehicle: {
      art: vehicleFixtures[source.vehicleType].art,
      packageName,
      carLine: `${carName(source)}${source.color ? ` · ${source.color}` : ''}`,
      plate: source.plate ? source.plate : null,
    },
    care: {
      packageName,
      extras: extras.length
        ? extras.map((extra) => extraFixtures[extra].name).join('، ')
        : NO_EXTRAS_TEXT,
    },
    place: {
      label: source.addressLabel || PLACE_FALLBACK_LABEL,
      address: source.address,
      accessNote: source.locationNote ? source.locationNote : null,
    },
    time: {
      when: `${dateLabel(source.slot?.date ?? '')} · ${timeLabel(source.slot?.time ?? null)}`,
      detail: `بتوقيت دمشق · ${minutes} دقيقة تقريبًا`,
    },
    contact: { name: source.contactName, phone: source.contactPhone },
    payment: {
      icon: method?.icon ?? 'wallet',
      name: method?.name ?? 'اختر طريقة الدفع',
      detail:
        method?.id === 'cash'
          ? 'كاش بعد إتمام الغسيل'
          : method
            ? WALLET_PAYMENT_DETAIL
            : 'لم تحدد بعد',
    },
    technicianNote: source.note ? source.note : null,
  };
}
