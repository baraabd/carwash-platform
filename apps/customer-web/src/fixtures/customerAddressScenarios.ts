import { blankBookingDraft } from '../state/bookingDraft.ts';
import type { CustomerSessionState } from '../state/customerSession.ts';
import type { SavedAddress } from '../state/savedAddresses.ts';
import { emptySession } from './customerHomeScenarios.ts';

/**
 * Deterministic address books, selected with `?scenario=<id>` like the other
 * scenarios. Sample text only — no real address and no coordinates: a place's
 * x/y are positions in the illustrative drawing. An empty address book is the
 * default session (`home-empty`).
 */

export type AddressScenarioId =
  'addresses-one' | 'addresses-three' | 'addresses-full' | 'addresses-draft-from-book';

const home: SavedAddress = {
  id: 'ADR-1',
  label: 'المنزل',
  address: 'دمشق، المزة، شارع تجريبي 12',
  locationNote: '',
  place: { kind: 'home', x: 350, y: 250, label: 'عنوان توضيحي للتجربة' },
};

// A pin away from the centre, a long address and an access note.
const office: SavedAddress = {
  id: 'ADR-2',
  label: 'مكتب الشركة',
  address: 'دمشق، شارع تجريبي طويل الاسم، بناء توضيحي رقم 4، الطابق الأرضي قرب المدخل الخلفي',
  locationNote: 'أمام البوابة الخضراء، اتصل عند الوصول',
  place: { kind: 'map', x: 228, y: 312, label: 'نقطة مختارة على الخريطة التوضيحية' },
};

// Text that looks like markup must be shown as text, never interpreted; no pin.
const markupLabelled: SavedAddress = {
  id: 'ADR-3',
  label: '<b>بيت</b> & "تجربة"',
  address: 'دمشق، عنوان توضيحي <img src=x> رقم 9',
  locationNote: '',
  place: null,
};

const three = [home, office, markupLabelled];

/** Twenty records: the address book at its capacity. */
const full: readonly SavedAddress[] = Array.from({ length: 20 }, (_, index) => ({
  id: `ADR-${index + 1}`,
  label: `عنوان ${index + 1}`,
  address: `دمشق، شارع توضيحي ${index + 1}`,
  locationNote: '',
  place: { kind: 'manual', x: 350, y: 250, label: 'عنوان يدوي' },
}));

const scenarioBuilders: Readonly<Record<AddressScenarioId, () => CustomerSessionState>> = {
  'addresses-one': () => ({ ...emptySession(), addresses: [home], addressSequence: 1 }),
  'addresses-three': () => ({ ...emptySession(), addresses: three, addressSequence: 3 }),
  'addresses-full': () => ({ ...emptySession(), addresses: full, addressSequence: 20 }),
  // The draft already uses the second saved address, as after tapping its chip.
  'addresses-draft-from-book': () => ({
    ...emptySession(),
    addresses: three,
    addressSequence: 3,
    draft: {
      ...blankBookingDraft(),
      vehicleType: 'suv',
      service: 'complete',
      address: office.address,
      addressLabel: office.label,
      locationNote: office.locationNote,
      place: office.place ? { ...office.place } : null,
      saveAddress: false,
      touched: true,
    },
    draftStep: 2,
  }),
};

export const addressScenarioIds = Object.keys(scenarioBuilders) as readonly AddressScenarioId[];

export function isAddressScenarioId(value: string | null | undefined): value is AddressScenarioId {
  return typeof value === 'string' && Object.hasOwn(scenarioBuilders, value);
}

export function addressScenarioState(id: AddressScenarioId): CustomerSessionState {
  return scenarioBuilders[id]();
}
