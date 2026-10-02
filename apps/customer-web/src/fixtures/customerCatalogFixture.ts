import type {
  BookingDraft,
  CareExtraId,
  CarePackageId,
  VehicleTypeId,
} from '../state/bookingDraft.ts';
import type { OrderStage } from '../state/customerSession.ts';

/**
 * Illustrative display data copied from the approved prototype. It is fixture
 * content for the deterministic UI, not a price list: production package
 * definitions come from Catalog and every payable amount from a Pricing quote.
 */

export type PackageIconId = 'drop' | 'spark' | 'shield';

export interface PackageFixture {
  readonly name: string;
  readonly short: string;
  readonly price: number;
  readonly minutes: number;
  readonly icon: PackageIconId;
}

export const packageFixtures: Readonly<Record<CarePackageId, PackageFixture>> = {
  exterior: { name: 'لمعة سريعة', short: 'غسيل خارجي', price: 500, minutes: 35, icon: 'drop' },
  complete: {
    name: 'نظافة متكاملة',
    short: 'داخلي + خارجي',
    price: 900,
    minutes: 60,
    icon: 'spark',
  },
  premium: {
    name: 'عناية استثنائية',
    short: 'عناية بالتفاصيل',
    price: 1500,
    minutes: 95,
    icon: 'shield',
  },
};

export interface VehicleFixture {
  readonly name: string;
  readonly fee: number;
  readonly minutes: number;
  readonly art: 'sedan' | 'suv' | 'pickup';
}

export const vehicleFixtures: Readonly<Record<VehicleTypeId, VehicleFixture>> = {
  sedan: { name: 'سيدان', fee: 0, minutes: 0, art: 'sedan' },
  suv: { name: 'كروس أوفر', fee: 200, minutes: 10, art: 'suv' },
  large: { name: 'دفع رباعي', fee: 350, minutes: 20, art: 'suv' },
  pickup: { name: 'بيك أب', fee: 250, minutes: 15, art: 'pickup' },
};

const extraPriceFixtures: Readonly<Record<CareExtraId, number>> = {
  seats: 350,
  wheels: 150,
  fresh: 100,
};

const extrasIncludedInPackage: Readonly<Record<CarePackageId, readonly CareExtraId[]>> = {
  exterior: [],
  complete: [],
  premium: ['wheels'],
};

/** Labels of the in-progress tracking stages shown on the Home follow-up card. */
export const orderStageLabels: Readonly<Record<Exclude<OrderStage, -1>, string>> = {
  0: 'استلمنا الطلب',
  1: 'تعيين الفني',
  2: 'في الطريق',
  3: 'جاري الغسيل',
  4: 'مكتمل',
};

/** The two packages the approved Home offers as direct entries, in display order. */
export const homePackageIds: readonly CarePackageId[] = ['exterior', 'complete'];

/**
 * Illustrative draft total, mirroring the prototype's local sum so the saved-draft
 * card shows the approved figure. It is not a quote and is never charged.
 */
export function illustrativeDraftTotal(
  draft: Pick<BookingDraft, 'service' | 'vehicleType' | 'extras'>,
): number {
  const included = extrasIncludedInPackage[draft.service];
  const extras = [...new Set(draft.extras)].filter((extra) => !included.includes(extra));
  return (
    packageFixtures[draft.service].price +
    vehicleFixtures[draft.vehicleType].fee +
    extras.reduce((sum, extra) => sum + extraPriceFixtures[extra], 0)
  );
}

const extraMinuteFixtures: Readonly<Record<CareExtraId, number>> = {
  seats: 20,
  wheels: 10,
  fresh: 5,
};

/** Vehicle sizes in the approved display order of the vehicle step. */
export const vehicleTypeIds: readonly VehicleTypeId[] = ['sedan', 'suv', 'large', 'pickup'];

/** Illustrative duration shown in the booking footer. An estimate, not a reserved slot length. */
export function illustrativeDraftMinutes(
  draft: Pick<BookingDraft, 'service' | 'vehicleType' | 'extras'>,
): number {
  const included = extrasIncludedInPackage[draft.service];
  const extras = [...new Set(draft.extras)].filter((extra) => !included.includes(extra));
  return (
    packageFixtures[draft.service].minutes +
    vehicleFixtures[draft.vehicleType].minutes +
    extras.reduce((sum, extra) => sum + extraMinuteFixtures[extra], 0)
  );
}
