import type { CatalogSnapshot } from '../../src/domain';
import type {
  AuditRecord,
  CatalogRepository,
  CatalogUnitOfWork,
  IdempotencyReceipt,
  NewPublication,
  OutboxEvent,
} from '../../src/ports';

/**
 * TEST DOUBLE for application/HTTP tests. Transactions are serialised and
 * staged so a thrown error discards every write, mirroring rollback. It is not
 * persistence evidence; the PostgreSQL suite covers the real adapter.
 */
export class InMemoryCatalogRepository implements CatalogRepository {
  readonly publications: NewPublication[] = [];
  readonly receipts = new Map<string, IdempotencyReceipt>();
  readonly audit: AuditRecord[] = [];
  readonly outbox: OutboxEvent[] = [];
  private queue: Promise<unknown> = Promise.resolve();

  private snapshot(): CatalogSnapshot | null {
    const last = this.publications.at(-1);
    return last
      ? { catalogRevision: last.catalogRevision, publishedAt: last.publishedAt, items: last.items }
      : null;
  }

  transaction<T>(work: (uow: CatalogUnitOfWork) => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const staged = {
        publications: [] as NewPublication[],
        receipts: new Map<string, IdempotencyReceipt>(),
        audit: [] as AuditRecord[],
        outbox: [] as OutboxEvent[],
      };
      const uow: CatalogUnitOfWork = {
        lockCurrent: () => Promise.resolve(this.snapshot()),
        findReceipt: (actor, operation, key) =>
          Promise.resolve(this.receipts.get(`${actor}|${operation}|${key}`) ?? null),
        insertPublication: (publication) => {
          // Mirrors the insert-only identity table: an id is created exactly once.
          const known = new Set(this.publications.flatMap((p) => p.createdDefinitionIds));
          if (publication.createdDefinitionIds.some((id) => known.has(id)))
            throw new Error('IDENTITY_ALREADY_EXISTS');
          staged.publications.push(publication);
          return Promise.resolve();
        },
        saveReceipt: (receipt) => {
          staged.receipts.set(
            `${receipt.actorSubject}|${receipt.operation}|${receipt.idempotencyKey}`,
            // Receipts are stored as JSON, exactly like the JSONB column.
            JSON.parse(JSON.stringify(receipt)) as IdempotencyReceipt,
          );
          return Promise.resolve();
        },
        appendAudit: (record) => {
          staged.audit.push(record);
          return Promise.resolve();
        },
        enqueue: (event) => {
          staged.outbox.push(event);
          return Promise.resolve();
        },
      };
      const result = await work(uow);
      this.publications.push(...staged.publications);
      for (const [k, v] of staged.receipts) this.receipts.set(k, v);
      this.audit.push(...staged.audit);
      this.outbox.push(...staged.outbox);
      return result;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  current(): Promise<CatalogSnapshot | null> {
    return Promise.resolve(this.snapshot());
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
