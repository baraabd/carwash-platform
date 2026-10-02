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
 * All amounts are whole Syrian pounds; there is no fractional arithmetic.
 */

export type PackageIconId = 'drop' | 'spark' | 'shield';

export interface PackageFixture {
  readonly name: string;
  readonly short: string;
  readonly price: number;
  readonly minutes: number;
  readonly icon: PackageIconId;
  /** Latin label printed above the name on the care step. */
  readonly kicker: string;
  readonly features: readonly string[];
  /** Extras this package already contains; they are never charged on top of it. */
  readonly includes: readonly CareExtraId[];
}

export const packageFixtures: Readonly<Record<CarePackageId, PackageFixture>> = {
  exterior: {
    name: 'لمعة سريعة',
    short: 'غسيل خارجي',
    price: 500,
    minutes: 35,
    icon: 'drop',
    kicker: 'EVERYDAY CLEAN',
    features: ['غسيل الهيكل', 'تنظيف الزجاج', 'تجفيف يدوي'],
    includes: [],
  },
  complete: {
    name: 'نظافة متكاملة',
    short: 'داخلي + خارجي',
    price: 900,
    minutes: 60,
    icon: 'spark',
    kicker: 'INSIDE & OUT',
    features: ['غسيل خارجي', 'شفط الأتربة', 'تنظيف المقصورة'],
    includes: [],
  },
  premium: {
    name: 'عناية استثنائية',
    short: 'عناية بالتفاصيل',
    price: 1500,
    minutes: 95,
    icon: 'shield',
    kicker: 'SIGNATURE CARE',
    features: ['تنظيف متكامل', 'عناية بالتفاصيل', 'تلميع الإطارات'],
    includes: ['wheels'],
  },
};

/** The three packages in the approved display order. */
export const carePackageIds: readonly CarePackageId[] = ['exterior', 'complete', 'premium'];

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

/** Vehicle sizes in the approved display order of the vehicle step. */
export const vehicleTypeIds: readonly VehicleTypeId[] = ['sedan', 'suv', 'large', 'pickup'];

export interface ExtraFixture {
  readonly name: string;
  readonly price: number;
  readonly minutes: number;
}

/**
 * Add-ons a draft may already carry. Choosing them is the extras sprint (C007);
 * they are listed here only so an existing draft is priced and described truthfully.
 */
export const extraFixtures: Readonly<Record<CareExtraId, ExtraFixture>> = {
  seats: { name: 'تنظيف المقاعد', price: 350, minutes: 20 },
  wheels: { name: 'تلميع الإطارات', price: 150, minutes: 10 },
  fresh: { name: 'تعطير المقصورة', price: 100, minutes: 5 },
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

type PricedDraft = Pick<BookingDraft, 'service' | 'vehicleType' | 'extras'>;

export interface IllustrativeCost {
  /** Package price for the smallest size. */
  readonly base: number;
  /** Surcharge for the chosen vehicle size; 0 for the smallest. */
  readonly vehicle: number;
  /** Chargeable extras: de-duplicated and without those the package includes. */
  readonly extraIds: readonly CareExtraId[];
  readonly extras: number;
  readonly total: number;
  readonly minutes: number;
}

/**
 * The one place the illustrative figures are added up, mirroring the prototype's
 * `cost()`: package + size surcharge + chargeable extras. It is not a quote and is
 * never charged; a payable amount will come from the Pricing service.
 */
export function illustrativeCost(draft: PricedDraft): IllustrativeCost {
  const pack = packageFixtures[draft.service];
  const vehicle = vehicleFixtures[draft.vehicleType];
  const extraIds = [...new Set(draft.extras)].filter((extra) => !pack.includes.includes(extra));
  const extras = extraIds.reduce((sum, extra) => sum + extraFixtures[extra].price, 0);
  return {
    base: pack.price,
    vehicle: vehicle.fee,
    extraIds,
    extras,
    total: pack.price + vehicle.fee + extras,
    minutes:
      pack.minutes +
      vehicle.minutes +
      extraIds.reduce((sum, extra) => sum + extraFixtures[extra].minutes, 0),
  };
}

/** Illustrative draft total shown on Home and in the booking footer. */
export function illustrativeDraftTotal(draft: PricedDraft): number {
  return illustrativeCost(draft).total;
}

/** Illustrative duration shown in the booking footer. An estimate, not a reserved slot length. */
export function illustrativeDraftMinutes(draft: PricedDraft): number {
  return illustrativeCost(draft).minutes;
}
