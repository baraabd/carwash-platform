import { blankBookingDraft } from '../state/bookingDraft.ts';
import type { CustomerSessionState } from '../state/customerSession.ts';
import { emptySession } from './customerHomeScenarios.ts';

/**
 * Deterministic sessions for the care (package) step, selected with
 * `?scenario=<id>` like the other scenarios. Sample data only.
 */

export type CareScenarioId = 'booking-care-with-extras';

const scenarioBuilders: Readonly<Record<CareScenarioId, () => CustomerSessionState>> = {
  // A draft that already carries two add-ons, one of which the top package
  // includes: choosing that package must drop it rather than charge it twice.
  'booking-care-with-extras': () => ({
    ...emptySession(),
    draft: {
      ...blankBookingDraft(),
      vehicleType: 'large',
      plate: '77 ر',
      service: 'complete',
      extras: ['wheels', 'fresh'],
      touched: true,
    },
    draftStep: 1,
  }),
};

export const careScenarioIds = Object.keys(scenarioBuilders) as readonly CareScenarioId[];

export function isCareScenarioId(value: string | null | undefined): value is CareScenarioId {
  return typeof value === 'string' && Object.hasOwn(scenarioBuilders, value);
}

export function careScenarioState(id: CareScenarioId): CustomerSessionState {
  return scenarioBuilders[id]();
}
