import { vehicleFixtures } from '../../fixtures/customerCatalogFixture.ts';
import type { CustomerSessionState } from '../../state/customerSession.ts';

export interface GarageCard {
  readonly id: string;
  readonly name: string;
  /** Size name, followed by the colour when one was given. */
  readonly description: string;
  /** Null when no plate was added; the card then says so. */
  readonly plate: string | null;
  readonly art: 'sedan' | 'suv' | 'pickup';
}

export interface GarageViewModel {
  readonly cards: readonly GarageCard[];
  readonly empty: boolean;
}

/** Everything the garage screen shows, derived from the session. Pure. */
export function buildGarageViewModel(state: CustomerSessionState): GarageViewModel {
  return {
    cards: state.vehicles.map((vehicle) => ({
      id: vehicle.id,
      name: vehicle.name,
      description: `${vehicleFixtures[vehicle.type].name}${vehicle.color ? ` · ${vehicle.color}` : ''}`,
      plate: vehicle.plate || null,
      art: vehicleFixtures[vehicle.type].art,
    })),
    empty: state.vehicles.length === 0,
  };
}
