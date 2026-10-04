import { isPaymentMethodId, type PaymentMethodId } from './bookingDraft.ts';
import type { CustomerSessionState, SessionTransition } from './customerSession.ts';

export const CONTACT_STEP_INDEX = 4;
export const PAYMENT_STEP_INDEX = 5;
export const REVIEW_STEP_INDEX = 6;

export const PAYMENT_REQUIRED_MESSAGE = 'اختر كيف ستدفع قبل متابعة الحجز.';

export interface PaymentMethodDefinition {
  readonly id: PaymentMethodId;
  readonly name: string;
  readonly short: string;
  readonly hint: string;
  readonly icon: 'banknote' | 'wallet' | 'signal-pay';
  readonly tone: 'cash' | 'sham' | 'syriatel';
}

export const PAYMENT_METHODS: readonly PaymentMethodDefinition[] = [
  {
    id: 'cash',
    name: 'كاش بعد الغسيل',
    short: 'كاش',
    hint: 'ارتاح الآن. وادفع للفني بعد انتهاء العناية.',
    icon: 'banknote',
    tone: 'cash',
  },
  {
    id: 'sham',
    name: 'شام كاش',
    short: 'شام كاش',
    hint: 'رمز QR وبيانات تحويل واضحة أمامك.',
    icon: 'wallet',
    tone: 'sham',
  },
  {
    id: 'syriatel',
    name: 'سيريتل كاش',
    short: 'سيريتل كاش',
    hint: 'ادفع من محفظتك، ثم تابع حالة التحويل.',
    icon: 'signal-pay',
    tone: 'syriatel',
  },
] as const;

const methodById = Object.fromEntries(
  PAYMENT_METHODS.map((method) => [method.id, method]),
) as Readonly<Record<PaymentMethodId, PaymentMethodDefinition>>;

export { isPaymentMethodId };

/** The approved definition of a method, or null for a missing, unknown or prototype key. */
export function paymentMethodDefinition(id: unknown): PaymentMethodDefinition | null {
  return isPaymentMethodId(id) ? methodById[id] : null;
}

export function selectPaymentMethod(
  state: CustomerSessionState,
  method: unknown,
  illustrativeTotal: number,
): CustomerSessionState {
  if (!isPaymentMethodId(method)) return state;
  const definition = methodById[method];
  return {
    ...state,
    draft: { ...state.draft, paymentMethod: method, touched: true },
    announcement: {
      message: `${definition.name}. الإجمالي ${illustrativeTotal} ليرة سورية تجريبية.`,
      sequence: (state.announcement?.sequence ?? 0) + 1,
    },
  };
}

export interface PaymentStepSubmission extends SessionTransition {
  readonly error: string | null;
}

export function submitPaymentStep(state: CustomerSessionState): PaymentStepSubmission {
  if (!isPaymentMethodId(state.draft.paymentMethod)) {
    return {
      state: {
        ...state,
        announcement: {
          message: PAYMENT_REQUIRED_MESSAGE,
          sequence: (state.announcement?.sequence ?? 0) + 1,
        },
      },
      intent: null,
      error: PAYMENT_REQUIRED_MESSAGE,
    };
  }
  return {
    state: {
      ...state,
      draft: { ...state.draft, touched: true },
      draftStep: REVIEW_STEP_INDEX,
    },
    intent: { kind: 'booking-step', step: REVIEW_STEP_INDEX },
    error: null,
  };
}

export function returnToContactStep(state: CustomerSessionState): SessionTransition {
  return { state, intent: { kind: 'booking-step', step: CONTACT_STEP_INDEX } };
}
