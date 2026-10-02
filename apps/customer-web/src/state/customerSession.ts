import type {
  BookingDraft,
  BookingSlot,
  CareExtraId,
  CarePackageId,
  PaymentMethodId,
  VehicleTypeId,
} from './bookingDraft';

/** -1 cancelled, 0–3 in progress, 4 completed — the approved tracking stages. */
export type OrderStage = -1 | 0 | 1 | 2 | 3 | 4;

/** A read-only snapshot of an existing order. The session never creates or mutates one. */
export interface CustomerOrderSnapshot {
  readonly id: string;
  readonly stage: OrderStage;
  readonly vehicleType: VehicleTypeId;
  readonly carName: string;
  readonly plate: string;
  readonly color: string;
  readonly service: CarePackageId;
  readonly extras: readonly CareExtraId[];
  readonly address: string;
  readonly addressLabel: string;
  readonly locationNote: string;
  readonly slot: BookingSlot | null;
  readonly contactName: string;
  readonly contactPhone: string;
  readonly note: string;
  readonly paymentMethod: PaymentMethodId | null;
}

export type BookingMode = 'standard' | 'repeat';

export interface CustomerSessionState {
  readonly profile: { readonly name: string; readonly phone: string };
  readonly orders: readonly CustomerOrderSnapshot[];
  readonly draft: BookingDraft;
  /** The booking step the draft was last left at. */
  readonly draftStep: number;
  readonly bookingMode: BookingMode;
  /** Next slot offered for a repeat. A fixture stand-in for a Scheduling answer. */
  readonly nextAvailableSlot: BookingSlot | null;
  readonly notice: { readonly message: string; readonly sequence: number } | null;
}

export type NavigationIntent =
  | { readonly kind: 'booking-step'; readonly step: number }
  | { readonly kind: 'order-tracking'; readonly orderId: string };

export interface SessionTransition {
  readonly state: CustomerSessionState;
  /** Where the customer goes next; null when the command did not apply. */
  readonly intent: NavigationIntent | null;
}

export const REPEAT_BOOKING_NOTICE = 'اخترنا أقرب موعد تجريبي جديد. راجع التفاصيل ثم أكّد.';

export function isOrderInProgress(order: CustomerOrderSnapshot): boolean {
  return order.stage >= 0 && order.stage < 4;
}

export function isOrderCompleted(order: CustomerOrderSnapshot): boolean {
  return order.stage === 4;
}

/** Count shown on the bookings tab badge: orders still in progress. */
export function inProgressOrderCount(state: CustomerSessionState): number {
  return state.orders.filter(isOrderInProgress).length;
}
