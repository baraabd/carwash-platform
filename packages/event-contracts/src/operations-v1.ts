import { asAggregateVersion, asCanonicalUtc, asObject, asUuid, exactKeys } from './envelope';
import { parseEnvelopeV2, type EventProducer } from './envelope-v2';
import { asMoney } from './billing-v1';

/** Published owner payloads, not a declaration that a deployment is accepted. */
const ASYNCAPI = 'docs/asyncapi/operations-events-v1.yaml';
function member<const T extends readonly string[]>(value: unknown, allowed: T): T[number] {
  if (typeof value !== 'string' || !allowed.includes(value)) throw new Error('INVALID_EVENT_DATA');
  return value;
}
function specification<T extends string, P extends EventProducer, D>(value: {
  readonly eventType: T;
  readonly producer: P;
  readonly aggregateType: string;
  readonly parseData: (data: unknown) => D;
}) {
  return {
    ...value,
    asyncApi: ASYNCAPI,
    parse: (raw: unknown) => parseEnvelopeV2(raw, value, value.parseData),
  };
}
function span(value: Record<string, unknown>) {
  const startsAt = asCanonicalUtc(value.startsAt);
  const endsAt = asCanonicalUtc(value.endsAt);
  if (Date.parse(endsAt) <= Date.parse(startsAt)) throw new Error('INVALID_EVENT_INTERVAL');
  return { startsAt, endsAt };
}
function principal(value: unknown) {
  const p = asObject(value);
  exactKeys(p, ['kind', 'subjectId']);
  return { kind: member(p.kind, ['account', 'guest'] as const), subjectId: asUuid(p.subjectId) };
}
export const DISPATCH_TASK_STAGES_V1 = [
  'ACCEPTED',
  'EN_ROUTE',
  'ARRIVED',
  'IN_SERVICE',
  'DOCUMENTING',
  'FINISHED',
  'CLOSED',
  'RELEASED',
  'WITHDRAWN',
  'CANCELLED',
] as const;
export const DISPATCH_ASSIGNMENT_STATUSES_V1 = [
  'UNASSIGNED',
  'OFFERED',
  'ASSIGNED',
  'CANCELLED',
] as const;
export const BOOKING_EXECUTION_STATUSES_V1 = [
  'CONFIRMED',
  'ASSIGNED',
  'EN_ROUTE',
  'ARRIVED',
  'IN_PROGRESS',
  'COMPLETED',
] as const;

