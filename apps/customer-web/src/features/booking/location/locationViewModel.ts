import { illustrativeCost } from '../../../fixtures/customerCatalogFixture.ts';
import type { CustomerSessionState } from '../../../state/customerSession.ts';
import type { SamplePlaceKind } from '../../../state/locationStep.ts';

export interface PlaceShortcut {
  readonly kind: SamplePlaceKind;
  readonly icon: 'home' | 'work';
  readonly name: string;
  readonly selected: boolean;
}

export interface LocationStepViewModel {
  /** Whether the draft carries any address text. */
  readonly hasAddress: boolean;
  /** Accessible name of the card that opens the address sheet. */
  readonly cardLabel: string;
  readonly cardTitle: string;
  readonly cardPreview: string;
  readonly shortcuts: readonly PlaceShortcut[];
  /** The kind of sample place the draft holds, for the selection feedback. */
  readonly selectedShortcut: SamplePlaceKind | null;
  /** Access note shown under the tip, or an empty string. */
  readonly locationNote: string;
  readonly footerTotal: number;
  readonly footerMinutes: number;
}

const shortcuts = [
  { kind: 'home', icon: 'home', name: 'المنزل' },
  { kind: 'work', icon: 'work', name: 'العمل' },
] as const;

/** Everything the location step shows, derived from the session. Pure. */
export function buildLocationStepViewModel(state: CustomerSessionState): LocationStepViewModel {
  const { draft } = state;
  const hasAddress = draft.address !== '';
  const placeKind = draft.place?.kind;
  const cost = illustrativeCost(draft);
  return {
    hasAddress,
    cardLabel: `${hasAddress ? 'تعديل' : 'تحديد'} مكان غسيل السيارة`,
    cardTitle: hasAddress ? draft.addressLabel || 'موقع الغسيل' : 'حدد مكان السيارة',
    cardPreview: hasAddress ? draft.address : 'اكتب العنوان أو اختر نقطة على الخريطة',
    shortcuts: shortcuts.map((shortcut) => ({
      ...shortcut,
      selected: placeKind === shortcut.kind,
    })),
    selectedShortcut: placeKind === 'home' || placeKind === 'work' ? placeKind : null,
    locationNote: draft.locationNote,
    footerTotal: cost.total,
    footerMinutes: cost.minutes,
  };
}
