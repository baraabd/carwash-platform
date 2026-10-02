import { blankBookingDraft } from '../state/bookingDraft.ts';
import type { CustomerSessionState } from '../state/customerSession.ts';
import type { SavedVehicle } from '../state/savedVehicles.ts';
import { emptySession } from './customerHomeScenarios.ts';

/**
 * Deterministic garages, selected with `?scenario=<id>` like the other scenarios.
 * Sample data only — no real car, plate or customer. An empty garage is the
 * default session (`home-empty`).
 */

export type GarageScenarioId =
  'garage-one-vehicle' | 'garage-three-vehicles' | 'garage-vehicle-chosen';

const familyCar: SavedVehicle = {
  id: 'CAR-1',
  type: 'suv',
  name: 'سيارة العائلة',
  plate: '4821 ب ج',
  color: 'أبيض',
};

// No plate and no colour: the card shows the approved "plate not added" line.
const workPickup: SavedVehicle = {
  id: 'CAR-2',
  type: 'pickup',
  name: 'بيك أب',
  plate: '',
  color: '',
};

// A name that looks like markup must be shown as text, never interpreted.
const markupNamedCar: SavedVehicle = {
  id: 'CAR-3',
  type: 'sedan',
  name: '<b>كامري</b> & "تجربة"',
  plate: '7 ABC',
  color: 'رمادي',
};

const threeVehicles = [familyCar, workPickup, markupNamedCar];

const scenarioBuilders: Readonly<Record<GarageScenarioId, () => CustomerSessionState>> = {
  'garage-one-vehicle': () => ({ ...emptySession(), vehicles: [familyCar], vehicleSequence: 1 }),
  'garage-three-vehicles': () => ({
    ...emptySession(),
    vehicles: threeVehicles,
    vehicleSequence: 3,
  }),
  // The draft already uses a saved car, as after tapping its chip on the vehicle step.
  'garage-vehicle-chosen': () => ({
    ...emptySession(),
    vehicles: threeVehicles,
    vehicleSequence: 3,
    draft: {
      ...blankBookingDraft(),
      vehicleType: familyCar.type,
      carId: familyCar.id,
      carName: familyCar.name,
      plate: familyCar.plate,
      color: familyCar.color,
      touched: true,
    },
  }),
};

export const garageScenarioIds = Object.keys(scenarioBuilders) as readonly GarageScenarioId[];

export function isGarageScenarioId(value: string | null | undefined): value is GarageScenarioId {
  return typeof value === 'string' && Object.hasOwn(scenarioBuilders, value);
}

export function garageScenarioState(id: GarageScenarioId): CustomerSessionState {
  return scenarioBuilders[id]();
}
