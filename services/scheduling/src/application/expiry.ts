import {
  SCHEDULING_EVENTS_EXCHANGE,
  expire,
  holdChangedEvent,
  releaseHeldUnits,
  type CapacityWindowState,
  type EventActor,
  type HoldState,
  type SchedulingEvent,
} from '../domain';
import type { Actor, IdGenerator, SchedulingTransaction } from '../ports';

export const SYSTEM_ACTOR: Actor = { kind: 'SYSTEM', component: 'hold-expiry' };

export function emit(tx: SchedulingTransaction, event: SchedulingEvent): Promise<void> {
  return tx.appendEvent({
    event,
    exchange: SCHEDULING_EVENTS_EXCHANGE,
    routingKey: event.eventType,
  });
}

/** PII-free event actor (envelope v2): subject UUID, service name, or system. */
export function eventActor(actor: Actor): EventActor {
  if (actor.kind === 'USER') return { kind: actor.principalKind, id: actor.subject };
  if (actor.kind === 'SERVICE') return { kind: 'service', id: actor.clientId };
  return { kind: 'system', id: null };
}

/**
 * Expire the given due holds of a window the caller has locked. Returns the
 * window state to persist; the caller writes it once, guarded by the version
 * it read under the lock.
 */
export async function applyExpiry(
  tx: SchedulingTransaction,
  ids: IdGenerator,
  window: CapacityWindowState,
  due: readonly HoldState[],
  now: Date,
  correlationId: string,
): Promise<CapacityWindowState> {
  let current = window;
  for (const hold of due) {
    const expired = expire(hold, now);
    await tx.updateHold(expired, hold.version);
    current = releaseHeldUnits(current, hold.units);
    await emit(
      tx,
      holdChangedEvent({
        eventId: ids.next(),
        correlationId,
        hold: expired,
        zoneId: window.zoneId,
        actor: { kind: 'system', id: null },
      }),
    );
    await tx.appendAudit({
      action: 'hold.expired',
      actor: SYSTEM_ACTOR,
      targetType: 'CAPACITY_HOLD',
      targetId: hold.id,
      correlationId,
      details: { windowId: window.id, units: hold.units },
    });
  }
  return current;
}

/** Expire every due hold of a locked window: v1 holds with events, pre-v1 rows silently. */
export async function expireDueHoldsOf(
  tx: SchedulingTransaction,
  ids: IdGenerator,
  window: CapacityWindowState,
  now: Date,
  correlationId: string,
): Promise<CapacityWindowState> {
  const due = await tx.lockDueHolds(window.id, now);
  const current = await applyExpiry(tx, ids, window, due, now, correlationId);
  const legacyUnits = await tx.expireLegacyDueHolds(window.id, now);
  return legacyUnits > 0 ? releaseHeldUnits(current, legacyUnits) : current;
}
