import { vehicleFixtures, vehicleTypeIds } from '../../fixtures/customerCatalogFixture.ts';
import type { VehicleTypeId } from '../../state/bookingDraft.ts';
import { previewPlate, type SavedVehicle } from '../../state/savedVehicles.ts';

export const PLATE_PREVIEW_PLACEHOLDER = '1234 أ ب ج';

export interface EditorSizeOption {
  readonly id: VehicleTypeId;
  readonly name: string;
  readonly priceLabel: string;
  readonly art: 'sedan' | 'suv' | 'pickup';
}

/** The four sizes in the approved order, with the reference's price labels. */
export const editorSizeOptions: readonly EditorSizeOption[] = vehicleTypeIds.map((id) => ({
  id,
  name: vehicleFixtures[id].name,
  priceLabel: vehicleFixtures[id].fee ? `+${vehicleFixtures[id].fee} ل.س` : 'السعر الأساسي',
  art: vehicleFixtures[id].art,
}));

export function sizeName(type: VehicleTypeId): string {
  return vehicleFixtures[type].name;
}

export function sizeArt(type: VehicleTypeId): 'sedan' | 'suv' | 'pickup' {
  return vehicleFixtures[type].art;
}

/** Text of the plate preview while typing; the sample plate when nothing is typed. */
export function platePreviewText(typed: string): string {
  return previewPlate(typed) || PLATE_PREVIEW_PLACEHOLDER;
}

export interface SavedVehicleChoice {
  readonly id: string;
  readonly name: string;
  readonly selected: boolean;
}

export function savedVehicleChoices(
  vehicles: readonly SavedVehicle[],
  selectedId: string | null,
): readonly SavedVehicleChoice[] {
  return vehicles.map((vehicle) => ({
    id: vehicle.id,
    name: vehicle.name,
    selected: vehicle.id === selectedId,
  }));
}
