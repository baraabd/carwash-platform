import type { OutboxRecord, OutboxStore } from '@carwash/platform-messaging';
import type { PrismaService } from '../infrastructure/persistence/prisma.service';
import { CUSTODY_EVENT_TYPES } from './custody-events';

interface Row {
  id: string;
  event_id: string;
  event_type: string;
  exchange: string;
  routing_key: string;
  payload: string;
  correlation_id: string;
  attempts: number;
  trace_parent: string | null;
  created_at: Date;
}

/** Billing's own transactional outbox. Legacy unpublished events stay untouched. */
export class PrismaCustodyOutboxStore implements OutboxStore {
  constructor(private readonly prisma: PrismaService) {}

  async leaseBatch(input: {
    workerId: string;
    leaseMs: number;
    limit: number;
    maxAttempts: number;
  }): Promise<OutboxRecord[]> {
    // A process can die on its final lease before markFailed. Park that expired
    // row explicitly; never leave it invisible to both pending and dead alerts.
    await this.prisma.client.$executeRawUnsafe(
      `UPDATE app.outbox_message SET dead_at = now(), locked_by = NULL,
              locked_until = NULL, last_error = 'LEASE_EXHAUSTED'
        WHERE published_at IS NULL AND dead_at IS NULL AND attempts >= $1
          AND (locked_until IS NULL OR locked_until < now())
          AND event_type = ANY($2::text[])`,
      input.maxAttempts,
      [...CUSTODY_EVENT_TYPES],
    );
    const rows = await this.prisma.client.$queryRawUnsafe<Row[]>(
      `UPDATE app.outbox_message AS o
          SET locked_by = $1, locked_until = now() + ($2::bigint * interval '1 millisecond'),
              attempts = o.attempts + 1
        WHERE o.id IN (
          SELECT c.id FROM app.outbox_message AS c
           WHERE c.published_at IS NULL AND c.dead_at IS NULL
             AND (c.locked_until IS NULL OR c.locked_until < now())
             AND c.attempts < $3 AND c.event_type = ANY($5::text[])
           ORDER BY c.created_at, c.id FOR UPDATE SKIP LOCKED LIMIT $4
        )
        RETURNING o.id, o.event_id, o.event_type, o.exchange, o.routing_key,
                  o.payload, o.correlation_id, o.attempts, o.trace_parent, o.created_at`,
      input.workerId,
      input.leaseMs,
      input.maxAttempts,
      input.limit,
      [...CUSTODY_EVENT_TYPES],
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
      traceParent: row.trace_parent,
      createdAtMs: row.created_at.getTime(),
    }));
  }

  async markPublished(input: {
    id: string;
    workerId: string;
    leaseAttempt: number;
  }): Promise<boolean> {
    const rows = await this.prisma.client.$queryRawUnsafe<{ id: string }[]>(
      `UPDATE app.outbox_message SET published_at = now(), locked_by = NULL,
              locked_until = NULL, last_error = NULL
        WHERE id = $1::uuid AND locked_by = $2 AND attempts = $3 AND locked_until > now()
          AND published_at IS NULL AND dead_at IS NULL RETURNING id`,
      input.id,
      input.workerId,
      input.leaseAttempt,
    );
    return rows.length === 1;
  }

  async markFailed(input: {
    id: string;
    workerId: string;
    leaseAttempt: number;
    error: string;
    maxAttempts: number;
  }): Promise<boolean> {
    const rows = await this.prisma.client.$queryRawUnsafe<{ id: string }[]>(
      `UPDATE app.outbox_message SET last_error = $3, locked_by = NULL, locked_until = NULL,
              dead_at = CASE WHEN attempts >= $4 THEN now() ELSE NULL END
        WHERE id = $1::uuid AND locked_by = $2 AND attempts = $5 AND locked_until > now()
          AND published_at IS NULL AND dead_at IS NULL RETURNING id`,
      input.id,
      input.workerId,
      input.error,
      input.maxAttempts,
      input.leaseAttempt,
    );
    return rows.length === 1;
  }
}
