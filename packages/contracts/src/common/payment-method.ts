/**
 * Payment methods offered on the approved payment screen (cash after the wash,
 * Sham Cash, Syriatel Cash). The customer's choice is a booking fact; whether
 * money arrived is a Billing fact. Adding a method is a contract change and
 * needs an explicit product/provider decision.
 */
export const PAYMENT_METHODS = ['CASH_AFTER_SERVICE', 'SHAM_CASH', 'SYRIATEL_CASH'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Methods settled by a wallet transfer that Billing must verify before PAID. */
export const WALLET_PAYMENT_METHODS = ['SHAM_CASH', 'SYRIATEL_CASH'] as const;
