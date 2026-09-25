import { Injectable } from '@nestjs/common';
import type { InboxOutcome, InboxRecord, InboxStore } from '@carwash/platform-messaging';
import { PrismaService } from '../prisma.service';

/**
 * reporting's inbox storage.
 *
 * The inbox row and the local effect are written by ONE transaction. That single
 * fact is what makes redelivery safe: either both exist or neither does, so a
 * crash cannot leave an applied effect that will be applied again, nor an inbox
 * row claiming an effect that never happened.
 *
 * The ACK is sent by the consumer only after this transaction has committed.
 */
@Injectable()
export class PrismaInboxStore implements InboxStore {
  constructor(private readonly prisma: PrismaService) {}

  async applyOnce(
    record: InboxRecord,
    effect: (tx: unknown) => Promise<void>,
  ): Promise<InboxOutcome> {
    try {
      return await this.prisma.client.$transaction(async (tx) => {
        const existing = await tx.inboxMessage.findUnique({
          where: { eventId: record.eventId },
        });
        if (existing) {
          // Same id, different bytes: an integrity fault. Never apply it, and
          // never retry it either - retrying cannot change the contradiction.
          return existing.payloadHash === record.payloadHash ? 'DUPLICATE' : 'CONFLICT';
        }
        await tx.inboxMessage.create({
          data: {
            eventId: record.eventId,
            eventType: record.eventType,
            payloadHash: record.payloadHash,
            correlationId: record.correlationId,
          },
        });
        await effect(tx);
        return 'APPLIED';
      });
    } catch (error: unknown) {
      // Two deliveries racing each other: both read "not present", one wins the
      // insert and the loser sees a unique violation. That is a duplicate, not
      // an error worth redelivering.
      if (isUniqueViolation(error)) return 'DUPLICATE';
      throw error;
    }
  }
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  // P2002 = Prisma unique constraint, 23505 = PostgreSQL unique_violation.
  return code === 'P2002' || code === '23505';
}
