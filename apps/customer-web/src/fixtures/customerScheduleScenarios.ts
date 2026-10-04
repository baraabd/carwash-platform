import { blankBookingDraft, type BookingDraft } from '../state/bookingDraft.ts';
import type { CustomerSessionState } from '../state/customerSession.ts';
import { sampleLocation } from '../state/locationStep.ts';
import { emptySession } from './customerHomeScenarios.ts';

/**
 * Deterministic sessions for the time step, selected with `?scenario=<id>` like
 * the other scenarios. Sample data only.
 *
 * The days below are calendar keys, valid under the fixed clock of the rendering
 * contract (docs/design/f010-reference-manifest.json, 2026-09-20 12:00 in
 * Damascus). Under any other clock they are simply days that are no longer
 * offered, which the screen shows as such; they are test fixtures, not a claim
 * about availability.
 */

export type ScheduleScenarioId =
  | 'booking-time-ready'
  | 'booking-time-day-chosen'
  | 'booking-time-slot-chosen'
  | 'booking-time-late-slot';

const located = (changes: Partial<BookingDraft>): CustomerSessionState => ({
  ...emptySession(),
  draft: { ...blankBookingDraft(), ...sampleLocation('work'), touched: true, ...changes },
  draftStep: 3,
});

const scenarioBuilders: Readonly<Record<ScheduleScenarioId, () => CustomerSessionState>> = {
  // A place is chosen; no day was recorded and no time is chosen.
  'booking-time-ready': () => located({}),
  // A day is highlighted but no time is chosen: not yet an appointment.
  'booking-time-day-chosen': () =>
    located({ vehicleType: 'suv', service: 'complete', scheduleDay: '2026-09-22' }),
  // A complete appointment among the first six times of its day.
  'booking-time-slot-chosen': () =>
    located({
      vehicleType: 'large',
      service: 'premium',
      extras: ['seats'],
      addressLabel: 'بيت العائلة الكبير في الحي القديم',
      scheduleDay: '2026-09-21',
      slot: { date: '2026-09-21', time: '09:00' },
    }),
  // A complete appointment beyond the first six times, so the whole list shows.
  'booking-time-late-slot': () =>
    located({ scheduleDay: '2026-09-22', slot: { date: '2026-09-22', time: '18:00' } }),
};

export const scheduleScenarioIds = Object.keys(scenarioBuilders) as readonly ScheduleScenarioId[];

export function isScheduleScenarioId(
  value: string | null | undefined,
): value is ScheduleScenarioId {
  return typeof value === 'string' && Object.hasOwn(scenarioBuilders, value);
}

export function scheduleScenarioState(id: ScheduleScenarioId): CustomerSessionState {
  return scenarioBuilders[id]();
}
