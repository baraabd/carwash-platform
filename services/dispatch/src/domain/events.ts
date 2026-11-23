import type { EventActor, EventEnvelopeV2 } from '@carwash/event-contracts';
import type { AssignmentState, AssignmentStatus } from './assignment';
import { CURRENCY_SCALE, moneyToWire, type MoneyWire } from './money';
import type { CollectionOutcome, TaskStage, TaskState } from './task';

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

/**
 * PRODUCER-PENDING (CR-P03-C4 §1): task milestones for Booking's lifecycle and
 * operations/customer tracking. Opaque ids and the stage only.
 */
export const DISPATCH_TASK_PROGRESSED_V1 = 'dispatch.task-progressed.v1' as const;

export interface TaskProgressedData {
  readonly bookingId: string;
  readonly assignmentId: string;
  readonly taskId: string;
  readonly stage: TaskStage;
}

export type DispatchTaskProgressedV1 = EventEnvelopeV2<
  typeof DISPATCH_TASK_PROGRESSED_V1,
  'dispatch',
  TaskProgressedData
>;

/**
 * PRODUCER-PENDING (CR-P03-C4 §1): the technician's cash declaration for
 * Billing. A declaration is a claim to reconcile, never a payment or receipt.
 */
export const DISPATCH_CASH_DECLARED_V1 = 'dispatch.cash-declared.v1' as const;

export interface CashDeclaredData {
  readonly bookingId: string;
  readonly taskId: string;
  readonly outcome: CollectionOutcome;
  readonly amount: MoneyWire | null;
  readonly late: boolean;
}

export type DispatchCashDeclaredV1 = EventEnvelopeV2<
  typeof DISPATCH_CASH_DECLARED_V1,
  'dispatch',
  CashDeclaredData
>;

export type DispatchEvent =
  DispatchAssignmentChangedV1 | DispatchTaskProgressedV1 | DispatchCashDeclaredV1;

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

interface EventInput {
  readonly eventId: string;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly actor: EventActor;
  readonly task: TaskState;
}

export function taskProgressedEvent(input: EventInput): DispatchTaskProgressedV1 {
  const { task } = input;
  return {
    eventId: uuid(input.eventId),
    eventType: DISPATCH_TASK_PROGRESSED_V1,
    envelopeVersion: 2,
    producer: 'dispatch',
    occurredAt: task.updatedAt.toISOString(),
    correlationId: uuid(input.correlationId),
    causationId: input.causationId === null ? null : uuid(input.causationId),
    traceparent: null,
    aggregate: { type: 'task', id: uuid(task.id), version: task.version },
    actor: input.actor,
    data: {
      bookingId: uuid(task.bookingId),
      assignmentId: uuid(task.assignmentId),
      taskId: uuid(task.id),
      stage: task.stage,
    },
  };
}

/** Emitted on close (any outcome) and on a late cash declaration. */
export function cashDeclaredEvent(
  input: EventInput & { readonly late: boolean },
): DispatchCashDeclaredV1 {
  const { task } = input;
  const collection = task.collection;
  if (collection === null) throw new Error('CASH_EVENT_WITHOUT_DECLARATION');
  const minor = input.late ? collection.lateAmountMinor : collection.amountMinor;
  const expectsAmount = input.late || collection.outcome === 'CASH_COLLECTED';
  if (expectsAmount !== (minor !== null) || (minor !== null && collection.currency === null)) {
    throw new Error('CASH_EVENT_INCONSISTENT');
  }
  const amount =
    minor !== null && collection.currency !== null
      ? moneyToWire({
          currency: collection.currency,
          amountMinor: minor,
          scale: CURRENCY_SCALE[collection.currency],
        })
      : null;
  return {
    eventId: uuid(input.eventId),
    eventType: DISPATCH_CASH_DECLARED_V1,
    envelopeVersion: 2,
    producer: 'dispatch',
    occurredAt: task.updatedAt.toISOString(),
    correlationId: uuid(input.correlationId),
    causationId: input.causationId === null ? null : uuid(input.causationId),
    traceparent: null,
    aggregate: { type: 'task', id: uuid(task.id), version: task.version },
    actor: input.actor,
    data: {
      bookingId: uuid(task.bookingId),
      taskId: uuid(task.id),
      outcome: collection.outcome,
      amount,
      late: input.late,
    },
  };
}
