import { blankBookingDraft } from '../state/bookingDraft.ts';
import type { CustomerSessionState } from '../state/customerSession.ts';
import { emptySession } from './customerHomeScenarios.ts';

/**
 * Deterministic sessions for the booking steps, selected with `?scenario=<id>`
 * like the Home scenarios. Sample data only — no real car, plate or customer.
 */

export type BookingScenarioId = 'booking-vehicle-prefilled' | 'booking-vehicle-invalid-plate';

const scenarioBuilders: Readonly<Record<BookingScenarioId, () => CustomerSessionState>> = {
  // A draft the customer already described: size, plate, optional name and colour.
  'booking-vehicle-prefilled': () => ({
    ...emptySession(),
    draft: {
      ...blankBookingDraft(),
      vehicleType: 'pickup',
      carName: 'هايلكس',
      color: 'أبيض',
      plate: '4821 ب ج',
      saveVehicle: false,
      service: 'complete',
      touched: true,
    },
  }),
  // A stored plate with no digit: the step must refuse to advance until it is fixed.
  'booking-vehicle-invalid-plate': () => ({
    ...emptySession(),
    draft: { ...blankBookingDraft(), vehicleType: 'suv', plate: 'ب ج د', touched: true },
  }),
};

export const bookingScenarioIds = Object.keys(scenarioBuilders) as readonly BookingScenarioId[];

export function isBookingScenarioId(value: string | null | undefined): value is BookingScenarioId {
  return typeof value === 'string' && Object.hasOwn(scenarioBuilders, value);
}

export function bookingScenarioState(id: BookingScenarioId): CustomerSessionState {
  return scenarioBuilders[id]();
}
