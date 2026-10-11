import { parseEnvelopeV2, type EventEnvelopeV2 } from '@carwash/event-contracts';
import {
  CASE_ACTIONS,
  CASE_KINDS,
  CASE_STATUSES,
  SUBJECT_TYPES,
  type CaseAction,
  type CaseKind,
  type CaseStatus,
  type SubjectType,
} from '../domain';
import type { OutboxEvent } from '../ports';

/**
 * Support integration events, written to the local outbox in the SAME
 * transaction as the case change they describe (transactional outbox).
 *
 * Data carries opaque ids, kinds and statuses only: never the summary, the
 * reason note, evidence references, amounts or who decided. Registration in
 * @carwash/event-contracts and the broker topology are a Lane E request
 * (CR-D-P04-02). Until E publishes them the relay is NOT started and rows stay
 * pending; the shapes below are the exact proposal and are self-validated
 * through the shared envelope v2 parser.
 */
export const SUPPORT_EVENTS_EXCHANGE = 'support.events';
export const CASE_AGGREGATE = 'support-case';
export const CASE_OPENED_V1 = 'support.case-opened.v1' as const;
export const CASE_STATUS_CHANGED_V1 = 'support.case-status-changed.v1' as const;

export interface CaseOpenedData {
  readonly kind: CaseKind;
  readonly subjectType: SubjectType;
  readonly subjectId: string;
  readonly status: CaseStatus;
}

export interface CaseStatusChangedData {
  readonly kind: CaseKind;
  readonly previousStatus: CaseStatus;
  readonly status: CaseStatus;
  readonly decisionNo: number | null;
  readonly action: CaseAction | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function closed(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('INVALID_EVENT_DATA');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(',') !== [...keys].sort().join(','))
    throw new Error('INVALID_EVENT_DATA');
  return record;
}

function member<T extends string>(value: unknown, allowed: readonly T[]): T {
  const found = allowed.find((candidate) => candidate === value);
  if (found === undefined) throw new Error('INVALID_EVENT_DATA');
  return found;
}

export function parseCaseOpenedData(value: unknown): CaseOpenedData {
  const d = closed(value, ['kind', 'subjectType', 'subjectId', 'status']);
  if (typeof d.subjectId !== 'string' || !UUID.test(d.subjectId))
    throw new Error('INVALID_EVENT_DATA');
  return {
    kind: member(d.kind, CASE_KINDS),
    subjectType: member(d.subjectType, SUBJECT_TYPES),
    subjectId: d.subjectId,
    status: member(d.status, CASE_STATUSES),
  };
}

export function parseCaseStatusChangedData(value: unknown): CaseStatusChangedData {
  const d = closed(value, ['kind', 'previousStatus', 'status', 'decisionNo', 'action']);
  const previousStatus = member(d.previousStatus, CASE_STATUSES);
  const status = member(d.status, CASE_STATUSES);
  if (previousStatus === status) throw new Error('INVALID_EVENT_DATA');
  const decisionNo = d.decisionNo;
  if (
    decisionNo !== null &&
    (typeof decisionNo !== 'number' || !Number.isSafeInteger(decisionNo) || decisionNo < 1)
  )
    throw new Error('INVALID_EVENT_DATA');
  return {
    kind: member(d.kind, CASE_KINDS),
    previousStatus,
    status,
    decisionNo,
    action: d.action === null ? null : member(d.action, CASE_ACTIONS),
  };
}

export interface CaseEventContext {
  readonly eventId: string;
  readonly occurredAt: Date;
  readonly correlationId: string;
  readonly actorSubject: string;
  readonly caseId: string;
  /** The case revision this event describes (consumers apply newer only). */
  readonly revision: number;
}

function outboxRow<TType extends string, TData>(
  eventType: TType,
  data: TData,
  context: CaseEventContext,
  parseData: (data: unknown) => TData,
): OutboxEvent {
  const envelope: EventEnvelopeV2<TType, 'support', TData> = {
    eventId: context.eventId,
    eventType,
    envelopeVersion: 2,
    producer: 'support',
    occurredAt: context.occurredAt.toISOString(),
    correlationId: context.correlationId,
    causationId: null,
    traceparent: null,
    aggregate: { type: CASE_AGGREGATE, id: context.caseId, version: context.revision },
    actor: { kind: 'account', id: context.actorSubject },
    data,
  };
  // Never write an envelope the shared parser would reject.
  parseEnvelopeV2(
    envelope,
    { eventType, producer: 'support', aggregateType: CASE_AGGREGATE },
    parseData,
  );
  return {
    eventId: context.eventId,
    eventType,
    exchange: SUPPORT_EVENTS_EXCHANGE,
    routingKey: eventType,
    payload: JSON.stringify(envelope),
    correlationId: context.correlationId,
    createdAt: context.occurredAt,
  };
}

export function caseOpenedEvent(data: CaseOpenedData, context: CaseEventContext): OutboxEvent {
  return outboxRow(CASE_OPENED_V1, data, context, parseCaseOpenedData);
}

export function caseStatusChangedEvent(
  data: CaseStatusChangedData,
  context: CaseEventContext,
): OutboxEvent {
  return outboxRow(CASE_STATUS_CHANGED_V1, data, context, parseCaseStatusChangedData);
}
