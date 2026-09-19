export interface LedgerEntry { accountId: string; currency: string; side: 'DEBIT' | 'CREDIT'; amountMinor: string }
/** Validate a candidate journal; this does not post money or verify a payment.
 * Storage must independently enforce authorized accounts, balanced posting,
 * immutable posted journals and unique business references transactionally.
 */
export function assertBalancedJournal(entries: ReadonlyArray<LedgerEntry>): void {
 if (!Array.isArray(entries) || entries.length < 2 || entries.length > 1000) throw new Error('INVALID_ENTRY_COUNT');
 const totals = new Map<string,bigint>();
 for (const e of entries) {
  if (typeof e.accountId !== 'string' || e.accountId.trim().length < 1) throw new Error('INVALID_ACCOUNT');
  if (!/^[A-Z]{3}$/.test(e.currency)) throw new Error('INVALID_CURRENCY_FORMAT');
  if (e.side !== 'DEBIT' && e.side !== 'CREDIT') throw new Error('INVALID_SIDE');
  if (typeof e.amountMinor !== 'string' || !/^[1-9][0-9]{0,17}$/.test(e.amountMinor)) throw new Error('INVALID_AMOUNT');
  const delta=BigInt(e.amountMinor)*(e.side==='DEBIT'?1n:-1n);
  totals.set(e.currency,(totals.get(e.currency)??0n)+delta);
 }
 for (const total of totals.values()) if (total!==0n) throw new Error('UNBALANCED_JOURNAL');
}
