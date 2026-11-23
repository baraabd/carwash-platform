import { randomUUID } from 'node:crypto';
import type { HoldRequest } from '../../src/application';
import type { SchedulingQuote, SchedulingQuoteReader } from '../../src/ports';

/** Explicit finite Pricing double for capacity, transaction and broker tests. */
export class DeclaredQuotes implements SchedulingQuoteReader {
  readonly quotes = new Map<string, SchedulingQuote>();

  register<T extends HoldRequest>(request: T, expiresAt = request.startsAt): T {
    this.quotes.set(request.quoteRef.quoteId, {
      ...request.quoteRef,
      status: 'USABLE',
      beneficiary: request.beneficiary,
      zoneId: request.zoneId,
      durationMinutes: request.durationMinutes,
      expiresAt,
    });
    return request;
  }

  read(quoteId: string): Promise<SchedulingQuote | null> {
    return Promise.resolve(this.quotes.get(quoteId) ?? null);
  }

  /** Closed published Pricing response, for HTTP edge tests only. */
  wire(quoteId: string): Record<string, unknown> | null {
    const quote = this.quotes.get(quoteId);
    if (!quote) return null;
    const money = { currency: 'SYP', amountMinor: '10000', scale: 2 };
    return {
      ...quote,
      vehicleType: 'sedan',
      currency: 'SYP',
      lines: [
        {
          lineId: randomUUID(),
          kind: 'PACKAGE',
          definitionId: randomUUID(),
          quantity: 1,
          unitPrice: money,
          amount: money,
        },
      ],
      total: money,
      catalogRevision: 1,
      priceBookRevision: 1,
      issuedAt: new Date(quote.expiresAt.getTime() - 3_600_000).toISOString(),
      expiresAt: quote.expiresAt.toISOString(),
    };
  }
}
