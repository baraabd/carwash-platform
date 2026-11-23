import type { VersionHead } from '../../../src/domain/legacy';
import {
  PromotionUniqueConflict,
  ReceiptAlreadyExists,
  type AuditRecord,
  type OutboxEvent,
  type PromotionAuditRecord,
  type PromotionRecord,
  type PromotionRevisionRecord,
  type PromotionUsage,
  type RedemptionRecord,
  type IdempotencyReceipt,
  type PricingRepository,
  type PricingUnitOfWork,
  type PublishedPriceVersion,
  type StoredQuote,
} from '../../../src/ports/legacy';

/**
 * TEST DOUBLE for application/HTTP tests: serialised, staged transactions that
 * discard every write when the work throws. Not persistence evidence.
 */
export class InMemoryPricingRepository implements PricingRepository {
  readonly versions: PublishedPriceVersion[] = [];
  readonly quotes = new Map<string, StoredQuote>();
  readonly receipts = new Map<string, IdempotencyReceipt>();
  readonly audit: AuditRecord[] = [];
  readonly promotions = new Map<string, PromotionRecord>();
  readonly revisions: PromotionRevisionRecord[] = [];
  readonly redemptions = new Map<string, RedemptionRecord>();
  readonly promotionAudit: PromotionAuditRecord[] = [];
  readonly outbox: OutboxEvent[] = [];
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
        promotions: [] as PromotionRecord[],
        revisions: [] as PromotionRevisionRecord[],
        redemptions: [] as RedemptionRecord[],
        promotionAudit: [] as PromotionAuditRecord[],
        outbox: [] as OutboxEvent[],
      };
      const live = (r: RedemptionRecord) => r.status !== 'RELEASED';
      const uow: PricingUnitOfWork = {
        lockPrices: () => Promise.resolve(),
        versionInForce: (at) =>
          Promise.resolve(
            this.versions.filter((v) => v.effectiveFrom.getTime() <= at.getTime()).at(-1) ?? null,
          ),
        version: (version) =>
          Promise.resolve(this.versions.find((v) => v.version === version) ?? null),
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
        lockPromotion: (code) =>
          Promise.resolve(
            this.promotions.get(code) ?? staged.promotions.find((p) => p.code === code) ?? null,
          ),
        insertPromotion: (promotion) => {
          if (
            [...this.promotions.values(), ...staged.promotions].some(
              (p) => p.couponDigest === promotion.couponDigest,
            )
          )
            return Promise.reject(new PromotionUniqueConflict('COUPON_CODE'));
          staged.promotions.push(promotion);
          return Promise.resolve();
        },
        promotionRevisions: (code) =>
          Promise.resolve(
            [...this.revisions, ...staged.revisions].filter((r) => r.promotionCode === code),
          ),
        insertPromotionRevision: (revision) => {
          staged.revisions.push(revision);
          return Promise.resolve();
        },
        promotionByCoupon: (digest) =>
          Promise.resolve(
            [...this.promotions.values()].find((p) => p.couponDigest === digest) ?? null,
          ),
        liveRedemptions: (code, customer) => {
          const all = [...this.redemptions.values()].filter(
            (r) => r.promotionCode === code && live(r),
          );
          return Promise.resolve({
            total: all.length,
            customer: all.filter((r) => r.customerSubject === customer).length,
          });
        },
        redemptionFor: (code, bookingId) =>
          Promise.resolve(
            [...this.redemptions.values()].find(
              (r) => r.promotionCode === code && r.bookingId === bookingId,
            ) ?? null,
          ),
        lockRedemption: (id) => Promise.resolve(this.redemptions.get(id) ?? null),
        insertRedemption: (redemption) => {
          staged.redemptions.push(redemption);
          return Promise.resolve();
        },
        updateRedemption: (redemption) => {
          staged.redemptions.push(redemption);
          return Promise.resolve();
        },
        appendPromotionAudit: (record) => {
          staged.promotionAudit.push(record);
          return Promise.resolve();
        },
        appendOutbox: (event) => {
          staged.outbox.push(event);
          return Promise.resolve();
        },
      };
      const result = await work(uow);
      this.versions.push(...staged.versions);
      for (const quote of staged.quotes) this.quotes.set(quote.id, quote);
      for (const [key, value] of staged.receipts) this.receipts.set(key, value);
      this.audit.push(...staged.audit);
      for (const promotion of staged.promotions) this.promotions.set(promotion.code, promotion);
      this.revisions.push(...staged.revisions);
      for (const redemption of staged.redemptions) this.redemptions.set(redemption.id, redemption);
      this.promotionAudit.push(...staged.promotionAudit);
      this.outbox.push(...staged.outbox);
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

  promotionCodes(limit: number): Promise<string[]> {
    return Promise.resolve([...this.promotions.keys()].sort().slice(0, limit));
  }

  promotion(code: string): Promise<PromotionRecord | null> {
    return Promise.resolve(this.promotions.get(code) ?? null);
  }

  promotionRevisions(code: string): Promise<PromotionRevisionRecord[]> {
    return Promise.resolve(this.revisions.filter((r) => r.promotionCode === code));
  }

  promotionUsage(code: string): Promise<PromotionUsage> {
    const all = [...this.redemptions.values()].filter((r) => r.promotionCode === code);
    const count = (status: string) => all.filter((r) => r.status === status).length;
    return Promise.resolve({
      reserved: count('RESERVED'),
      committed: count('COMMITTED'),
      released: count('RELEASED'),
    });
  }

  redemption(id: string): Promise<RedemptionRecord | null> {
    return Promise.resolve(this.redemptions.get(id) ?? null);
  }

  redemptionsForBooking(bookingId: string): Promise<RedemptionRecord[]> {
    return Promise.resolve([...this.redemptions.values()].filter((r) => r.bookingId === bookingId));
  }
}
