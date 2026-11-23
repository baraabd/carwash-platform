import {
  extraFixtures,
  illustrativeCost,
  packageFixtures,
  vehicleFixtures,
} from '../../fixtures/customerCatalogFixture.ts';
import type { BookingDraft } from '../../state/bookingDraft.ts';

export interface PriceBreakdownLine {
  /** What the line charges for (`package`, `vehicle`, `extra:<id>`, `visit`). Unique per bill. */
  readonly id: string;
  readonly label: string;
  /** Already formatted for display, e.g. "500 ل.س", "+200 ل.س" or "ضمن السعر". */
  readonly value: string;
}

export interface PriceBreakdown {
  readonly lines: readonly PriceBreakdownLine[];
  readonly total: number;
}

const grouped = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/**
 * The approved "السعر، بدون مفاجآت." bill for a draft: package, size surcharge, any
 * chargeable extras the draft already carries, and the visit line. Presentation
 * of `illustrativeCost` only — it adds nothing up itself.
 */
export function buildPriceBreakdown(
  draft: Pick<BookingDraft, 'service' | 'vehicleType' | 'extras'>,
): PriceBreakdown {
  const cost = illustrativeCost(draft);
  return {
    lines: [
      {
        id: 'package',
        label: packageFixtures[draft.service].name,
        value: `${grouped.format(cost.base)} ل.س`,
      },
      {
        id: 'vehicle',
        label: `حجم السيارة · ${vehicleFixtures[draft.vehicleType].name}`,
        value: cost.vehicle ? `+${cost.vehicle} ل.س` : 'ضمن السعر',
      },
      ...cost.extraIds.map((extra) => ({
        id: `extra:${extra}`,
        label: extraFixtures[extra].name,
        value: `+${extraFixtures[extra].price} ل.س`,
      })),
      { id: 'visit', label: 'الوصول إلى الموقع', value: 'ضمن سعر التجربة' },
    ],
    total: cost.total,
  };
}
