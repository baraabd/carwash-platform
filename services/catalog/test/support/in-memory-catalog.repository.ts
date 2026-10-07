import type { RevisionHead } from '../../src/domain';
import type {
  AuditRecord,
  CatalogRepository,
  CatalogUnitOfWork,
  IdempotencyReceipt,
  NewRevision,
  PublishedRevision,
  RevisionSummary,
} from '../../src/ports';

/**
 * TEST DOUBLE for application/HTTP tests. Transactions are serialised and
 * staged so a thrown error discards every write, mirroring rollback. It is not
 * persistence evidence; the PostgreSQL suite covers the real adapter.
 */
export class InMemoryCatalogRepository implements CatalogRepository {
  readonly revisions: PublishedRevision[] = [];
  readonly receipts = new Map<string, IdempotencyReceipt>();
  readonly audit: AuditRecord[] = [];
  private queue: Promise<unknown> = Promise.resolve();

  transaction<T>(work: (uow: CatalogUnitOfWork) => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const staged = {
        revisions: [] as PublishedRevision[],
        receipts: new Map<string, IdempotencyReceipt>(),
        audit: [] as AuditRecord[],
      };
      const uow: CatalogUnitOfWork = {
        lockHead: (): Promise<RevisionHead | null> => {
          const head = this.revisions.at(-1);
          return Promise.resolve(
            head ? { revision: head.revision, effectiveFrom: head.effectiveFrom } : null,
          );
        },
        findReceipt: (actor, operation, key) =>
          Promise.resolve(this.receipts.get(`${actor}|${operation}|${key}`) ?? null),
        insertRevision: (revision: NewRevision) => {
          staged.revisions.push({
            revision: revision.revision,
            effectiveFrom: revision.effectiveFrom,
            publishedAt: revision.publishedAt,
            definitionsFingerprint: revision.definitionsFingerprint,
            definitions: revision.definitions,
          });
          return Promise.resolve();
        },
        saveReceipt: (receipt) => {
          staged.receipts.set(
            `${receipt.actorSubject}|${receipt.operation}|${receipt.idempotencyKey}`,
            receipt,
          );
          return Promise.resolve();
        },
        appendAudit: (record) => {
          staged.audit.push(record);
          return Promise.resolve();
        },
      };
      const result = await work(uow);
      this.revisions.push(...staged.revisions);
      for (const [key, value] of staged.receipts) this.receipts.set(key, value);
      this.audit.push(...staged.audit);
      return result;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  revisionInForce(at: Date): Promise<PublishedRevision | null> {
    const candidates = this.revisions.filter((r) => r.effectiveFrom.getTime() <= at.getTime());
    return Promise.resolve(candidates.at(-1) ?? null);
  }

  revision(revision: number): Promise<PublishedRevision | null> {
    return Promise.resolve(this.revisions.find((r) => r.revision === revision) ?? null);
  }

  listRevisions(limit: number): Promise<RevisionSummary[]> {
    return Promise.resolve(
      [...this.revisions]
        .reverse()
        .slice(0, limit)
        .map((r) => ({
          revision: r.revision,
          effectiveFrom: r.effectiveFrom,
          publishedAt: r.publishedAt,
          definitionsFingerprint: r.definitionsFingerprint,
        })),
    );
  }
}

export class FixedClock {
  constructor(public current: Date) {}
  now(): Date {
    return new Date(this.current.getTime());
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}
