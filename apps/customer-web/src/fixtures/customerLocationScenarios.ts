import { blankBookingDraft } from '../state/bookingDraft.ts';
import type { CustomerSessionState } from '../state/customerSession.ts';
import { sampleLocation } from '../state/locationStep.ts';
import { emptySession } from './customerHomeScenarios.ts';

/**
 * Deterministic sessions for the location step, selected with `?scenario=<id>`
 * like the other scenarios. Sample data only — no real address and no
 * coordinates: a place's x/y are positions in the illustrative drawing.
 */

export type LocationScenarioId =
  'booking-location-sample-work' | 'booking-location-map-point' | 'booking-location-manual-note';

const scenarioBuilders: Readonly<Record<LocationScenarioId, () => CustomerSessionState>> = {
  // The "العمل" demonstration address, as the shortcut leaves the draft.
  'booking-location-sample-work': () => ({
    ...emptySession(),
    draft: { ...blankBookingDraft(), ...sampleLocation('work'), touched: true },
    draftStep: 2,
  }),
  // A pin the customer put on the drawing, away from its centre.
  'booking-location-map-point': () => ({
    ...emptySession(),
    draft: {
      ...blankBookingDraft(),
      vehicleType: 'suv',
      service: 'complete',
      address: 'دمشق، موقع مختار على الخريطة التوضيحية',
      addressLabel: 'مكان الغسيل',
      place: { kind: 'map', x: 228, y: 312, label: 'نقطة مختارة على الخريطة التوضيحية' },
      saveAddress: false,
      touched: true,
    },
    draftStep: 2,
  }),
  // An address typed by hand with an access note and a custom label.
  'booking-location-manual-note': () => ({
    ...emptySession(),
    draft: {
      ...blankBookingDraft(),
      vehicleType: 'large',
      service: 'premium',
      extras: ['seats'],
      address: 'دمشق، شارع تجريبي طويل الاسم، بناء توضيحي رقم 4، الطابق الأرضي قرب المدخل الخلفي',
      addressLabel: 'بيت العائلة',
      locationNote: 'أمام البوابة الخضراء، اتصل عند الوصول',
      place: { kind: 'manual', x: 350, y: 250, label: 'عنوان يدوي' },
      saveAddress: true,
      touched: true,
    },
    draftStep: 2,
  }),
};

export const locationScenarioIds = Object.keys(scenarioBuilders) as readonly LocationScenarioId[];

export function isLocationScenarioId(
  value: string | null | undefined,
): value is LocationScenarioId {
  return typeof value === 'string' && Object.hasOwn(scenarioBuilders, value);
}

export function locationScenarioState(id: LocationScenarioId): CustomerSessionState {
  return scenarioBuilders[id]();
}
