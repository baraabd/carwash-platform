import { randomUUID } from 'node:crypto';
import { dispatchExecutionV1 } from '@carwash/contracts';
import { BOOKING_LIFECYCLE_PROGRESSED_V1 } from '@carwash/event-contracts';
import type { InboxRecord, InboxStore, InboxOutcome } from '@carwash/platform-messaging';
import type { Prisma } from '../../generated/prisma/client';
import type { BookingStatus } from '../../domain';
import { projectExecution, type ExecutionWatermark } from '../../domain/execution-projection';
import { appendAudit } from '../persistence/prisma-booking.store';
import type { PrismaService } from '../persistence/prisma.service';

/** Exactly one local transaction contains deduplication, watermark, booking, audit and outbox. */
export class DispatchProjectionStore implements InboxStore {
  constructor(private readonly prisma: PrismaService) {}
  async applyOnce(
    record: InboxRecord,
    effect: (tx: unknown) => Promise<void>,
  ): Promise<InboxOutcome> {
    return this.prisma.client.$transaction(
      async (tx) => {
        const inserted = await tx.$queryRawUnsafe<Array<{ event_id: string }>>(
          `INSERT INTO app.inbox_message (consumer_name,event_id,event_type,payload_hash,correlation_id)
         VALUES ('dispatch-execution-v1',$1::uuid,$2,$3,$4::uuid)
         ON CONFLICT (consumer_name,event_id) DO NOTHING RETURNING event_id::text`,
          record.eventId,
          record.eventType,
          record.payloadHash,
          record.correlationId,
        );
        if (!inserted.length) {
          const [known] = await tx.$queryRawUnsafe<Array<{ payload_hash: string }>>(
            `SELECT payload_hash FROM app.inbox_message WHERE consumer_name='dispatch-execution-v1'
           AND event_id=$1::uuid`,
            record.eventId,
          );
          return known?.payload_hash === record.payloadHash ? 'DUPLICATE' : 'CONFLICT';
        }
        await effect(tx);
        return 'APPLIED';
      },
      { isolationLevel: 'ReadCommitted', timeout: 10_000, maxWait: 5_000 },
    );
  }

  async project(
    rawTx: unknown,
    rawSnapshot: unknown,
    trigger: { readonly eventId: string; readonly correlationId: string },
  ): Promise<void> {
    const tx = rawTx as Prisma.TransactionClient;
    const snapshot = dispatchExecutionV1.parseExecutionV1(rawSnapshot);
    const [booking] = await tx.$queryRawUnsafe<
      Array<{
        status: BookingStatus;
        version: number;
        hold_id: string;
        subscription_id: string | null;
        reservation_id: string | null;
      }>
    >(
      `SELECT b.status,b.version,COALESCE(b.schedule_hold_id,b.hold_id)::text AS hold_id,
           b.subscription_id::text,(SELECT s.entitlement_reservation_id::text FROM app.booking_saga s
             WHERE s.booking_id=b.id) AS reservation_id
           FROM app.booking b WHERE b.id=$1::uuid FOR UPDATE OF b`,
      snapshot.bookingId,
    );
    if (!booking) throw new Error('BOOKING_NOT_YET_AVAILABLE');
    const [mark] = await tx.$queryRawUnsafe<
      Array<{
        assignment_id: string;
        assignment_revision: number;
        task_id: string | null;
        task_revision: number | null;
      }>
    >(
      `SELECT assignment_id::text,assignment_revision,task_id::text,task_revision
         FROM app.booking_dispatch_projection WHERE booking_id=$1::uuid`,
      snapshot.bookingId,
    );
    const previous: ExecutionWatermark | null = mark
      ? {
          assignmentId: mark.assignment_id,
          assignmentRevision: mark.assignment_revision,
          taskId: mark.task_id,
          taskRevision: mark.task_revision,
        }
      : null;
    const next = projectExecution(booking.status, previous, snapshot);
    if (next === 'STALE') return;
    if (booking.hold_id !== snapshot.holdId) throw new Error('BOOKING_SCHEDULE_NOT_SYNCHRONIZED');
    await tx.$executeRawUnsafe(
      `INSERT INTO app.booking_dispatch_projection
        (booking_id,assignment_id,assignment_revision,task_id,task_revision,updated_at)
       VALUES ($1::uuid,$2::uuid,$3,$4::uuid,$5,now())
       ON CONFLICT (booking_id) DO UPDATE SET assignment_id=EXCLUDED.assignment_id,
         assignment_revision=EXCLUDED.assignment_revision,task_id=EXCLUDED.task_id,
         task_revision=EXCLUDED.task_revision,updated_at=EXCLUDED.updated_at`,
      snapshot.bookingId,
      snapshot.assignmentId,
      snapshot.revision,
      snapshot.task?.taskId ?? null,
      snapshot.task?.revision ?? null,
    );
    if (next === booking.status) return;
    const updated = await tx.$executeRawUnsafe(
      `UPDATE app.booking SET status=$2,version=version+1,updated_at=now()
       WHERE id=$1::uuid AND version=$3`,
      snapshot.bookingId,
      next,
      booking.version,
    );
    if (updated !== 1) throw new Error('BOOKING_PROJECTION_REVISION_CONFLICT');
    if (next === 'COMPLETED' && booking.subscription_id !== null) {
      if (booking.reservation_id === null)
        throw new Error('COMPLETED_ENTITLEMENT_REFERENCE_MISSING');
      await tx.$executeRawUnsafe(
        `INSERT INTO app.booking_entitlement_consumption
        (booking_id,reservation_id,correlation_id) VALUES ($1::uuid,$2::uuid,$3::uuid)
        ON CONFLICT (booking_id) DO NOTHING`,
        snapshot.bookingId,
        booking.reservation_id,
        trigger.correlationId,
      );
    }
    const eventId = randomUUID();
    const event = BOOKING_LIFECYCLE_PROGRESSED_V1.parse({
      eventId,
      eventType: BOOKING_LIFECYCLE_PROGRESSED_V1.eventType,
      envelopeVersion: 2,
      producer: 'booking',
      occurredAt: new Date().toISOString(),
      correlationId: trigger.correlationId,
      causationId: trigger.eventId,
      traceparent: null,
      aggregate: { type: 'booking', id: snapshot.bookingId, version: booking.version + 1 },
      actor: { kind: 'system', id: null },
      data: {
        previousStatus: booking.status,
        status: next,
        assignmentId: snapshot.assignmentId,
        assignmentRevision: snapshot.revision,
        taskId: snapshot.task?.taskId ?? null,
        taskRevision: snapshot.task?.revision ?? null,
      },
    });
    await tx.$executeRawUnsafe(
      `INSERT INTO app.outbox_message (id,event_id,event_type,exchange,routing_key,payload,correlation_id)
       VALUES ($1::uuid,$2::uuid,$3,'booking.events',$3,$4,$5::uuid)`,
      randomUUID(),
      eventId,
      event.eventType,
      JSON.stringify(event),
      trigger.correlationId,
    );
    await appendAudit(tx, {
      action: 'booking.execution-projected',
      actor: { kind: 'SYSTEM', component: 'dispatch-execution-v1' },
      bookingId: snapshot.bookingId,
      correlationId: trigger.correlationId,
      details: {
        previousStatus: booking.status,
        status: next,
        assignmentId: snapshot.assignmentId,
        assignmentRevision: snapshot.revision,
        taskId: snapshot.task?.taskId ?? null,
        taskRevision: snapshot.task?.revision ?? null,
      },
    });
  }
}
