import type { VersionHead } from '../../src/domain';
import {
  ReceiptAlreadyExists,
  type AuditRecord,
  type IdempotencyReceipt,
  type PricingRepository,
  type PricingUnitOfWork,
  type PublishedPriceVersion,
  type StoredQuote,
} from '../../src/ports';

/**
 * TEST DOUBLE for application/HTTP tests: serialised, staged transactions that
 * discard every write when the work throws. Not persistence evidence.
 */
export class InMemoryPricingRepository implements PricingRepository {
  readonly versions: PublishedPriceVersion[] = [];
  readonly quotes = new Map<string, StoredQuote>();
  readonly receipts = new Map<string, IdempotencyReceipt>();
  readonly audit: AuditRecord[] = [];
  private queue: Promise<unknown> = Promise.resolve();

  private receiptKey(actor: string, operation: string, key: string): string {
    return `${actor}|${operation}|${key}`;
  }

  transaction<T>(work: (uow: PricingUnitOfWork) => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const staged = {
        versions: [] as PublishedPriceVersion[],
        quotes: [] as StoredQuote[],
        receipts: new Map<string, IdempotencyReceipt>(),
        audit: [] as AuditRecord[],
      };
      const uow: PricingUnitOfWork = {
        lockHead: (): Promise<VersionHead | null> => {
          const head = this.versions.at(-1);
          return Promise.resolve(
            head ? { version: head.version, effectiveFrom: head.effectiveFrom } : null,
          );
        },
        findReceipt: (actor, operation, key) =>
          Promise.resolve(this.receipts.get(this.receiptKey(actor, operation, key)) ?? null),
        insertPriceVersion: (version) => {
          staged.versions.push(version);
          return Promise.resolve();
        },
        insertQuote: (quote) => {
          staged.quotes.push(quote);
          return Promise.resolve();
        },
        saveReceipt: (receipt) => {
          const key = this.receiptKey(
            receipt.actorSubject,
            receipt.operation,
            receipt.idempotencyKey,
          );
          if (this.receipts.has(key)) return Promise.reject(new ReceiptAlreadyExists());
          staged.receipts.set(key, receipt);
          return Promise.resolve();
        },
        appendAudit: (record) => {
          staged.audit.push(record);
          return Promise.resolve();
        },
      };
      const result = await work(uow);
      this.versions.push(...staged.versions);
      for (const quote of staged.quotes) this.quotes.set(quote.id, quote);
      for (const [key, value] of staged.receipts) this.receipts.set(key, value);
      this.audit.push(...staged.audit);
      return result;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  findReceipt(actor: string, operation: string, key: string): Promise<IdempotencyReceipt | null> {
    return Promise.resolve(this.receipts.get(this.receiptKey(actor, operation, key)) ?? null);
  }

  versionInForce(at: Date): Promise<PublishedPriceVersion | null> {
    return Promise.resolve(
      this.versions.filter((v) => v.effectiveFrom.getTime() <= at.getTime()).at(-1) ?? null,
    );
  }

  version(version: number): Promise<PublishedPriceVersion | null> {
    return Promise.resolve(this.versions.find((v) => v.version === version) ?? null);
  }

  listVersions(limit: number) {
    return Promise.resolve(
      [...this.versions]
        .reverse()
        .slice(0, limit)
        .map((v) => ({
          version: v.version,
          effectiveFrom: v.effectiveFrom,
          publishedAt: v.publishedAt,
          catalogRevision: v.catalogRevision,
          policyRevision: v.policyRevision,
          currency: v.currency,
          minorUnitExponent: v.minorUnitExponent,
          ratesFingerprint: v.ratesFingerprint,
        })),
    );
  }

  quote(id: string): Promise<StoredQuote | null> {
    return Promise.resolve(this.quotes.get(id) ?? null);
  }
}
