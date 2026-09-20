import { Injectable } from '@nestjs/common';
import type { OutboxRecord, OutboxStore } from '@carwash/platform-messaging';
import { PrismaService } from '../prisma.service';

interface LeasedRow {
  id: string;
  event_id: string;
  event_type: string;
  exchange: string;
  routing_key: string;
  payload: string;
  correlation_id: string;
  attempts: number;
}

/**
 * Catalog's outbox storage.
 *
 * Two independent mechanisms keep competing relay replicas correct:
 *
 *   FOR UPDATE SKIP LOCKED  - two workers leasing at the same instant pick
 *                             disjoint rows instead of blocking or colliding.
 *   locked_by / locked_until - a worker that stalls past its lease loses
 *                             ownership; every later write is guarded by
 *                             `locked_by = $workerId`, so the stalled worker's
 *                             update matches zero rows instead of overwriting
 *                             what the new owner did.
 *
 * Every mutating method therefore returns whether it still owned the row. The
 * relay reports a lost lease rather than assuming success.
 */
@Injectable()
export class PrismaOutboxStore implements OutboxStore {
  constructor(private readonly prisma: PrismaService) {}

  async leaseBatch(input: {
    workerId: string;
    leaseMs: number;
    limit: number;
    maxAttempts: number;
  }): Promise<OutboxRecord[]> {
    const rows = await this.prisma.client.$queryRawUnsafe<LeasedRow[]>(
      `UPDATE app.outbox_message AS o
          SET locked_by = $1,
              locked_until = now() + ($2::bigint * interval '1 millisecond'),
              attempts = o.attempts + 1
        WHERE o.id IN (
          SELECT c.id
            FROM app.outbox_message AS c
           WHERE c.published_at IS NULL
             AND c.dead_at IS NULL
             AND (c.locked_until IS NULL OR c.locked_until < now())
             AND c.attempts < $3
           ORDER BY c.created_at, c.id
           FOR UPDATE SKIP LOCKED
           LIMIT $4
        )
      RETURNING o.id, o.event_id, o.event_type, o.exchange, o.routing_key,
                o.payload, o.correlation_id, o.attempts`,
      input.workerId,
      input.leaseMs,
      input.maxAttempts,
      input.limit,
    );

    return rows.map((row) => ({
      id: row.id,
      eventId: row.event_id,
      eventType: row.event_type,
      exchange: row.exchange,
      routingKey: row.routing_key,
      payload: row.payload,
      correlationId: row.correlation_id,
      attempts: row.attempts,
    }));
  }

  async markPublished(input: { id: string; workerId: string }): Promise<boolean> {
    // `locked_by = $2` is the lease guard. Without it a resumed worker would
    // mark a row published that another worker is still responsible for.
    const rows = await this.prisma.client.$queryRawUnsafe<{ id: string }[]>(
      `UPDATE app.outbox_message
          SET published_at = now(), locked_by = NULL, locked_until = NULL, last_error = NULL
        WHERE id = $1 AND locked_by = $2 AND published_at IS NULL
      RETURNING id`,
      input.id,
      input.workerId,
    );
    return rows.length === 1;
  }

  async markFailed(input: {
    id: string;
    workerId: string;
    error: string;
    maxAttempts: number;
  }): Promise<boolean> {
    // The row goes back into the pending pool unless it has exhausted its
    // attempts, in which case it is parked as dead rather than retried forever.
    const rows = await this.prisma.client.$queryRawUnsafe<{ id: string; dead_at: Date | null }[]>(
      `UPDATE app.outbox_message
          SET last_error = $3,
              locked_by = NULL,
              locked_until = NULL,
              dead_at = CASE WHEN attempts >= $4 THEN now() ELSE NULL END
        WHERE id = $1 AND locked_by = $2 AND published_at IS NULL
      RETURNING id, dead_at`,
      input.id,
      input.workerId,
      input.error,
      input.maxAttempts,
    );
    return rows.length === 1;
  }
}
