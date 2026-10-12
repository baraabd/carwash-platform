import { Injectable } from '@nestjs/common';
import {
  DEFINITION_KINDS,
  DEFINITION_STATUSES,
  PRINCIPAL_KINDS,
  VEHICLE_TYPES,
  type CatalogView,
  type PriceBookEntry,
  type VehicleType,
} from '../../domain';
import {
  ReceiptAlreadyExists,
  type AuditRecord,
  type IdempotencyReceipt,
  type NewPriceBook,
  type PriceBook,
  type PricingRepository,
  type PricingUnitOfWork,
  type StoredQuote,
} from '../../ports';
import { Prisma, type PrismaClient } from '../../generated/prisma/client';
import { PrismaService } from './prisma.service';

type Tx = Prisma.TransactionClient;
type BookRow = Prisma.PriceBookGetPayload<{ include: { entries: true } }>;
type QuoteRow = Prisma.PricingQuoteGetPayload<{ include: { lines: true } }>;

/** Stored values were written by this adapter under database CHECKs; a mismatch is corruption. */
function oneOf<T extends string>(values: readonly T[], value: string, what: string): T {
  const found = values.find((v) => v === value);
  if (!found) throw new Error(`STORED_${what}_INVALID`);
  return found;
}

function vehicleScope(type: VehicleType | null): string {
  return type ?? '*';
}

function catalogToJson(view: CatalogView): Prisma.InputJsonObject {
  return {
    catalogRevision: view.catalogRevision,
    publishedAt: view.publishedAt.toISOString(),
    definitions: view.definitions.map((d) => ({
      definitionId: d.definitionId,
      kind: d.kind,
      durationMinutes: d.durationMinutes,
      vehicleTypes: [...d.vehicleTypes],
      status: d.status,
    })),
  };
}

function catalogFromJson(value: Prisma.JsonValue): CatalogView {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('STORED_CATALOG_VIEW_INVALID');
  const raw = value as Record<string, unknown>;
  const definitions = raw.definitions;
  if (
    typeof raw.catalogRevision !== 'number' ||
    typeof raw.publishedAt !== 'string' ||
    !Array.isArray(definitions)
  )
    throw new Error('STORED_CATALOG_VIEW_INVALID');
  return {
    catalogRevision: raw.catalogRevision,
    publishedAt: new Date(raw.publishedAt),
    definitions: definitions.map((entry: unknown) => {
      const d = entry as Record<string, unknown>;
      if (
        typeof d.definitionId !== 'string' ||
        typeof d.kind !== 'string' ||
        typeof d.status !== 'string' ||
        typeof d.durationMinutes !== 'number' ||
        !Array.isArray(d.vehicleTypes)
      )
        throw new Error('STORED_CATALOG_VIEW_INVALID');
      return {
        definitionId: d.definitionId,
        kind: oneOf(DEFINITION_KINDS, d.kind, 'DEFINITION_KIND'),
        status: oneOf(DEFINITION_STATUSES, d.status, 'DEFINITION_STATUS'),
        durationMinutes: d.durationMinutes,
        vehicleTypes: d.vehicleTypes.map((t: unknown) =>
          oneOf(VEHICLE_TYPES, String(t), 'VEHICLE_TYPE'),
        ),
      };
    }),
  };
}

function toEntry(row: BookRow['entries'][number]): PriceBookEntry {
  return {
    definitionId: row.definitionId,
    vehicleType:
      row.vehicleScope === '*' ? null : oneOf(VEHICLE_TYPES, row.vehicleScope, 'VEHICLE_SCOPE'),
    unitPriceMinor: row.unitPriceMinor,
  };
}

function toBook(row: BookRow): PriceBook {
  const key = (e: PriceBookEntry) => `${e.definitionId}|${e.vehicleType ?? ''}`;
  return {
    revision: row.revision,
    currency: row.currency,
    scale: row.scale,
    policyRevision: row.policyRevision,
    catalog: catalogFromJson(row.catalogView),
    catalogFingerprint: row.catalogFingerprint,
    entries: row.entries
      .map(toEntry)
      .sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0)),
    entriesFingerprint: row.entriesFingerprint,
    publishedAt: row.publishedAt,
  };
}

function toQuote(row: QuoteRow): StoredQuote {
  return {
    id: row.id,
    revision: row.revision,
    beneficiary: {
      kind: oneOf(PRINCIPAL_KINDS, row.beneficiaryKind, 'BENEFICIARY_KIND'),
      subjectId: row.beneficiarySubject,
    },
    requestedBy: row.requestedBy,
    vehicleType: oneOf(VEHICLE_TYPES, row.vehicleType, 'VEHICLE_TYPE'),
    zoneId: row.zoneId,
    currency: row.currency,
    scale: row.scale,
    priceBookRevision: row.priceBookRevision,
    catalogRevision: row.catalogRevision,
    policyRevision: row.policyRevision,
    lines: [...row.lines]
      .sort((a, b) => a.lineNo - b.lineNo)
      .map((l) => ({
        lineId: l.lineId,
        kind: oneOf(DEFINITION_KINDS, l.kind, 'LINE_KIND'),
        definitionId: l.definitionId,
        quantity: l.quantity,
        unitPriceMinor: l.unitPriceMinor,
        amountMinor: l.amountMinor,
      })),
    totalMinor: row.totalMinor,
    issuedAt: row.issuedAt,
    expiresAt: row.expiresAt,
    correlationId: row.correlationId,
  };
}

