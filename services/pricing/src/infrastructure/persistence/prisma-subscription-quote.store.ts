import { Injectable } from '@nestjs/common';
import { pricingV1 } from '@carwash/contracts';
import type { SubscriptionQuoteStore } from '../../ports/subscription-quote.ports';
import { Prisma, type PrismaClient } from '../../generated/prisma/client';
import { PrismaService } from './prisma.service';

const OPERATION = 'pricing.subscription-quote.create.v1';
function view(row: Prisma.PricingSubscriptionQuoteGetPayload<object>) {
  return pricingV1.parseSubscriptionQuoteV1({
    quoteId: row.id,
    beneficiary: { kind: 'account', subjectId: row.customerSubject },
    planId: row.planId,
    planVersion: row.planVersion,
    currency: row.currency,
    total: { currency: row.currency, scale: 2, amountMinor: row.totalMinor.toString() },
    status: 'USABLE',
    planContentHash: row.planContentHash,
    issuedAt: row.issuedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  });
}
async function receipt(db: Prisma.TransactionClient | PrismaClient, actor: string, key: string) {
  const row = await db.pricingIdempotencyReceipt.findUnique({
    where: {
      actorSubject_operation_idempotencyKey: {
        actorSubject: actor,
        operation: OPERATION,
        idempotencyKey: key,
      },
    },
  });
  return row
    ? {
        fingerprint: row.requestFingerprint,
        quote: pricingV1.parseSubscriptionQuoteV1(row.responseBody),
      }
    : null;
}
@Injectable()
export class PrismaSubscriptionQuoteStore implements SubscriptionQuoteStore {
  private readonly client: PrismaClient;
  constructor(prisma: PrismaService) {
    this.client = prisma.client;
  }
  receipt(actor: string, key: string) {
    return receipt(this.client, actor, key);
  }
  async get(id: string) {
    const row = await this.client.pricingSubscriptionQuote.findUnique({ where: { id } });
    return row ? view(row) : null;
  }
  async create(
    actor: string,
    key: string,
    fingerprint: string,
    quote: pricingV1.SubscriptionQuoteV1,
  ) {
    return this.client.$transaction(async (tx) => {
      const lock = JSON.stringify([OPERATION, actor, key]);
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lock},0))::text`;
      const prior = await receipt(tx, actor, key);
      if (prior) return { ...prior, replayed: true };
      await tx.pricingSubscriptionQuote.create({
        data: {
          id: quote.quoteId,
          customerSubject: actor,
          planId: quote.planId,
          planVersion: quote.planVersion,
          currency: quote.currency,
          totalMinor: BigInt(quote.total.amountMinor),
          planContentHash: quote.planContentHash,
          issuedAt: new Date(quote.issuedAt),
          expiresAt: new Date(quote.expiresAt),
        },
      });
      await tx.pricingIdempotencyReceipt.create({
        data: {
          actorSubject: actor,
          operation: OPERATION,
          idempotencyKey: key,
          requestFingerprint: fingerprint,
          responseStatus: 201,
          responseBody: quote as unknown as Prisma.InputJsonObject,
          createdAt: new Date(quote.issuedAt),
        },
      });
      return { fingerprint, quote, replayed: false };
    });
  }
}
