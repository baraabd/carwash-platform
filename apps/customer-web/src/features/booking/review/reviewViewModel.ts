import {
  extraFixtures,
  illustrativeCost,
  packageFixtures,
  vehicleFixtures,
  type VehicleFixture,
} from '../../../fixtures/customerCatalogFixture.ts';
import type { BookingDraft, CareExtraId } from '../../../state/bookingDraft.ts';
import type { BookingMode } from '../../../state/customerSession.ts';
import {
  paymentMethodDefinition,
  type PaymentMethodDefinition,
} from '../../../state/paymentStep.ts';
import { dateLabel, timeLabel } from '../../../state/scheduling.ts';
import { buildPriceBreakdown, type PriceBreakdown } from '../priceBreakdown.ts';

/**
 * Presentation of the seventh booking screen, ported from the approved
 * `reviewView()`, `summary()`, `paymentSummary()` and `bill()`. A pure function of
 * the CURRENT draft and booking mode: nothing is copied, stored or memoised beyond
 * one render, so an edit is always reflected, and nothing here confirms anything.
 *
 * Every value is plain text for React to render as text; none is markup.
 */

export interface ReviewEditAction {
  /** The booking step the «تعديل» control opens (0 Vehicle … 5 Payment). */
  readonly step: number;
  /** The control's accessible name, as in the reference. */
  readonly label: string;
}

/** The reference's edit controls, in receipt order. */
export const REVIEW_EDIT_ACTIONS: readonly ReviewEditAction[] = Object.freeze([
  { step: 0, label: 'تعديل السيارة' },
  { step: 1, label: 'تعديل العناية والإضافات' },
  { step: 2, label: 'تعديل الموقع' },
  { step: 3, label: 'تعديل الموعد' },
  { step: 4, label: 'تعديل بيانات التواصل' },
  { step: 5, label: 'تعديل طريقة الدفع' },
]);

export const REVIEW_EYEBROW = '07 / كل شيء واضح';
export const NO_PLATE_TEXT = 'بدون لوحة في هذا النموذج';
export const NO_EXTRAS_TEXT = 'بدون إضافات';
export const PLACE_FALLBACK_LABEL = 'المكان';
export const TECHNICIAN_NOTE_HEADING = 'ملاحظتك للفني';

/**
 * C013's own disclosure, not a quote from the golden source. It replaces the
 * reference's sentence saying that the confirm button creates a request on the
 * device, because confirmation is not available in this build; it is the visible reason the final action is disabled.
 * It is kept as short as the sentence it replaces (one line at 320 CSS px), so the
 * screen's geometry stays the reference's.
 */
export const CONFIRMATION_UNAVAILABLE_TEXT =
  'مسودة تجريبية لهذه الجلسة فقط. تأكيد الحجز غير متاح بعد.';

const copy: Readonly<
  Record<BookingMode, { readonly title: string; readonly description: string }>
> = {
  standard: {
    title: 'غسلتك، مثل ما تحب.',
    description: 'كل اختياراتك أمامك. يمكنك تعديل أي تفصيلة.',
  },
  repeat: {
    title: 'نفس العناية، بموعد جديد.',
    description: 'حفظنا سيارتك وخدمتك وعنوانك. راجع الموعد الجديد قبل التأكيد.',
  },
};

export interface ReviewViewModel {
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
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
  readonly breakdown: PriceBreakdown;
  readonly total: number;
  readonly minutes: number;
  /** First line of the note under the bill: what the chosen method means. */
  readonly paymentNote: string;
  /** The reference's final-action label for the chosen method. */
  readonly confirmLabel: string;
}

/** The reference's `carName()`: the trimmed, capped name, or the size's name. */
function carName(draft: Pick<BookingDraft, 'carName' | 'vehicleType'>): string {
  return draft.carName.trim().slice(0, 60) || vehicleFixtures[draft.vehicleType].name;
}

/**
 * The add-ons the receipt lists. The reference's draft is always clean — known
 * ids, once each, none the package already includes — so the same rules are
 * applied here to whatever the draft carries (a repeated order may be dirty).
 */
function receiptExtras(draft: Pick<BookingDraft, 'service' | 'extras'>): readonly CareExtraId[] {
  const included = packageFixtures[draft.service].includes;
  return [...new Set(draft.extras)].filter(
    (extra) => Object.hasOwn(extraFixtures, extra) && !included.includes(extra),
  );
}

export function buildReviewViewModel(draft: BookingDraft, mode: BookingMode): ReviewViewModel {
  const cost = illustrativeCost(draft);
  const packageName = packageFixtures[draft.service].name;
  const extras = receiptExtras(draft);
  const method = paymentMethodDefinition(draft.paymentMethod);
  const cash = method?.id === 'cash';
  return {
    eyebrow: REVIEW_EYEBROW,
    title: copy[mode].title,
    description: copy[mode].description,
    vehicle: {
      art: vehicleFixtures[draft.vehicleType].art,
      packageName,
      carLine: `${carName(draft)}${draft.color ? ` · ${draft.color}` : ''}`,
      plate: draft.plate ? draft.plate : null,
    },
    care: {
      packageName,
      extras: extras.length
        ? extras.map((extra) => extraFixtures[extra].name).join('، ')
        : NO_EXTRAS_TEXT,
    },
    place: {
      label: draft.addressLabel || PLACE_FALLBACK_LABEL,
      address: draft.address,
      accessNote: draft.locationNote ? draft.locationNote : null,
    },
    time: {
      when: `${dateLabel(draft.slot?.date ?? '')} · ${timeLabel(draft.slot?.time ?? null)}`,
      detail: `بتوقيت دمشق · ${cost.minutes} دقيقة تقريبًا`,
    },
    // As typed: Review does not normalise the number; that belongs to confirmation.
    contact: { name: draft.contactName, phone: draft.contactPhone },
    payment: {
      icon: method?.icon ?? 'wallet',
      name: method?.name ?? 'اختر طريقة الدفع',
      detail: cash
        ? 'كاش بعد إتمام الغسيل'
        : method
          ? 'QR بعد المراجعة · التحقق قبل بدء الخدمة'
          : 'لم تحدد بعد',
    },
    technicianNote: draft.note ? draft.note : null,
    breakdown: buildPriceBreakdown(draft),
    total: cost.total,
    minutes: cost.minutes,
    paymentNote: cash
      ? 'كاش بعد الغسيل. لا دفع مسبق.'
      : 'يظهر QR بعد التأكيد. الدفع لا يُعتمد دون مطابقة.',
    confirmLabel: cash ? 'تأكيد الحجز التجريبي' : 'تأكيد الحجز وعرض QR',
  };
}
