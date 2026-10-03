import {
  careExtraIds,
  extraFixtures,
  illustrativeCost,
  packageFixtures,
  type ExtraIconId,
} from '../../../fixtures/customerCatalogFixture.ts';
import type { BookingDraft, CareExtraId } from '../../../state/bookingDraft.ts';

export interface ExtraOption {
  readonly id: CareExtraId;
  readonly name: string;
  readonly hint: string;
  readonly icon: ExtraIconId;
  /** Part of the chosen package: shown ticked, not toggleable, never charged. */
  readonly included: boolean;
  /** Ticked: either chosen by the customer or included in the package. */
  readonly checked: boolean;
  /** "+350" for a payable add-on, or "ضمن الباقة" when the package includes it. */
  readonly priceLabel: string;
}

export interface ExtrasViewModel {
  readonly options: readonly ExtraOption[];
  /** Draft total with the current choices, from the one pricing calculation. */
  readonly total: number;
}

export const INCLUDED_IN_PACKAGE_LABEL = 'ضمن الباقة';

/** The add-ons sheet for a draft. Pure: the same draft always gives the same sheet. */
export function buildExtrasViewModel(
  draft: Pick<BookingDraft, 'service' | 'vehicleType' | 'extras'>,
): ExtrasViewModel {
  const included = packageFixtures[draft.service].includes;
  return {
    options: careExtraIds.map((id) => {
      const isIncluded = included.includes(id);
      return {
        id,
        name: extraFixtures[id].name,
        hint: extraFixtures[id].hint,
        icon: extraFixtures[id].icon,
        included: isIncluded,
        checked: isIncluded || draft.extras.includes(id),
        priceLabel: isIncluded ? INCLUDED_IN_PACKAGE_LABEL : `+${extraFixtures[id].price}`,
      };
    }),
    total: illustrativeCost(draft).total,
  };
}
