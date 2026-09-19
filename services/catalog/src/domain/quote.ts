export interface QuoteLine { unitAmountMinor: string; quantity: number }
export interface QuoteInput { currency: string; lines: ReadonlyArray<QuoteLine>; discountBps: number }
export interface QuoteResult { currency: string; subtotalMinor: string; discountMinor: string; totalMinor: string }
const MAX = 999_999_999_999_999_999n;
function amount(value: string): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,17})$/.test(value)) throw new Error('INVALID_AMOUNT');
  return BigInt(value);
}
/** Internal calculation only. Callers resolve price versions server-side.
 * Not an HTTP DTO. Does not persist/reserve quotes, coupons, taxes or entitlements.
 * Rounding rule for non-negative discounts is half-up in minor units.
 */
export function calculateQuote(input: QuoteInput): QuoteResult {
  if (!/^[A-Z]{3}$/.test(input.currency)) throw new Error('INVALID_CURRENCY_FORMAT');
  // Syntax does not prove that a currency is supported: the catalog application must check its registry.
  if (!Array.isArray(input.lines) || input.lines.length < 1 || input.lines.length > 100) throw new Error('INVALID_LINES');
  if (!Number.isInteger(input.discountBps) || input.discountBps < 0 || input.discountBps > 10_000)
    throw new Error('INVALID_DISCOUNT');
  let subtotal = 0n;
  for (const line of input.lines) {
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 1000) throw new Error('INVALID_QUANTITY');
    subtotal += amount(line.unitAmountMinor) * BigInt(line.quantity);
    if (subtotal > MAX) throw new Error('AMOUNT_OVERFLOW');
  }
  const discount = (subtotal * BigInt(input.discountBps) + 5_000n) / 10_000n;
  return {currency:input.currency, subtotalMinor:subtotal.toString(), discountMinor:discount.toString(), totalMinor:(subtotal-discount).toString()};
}
