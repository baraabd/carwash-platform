import {
  ReceiptAlreadyExists,
  type AuditRecord,
  type IdempotencyReceipt,
  type NewPriceBook,
  type PriceBook,
  type PricingRepository,
  type PricingUnitOfWork,
  type StoredQuote,
} from '../../src/ports';

/**
 * TEST DOUBLE of the persistence port for transport/application specs. It
 * serialises transactions and commits staged writes only when the work
 * succeeds, mirroring rollback. Real constraints, triggers and races are
 * proven separately against PostgreSQL (test/integration).
 */
export class InMemoryPricingRepository implements PricingRepository {
  readonly books: NewPriceBook[] = [];
  readonly quotes = new Map<string, StoredQuote>();
  readonly receipts = new Map<string, IdempotencyReceipt>();
  readonly audit: AuditRecord[] = [];
  private queue: Promise<unknown> = Promise.resolve();

  private static key(actor: string, operation: string, key: string): string {
    return `${actor}|${operation}|${key}`;
  }

  transaction<T>(work: (uow: PricingUnitOfWork) => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const books: NewPriceBook[] = [];
      const quotes: StoredQuote[] = [];
      const receipts: IdempotencyReceipt[] = [];
      const audit: AuditRecord[] = [];
      const uow: PricingUnitOfWork = {
        lockPriceBookHead: () => Promise.resolve(this.books.at(-1)?.revision ?? null),
        priceBookInForce: () => Promise.resolve<PriceBook | null>(this.books.at(-1) ?? null),
        findReceipt: (a, o, k) => this.findReceipt(a, o, k),
        insertPriceBook: (book) => {
          books.push(book);
          return Promise.resolve();
        },
        insertQuote: (quote) => {
          quotes.push(quote);
          return Promise.resolve();
        },
        saveReceipt: (receipt) => {
          const key = InMemoryPricingRepository.key(
            receipt.actorSubject,
            receipt.operation,
            receipt.idempotencyKey,
          );
          if (this.receipts.has(key)) return Promise.reject(new ReceiptAlreadyExists());
          receipts.push(receipt);
          return Promise.resolve();
        },
        appendAudit: (record) => {
          audit.push(record);
          return Promise.resolve();
        },
      };
      const result = await work(uow);
      this.books.push(...books);
      for (const quote of quotes) this.quotes.set(quote.id, quote);
      for (const r of receipts)
        this.receipts.set(
          InMemoryPricingRepository.key(r.actorSubject, r.operation, r.idempotencyKey),
          r,
        );
      this.audit.push(...audit);
      return result;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  findReceipt(actor: string, operation: string, key: string): Promise<IdempotencyReceipt | null> {
    return Promise.resolve(
      this.receipts.get(InMemoryPricingRepository.key(actor, operation, key)) ?? null,
    );
  }

  quote(id: string): Promise<StoredQuote | null> {
    return Promise.resolve(this.quotes.get(id) ?? null);
  }

  appendAudit(record: AuditRecord): Promise<void> {
    this.audit.push(record);
    return Promise.resolve();
  }
}
