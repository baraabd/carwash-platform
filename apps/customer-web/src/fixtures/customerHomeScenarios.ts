import { blankBookingDraft } from '../state/bookingDraft.ts';
import type { CustomerOrderSnapshot, CustomerSessionState } from '../state/customerSession.ts';

/**
 * Deterministic session scenarios for the Home screen. They refine the C002
 * `home-default` route fixture and are selected with `#/?scenario=<id>`; an
 * unknown or missing id falls back to the empty default. Everything here is
 * sample data — no real customer, order, plate or address.
 */

export const HOME_SCENARIO_PARAM = 'scenario';

export type HomeScenarioId =
  | 'home-empty'
  | 'home-active-order'
  | 'home-repeat-order'
  | 'home-saved-draft'
  | 'home-returning-customer';

const sampleOrder: Omit<CustomerOrderSnapshot, 'id' | 'stage'> = {
  vehicleType: 'sedan',
  carName: 'سيارتي التجريبية',
  plate: '123456',
  color: '',
  service: 'complete',
  extras: [],
  address: 'المزة، دمشق',
  addressLabel: 'المنزل',
  locationNote: '',
  slot: { date: '2026-09-18', time: '10:00' },
  contactName: 'سامر التجريبي',
  contactPhone: '0900000000',
  note: '',
  paymentMethod: 'cash',
};

const runningOrder: CustomerOrderSnapshot = { ...sampleOrder, id: 'WG-DEMO-RUNNING', stage: 2 };
const completedOrder: CustomerOrderSnapshot = { ...sampleOrder, id: 'WG-DEMO-DONE', stage: 4 };

export function emptySession(): CustomerSessionState {
  return {
    profile: { name: '', phone: '' },
    orders: [],
    vehicles: [],
    vehicleSequence: 0,
    addresses: [],
    addressSequence: 0,
    draft: blankBookingDraft(),
    draftStep: 0,
    bookingMode: 'standard',
    showAllTimes: false,
    reviewEditing: false,
    notice: null,
    announcement: null,
    orderSequence: 0,
    draftGeneration: 0,
    confirmationReceipts: [],
    pendingHandoff: null,
  };
}

const scenarioBuilders: Readonly<Record<HomeScenarioId, () => CustomerSessionState>> = {
  'home-empty': emptySession,
  'home-active-order': () => ({ ...emptySession(), orders: [runningOrder] }),
  'home-repeat-order': () => ({ ...emptySession(), orders: [completedOrder] }),
  'home-saved-draft': () => ({
    ...emptySession(),
    draft: { ...blankBookingDraft(), service: 'complete', touched: true },
    draftStep: 2,
  }),
  'home-returning-customer': () => ({
    ...emptySession(),
    profile: { name: 'سامر', phone: '0900000000' },
    orders: [runningOrder, completedOrder],
    draft: {
      ...blankBookingDraft(),
      vehicleType: 'suv',
      service: 'premium',
      extras: ['seats'],
      touched: true,
    },
    draftStep: 1,
  }),
};

export const homeScenarioIds = Object.keys(scenarioBuilders) as readonly HomeScenarioId[];

export const DEFAULT_HOME_SCENARIO: HomeScenarioId = 'home-empty';

export function isHomeScenarioId(value: string | null | undefined): value is HomeScenarioId {
  return typeof value === 'string' && Object.hasOwn(scenarioBuilders, value);
}

export function homeScenarioState(id: HomeScenarioId): CustomerSessionState {
  return scenarioBuilders[id]();
}
