import type { BookingDraft } from '../state/bookingDraft.ts';
import type { CustomerSessionState } from '../state/customerSession.ts';
import { contactScenarioState } from './customerContactScenarios.ts';

/**
 * Deterministic sessions for the review step, selected with `?scenario=<id>`.
 * Synthetic cars, places, names and numbers only. Appointments are calendar keys
 * relative to the rendering contract's fixed clock (2026-09-20 12:00 in Damascus):
 * 2026-09-21 10:00 is offered, 2026-09-20 12:00 is inside the lead time.
 */

export type ReviewScenarioId =
  | 'booking-review-cash'
  | 'booking-review-sham'
  | 'booking-review-syriatel'
  | 'booking-review-minimal'
  | 'booking-review-full'
  | 'booking-review-long'
  | 'booking-review-repeat'
  | 'booking-review-expired-slot';

/** The valid Contact fixture (place, appointment, name, number, both notes) with a method. */
function review(changes: Partial<BookingDraft>, mode: 'standard' | 'repeat' = 'standard') {
  return (): CustomerSessionState => {
    // Built afresh on every call, so no two sessions share nested values.
    const base = contactScenarioState('booking-contact-prefilled');
    return {
      ...base,
      draft: { ...base.draft, paymentMethod: 'cash', touched: true, ...structuredClone(changes) },
      draftStep: 6,
      bookingMode: mode,
    };
  };
}

const builders: Readonly<Record<ReviewScenarioId, () => CustomerSessionState>> = {
  'booking-review-cash': review({}),
  'booking-review-sham': review({ paymentMethod: 'sham' }),
  'booking-review-syriatel': review({ paymentMethod: 'syriatel' }),
  // Every optional value absent: no name, colour or plate, no add-on, no access or
  // technician note. The receipt shows the approved fallbacks.
  'booking-review-minimal': review({
    vehicleType: 'sedan',
    service: 'exterior',
    carName: '',
    color: '',
    plate: '',
    extras: [],
    locationNote: '',
    note: '',
  }),
  // Every optional value present, with two chargeable add-ons on the premium package.
  'booking-review-full': review({
    vehicleType: 'large',
    service: 'premium',
    carName: 'سيارة العائلة',
    color: 'رمادي',
    plate: '4567 دمشق',
    extras: ['seats', 'fresh'],
  }),
  // Long Arabic and mixed text at the field limits; markup-like input stays text.
  'booking-review-long': review({
    vehicleType: 'pickup',
    // Close to the name's 60-character limit.
    carName: 'سيارة تجريبية باسم طويل جدًا لاختبار الالتفاف Model X-2026',
    color: 'أخضر زيتوني <b>غامق</b>',
    plate: '12345 أ ب ج د',
    addressLabel: 'مكتب العمل الرئيسي',
    address: 'دمشق، المزة، شارع تجريبي طويل جدًا، بناء رقم 1234، الطابق السابع، بجانب الحديقة',
    locationNote: 'المدخل الجانبي <script>alert(1)</script> & "اختبار"',
    contactName: 'اسم تجريبي طويل جدًا يملأ الحقل حتى آخره لاختبار الطول 1234',
    contactPhone: '٠٩٠٠ ٠٠٠ ٠٠٠',
    note: 'السطر الأول من ملاحظة تجريبية للفني.\nالسطر الثاني: الدخول من الباب الجانبي.\nالسطر الثالث <b>نص</b> & "اختبار".',
  }),
  // The draft a repeated order produces: the repeat heading, a fresh appointment.
  'booking-review-repeat': review({ carName: 'سيارتي التجريبية', plate: '123456' }, 'repeat'),
  // Complete except for an appointment that is no longer offered at the fixed clock.
  'booking-review-expired-slot': review({
    scheduleDay: '2026-09-20',
    slot: { date: '2026-09-20', time: '12:00' },
  }),
};

export const reviewScenarioIds = Object.keys(builders) as readonly ReviewScenarioId[];

export function isReviewScenarioId(value: string | null | undefined): value is ReviewScenarioId {
  return typeof value === 'string' && Object.hasOwn(builders, value);
}

export function reviewScenarioState(id: ReviewScenarioId): CustomerSessionState {
  return builders[id]();
}
