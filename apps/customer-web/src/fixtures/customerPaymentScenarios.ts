import type { PaymentMethodId } from '../state/bookingDraft.ts';
import type { CustomerSessionState } from '../state/customerSession.ts';
import { contactScenarioState } from './customerContactScenarios.ts';

export type PaymentScenarioId =
  | 'booking-payment-empty'
  | 'booking-payment-cash'
  | 'booking-payment-sham'
  | 'booking-payment-syriatel';

function paymentState(paymentMethod: PaymentMethodId | null): CustomerSessionState {
  const base = contactScenarioState('booking-contact-prefilled');
  return {
    ...base,
    draft: { ...base.draft, paymentMethod, touched: true },
    draftStep: 5,
  };
}

const builders: Readonly<Record<PaymentScenarioId, () => CustomerSessionState>> = {
  'booking-payment-empty': () => paymentState(null),
  'booking-payment-cash': () => paymentState('cash'),
  'booking-payment-sham': () => paymentState('sham'),
  'booking-payment-syriatel': () => paymentState('syriatel'),
};

export const paymentScenarioIds = Object.keys(builders) as readonly PaymentScenarioId[];

export function isPaymentScenarioId(value: string | null | undefined): value is PaymentScenarioId {
  return typeof value === 'string' && Object.hasOwn(builders, value);
}

export function paymentScenarioState(id: PaymentScenarioId): CustomerSessionState {
  return builders[id]();
}
