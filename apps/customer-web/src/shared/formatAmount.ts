const amountFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** The approved reference renders amounts with Latin digits and grouping. */
export function formatAmount(amount: number): string {
  return amountFormat.format(amount);
}
