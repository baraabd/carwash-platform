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
        if (existing) return classifyWinner(existing.payloadHash, record.payloadHash);
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
      if (!isUniqueViolation(error)) throw error;
      // INT-D-01: a unique violation is only a duplicate when a committed inbox
      // row for THIS event proves the effect already happened. The failed
      // transaction rolled back, so a winner can only be another delivery that
      // committed. Without one, the violation came from the effect itself (an
      // unrelated business constraint) and must stay an error: ACKing it as a
      // duplicate would discard work that was never applied.
      const winner = await this.prisma.client.inboxMessage.findUnique({
        where: { eventId: record.eventId },
      });
      if (!winner) throw new InboxEffectConflictError(record.eventId, error);
      return classifyWinner(winner.payloadHash, record.payloadHash);
    }
  }
}

/** Same id, different bytes is an integrity fault: never applied, never retried. */
function classifyWinner(committedHash: string, incomingHash: string): InboxOutcome {
  return committedHash === incomingHash ? 'DUPLICATE' : 'CONFLICT';
}

/**
 * A uniqueness failure raised by the local effect, not by inbox deduplication.
 * It is rethrown so the consumer NACKs and the broker's bounded delivery limit
 * moves a persistent fault to the dead-letter queue.
 */
export class InboxEffectConflictError extends Error {
  constructor(
    readonly eventId: string,
    cause: unknown,
  ) {
    super('INBOX_EFFECT_UNIQUE_CONFLICT', { cause });
    this.name = 'InboxEffectConflictError';
  }
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  // P2002 = Prisma unique constraint, 23505 = PostgreSQL unique_violation.
  return code === 'P2002' || code === '23505';
}
