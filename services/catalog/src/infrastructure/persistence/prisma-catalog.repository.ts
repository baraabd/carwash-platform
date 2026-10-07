import { Injectable } from '@nestjs/common';
import type { CatalogDefinitions, RevisionHead } from '../../domain';
import type {
  AuditRecord,
  CatalogRepository,
  CatalogUnitOfWork,
  IdempotencyReceipt,
  NewRevision,
  PublishedRevision,
  RevisionSummary,
} from '../../ports';
import { Prisma, type PrismaClient } from '../../generated/prisma/client';
import { PrismaService } from './prisma.service';

type Tx = Prisma.TransactionClient;

const REVISION_INCLUDE = {
  categories: true,
  packages: { include: { categories: true, addons: true } },
  addons: { include: { categories: true } },
} satisfies Prisma.CatalogRevisionInclude;

type RevisionRow = Prisma.CatalogRevisionGetPayload<{ include: typeof REVISION_INCLUDE }>;

function ordered<T extends { sortOrder: number; id: string }>(rows: readonly T[]): T[] {
  return [...rows].sort(
    (a, b) => a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

function sortedIds(ids: readonly string[]): string[] {
  return [...ids].sort();
}

/** Rebuilds the canonical snapshot exactly as the domain normalised it. */
function toDefinitions(row: RevisionRow): CatalogDefinitions {
  return {
    categories: ordered(row.categories).map((c) => ({
      id: c.id,
      labelAr: c.labelAr,
      labelEn: c.labelEn,
      extraDurationMinutes: c.extraDurationMinutes,
      sortOrder: c.sortOrder,
    })),
    packages: ordered(row.packages).map((p) => ({
      id: p.id,
      labelAr: p.labelAr,
      labelEn: p.labelEn,
      descriptionAr: p.descriptionAr,
      durationMinutes: p.durationMinutes,
      sortOrder: p.sortOrder,
      featuresAr: [...p.featuresAr],
      allowedCategoryIds: sortedIds(p.categories.map((c) => c.categoryId)),
      includedAddonIds: sortedIds(
        p.addons.filter((a) => a.relation === 'INCLUDED').map((a) => a.addonId),
      ),
      optionalAddonIds: sortedIds(
        p.addons.filter((a) => a.relation === 'OPTIONAL').map((a) => a.addonId),
      ),
    })),
    addons: ordered(row.addons).map((a) => ({
      id: a.id,
      labelAr: a.labelAr,
      labelEn: a.labelEn,
      durationMinutes: a.durationMinutes,
      sortOrder: a.sortOrder,
      allowedCategoryIds: sortedIds(a.categories.map((c) => c.categoryId)),
    })),
  };
}

function toPublished(row: RevisionRow): PublishedRevision {
  return {
    revision: row.revision,
    effectiveFrom: row.effectiveFrom,
    publishedAt: row.publishedAt,
    definitionsFingerprint: row.definitionsFingerprint,
    definitions: toDefinitions(row),
  };
}

class PrismaCatalogUnitOfWork implements CatalogUnitOfWork {
  constructor(private readonly tx: Tx) {}

  async lockHead(): Promise<RevisionHead | null> {
    // Every publisher queues on this one row, so receipt lookup, planning and
    // insertion observe a stable head. The unique keys remain the backstop.
    await this.tx.$queryRaw`SELECT id FROM app.catalog_publication_lock WHERE id = 1 FOR UPDATE`;
    const head = await this.tx.catalogRevision.findFirst({
      orderBy: { revision: 'desc' },
      select: { revision: true, effectiveFrom: true },
    });
    return head ?? null;
  }

  async findReceipt(
    actorSubject: string,
    operation: string,
    idempotencyKey: string,
  ): Promise<IdempotencyReceipt | null> {
    const row = await this.tx.catalogIdempotencyReceipt.findUnique({
      where: { actorSubject_operation_idempotencyKey: { actorSubject, operation, idempotencyKey } },
    });
    if (!row) return null;
    return {
      actorSubject: row.actorSubject,
      operation: row.operation,
      idempotencyKey: row.idempotencyKey,
      requestFingerprint: row.requestFingerprint,
      outcome: {
        status: row.responseStatus,
        body: row.responseBody as Readonly<Record<string, unknown>>,
      },
    };
  }

  async insertRevision(revision: NewRevision): Promise<void> {
    const { definitions } = revision;
    const key = { revision: revision.revision };
    await this.tx.catalogRevision.create({
      data: {
        revision: revision.revision,
        previousRevision: revision.revision > 1 ? revision.revision - 1 : null,
        effectiveFrom: revision.effectiveFrom,
        publishedAt: revision.publishedAt,
        publishedBy: revision.publishedBy,
        correlationId: revision.correlationId,
        definitionsFingerprint: revision.definitionsFingerprint,
      },
    });
    await this.tx.catalogVehicleCategory.createMany({
      data: definitions.categories.map((c) => ({ ...key, ...c })),
    });
    await this.tx.catalogAddon.createMany({
      data: definitions.addons.map((a) => ({
        ...key,
        id: a.id,
        labelAr: a.labelAr,
        labelEn: a.labelEn,
        durationMinutes: a.durationMinutes,
        sortOrder: a.sortOrder,
      })),
    });
    await this.tx.catalogPackage.createMany({
      data: definitions.packages.map((p) => ({
        ...key,
        id: p.id,
        labelAr: p.labelAr,
        labelEn: p.labelEn,
        descriptionAr: p.descriptionAr,
        durationMinutes: p.durationMinutes,
        sortOrder: p.sortOrder,
        featuresAr: [...p.featuresAr],
      })),
    });
    await this.tx.catalogAddonCategory.createMany({
      data: definitions.addons.flatMap((a) =>
        a.allowedCategoryIds.map((categoryId) => ({ ...key, addonId: a.id, categoryId })),
      ),
    });
    await this.tx.catalogPackageCategory.createMany({
      data: definitions.packages.flatMap((p) =>
        p.allowedCategoryIds.map((categoryId) => ({ ...key, packageId: p.id, categoryId })),
      ),
    });
    await this.tx.catalogPackageAddon.createMany({
      data: definitions.packages.flatMap((p) => [
        ...p.includedAddonIds.map((addonId) => ({
          ...key,
          packageId: p.id,
          addonId,
          relation: 'INCLUDED',
        })),
        ...p.optionalAddonIds.map((addonId) => ({
          ...key,
          packageId: p.id,
          addonId,
          relation: 'OPTIONAL',
        })),
      ]),
    });
  }

  async saveReceipt(receipt: IdempotencyReceipt, recordedAt: Date): Promise<void> {
    await this.tx.catalogIdempotencyReceipt.create({
      data: {
        actorSubject: receipt.actorSubject,
        operation: receipt.operation,
        idempotencyKey: receipt.idempotencyKey,
        requestFingerprint: receipt.requestFingerprint,
        responseStatus: receipt.outcome.status,
        responseBody: receipt.outcome.body as Prisma.InputJsonObject,
        createdAt: recordedAt,
      },
    });
  }

  async appendAudit(record: AuditRecord): Promise<void> {
    await this.tx.catalogAuditEvent.create({ data: { ...record } });
  }
}

@Injectable()
export class PrismaCatalogRepository implements CatalogRepository {
  private readonly client: PrismaClient;

  constructor(prisma: PrismaService) {
    this.client = prisma.client;
  }

  transaction<T>(work: (uow: CatalogUnitOfWork) => Promise<T>): Promise<T> {
    return this.client.$transaction((tx) => work(new PrismaCatalogUnitOfWork(tx)), {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5_000,
      timeout: 15_000,
    });
  }

  async revisionInForce(at: Date): Promise<PublishedRevision | null> {
    const row = await this.client.catalogRevision.findFirst({
      where: { effectiveFrom: { lte: at } },
      orderBy: { effectiveFrom: 'desc' },
      include: REVISION_INCLUDE,
    });
    return row ? toPublished(row) : null;
  }

  async revision(revision: number): Promise<PublishedRevision | null> {
    const row = await this.client.catalogRevision.findUnique({
      where: { revision },
      include: REVISION_INCLUDE,
    });
    return row ? toPublished(row) : null;
  }

  async listRevisions(limit: number): Promise<RevisionSummary[]> {
    return this.client.catalogRevision.findMany({
      orderBy: { revision: 'desc' },
      take: limit,
      select: {
        revision: true,
        effectiveFrom: true,
        publishedAt: true,
        definitionsFingerprint: true,
      },
    });
  }
}
