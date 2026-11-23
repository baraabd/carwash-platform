import { createHash } from 'node:crypto';
import { EVENT_PRODUCERS, type EventActor } from '@carwash/event-contracts';
import {
  ELIGIBILITY_CHANGED_V1,
  SHIFT_UPDATED_V1,
  WORKFORCE_EVENTS_EXCHANGE,
  WorkforceError,
  eligibilityAt,
  eligibilityChangedEvent,
  shiftEvent,
  type OperatorState,
  type ShiftState,
} from '../domain';
import type { Actor, Clock, IdGenerator, RequestMeta, WorkforceTransaction } from '../ports';

/**
 * Helpers shared by the Workforce application services: idempotency, the
 * PII-free event actor and the outbox writers. Framework-free.
 */

/**
 * PII-free envelope actor. Users are their Identity subject; a service is named
 * only when it is a declared event producer.
 */
export function eventActor(actor: Actor): EventActor {
  if (actor.kind === 'USER') return { kind: 'account', id: actor.subject };
  if (actor.kind === 'SYSTEM') return { kind: 'system', id: null };
  const producer = EVENT_PRODUCERS.find((name) => name === actor.clientId);
  if (producer === undefined) throw new Error('EVENT_ACTOR_UNSUPPORTED');
  return { kind: 'service', id: producer };
}

export function requestFingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

export function requester(actor: Actor): string {
  if (actor.kind === 'USER') return `user:${actor.subject}`;
  if (actor.kind === 'SERVICE') return `service:${actor.clientId}`;
  return `system:${actor.component}`;
}

export function assertIdempotencyKey(key: string): void {
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
    throw new WorkforceError('INVALID_INPUT', 'Invalid Idempotency-Key.');
  }
}

export function idempotencyReused(): never {
  throw new WorkforceError(
    'IDEMPOTENCY_KEY_REUSED',
    'Idempotency key reused with different input.',
  );
}

/**
 * Published workforce.eligibility-changed.v1, written to the outbox in the
 * caller's transaction, exactly when the eligibility revision moved. The
 * data is the eligibility at the instant of the change.
 */
export async function appendEligibility(
  tx: WorkforceTransaction,
  ids: IdGenerator,
  meta: RequestMeta,
  before: OperatorState,
  after: OperatorState,
  knownSkills?: readonly string[],
): Promise<void> {
  if (after.eligibilityRevision === before.eligibilityRevision) return;
  const skills = knownSkills ?? (await tx.listSkills(after.id));
  const event = eligibilityChangedEvent({
    eventId: ids.next(),
    correlationId: meta.correlationId,
    actor: eventActor(meta.actor),
    operator: after,
    eligibility: eligibilityAt(after, skills, after.updatedAt),
  });
  await tx.appendEvent({
    event,
    exchange: WORKFORCE_EVENTS_EXCHANGE,
    routingKey: ELIGIBILITY_CHANGED_V1,
  });
}

/** The UNPUBLISHED P01-C2 `workforce.shift-updated.v1`, kept for every shift write. */
export async function appendShift(
  tx: WorkforceTransaction,
  ids: IdGenerator,
  clock: Clock,
  meta: RequestMeta,
  shift: ShiftState,
): Promise<void> {
  const event = shiftEvent({
    eventId: ids.next(),
    occurredAt: clock.now().toISOString(),
    correlationId: meta.correlationId,
    aggregateVersion: shift.version,
    data: {
      shiftId: shift.id,
      operatorId: shift.operatorId,
      zoneId: shift.zoneId,
      startsAt: shift.startsAt.toISOString(),
      endsAt: shift.endsAt.toISOString(),
      status: shift.status,
    },
  });
  await tx.appendEvent({
    event,
    exchange: WORKFORCE_EVENTS_EXCHANGE,
    routingKey: SHIFT_UPDATED_V1,
  });
}
