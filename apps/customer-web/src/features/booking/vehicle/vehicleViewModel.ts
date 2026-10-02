import {
  illustrativeDraftMinutes,
  illustrativeDraftTotal,
  vehicleFixtures,
  vehicleTypeIds,
} from '../../../fixtures/customerCatalogFixture.ts';
import type { VehicleTypeId } from '../../../state/bookingDraft.ts';
import type { CustomerSessionState } from '../../../state/customerSession.ts';

export type CarArtId = 'sedan' | 'suv' | 'pickup';

export interface VehicleOption {
  readonly id: VehicleTypeId;
  readonly name: string;
  /** "+200 ل.س" style surcharge, or the base-price label for the smallest size. */
  readonly priceLabel: string;
  readonly art: CarArtId;
  readonly selected: boolean;
}

export interface VehicleStepViewModel {
  readonly options: readonly VehicleOption[];
  readonly selectedType: VehicleTypeId;
  readonly stageArt: CarArtId;
  /** The car's own name when the customer gave one, otherwise its size name. */
  readonly stageName: string;
  readonly plate: string;
  /** Optional name and colour summary, or null when neither was given. */
  readonly detailsSummary: string | null;
  readonly saveVehicle: boolean;
  readonly footerTotal: number;
  readonly footerMinutes: number;
}

/** Everything the vehicle step shows, derived from the session. Pure. */
export function buildVehicleStepViewModel(state: CustomerSessionState): VehicleStepViewModel {
  const { draft } = state;
  const selected = vehicleFixtures[draft.vehicleType];
  return {
    options: vehicleTypeIds.map((id) => ({
      id,
      name: vehicleFixtures[id].name,
      priceLabel: vehicleFixtures[id].fee ? `+${vehicleFixtures[id].fee} ل.س` : 'السعر الأساسي',
      art: vehicleFixtures[id].art,
      selected: id === draft.vehicleType,
    })),
    selectedType: draft.vehicleType,
    stageArt: selected.art,
    stageName: draft.carName.trim().slice(0, 60) || selected.name,
    plate: draft.plate,
    detailsSummary: draft.carName || draft.color ? `${draft.carName} ${draft.color}` : null,
    saveVehicle: draft.saveVehicle,
    footerTotal: illustrativeDraftTotal(draft),
    footerMinutes: illustrativeDraftMinutes(draft),
  };
}

/** Text read to assistive technology after a size is chosen. */
export function vehicleSelectionAnnouncement(
  state: CustomerSessionState,
  vehicleType: VehicleTypeId,
): string {
  const total = illustrativeDraftTotal({ ...state.draft, vehicleType });
  return `${vehicleFixtures[vehicleType].name}، الإجمالي ${total} ليرة سورية.`;
}
