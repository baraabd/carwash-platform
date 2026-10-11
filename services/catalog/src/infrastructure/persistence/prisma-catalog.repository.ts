import { Injectable } from '@nestjs/common';
import {
  DEFINITION_KINDS,
  DEFINITION_STATUSES,
  VEHICLE_TYPES,
  orderDefinitions,
  type CatalogSnapshot,
  type Definition,
} from '../../domain';
import type {
  AuditRecord,
  CatalogRepository,
  CatalogUnitOfWork,
  IdempotencyReceipt,
  NewPublication,
  OutboxEvent,
} from '../../ports';
import { Prisma, type PrismaClient } from '../../generated/prisma/client';
import { PrismaService } from './prisma.service';

type Tx = Prisma.TransactionClient | PrismaClient;

const PUBLICATION_INCLUDE = {
  definitions: true,
} satisfies Prisma.CatalogV1PublicationInclude;

type PublicationRow = Prisma.CatalogV1PublicationGetPayload<{
  include: typeof PUBLICATION_INCLUDE;
}>;
type DefinitionRow = PublicationRow['definitions'][number];

/** Database values are constrained by CHECKs; anything else is corruption. */
function member<const T extends readonly string[]>(allowed: T, value: string): T[number] {
  const found = allowed.find((candidate) => candidate === value);
  if (found === undefined) throw new Error('CATALOG_ROW_CORRUPT');
  return found;
}

function toDefinition(row: DefinitionRow): Definition {
  return {
    definitionId: row.definitionId,
    revision: row.revision,
    kind: member(DEFINITION_KINDS, row.kind),
    code: row.code,
    name: { ar: row.nameAr, en: row.nameEn },
    description: { ar: row.descriptionAr, en: row.descriptionEn },
    durationMinutes: row.durationMinutes,
    vehicleTypes: row.vehicleTypes.map((type) => member(VEHICLE_TYPES, type)),
    status: member(DEFINITION_STATUSES, row.status),
    sortOrder: row.sortOrder,
  };
}

function toSnapshot(row: PublicationRow): CatalogSnapshot {
  return {
    catalogRevision: row.catalogRevision,
    publishedAt: row.publishedAt,
    items: orderDefinitions(row.definitions.map(toDefinition)),
  };
}

async function currentSnapshot(client: Tx): Promise<CatalogSnapshot | null> {
  const row = await client.catalogV1Publication.findFirst({
    orderBy: { catalogRevision: 'desc' },
    include: PUBLICATION_INCLUDE,
  });
  return row ? toSnapshot(row) : null;
}

class PrismaCatalogUnitOfWork implements CatalogUnitOfWork {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async lockCurrent(): Promise<CatalogSnapshot | null> {
    // Every publisher queues on this one row, so receipt lookup, planning and
    // insertion observe a stable head. Keys and triggers remain the backstop.
    await this.tx.$queryRaw`SELECT id FROM app.catalog_publication_lock WHERE id = 1 FOR UPDATE`;
    return currentSnapshot(this.tx);
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
    const body = row.responseBody;
    if (typeof body !== 'object' || body === null || Array.isArray(body))
      throw new Error('CATALOG_RECEIPT_CORRUPT');
    return {
      actorSubject: row.actorSubject,
      operation: row.operation,
      idempotencyKey: row.idempotencyKey,
      requestFingerprint: row.requestFingerprint,
      outcome: { status: row.responseStatus, body },
    };
  }

  async insertPublication(publication: NewPublication): Promise<void> {
    const key = { catalogRevision: publication.catalogRevision };
    await this.tx.catalogV1Publication.create({
      data: {
        ...key,
        previousRevision: publication.catalogRevision > 1 ? publication.catalogRevision - 1 : null,
        publishedAt: publication.publishedAt,
        publishedBy: publication.publishedBy,
        correlationId: publication.correlationId,
        reasonCode: publication.reasonCode,
        snapshotFingerprint: publication.snapshotFingerprint,
      },
    });
    // Identity rows are insert-only and written once, for new definitions. The
    // composite foreign key below rejects any later kind/code drift.
    await this.tx.catalogV1DefinitionIdentity.createMany({
      data: publication.items
        .filter((d) => d.revision === 1)
        .map((d) => ({
          definitionId: d.definitionId,
          code: d.code,
          kind: d.kind,
          firstCatalogRevision: publication.catalogRevision,
        })),
    });
    await this.tx.catalogV1Definition.createMany({
      data: publication.items.map((d) => ({
        ...key,
        definitionId: d.definitionId,
        revision: d.revision,
        kind: d.kind,
        code: d.code,
        nameAr: d.name.ar,
        nameEn: d.name.en,
        descriptionAr: d.description.ar,
        descriptionEn: d.description.en,
        durationMinutes: d.durationMinutes,
        vehicleTypes: [...d.vehicleTypes],
        status: d.status,
        sortOrder: d.sortOrder,
      })),
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

  async enqueue(event: OutboxEvent): Promise<void> {
    await this.tx.outboxMessage.create({
      data: {
        id: event.eventId,
        eventId: event.eventId,
        eventType: event.eventType,
        exchange: event.exchange,
        routingKey: event.routingKey,
        payload: event.payload,
        correlationId: event.correlationId,
        traceParent: event.traceParent,
      },
    });
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

  current(): Promise<CatalogSnapshot | null> {
    return currentSnapshot(this.client);
  }
}
