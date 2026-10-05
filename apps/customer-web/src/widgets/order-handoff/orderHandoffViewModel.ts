import { illustrativeCost } from '../../fixtures/customerCatalogFixture.ts';
import type { CustomerOrderSnapshot, InitialOrderPayment } from '../../state/customerSession.ts';
import { buildReceiptView, type ReceiptView } from '../order-receipt/receiptViewModel.ts';

/**
 * The minimal post-confirmation handoff on the existing `/order/:id` and `/pay/:id`
 * routes (C014). It shows the order recorded in this session and says plainly what
 * it is not. The reference's full tracking and checkout screens (stages, technician,
 * QR, proof, cancellation, rating) are later sprints and are not imitated here.
 */

export type HandoffKind = 'tracking' | 'payment';

/** The reference's PAYMENT_STATES wording for the two initial, unpaid states. */
export const INITIAL_PAYMENT_COPY: Readonly<
  Record<InitialOrderPayment['status'], { readonly label: string; readonly hint: string }>
> = {
  cash_due: {
    label: 'كاش بعد الغسيل',
    hint: 'لم يتم تحصيل أي مبلغ. يبقى الدفع مستحقًا حتى استلامه.',
  },
  awaiting_transfer: {
    label: 'بانتظار التحويل',
    hint: 'الحجز مسجّل تجريبيًا، ولم يُؤكد الدفع. لا يبدأ تنفيذ الخدمة قبل التحقق.',
  },
};

/** C014 wording, not a quote: what the session order is and is not. */
export const SESSION_ORDER_DISCLOSURE =
  'طلب تجريبي لهذه الجلسة فقط: لم يُرسل إلى أي مزوّد، ولم يُحجز فني أو موعد، ولم يُدفع أي مبلغ. يختفي عند إعادة تحميل الصفحة.';
export const WALLET_CHECKOUT_DEFERRED =
  'لا يظهر QR ولا بيانات تحويل في هذا النموذج بعد. لا تحوّل أي مبلغ.';
export const ORDER_NOT_FOUND_TITLE = 'لم نجد هذا الطلب في هذه الجلسة.';
export const ORDER_NOT_FOUND_TEXT =
  'الطلبات التجريبية تبقى في هذه الصفحة فقط، وتختفي عند إعادة التحميل أو فتح رابط قديم.';

export interface OrderHandoffView {
  readonly orderId: string;
  readonly title: string;
  readonly receipt: ReceiptView;
  /** Present only for an order confirmed in this session. */
  readonly confirmed: {
    readonly total: number;
    readonly payment: { readonly label: string; readonly hint: string };
    readonly walletDeferred: boolean;
  } | null;
}

export function findSessionOrder(
  orders: readonly CustomerOrderSnapshot[],
  orderId: string | undefined,
): CustomerOrderSnapshot | null {
  if (typeof orderId !== 'string' || orderId === '') return null;
  return orders.find((order) => order.id === orderId) ?? null;
}

export function buildOrderHandoffView(
  order: CustomerOrderSnapshot,
  kind: HandoffKind,
): OrderHandoffView {
  const record = order.confirmation;
  // A confirmed order shows what was recorded; an older demo order has no record,
  // so its duration is only described from its own choices.
  const minutes = record ? record.minutes : illustrativeCost(order).minutes;
  return {
    orderId: order.id,
    title:
      kind === 'payment'
        ? 'الدفع، بكل وضوح.'
        : record && order.stage === 0
          ? 'كل شيء جاهز لغسلتك.'
          : 'غسلتك خطوة بخطوة',
    receipt: buildReceiptView(order, minutes),
    confirmed: record
      ? {
          total: record.total,
          payment: INITIAL_PAYMENT_COPY[record.payment.status],
          walletDeferred: record.payment.method !== 'cash',
        }
      : null,
  };
}
