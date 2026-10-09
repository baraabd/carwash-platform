import type { EventActor, EventEnvelopeV2 } from '@carwash/event-contracts';
import type { AssignmentState, AssignmentStatus } from './assignment';

/**
 * `dispatch.assignment-changed.v1` on the published envelope v2.
 *
 * PRODUCER-PENDING: this event type is REQUESTED from Lane E in
 * docs/production/C/contract-requests/CR-P02-C3-dispatch-v1.md and is NOT in
 * @carwash/event-contracts. Rows are written to the outbox so the change and its
 * event commit together, but nothing may treat the shape as published until E
 * registers it. Data is opaque ids and the job window only: no names, phones,
 * addresses or plates.
 */
export const DISPATCH_ASSIGNMENT_CHANGED_V1 = 'dispatch.assignment-changed.v1' as const;
export const DISPATCH_EVENTS_EXCHANGE = 'dispatch.events' as const;

export interface AssignmentChangedData {
  readonly bookingId: string;
  readonly status: AssignmentStatus;
  readonly zoneId: string;
  readonly startsAt: string;
  readonly endsAt: string;
  /** Workforce capacity resource; non-null exactly when status is ASSIGNED. */
  readonly resourceId: string | null;
}

export type DispatchAssignmentChangedV1 = EventEnvelopeV2<
  typeof DISPATCH_ASSIGNMENT_CHANGED_V1,
  'dispatch',
  AssignmentChangedData
>;

export type DispatchEvent = DispatchAssignmentChangedV1;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuid(value: string): string {
  if (!UUID.test(value)) throw new Error('INVALID_EVENT_UUID');
  return value;
}

export function assignmentChangedEvent(input: {
  readonly eventId: string;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly actor: EventActor;
  readonly assignment: AssignmentState;
}): DispatchAssignmentChangedV1 {
  const { assignment } = input;
  if ((assignment.status === 'ASSIGNED') !== (assignment.resourceId !== null)) {
    throw new Error('INCONSISTENT_ASSIGNMENT_RESOURCE');
  }
  return {
    eventId: uuid(input.eventId),
    eventType: DISPATCH_ASSIGNMENT_CHANGED_V1,
    envelopeVersion: 2,
    producer: 'dispatch',
    occurredAt: assignment.updatedAt.toISOString(),
    correlationId: uuid(input.correlationId),
    causationId: input.causationId === null ? null : uuid(input.causationId),
    // Filled from the active trace by the outbox adapter's relay headers, never invented.
    traceparent: null,
    aggregate: { type: 'assignment', id: uuid(assignment.id), version: assignment.version },
    actor: input.actor,
    data: {
      bookingId: uuid(assignment.bookingId),
      status: assignment.status,
      zoneId: uuid(assignment.zoneId),
      startsAt: assignment.startsAt.toISOString(),
      endsAt: assignment.endsAt.toISOString(),
      resourceId: assignment.resourceId,
    },
  };
}
