import { reviewsV1 } from '@carwash/contracts';
import type { Prisma, Review as ReviewRow } from '../../generated/prisma/client';
import type {
  CommandIdentity,
  CommandReceipt,
  QueueCursor,
  ReviewChange,
  ReviewRecord,
  ReviewsStore,
  ReviewTransaction,
} from '../../ports/reviews.ports';
import { REVIEW_CHANGED_EVENT, REVIEWS_EXCHANGE } from '../../application/events';
import { ReviewsError } from '../../application/errors';
import type { PrismaService } from './prisma.service';

type Client = Prisma.TransactionClient;

function record(row: ReviewRow): ReviewRecord {
  return {
    view: reviewsV1.parseReviewV1({
      reviewId: row.id,
      revision: row.revision,
      bookingId: row.bookingId,
      author: { kind: row.authorKind, subjectId: row.authorSubject },
      rating: row.rating,
      comment: row.comment,
      publicationConsent: row.publicationConsent,
      status: row.status,
      moderationReason: row.moderationReason,
      submittedAt: row.submittedAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }),
    bookingRevision: row.bookingRevision,
    bookingVerifiedAt: row.bookingVerifiedAt.toISOString(),
  };
}

function receiptWhere(command: CommandIdentity) {
  return {
    actorKind_actorSubject_operation_key: {
      actorKind: command.actor.kind,
      actorSubject: command.actor.subjectId,
      operation: command.operation,
      key: command.key,
    },
  };
}

async function receipt(client: Client, command: CommandIdentity): Promise<CommandReceipt | null> {
  const found = await client.reviewCommandReceipt.findUnique({
    where: receiptWhere(command),
    include: { audit: { include: { review: true } } },
  });
  if (!found) return null;
  const immutable = record(found.audit.review).view;
  return {
    fingerprint: found.fingerprint,
    view: reviewsV1.parseReviewV1({
      ...immutable,
      revision: found.audit.revision,
      status: found.audit.status,
      moderationReason: found.audit.reason,
      updatedAt: found.audit.occurredAt.toISOString(),
    }),
  };
}

async function byBooking(client: Client, bookingId: string): Promise<ReviewRecord | null> {
  const row = await client.review.findUnique({ where: { bookingId } });
  return row ? record(row) : null;
}

class Transaction implements ReviewTransaction {
  constructor(private readonly client: Client) {}

  async lockCommand(command: CommandIdentity): Promise<boolean> {
    const lock = `reviews.v1:${command.actor.kind}:${command.actor.subjectId}:${command.operation}:${command.key}`;
    const rows = await this.client.$queryRaw<{ acquired: boolean }[]>`
      SELECT pg_try_advisory_xact_lock(hashtextextended(${lock}, 0)) AS acquired`;
    return rows[0]?.acquired === true;
  }

  receipt(command: CommandIdentity): Promise<CommandReceipt | null> {
    return receipt(this.client, command);
  }

  async lockBooking(bookingId: string): Promise<void> {
    const lock = `reviews.booking:${bookingId}`;
    await this.client.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lock}, 0))::text`;
  }

  byBooking(bookingId: string): Promise<ReviewRecord | null> {
    return byBooking(this.client, bookingId);
  }

  async lockReview(reviewId: string): Promise<ReviewRecord | null> {
    await this.client.$queryRaw`SELECT id FROM app.review WHERE id = ${reviewId}::uuid FOR UPDATE`;
    const row = await this.client.review.findUnique({ where: { id: reviewId } });
    return row ? record(row) : null;
  }

  async apply(change: ReviewChange): Promise<void> {
    const { view, bookingRevision, bookingVerifiedAt } = change.next;
    if (change.previous === null) {
      await this.client.review.create({
        data: {
          id: view.reviewId,
          bookingId: view.bookingId,
          bookingRevision,
          bookingVerifiedAt: new Date(bookingVerifiedAt),
          authorKind: view.author.kind,
          authorSubject: view.author.subjectId,
          rating: view.rating,
          comment: view.comment,
          publicationConsent: view.publicationConsent,
          status: view.status,
          moderationReason: view.moderationReason,
          revision: view.revision,
          submittedAt: new Date(view.submittedAt),
          updatedAt: new Date(view.updatedAt),
        },
      });
    } else {
      const updated = await this.client.review.updateMany({
        where: { id: view.reviewId, revision: change.previous.revision },
        data: {
          status: view.status,
          moderationReason: view.moderationReason,
          revision: view.revision,
          updatedAt: new Date(view.updatedAt),
        },
      });
      if (updated.count !== 1) throw new ReviewsError('REVISION_CONFLICT');
    }
    await this.client.outboxMessage.create({
      data: {
        id: change.eventId,
        eventId: change.eventId,
        eventType: REVIEW_CHANGED_EVENT,
        exchange: REVIEWS_EXCHANGE,
        routingKey: REVIEW_CHANGED_EVENT,
        payload: change.payload,
        reviewId: view.reviewId,
        revision: view.revision,
        correlationId: change.correlationId,
        createdAt: new Date(view.updatedAt),
      },
    });
    await this.client.reviewAudit.create({
      data: {
        reviewId: view.reviewId,
        revision: view.revision,
        eventId: change.eventId,
        actorKind: change.actor.kind,
        actorSubject: change.actor.subjectId,
        action: change.action,
        previousStatus: change.previous?.status ?? null,
        status: view.status,
        reason: view.moderationReason,
        occurredAt: new Date(view.updatedAt),
        correlationId: change.correlationId,
      },
    });
    await this.client.reviewCommandReceipt.create({
      data: {
        actorKind: change.command.actor.kind,
        actorSubject: change.command.actor.subjectId,
        operation: change.command.operation,
        key: change.command.key,
        fingerprint: change.fingerprint,
        reviewId: view.reviewId,
        revision: view.revision,
      },
    });
  }
}

export class PrismaReviewsStore implements ReviewsStore {
  constructor(private readonly prisma: PrismaService) {}

  receipt(command: CommandIdentity): Promise<CommandReceipt | null> {
    return receipt(this.prisma.client, command);
  }

  byBooking(bookingId: string): Promise<ReviewRecord | null> {
    return byBooking(this.prisma.client, bookingId);
  }

  async pending(asOf: string, after: QueueCursor | null, limit: number) {
    const rows = await this.prisma.client.review.findMany({
      where: {
        status: 'PENDING_MODERATION',
        submittedAt: { lte: new Date(asOf) },
        ...(after
          ? {
              OR: [
                { submittedAt: { gt: new Date(after.submittedAt) } },
                { submittedAt: new Date(after.submittedAt), id: { gt: after.reviewId } },
              ],
            }
          : {}),
      },
      orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });
    return rows.map(record);
  }

  transaction<T>(work: (tx: ReviewTransaction) => Promise<T>): Promise<T> {
    return this.prisma.client.$transaction((client) => work(new Transaction(client)), {
      isolationLevel: 'ReadCommitted',
      maxWait: 5_000,
      timeout: 10_000,
    });
  }
}
