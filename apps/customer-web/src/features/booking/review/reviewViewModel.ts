import { illustrativeCost } from '../../../fixtures/customerCatalogFixture.ts';
import type { BookingDraft } from '../../../state/bookingDraft.ts';
import type { BookingMode } from '../../../state/customerSession.ts';
import {
  buildReceiptView,
  type ReceiptView,
} from '../../../widgets/order-receipt/receiptViewModel.ts';
import { buildPriceBreakdown, type PriceBreakdown } from '../priceBreakdown.ts';

export {
  NO_EXTRAS_TEXT,
  NO_PLATE_TEXT,
  PLACE_FALLBACK_LABEL,
  TECHNICIAN_NOTE_HEADING,
} from '../../../widgets/order-receipt/receiptViewModel.ts';

/**
 * Presentation of the seventh booking screen, ported from the approved
 * `reviewView()`, `summary()`, `paymentSummary()` and `bill()`. A pure function of
 * the CURRENT draft and booking mode: nothing is copied, stored or memoised beyond
 * one render, so an edit is always reflected. Confirming is a separate, explicit
 * command (state/bookingConfirmation.ts).
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

/**
 * C014's disclosure beside the confirm action, not a quote from the golden source.
 * It replaces the reference's sentence saying the confirm button creates a request on the device: confirmation
 * creates an order in this session's memory only. Kept no wider than the sentence
 * it replaces (one line at 320 CSS px), so the screen's geometry stays the
 * reference's; the brief's longer example wrapped there.
 */
export const CONFIRMATION_DISCLOSURE_TEXT =
  'ينشئ التأكيد طلبًا تجريبيًا لهذه الجلسة فقط، بلا حجز أو دفع.';

/** C014's confirm label for every method (the reference's cash label; no QR follows). */
export const CONFIRM_LABEL = 'تأكيد الحجز التجريبي';

/**
 * First line of the note for a wallet method. The reference's «يظهر QR بعد
 * التأكيد. الدفع لا يُعتمد دون مطابقة.» is replaced: no QR is shown in this build.
 */
export const WALLET_PAYMENT_NOTE = 'لا يظهر QR في هذا النموذج. لا يُحصَّل أي مبلغ.';

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

export interface ReviewViewModel extends ReceiptView {
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly breakdown: PriceBreakdown;
  readonly total: number;
  readonly minutes: number;
  /** First line of the note under the bill: what the chosen method means. */
  readonly paymentNote: string;
  readonly confirmLabel: string;
}

export function buildReviewViewModel(draft: BookingDraft, mode: BookingMode): ReviewViewModel {
  const cost = illustrativeCost(draft);
  return {
    eyebrow: REVIEW_EYEBROW,
    title: copy[mode].title,
    description: copy[mode].description,
    // As typed: Review does not normalise the number; confirmation does.
    ...buildReceiptView(draft, cost.minutes),
    breakdown: buildPriceBreakdown(draft),
    total: cost.total,
    minutes: cost.minutes,
    paymentNote:
      draft.paymentMethod === 'cash' ? 'كاش بعد الغسيل. لا دفع مسبق.' : WALLET_PAYMENT_NOTE,
    confirmLabel: CONFIRM_LABEL,
  };
}
