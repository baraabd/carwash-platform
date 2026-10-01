import {
  DEFAULT_HOME_SCENARIO,
  HOME_SCENARIO_PARAM,
  homeScenarioState,
  isHomeScenarioId,
} from '../fixtures/customerHomeScenarios.ts';
import type { CustomerSessionState } from '../state/customerSession.ts';

/**
 * Picks the deterministic session the page starts from. Until the customer
 * services exist, fixtures are the only data source; `#/?scenario=<id>` selects
 * one and anything unrecognised falls back to the empty default.
 */
export function initialSessionState(locationHash: string): CustomerSessionState {
  const queryStart = locationHash.indexOf('?');
  const requested =
    queryStart === -1
      ? null
      : new URLSearchParams(locationHash.slice(queryStart + 1)).get(HOME_SCENARIO_PARAM);
  return homeScenarioState(isHomeScenarioId(requested) ? requested : DEFAULT_HOME_SCENARIO);
}
