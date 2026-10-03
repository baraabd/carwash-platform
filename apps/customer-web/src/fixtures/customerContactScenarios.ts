import { blankBookingDraft, type BookingDraft } from '../state/bookingDraft.ts';
import type { CustomerSessionState } from '../state/customerSession.ts';
import { sampleLocation } from '../state/locationStep.ts';
import { emptySession } from './customerHomeScenarios.ts';

/**
 * Deterministic sessions for the contact step, selected with `?scenario=<id>`.
 * Synthetic names and numbers only. The appointment is a calendar key valid
 * under the rendering contract's fixed clock (2026-09-20 12:00 in Damascus).
 */

export type ContactScenarioId =
  'booking-contact-ready' | 'booking-contact-prefilled' | 'booking-contact-long';

const scheduled = (changes: Partial<BookingDraft>): CustomerSessionState => ({
  ...emptySession(),
  draft: {
    ...blankBookingDraft(),
    ...sampleLocation('home'),
    scheduleDay: '2026-09-21',
    slot: { date: '2026-09-21', time: '10:00' },
    touched: true,
    ...changes,
  },
  draftStep: 4,
});

const scenarioBuilders: Readonly<Record<ContactScenarioId, () => CustomerSessionState>> = {
  // Place and appointment chosen; no contact details yet.
  'booking-contact-ready': () => scheduled({}),
  // Details already in the draft, with a technician note distinct from the access note.
  'booking-contact-prefilled': () =>
    scheduled({
      vehicleType: 'suv',
      service: 'complete',
      contactName: 'ريم التجريبية',
      contactPhone: '+963 (11) 000-0000',
      locationNote: 'أمام البوابة',
      note: 'السيارة بجانب المدخل الخلفي',
    }),
  // Values at their limits: a 60-character name and a long multiline note.
  'booking-contact-long': () =>
    scheduled({
      contactName: 'اسم تجريبي طويل جدًا يملأ الحقل حتى آخره لاختبار الطول 1234',
      contactPhone: '٠٩٠٠ ٠٠٠ ٠٠٠',
      note: 'السطر الأول من ملاحظة تجريبية للفني.\nالسطر الثاني: الدخول من الباب الجانبي.\nالسطر الثالث <b>نص</b> & "اختبار".',
    }),
};

export const contactScenarioIds = Object.keys(scenarioBuilders) as readonly ContactScenarioId[];

export function isContactScenarioId(value: string | null | undefined): value is ContactScenarioId {
  return typeof value === 'string' && Object.hasOwn(scenarioBuilders, value);
}

export function contactScenarioState(id: ContactScenarioId): CustomerSessionState {
  return scenarioBuilders[id]();
}
