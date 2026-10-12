import { moneyWire, quoteStatus } from '../domain';
import type { PriceBook, StoredQuote } from '../ports';

/** pricing.v1 QuoteV1. Status is evaluated at `now`; everything else is the stored snapshot. */
export function quoteView(quote: StoredQuote, now: Date): Record<string, unknown> {
  return {
    quoteId: quote.id,
    revision: quote.revision,
    status: quoteStatus(quote.expiresAt, now),
    beneficiary: { kind: quote.beneficiary.kind, subjectId: quote.beneficiary.subjectId },
    vehicleType: quote.vehicleType,
    zoneId: quote.zoneId,
    currency: quote.currency,
    lines: quote.lines.map((line) => ({
      lineId: line.lineId,
      kind: line.kind,
      definitionId: line.definitionId,
      quantity: line.quantity,
      unitPrice: moneyWire(quote.currency, line.unitPriceMinor),
      amount: moneyWire(quote.currency, line.amountMinor),
    })),
    total: moneyWire(quote.currency, quote.totalMinor),
    catalogRevision: quote.catalogRevision,
    priceBookRevision: quote.priceBookRevision,
    issuedAt: quote.issuedAt.toISOString(),
    expiresAt: quote.expiresAt.toISOString(),
  };
}

/** Publication receipt: identifies what is now in force; never echoes every entry. */
export function priceBookView(book: PriceBook): Record<string, unknown> {
  return {
    priceBookRevision: book.revision,
    currency: book.currency,
    catalogRevision: book.catalog.catalogRevision,
    policyRevision: book.policyRevision,
    entryCount: book.entries.length,
    entriesFingerprint: book.entriesFingerprint,
    publishedAt: book.publishedAt.toISOString(),
  };
}
