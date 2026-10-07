import { Injectable } from '@nestjs/common';
import {
  RATE_KINDS,
  type CatalogSnapshot,
  type Rate,
  type RateKind,
  type VersionHead,
} from '../../domain';
import {
  ReceiptAlreadyExists,
  type AuditRecord,
  type IdempotencyReceipt,
  type NewPriceVersion,
  type PricingRepository,
  type PricingUnitOfWork,
  type PublishedPriceVersion,
  type StoredQuote,
} from '../../ports';
import { Prisma, type PrismaClient } from '../../generated/prisma/client';
import { PrismaService } from './prisma.service';

type Tx = Prisma.TransactionClient;
type VersionRow = Prisma.PriceVersionGetPayload<{ include: { rates: true } }>;
type QuoteRow = Prisma.QuoteGetPayload<{ include: { lines: true } }>;

function kind(value: string): RateKind {
  const found = RATE_KINDS.find((k) => k === value);
  if (!found) throw new Error('STORED_RATE_KIND_INVALID');
  return found;
}

function snapshotToJson(snapshot: CatalogSnapshot): Prisma.InputJsonObject {
  return {
    revision: snapshot.revision,
    effectiveFrom: snapshot.effectiveFrom.toISOString(),
    definitionsFingerprint: snapshot.definitionsFingerprint,
    categories: snapshot.categories.map((c) => ({ ...c })),
    packages: snapshot.packages.map((p) => ({
      ...p,
      allowedCategoryIds: [...p.allowedCategoryIds],
      includedAddonIds: [...p.includedAddonIds],
      optionalAddonIds: [...p.optionalAddonIds],
    })),
    addons: snapshot.addons.map((a) => ({ ...a, allowedCategoryIds: [...a.allowedCategoryIds] })),
  };
}

/** The stored JSON was written by snapshotToJson in the same transaction as its version. */
function snapshotFromJson(value: Prisma.JsonValue): CatalogSnapshot {
  const raw = value as unknown as Omit<CatalogSnapshot, 'effectiveFrom'> & {
    effectiveFrom: string;
  };
  return { ...raw, effectiveFrom: new Date(raw.effectiveFrom) };
}

function toVersion(row: VersionRow): PublishedPriceVersion {
  const rates: Rate[] = row.rates
    .map((r) => ({ kind: kind(r.kind), definitionId: r.definitionId, amountMinor: r.amountMinor }))
    .sort(
      (a, b) =>
        RATE_KINDS.indexOf(a.kind) - RATE_KINDS.indexOf(b.kind) ||
        (a.definitionId < b.definitionId ? -1 : a.definitionId > b.definitionId ? 1 : 0),
    );
  return {
    version: row.version,
    effectiveFrom: row.effectiveFrom,
    publishedAt: row.publishedAt,
    catalogRevision: row.catalogRevision,
    policyRevision: row.policyRevision,
    currency: row.currency,
    minorUnitExponent: row.minorUnitExponent,
    ratesFingerprint: row.ratesFingerprint,
    rates,
    catalog: snapshotFromJson(row.catalogSnapshot),
  };
}

