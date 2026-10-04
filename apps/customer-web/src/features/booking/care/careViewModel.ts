import {
  carePackageIds,
  extraFixtures,
  illustrativeCost,
  packageFixtures,
  vehicleFixtures,
  type PackageIconId,
} from '../../../fixtures/customerCatalogFixture.ts';
import type { CarePackageId } from '../../../state/bookingDraft.ts';
import type { CustomerSessionState } from '../../../state/customerSession.ts';

export interface CarePackageOption {
  readonly id: CarePackageId;
  readonly name: string;
  readonly kicker: string;
  readonly icon: PackageIconId;
  /** "45 دقيقة · غسيل خارجي": duration for the chosen vehicle size, then the summary. */
  readonly durationLine: string;
  /** Package price including the surcharge of the chosen vehicle size. */
  readonly amount: number;
  readonly features: readonly string[];
  readonly selected: boolean;
}

export interface CareStepViewModel {
  /** The car the prices are shown for: its own name, otherwise its size name. */
  readonly carLabel: string;
  readonly options: readonly CarePackageOption[];
  readonly selectedPackage: CarePackageId;
  /** Names of extras the draft already carries, or the approved prompt when none. */
  readonly extrasSummary: string;
  /** "+350 ل.س" for chargeable extras, or an empty string. */
  readonly extrasAmount: string;
  readonly footerTotal: number;
  readonly footerMinutes: number;
}

const EXTRAS_PROMPT = 'المقاعد، الإطارات أو التعطير · اختياري';

/** Everything the care step shows, derived from the session. Pure. */
export function buildCareStepViewModel(state: CustomerSessionState): CareStepViewModel {
  const { draft } = state;
  const vehicle = vehicleFixtures[draft.vehicleType];
  const cost = illustrativeCost(draft);
  return {
    carLabel: draft.carName.trim().slice(0, 60) || vehicle.name,
    options: carePackageIds.map((id) => {
      const pack = packageFixtures[id];
      return {
        id,
        name: pack.name,
        kicker: pack.kicker,
        icon: pack.icon,
        durationLine: `${pack.minutes + vehicle.minutes} دقيقة · ${pack.short}`,
        amount: pack.price + vehicle.fee,
        features: pack.features,
        selected: id === draft.service,
      };
    }),
    selectedPackage: draft.service,
    extrasSummary: draft.extras.length
      ? draft.extras.map((extra) => extraFixtures[extra].name).join('، ')
      : EXTRAS_PROMPT,
    extrasAmount: draft.extras.length ? `+${cost.extras} ل.س` : '',
    footerTotal: cost.total,
    footerMinutes: cost.minutes,
  };
}
