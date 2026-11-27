import type {
  EntitlementConsumptionQueue,
  LeasedEntitlementConsumption,
} from '../../ports/entitlement-consumption.ports';
import type { PrismaService } from './prisma.service';

/** Exclusive, expiring, monotonically fenced leases. Exhausted rows require operator review. */
export class PrismaEntitlementConsumptionStore implements EntitlementConsumptionQueue {
  constructor(private readonly prisma: PrismaService) {}
  async lease(workerId: string, limit: number): Promise<readonly LeasedEntitlementConsumption[]> {
    const rows = await this.prisma.client.$queryRawUnsafe<
      Array<{
        booking_id: string;
        reservation_id: string;
        correlation_id: string;
        attempts: number;
      }>
    >(
      `UPDATE app.booking_entitlement_consumption AS q SET locked_by=$1,
          locked_until=clock_timestamp()+interval '60 seconds',attempts=q.attempts+1
         WHERE q.booking_id IN (SELECT booking_id FROM app.booking_entitlement_consumption
           WHERE consumed_at IS NULL AND attempts<50 AND next_attempt_at<=clock_timestamp()
             AND (locked_until IS NULL OR locked_until<=clock_timestamp())
           ORDER BY next_attempt_at,booking_id FOR UPDATE SKIP LOCKED LIMIT $2)
         RETURNING q.booking_id::text,q.reservation_id::text,q.correlation_id::text,q.attempts`,
      workerId,
      limit,
    );
    return rows.map((row) => ({
      bookingId: row.booking_id,
      reservationId: row.reservation_id,
      correlationId: row.correlation_id,
      attempt: row.attempts,
    }));
  }
  async consumed(workerId: string, item: LeasedEntitlementConsumption): Promise<boolean> {
    return (
      (await this.prisma.client.$executeRawUnsafe(
        `UPDATE app.booking_entitlement_consumption
      SET consumed_at=clock_timestamp(),last_error=NULL,locked_by=NULL,locked_until=NULL
      WHERE booking_id=$1::uuid AND locked_by=$2 AND attempts=$3 AND locked_until>clock_timestamp()
        AND consumed_at IS NULL`,
        item.bookingId,
        workerId,
        item.attempt,
      )) === 1
    );
  }
  async retry(
    workerId: string,
    item: LeasedEntitlementConsumption,
    error: string,
  ): Promise<boolean> {
    const delay = Math.min(300_000, 1_000 * 2 ** Math.min(item.attempt, 9));
    return (
      (await this.prisma.client.$executeRawUnsafe(
        `UPDATE app.booking_entitlement_consumption
      SET next_attempt_at=clock_timestamp()+($4::int*interval '1 millisecond'),last_error=$5,
        locked_by=NULL,locked_until=NULL
      WHERE booking_id=$1::uuid AND locked_by=$2 AND attempts=$3 AND locked_until>clock_timestamp()
        AND consumed_at IS NULL`,
        item.bookingId,
        workerId,
        item.attempt,
        delay,
        error.slice(0, 64),
      )) === 1
    );
  }
}