function toQuote(row: QuoteRow): StoredQuote {
  return {
    id: row.id,
    ownerSubject: row.ownerSubject,
    priceVersion: row.priceVersion,
    catalogRevision: row.catalogRevision,
    policyRevision: row.policyRevision,
    currency: row.currency,
    minorUnitExponent: row.minorUnitExponent,
    selection: {
      catalogRevision: row.catalogRevision,
      categoryId: row.categoryId,
      packageId: row.packageId,
      addonIds: [...row.addonIds],
    },
    lines: [...row.lines]
      .sort((a, b) => a.lineNo - b.lineNo)
      .map((l) => ({
        kind: kind(l.kind),
        definitionId: l.definitionId,
        amountMinor: l.amountMinor,
        included: l.included,
      })),
    subtotalMinor: row.subtotalMinor,
    totalMinor: row.totalMinor,
    durationMinutes: row.durationMinutes,
    inputFingerprint: row.inputFingerprint,
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

class PrismaPricingUnitOfWork implements PricingUnitOfWork {
  constructor(private readonly tx: Tx) {}

  async lockHead(): Promise<VersionHead | null> {
    await this.tx.$queryRaw`SELECT id FROM app.pricing_publication_lock WHERE id = 1 FOR UPDATE`;
    const head = await this.tx.priceVersion.findFirst({
      orderBy: { version: 'desc' },
      select: { version: true, effectiveFrom: true },
    });
    return head ?? null;
  }

  async lockPrices(): Promise<void> {
    await this.tx.$queryRaw`SELECT id FROM app.pricing_publication_lock WHERE id = 1 FOR SHARE`;
  }

  async versionInForce(at: Date): Promise<PublishedPriceVersion | null> {
    const row = await this.tx.priceVersion.findFirst({
      where: { effectiveFrom: { lte: at } },
      orderBy: { effectiveFrom: 'desc' },
      include: { rates: true },
    });
    return row ? toVersion(row) : null;
  }

  async version(version: number): Promise<PublishedPriceVersion | null> {
    const row = await this.tx.priceVersion.findUnique({
      where: { version },
      include: { rates: true },
    });
    return row ? toVersion(row) : null;
  }

  async findReceipt(actorSubject: string, operation: string, idempotencyKey: string) {
    const row = await this.tx.pricingIdempotencyReceipt.findUnique({
      where: { actorSubject_operation_idempotencyKey: { actorSubject, operation, idempotencyKey } },
    });
    return row ? toReceipt(row) : null;
  }

  async insertPriceVersion(version: NewPriceVersion): Promise<void> {
    await this.tx.priceVersion.create({
      data: {
        version: version.version,
        previousVersion: version.version > 1 ? version.version - 1 : null,
        effectiveFrom: version.effectiveFrom,
        publishedAt: version.publishedAt,
        publishedBy: version.publishedBy,
        correlationId: version.correlationId,
        catalogRevision: version.catalogRevision,
        catalogFingerprint: version.catalog.definitionsFingerprint,
        catalogSnapshot: snapshotToJson(version.catalog),
        policyRevision: version.policyRevision,
        currency: version.currency,
        minorUnitExponent: version.minorUnitExponent,
        ratesFingerprint: version.ratesFingerprint,
      },
    });
    await this.tx.priceRate.createMany({
      data: version.rates.map((rate) => ({
        version: version.version,
        kind: rate.kind,
        definitionId: rate.definitionId,
        amountMinor: rate.amountMinor,
      })),
    });
  }

  async insertQuote(quote: StoredQuote): Promise<void> {
    await this.tx.quote.create({
      data: {
        id: quote.id,
        ownerSubject: quote.ownerSubject,
        priceVersion: quote.priceVersion,
        catalogRevision: quote.catalogRevision,
        policyRevision: quote.policyRevision,
        currency: quote.currency,
        minorUnitExponent: quote.minorUnitExponent,
        categoryId: quote.selection.categoryId,
        packageId: quote.selection.packageId,
        addonIds: [...quote.selection.addonIds],
        subtotalMinor: quote.subtotalMinor,
        totalMinor: quote.totalMinor,
        durationMinutes: quote.durationMinutes,
        inputFingerprint: quote.inputFingerprint,
        issuedAt: quote.issuedAt,
        expiresAt: quote.expiresAt,
        correlationId: quote.correlationId,
      },
    });
    await this.tx.quoteLine.createMany({
      data: quote.lines.map((line, lineNo) => ({
        quoteId: quote.id,
        lineNo,
        kind: line.kind,
        definitionId: line.definitionId,
        amountMinor: line.amountMinor,
        included: line.included,
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

  async appendAudit(record: AuditRecord): Promise<void> {
    await this.tx.pricingAuditEvent.create({ data: { ...record } });
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
      where: { actorSubject_operation_idempotencyKey: { actorSubject, operation, idempotencyKey } },
    });
    return row ? toReceipt(row) : null;
  }

  async versionInForce(at: Date): Promise<PublishedPriceVersion | null> {
    const row = await this.client.priceVersion.findFirst({
      where: { effectiveFrom: { lte: at } },
      orderBy: { effectiveFrom: 'desc' },
      include: { rates: true },
    });
    return row ? toVersion(row) : null;
  }

  async version(version: number): Promise<PublishedPriceVersion | null> {
    const row = await this.client.priceVersion.findUnique({
      where: { version },
      include: { rates: true },
    });
    return row ? toVersion(row) : null;
  }

  async listVersions(limit: number) {
    return this.client.priceVersion.findMany({
      orderBy: { version: 'desc' },
      take: limit,
      select: {
        version: true,
        effectiveFrom: true,
        publishedAt: true,
        catalogRevision: true,
        policyRevision: true,
        currency: true,
        minorUnitExponent: true,
        ratesFingerprint: true,
      },
    });
  }

  async quote(id: string): Promise<StoredQuote | null> {
    const row = await this.client.quote.findUnique({ where: { id }, include: { lines: true } });
    return row ? toQuote(row) : null;
  }
}
