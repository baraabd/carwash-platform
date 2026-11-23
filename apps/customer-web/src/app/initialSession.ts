import { addressScenarioState, isAddressScenarioId } from '../fixtures/customerAddressScenarios.ts';
import { bookingScenarioState, isBookingScenarioId } from '../fixtures/customerBookingScenarios.ts';
import { careScenarioState, isCareScenarioId } from '../fixtures/customerCareScenarios.ts';
import { garageScenarioState, isGarageScenarioId } from '../fixtures/customerGarageScenarios.ts';
import {
  DEFAULT_HOME_SCENARIO,
  HOME_SCENARIO_PARAM,
  homeScenarioState,
  isHomeScenarioId,
} from '../fixtures/customerHomeScenarios.ts';
import {
  isLocationScenarioId,
  locationScenarioState,
} from '../fixtures/customerLocationScenarios.ts';
import {
  isScheduleScenarioId,
  scheduleScenarioState,
} from '../fixtures/customerScheduleScenarios.ts';
import { contactScenarioState, isContactScenarioId } from '../fixtures/customerContactScenarios.ts';
import { isPaymentScenarioId, paymentScenarioState } from '../fixtures/customerPaymentScenarios.ts';
import { isReviewScenarioId, reviewScenarioState } from '../fixtures/customerReviewScenarios.ts';
import type { CustomerSessionState } from '../state/customerSession.ts';

/**
 * Picks a deterministic session for the explicit parity build only. The main
 * entry point excludes this module from production; a `?scenario=<id>` hash is
 * never a production data source or permission to simulate a booking.
 */
export function initialSessionState(locationHash: string): CustomerSessionState {
  const queryStart = locationHash.indexOf('?');
  const requested =
    queryStart === -1
      ? null
      : new URLSearchParams(locationHash.slice(queryStart + 1)).get(HOME_SCENARIO_PARAM);
  if (isBookingScenarioId(requested)) return bookingScenarioState(requested);
  if (isGarageScenarioId(requested)) return garageScenarioState(requested);
  if (isCareScenarioId(requested)) return careScenarioState(requested);
  if (isLocationScenarioId(requested)) return locationScenarioState(requested);
  if (isAddressScenarioId(requested)) return addressScenarioState(requested);
  if (isScheduleScenarioId(requested)) return scheduleScenarioState(requested);
  if (isContactScenarioId(requested)) return contactScenarioState(requested);
  if (isPaymentScenarioId(requested)) return paymentScenarioState(requested);
  if (isReviewScenarioId(requested)) return reviewScenarioState(requested);
  return homeScenarioState(isHomeScenarioId(requested) ? requested : DEFAULT_HOME_SCENARIO);
}
