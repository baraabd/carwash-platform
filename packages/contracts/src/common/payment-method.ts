/**
 * Payment methods offered on the approved payment screen (cash after the wash,
 * Sham Cash, Syriatel Cash). The customer's choice is a booking fact; whether
 * money arrived is a Billing fact. Adding a method is a contract change and
 * needs an explicit product/provider decision. Names follow the Billing
 * provider (CR-B-01).
 */
export const PAYMENT_METHODS = ['CASH_ON_COMPLETION', 'SHAM_CASH', 'SYRIATEL_CASH'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Methods settled by a wallet transfer that Finance must reconcile before PAID. */
export const WALLET_PAYMENT_METHODS = ['SHAM_CASH', 'SYRIATEL_CASH'] as const;
export type WalletPaymentMethod = (typeof WALLET_PAYMENT_METHODS)[number];

export function isWalletPaymentMethod(method: PaymentMethod): method is WalletPaymentMethod {
  return method !== 'CASH_ON_COMPLETION';
}