export const DISPATCH_ASSIGNMENT_CHANGED_V1 = specification({
  eventType: 'dispatch.assignment-changed.v1',
  producer: 'dispatch',
  aggregateType: 'assignment',
  parseData(raw: unknown) {
    const d = asObject(raw);
    exactKeys(d, ['bookingId', 'status', 'zoneId', 'startsAt', 'endsAt', 'resourceId']);
    const status = member(d.status, DISPATCH_ASSIGNMENT_STATUSES_V1);
    const resourceId = d.resourceId === null ? null : asUuid(d.resourceId);
    if ((status === 'ASSIGNED') !== (resourceId !== null))
      throw new Error('INVALID_EVENT_RESOURCE');
    return {
      bookingId: asUuid(d.bookingId),
      status,
      zoneId: asUuid(d.zoneId),
      ...span(d),
      resourceId,
    };
  },
});
export const DISPATCH_TASK_PROGRESSED_V1 = specification({
  eventType: 'dispatch.task-progressed.v1',
  producer: 'dispatch',
  aggregateType: 'task',
  parseData(raw: unknown) {
    const d = asObject(raw);
    exactKeys(d, ['bookingId', 'assignmentId', 'taskId', 'stage']);
    return {
      bookingId: asUuid(d.bookingId),
      assignmentId: asUuid(d.assignmentId),
      taskId: asUuid(d.taskId),
      stage: member(d.stage, DISPATCH_TASK_STAGES_V1),
    };
  },
});
export const DISPATCH_CASH_DECLARED_V1 = specification({
  eventType: 'dispatch.cash-declared.v1',
  producer: 'dispatch',
  aggregateType: 'task',
  parseData(raw: unknown) {
    const d = asObject(raw);
    exactKeys(d, ['bookingId', 'taskId', 'outcome', 'amount', 'late']);
    const outcome = member(d.outcome, [
      'CASH_COLLECTED',
      'CASH_NOT_COLLECTED',
      'NOT_CASH',
    ] as const);
    if (typeof d.late !== 'boolean') throw new Error('INVALID_EVENT_DATA');
    const amount = d.amount === null ? null : asMoney(d.amount);
    if ((d.late || outcome === 'CASH_COLLECTED') !== (amount !== null))
      throw new Error('INVALID_CASH_DECLARATION');
    return {
      bookingId: asUuid(d.bookingId),
      taskId: asUuid(d.taskId),
      outcome,
      amount,
      late: d.late,
    };
  },
});
export const BOOKING_CREATED_V1 = specification({
  eventType: 'booking.created.v1',
  producer: 'booking',
  aggregateType: 'booking',
  parseData(raw: unknown) {
    const d = asObject(raw);
    exactKeys(d, [
      'status',
      'beneficiary',
      'zoneId',
      'startsAt',
      'endsAt',
      'holdId',
      'quoteId',
      'quoteRevision',
      'total',
      'paymentMethod',
    ]);
    return {
      status: member(d.status, ['CONFIRMED'] as const),
      beneficiary: principal(d.beneficiary),
      zoneId: asUuid(d.zoneId),
      ...span(d),
      holdId: asUuid(d.holdId),
      quoteId: asUuid(d.quoteId),
      quoteRevision: asAggregateVersion(d.quoteRevision),
      total: asMoney(d.total),
      paymentMethod: member(d.paymentMethod, [
        'CASH_ON_COMPLETION',
        'SHAM_CASH',
        'SYRIATEL_CASH',
      ] as const),
    };
  },
});
export const BOOKING_CANCELLED_V1 = specification({
  eventType: 'booking.cancelled.v1',
  producer: 'booking',
  aggregateType: 'booking',
  parseData(raw: unknown) {
    const d = asObject(raw);
    exactKeys(d, [
      'status',
      'changeId',
      'reason',
      'holdId',
      'zoneId',
      'startsAt',
      'endsAt',
      'paymentMethod',
      'total',
    ]);
    const reason = member(d.reason, [
      'CUSTOMER_REQUEST',
      'OPERATIONS_REQUEST',
      'CUSTOMER_REQUEST_BY_PHONE',
      'SERVICE_UNAVAILABLE',
    ] as const);
    return {
      status: member(d.status, ['CANCELLED'] as const),
      changeId: asUuid(d.changeId),
      reason,
      holdId: asUuid(d.holdId),
      zoneId: asUuid(d.zoneId),
      ...span(d),
      total: asMoney(d.total),
      paymentMethod: member(d.paymentMethod, [
        'CASH_ON_COMPLETION',
        'SHAM_CASH',
        'SYRIATEL_CASH',
      ] as const),
    };
  },
});
export const BOOKING_RESCHEDULED_V1 = specification({
  eventType: 'booking.rescheduled.v1',
  producer: 'booking',
  aggregateType: 'booking',
  parseData(raw: unknown) {
    const d = asObject(raw);
    exactKeys(d, ['changeId', 'scheduleRevision', 'previous', 'current']);
    const previous = asObject(d.previous);
    exactKeys(previous, ['holdId', 'startsAt', 'endsAt']);
    const current = asObject(d.current);
    exactKeys(current, ['holdId', 'zoneId', 'startsAt', 'endsAt']);
    return {
      changeId: asUuid(d.changeId),
      scheduleRevision: asAggregateVersion(d.scheduleRevision),
      previous: { holdId: asUuid(previous.holdId), ...span(previous) },
      current: { holdId: asUuid(current.holdId), zoneId: asUuid(current.zoneId), ...span(current) },
    };
  },
});
export const BOOKING_LIFECYCLE_PROGRESSED_V1 = specification({
  eventType: 'booking.lifecycle-progressed.v1',
  producer: 'booking',
  aggregateType: 'booking',
  parseData(raw: unknown) {
    const d = asObject(raw);
    exactKeys(d, [
      'previousStatus',
      'status',
      'assignmentId',
      'assignmentRevision',
      'taskId',
      'taskRevision',
    ]);
    const taskId = d.taskId === null ? null : asUuid(d.taskId);
    const taskRevision = d.taskRevision === null ? null : asAggregateVersion(d.taskRevision);
    if ((taskId === null) !== (taskRevision === null)) throw new Error('INVALID_TASK_REF');
    return {
      previousStatus: member(d.previousStatus, BOOKING_EXECUTION_STATUSES_V1),
      status: member(d.status, BOOKING_EXECUTION_STATUSES_V1),
      assignmentId: asUuid(d.assignmentId),
      assignmentRevision: asAggregateVersion(d.assignmentRevision),
      taskId,
      taskRevision,
    };
  },
});

/** Legacy shape already persisted by Workforce; preserved, never silently rewritten. */
export const WORKFORCE_SHIFT_UPDATED_V1 = {
  eventType: 'workforce.shift-updated.v1' as const,
  producer: 'workforce' as const,
  asyncApi: ASYNCAPI,
  parse(raw: unknown) {
    const e = asObject(raw);
    exactKeys(e, [
      'eventId',
      'eventType',
      'schemaVersion',
      'producer',
      'occurredAt',
      'correlationId',
      'aggregateVersion',
      'data',
    ]);
    if (
      e.eventType !== 'workforce.shift-updated.v1' ||
      e.producer !== 'workforce' ||
      e.schemaVersion !== 1
    )
      throw new Error('UNSUPPORTED_EVENT');
    const d = asObject(e.data);
    exactKeys(d, ['shiftId', 'operatorId', 'zoneId', 'startsAt', 'endsAt', 'status']);
    return {
      eventId: asUuid(e.eventId),
      eventType: 'workforce.shift-updated.v1' as const,
      schemaVersion: 1 as const,
      producer: 'workforce' as const,
      occurredAt: asCanonicalUtc(e.occurredAt),
      correlationId: asUuid(e.correlationId),
      aggregateVersion: asAggregateVersion(e.aggregateVersion),
      data: {
        shiftId: asUuid(d.shiftId),
        operatorId: asUuid(d.operatorId),
        zoneId: asUuid(d.zoneId),
        ...span(d),
        status: member(d.status, ['ACTIVE', 'CANCELLED'] as const),
      },
    };
  },
};

export const OPERATIONS_EVENTS_V1 = [
  DISPATCH_ASSIGNMENT_CHANGED_V1,
  DISPATCH_TASK_PROGRESSED_V1,
  DISPATCH_CASH_DECLARED_V1,
  BOOKING_CREATED_V1,
  BOOKING_CANCELLED_V1,
  BOOKING_RESCHEDULED_V1,
  BOOKING_LIFECYCLE_PROGRESSED_V1,
] as const;
