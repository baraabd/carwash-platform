import { illustrativeCost, vehicleFixtures } from '../../../fixtures/customerCatalogFixture.ts';
import type { ConfirmationCatalog } from '../../../state/bookingConfirmation.ts';

/**
 * The catalog facts a confirmation records, from the one illustrative calculation
 * Review, the footer and the price sheet use. Fixture figures, not a quote from
 * Pricing.
 */
export const confirmationCatalog: ConfirmationCatalog = {
  quote: (draft) => {
    const cost = illustrativeCost(draft);
    return { total: cost.total, minutes: cost.minutes };
  },
  sizeName: (type) => vehicleFixtures[type].name,
};
