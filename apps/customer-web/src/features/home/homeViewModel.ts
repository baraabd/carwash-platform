import {
  homePackageIds,
  illustrativeDraftTotal,
  orderStageLabels,
  packageFixtures,
  vehicleFixtures,
  type PackageIconId,
} from '../../fixtures/customerCatalogFixture.ts';
import type { CarePackageId } from '../../state/bookingDraft.ts';
import {
  isOrderCompleted,
  isOrderInProgress,
  type CustomerSessionState,
} from '../../state/customerSession.ts';

export interface HomePackageCard {
  readonly id: CarePackageId;
  readonly name: string;
  readonly summary: string;
  readonly price: number;
  readonly icon: PackageIconId;
  readonly featured: boolean;
}

export interface HomeViewModel {
  /** Customer's first name for the greeting, or null for the anonymous tagline. */
  readonly greetingName: string | null;
  readonly heroCarArt: 'sedan' | 'suv' | 'pickup';
  readonly startingPrice: number;
  /** In-progress order to follow, if any. */
  readonly activeOrder: { readonly id: string; readonly statusLabel: string } | null;
  /** Most recent completed order offered for a repeat, if any. */
  readonly repeatableOrder: {
    readonly id: string;
    readonly carLabel: string;
    readonly packageName: string;
  } | null;
  /** Unsent draft the customer can continue, if they started one. */
  readonly savedDraft: { readonly packageName: string; readonly total: number } | null;
  readonly packages: readonly HomePackageCard[];
}

/** Derives everything Home shows from the session. Pure: same state, same screen. */
export function buildHomeViewModel(state: CustomerSessionState): HomeViewModel {
  const active = state.orders.find(isOrderInProgress);
  const completed = state.orders.find(isOrderCompleted);
  const { draft } = state;

  return {
    greetingName: state.profile.name || null,
    heroCarArt: vehicleFixtures[draft.vehicleType].art,
    startingPrice: packageFixtures.exterior.price,
    activeOrder:
      active && active.stage !== -1
        ? { id: active.id, statusLabel: orderStageLabels[active.stage] }
        : null,
    repeatableOrder: completed
      ? {
          id: completed.id,
          carLabel: completed.carName || vehicleFixtures[completed.vehicleType].name,
          packageName: packageFixtures[completed.service].name,
        }
      : null,
    savedDraft: draft.touched
      ? { packageName: packageFixtures[draft.service].name, total: illustrativeDraftTotal(draft) }
      : null,
    packages: homePackageIds.map((id, index) => ({
      id,
      name: packageFixtures[id].name,
      summary: `${packageFixtures[id].short} · ${packageFixtures[id].minutes} دقيقة`,
      price: packageFixtures[id].price,
      icon: packageFixtures[id].icon,
      featured: index > 0,
    })),
  };
}
