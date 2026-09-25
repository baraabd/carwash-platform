import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  FOUNDATION_PROBE_CREATED_V1,
  parseFoundationProbeCreatedV1,
  type FoundationProbeCreatedV1,
} from '@carwash/event-contracts';
import { CATALOG_EVENTS_EXCHANGE, FOUNDATION_PROBE_ROUTING_KEY } from '@carwash/platform-messaging';
import { PrismaService } from '../prisma.service';

/**
 * The Sprint 0.2 producer slice.
 *
 * The whole point of this class is the transaction boundary: the local row and
 * the outbox row are written by the SAME transaction, so there is no window in
 * which the local state changed but the event was lost, and none in which an
 * event was promised for a change that rolled back.
 *
 * The event is deliberately non-financial and carries no personal data.
 */
export interface CreateProbeInput {
  readonly label: string;
  readonly correlationId?: string;
  /**
   * Test seam. Raises inside the transaction AFTER both writes, to prove that
   * the local row and the outbox row roll back together. It is never reachable
   * from an HTTP route.
   */
  readonly failAfterWrites?: boolean;
}

export interface CreateProbeResult {
  readonly probeId: string;
  readonly eventId: string;
  readonly correlationId: string;
}

@Injectable()
export class ProbeService {
  constructor(private readonly prisma: PrismaService) {}

  async createProbe(input: CreateProbeInput): Promise<CreateProbeResult> {
    const probeId = randomUUID();
    const eventId = randomUUID();
    const correlationId = input.correlationId ?? randomUUID();
    const occurredAt = new Date().toISOString();

    const event: FoundationProbeCreatedV1 = {
      eventId,
      eventType: FOUNDATION_PROBE_CREATED_V1,
      schemaVersion: 1,
      producer: 'catalog',
      occurredAt,
      correlationId,
      aggregateVersion: 1,
      data: { probeId, label: input.label },
    };
    // Validate before persisting: an event that cannot be parsed by its own
    // contract must never reach the outbox, where it would poison the relay.
    const payload = JSON.stringify(parseFoundationProbeCreatedV1(event));

    await this.prisma.client.$transaction(async (tx) => {
      await tx.foundationProbe.create({
        data: { id: probeId, label: input.label, version: 1 },
      });
      await tx.outboxMessage.create({
        data: {
          id: randomUUID(),
          eventId,
          eventType: FOUNDATION_PROBE_CREATED_V1,
          exchange: CATALOG_EVENTS_EXCHANGE,
          routingKey: FOUNDATION_PROBE_ROUTING_KEY,
          payload,
          correlationId,
        },
      });
      if (input.failAfterWrites) throw new Error('SIMULATED_PRODUCER_FAILURE');
    });

    return { probeId, eventId, correlationId };
  }
}
