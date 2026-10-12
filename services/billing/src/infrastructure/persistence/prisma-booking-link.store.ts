import {
  BookingAlreadyLinked,
  type BookingLink,
  type BookingLinkReader,
  type BookingLinkStore,
} from '../../ports';
import { Prisma, type PrismaClient } from '../../generated/prisma/client';

type Db = Prisma.TransactionClient | PrismaClient;
type LinkRow = Prisma.BookingObligationGetPayload<object>;

function toLink(row: LinkRow): BookingLink {
  return {
    bookingId: row.bookingId,
    obligationId: row.obligationId,
    clientId: row.clientId,
    createdAt: row.createdAt,
    voidedAt: row.voidedAt,
  };
}

async function forBooking(db: Db, bookingId: string): Promise<BookingLink | null> {
  const row = await db.bookingObligation.findUnique({ where: { bookingId } });
  return row ? toLink(row) : null;
}

async function forObligation(db: Db, obligationId: string): Promise<BookingLink | null> {
  const row = await db.bookingObligation.findUnique({ where: { obligationId } });
  return row ? toLink(row) : null;
}

/** Booking links on the caller's transaction. Guards live in the migration. */
export class PrismaBookingLinkStore implements BookingLinkStore {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  forBooking(bookingId: string) {
    return forBooking(this.tx, bookingId);
  }

  forObligation(obligationId: string) {
    return forObligation(this.tx, obligationId);
  }

  async insert(link: BookingLink, correlationId: string): Promise<void> {
    try {
      await this.tx.bookingObligation.create({
        data: {
          bookingId: link.bookingId,
          obligationId: link.obligationId,
          clientId: link.clientId,
          createdAt: link.createdAt,
          createdCorrelationId: correlationId,
        },
      });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new BookingAlreadyLinked();
      throw error;
    }
  }

  async markVoided(obligationId: string, at: Date, correlationId: string): Promise<void> {
    const result = await this.tx.bookingObligation.updateMany({
      where: { obligationId, voidedAt: null },
      data: { voidedAt: at, voidedCorrelationId: correlationId },
    });
    if (result.count !== 1) throw new Error('BOOKING_LINK_NOT_VOIDABLE');
  }
}

export class PrismaBookingLinkReader implements BookingLinkReader {
  constructor(private readonly client: PrismaClient) {}

  forBooking(bookingId: string) {
    return forBooking(this.client, bookingId);
  }

  forObligation(obligationId: string) {
    return forObligation(this.client, obligationId);
  }
}