function toReceipt(row: {
  actorSubject: string;
  operation: string;
  idempotencyKey: string;
  requestFingerprint: string;
  responseStatus: number;
  responseBody: Prisma.JsonValue;
}): IdempotencyReceipt {
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

function receiptWhere(actorSubject: string, operation: string, idempotencyKey: string) {
  return { actorSubject_operation_idempotencyKey: { actorSubject, operation, idempotencyKey } };
}

async function insertAudit(client: Tx | PrismaClient, record: AuditRecord): Promise<void> {
  await client.pricingAuditRecord.create({ data: { ...record } });
}

class PrismaPricingUnitOfWork implements PricingUnitOfWork {
  constructor(private readonly tx: Tx) {}

  async lockPriceBookHead(): Promise<number | null> {
    await this.tx.$queryRaw`SELECT id FROM app.pricing_publication_lock WHERE id = 1 FOR UPDATE`;
    const head = await this.tx.priceBook.findFirst({
      orderBy: { revision: 'desc' },
      select: { revision: true },
    });
    return head?.revision ?? null;
  }

  async priceBookInForce(): Promise<PriceBook | null> {
    const row = await this.tx.priceBook.findFirst({
      orderBy: { revision: 'desc' },
      include: { entries: true },
    });
    return row ? toBook(row) : null;
  }

  async findReceipt(actorSubject: string, operation: string, idempotencyKey: string) {
    const row = await this.tx.pricingIdempotencyReceipt.findUnique({
      where: receiptWhere(actorSubject, operation, idempotencyKey),
    });
    return row ? toReceipt(row) : null;
  }

  async insertPriceBook(book: NewPriceBook): Promise<void> {
    await this.tx.priceBook.create({
      data: {
        revision: book.revision,
        previousRevision: book.revision > 1 ? book.revision - 1 : null,
        currency: book.currency,
        scale: book.scale,
        policyRevision: book.policyRevision,
        catalogRevision: book.catalog.catalogRevision,
        catalogFingerprint: book.catalogFingerprint,
        catalogView: catalogToJson(book.catalog),
        entriesFingerprint: book.entriesFingerprint,
        publishedAt: book.publishedAt,
        publishedBy: book.publishedBy,
        correlationId: book.correlationId,
      },
    });
    await this.tx.priceBookEntry.createMany({
      data: book.entries.map((entry) => ({
        revision: book.revision,
        definitionId: entry.definitionId,
        vehicleScope: vehicleScope(entry.vehicleType),
        unitPriceMinor: entry.unitPriceMinor,
      })),
    });
  }

  async insertQuote(quote: StoredQuote): Promise<void> {
    await this.tx.pricingQuote.create({
      data: {
        id: quote.id,
        revision: quote.revision,
        beneficiaryKind: quote.beneficiary.kind,
        beneficiarySubject: quote.beneficiary.subjectId,
        requestedBy: quote.requestedBy,
        vehicleType: quote.vehicleType,
        zoneId: quote.zoneId,
        currency: quote.currency,
        scale: quote.scale,
        priceBookRevision: quote.priceBookRevision,
        catalogRevision: quote.catalogRevision,
        policyRevision: quote.policyRevision,
        totalMinor: quote.totalMinor,
        issuedAt: quote.issuedAt,
        expiresAt: quote.expiresAt,
        correlationId: quote.correlationId,
      },
    });
    await this.tx.pricingQuoteLine.createMany({
      data: quote.lines.map((line, lineNo) => ({
        quoteId: quote.id,
        lineNo,
        lineId: line.lineId,
        kind: line.kind,
        definitionId: line.definitionId,
        quantity: line.quantity,
        unitPriceMinor: line.unitPriceMinor,
        amountMinor: line.amountMinor,
      })),
    });
  }

  async saveReceipt(receipt: IdempotencyReceipt, recordedAt: Date): Promise<void> {
    try {
      await this.tx.pricingIdempotencyReceipt.create({
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
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ReceiptAlreadyExists();
      throw error;
    }
  }

  appendAudit(record: AuditRecord): Promise<void> {
    return insertAudit(this.tx, record);
  }
}

@Injectable()
export class PrismaPricingRepository implements PricingRepository {
  private readonly client: PrismaClient;

  constructor(prisma: PrismaService) {
    this.client = prisma.client;
  }

  transaction<T>(work: (uow: PricingUnitOfWork) => Promise<T>): Promise<T> {
    return this.client.$transaction((tx) => work(new PrismaPricingUnitOfWork(tx)), {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5_000,
      timeout: 15_000,
    });
  }

  async findReceipt(actorSubject: string, operation: string, idempotencyKey: string) {
    const row = await this.client.pricingIdempotencyReceipt.findUnique({
      where: receiptWhere(actorSubject, operation, idempotencyKey),
    });
    return row ? toReceipt(row) : null;
  }

  async quote(id: string): Promise<StoredQuote | null> {
    const row = await this.client.pricingQuote.findUnique({
      where: { id },
      include: { lines: true },
    });
    return row ? toQuote(row) : null;
  }

  appendAudit(record: AuditRecord): Promise<void> {
    return insertAudit(this.client, record);
  }
}
