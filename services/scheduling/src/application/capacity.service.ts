import {
  SchedulingError,
  assertWindowDefinition,
  changeCapacity,
  closeWindow,
  invalid,
  releaseByOperations,
  releaseHeldUnits,
  releaseReservedUnits,
  isDue,
  holdChangedEvent,
  type CapacityWindowState,
  type HoldState,
} from '../domain';
import type {
  Clock,
  IdGenerator,
  RequestMeta,
  SchedulingReadModel,
  SchedulingUnitOfWork,
} from '../ports';
import { requireOperations } from './authorization';
import { emit, eventActor, expireDueHoldsOf } from './expiry';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertUuid(value: string, field: string): void {
  if (typeof value !== 'string' || !UUID.test(value)) throw invalid(`${field} must be a UUID.`);
}

export type Replayable<T> = { readonly value: T; readonly replayed: boolean };

/**
 * Staff capacity management (owner surface, not part of scheduling.v1) and the
 * multi-replica hold-expiry sweep.
 */
export class CapacityService {
  constructor(
    private readonly uow: SchedulingUnitOfWork,
    private readonly read: SchedulingReadModel,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async defineWindow(
    meta: RequestMeta,
    command: {
      readonly zoneId: string;
      readonly startsAt: Date;
      readonly endsAt: Date;
      readonly capacity: number;
    },
  ): Promise<Replayable<CapacityWindowState>> {
    requireOperations(meta.actor);
    assertUuid(command.zoneId, 'zoneId');
    assertWindowDefinition({ ...command, now: this.clock.now() });
    const window: CapacityWindowState = {
      id: this.ids.next(),
      zoneId: command.zoneId.toLowerCase(),
      startsAt: command.startsAt,
      endsAt: command.endsAt,
      capacity: command.capacity,
      held: 0,
      reserved: 0,
      status: 'OPEN',
      version: 1,
    };
    const result = await this.uow.run(async (tx) => {
      const inserted = await tx.insertWindow(window);
      if (inserted === 'CREATED') {
        await tx.appendAudit({
          action: 'window.defined',
          actor: meta.actor,
          targetType: 'CAPACITY_WINDOW',
          targetId: window.id,
          correlationId: meta.correlationId,
          details: { capacity: window.capacity },
        });
      }
      return inserted;
    });
    if (result === 'CREATED') return { value: window, replayed: false };
    if (result === 'OVERLAPS') {
      throw new SchedulingError('WINDOW_OVERLAPS', 'Window overlaps another window in this zone.');
    }
    const existing = await this.read.findWindowByStart(window.zoneId, command.startsAt);
    if (
      existing &&
      existing.endsAt.getTime() === command.endsAt.getTime() &&
      existing.capacity === command.capacity
    ) {
      return { value: existing, replayed: true };
    }
    throw new SchedulingError('WINDOW_EXISTS', 'A different window already starts at this time.');
  }

  async changeCapacity(
    meta: RequestMeta,
    windowId: string,
    command: { readonly capacity: number; readonly expectedVersion: number },
  ): Promise<CapacityWindowState> {
    requireOperations(meta.actor);
    assertUuid(windowId, 'windowId');
    const now = this.clock.now();
    return this.uow.run(async (tx) => {
      const locked = await this.lockedWindow(tx, windowId);
      if (locked.version !== command.expectedVersion) {
        throw new SchedulingError('VERSION_CONFLICT', 'Window was changed by someone else.');
      }
      const current = await expireDueHoldsOf(tx, this.ids, locked, now, meta.correlationId);
      const next = changeCapacity(current, command.capacity);
      await tx.updateWindow(next, locked.version);
      await tx.appendAudit({
        action: 'window.capacity-changed',
        actor: meta.actor,
        targetType: 'CAPACITY_WINDOW',
        targetId: windowId,
        correlationId: meta.correlationId,
        details: { from: locked.capacity, to: next.capacity },
      });
      return next;
    });
  }

  async closeWindow(
    meta: RequestMeta,
    windowId: string,
    expectedVersion: number,
  ): Promise<CapacityWindowState> {
    requireOperations(meta.actor);
    assertUuid(windowId, 'windowId');
    return this.uow.run(async (tx) => {
      const locked = await this.lockedWindow(tx, windowId);
      if (locked.status === 'CLOSED') return locked;
      if (locked.version !== expectedVersion) {
        throw new SchedulingError('VERSION_CONFLICT', 'Window was changed by someone else.');
      }
      const next = closeWindow(locked);
      await tx.updateWindow(next, locked.version);
      await tx.appendAudit({
        action: 'window.closed',
        actor: meta.actor,
        targetType: 'CAPACITY_WINDOW',
        targetId: windowId,
        correlationId: meta.correlationId,
        details: {},
      });
      return next;
    });
  }

  /**
   * Staff override: frees a held or committed unit (for example a cancelled
   * booking, until scheduling.v1 has a committed-hold cancellation). Audited.
   */
  async overrideRelease(meta: RequestMeta, holdId: string): Promise<HoldState> {
    requireOperations(meta.actor);
    assertUuid(holdId, 'holdId');
    const known = await this.read.findHold(holdId);
    if (!known) throw new SchedulingError('HOLD_NOT_FOUND', 'Hold not found.');
    const now = this.clock.now();
    return this.uow.run(async (tx) => {
      const locked = await this.lockedWindow(tx, known.windowId);
      const hold = await tx.lockHold(holdId);
      if (!hold) throw new SchedulingError('HOLD_NOT_FOUND', 'Hold not found.');
      if (isDue(hold, now)) {
        const current = await expireDueHoldsOf(tx, this.ids, locked, now, meta.correlationId);
        await tx.updateWindow(current, locked.version);
        return { ...hold, status: 'EXPIRED' as const };
      }
      const outcome = releaseByOperations(hold, now);
      if (!outcome) return hold;
      const next =
        outcome.freed === 'HELD'
          ? releaseHeldUnits(locked, hold.units)
          : releaseReservedUnits(locked, hold.units);
      await tx.updateHold(outcome.hold, hold.version);
      await tx.updateWindow(next, locked.version);
      await emit(
        tx,
        holdChangedEvent({
          eventId: this.ids.next(),
          correlationId: meta.correlationId,
          hold: outcome.hold,
          zoneId: locked.zoneId,
          actor: eventActor(meta.actor),
        }),
      );
      await tx.appendAudit({
        action: outcome.freed === 'HELD' ? 'hold.released' : 'reservation.cancelled',
        actor: meta.actor,
        targetType: 'CAPACITY_HOLD',
        targetId: hold.id,
        correlationId: meta.correlationId,
        details: { windowId: locked.id, units: hold.units, reason: 'OPERATIONS_OVERRIDE' },
      });
      return outcome.hold;
    });
  }

  /**
   * Expire due holds across windows. Safe on any number of replicas: each
   * window is taken with SKIP LOCKED and every change is re-derived under the
   * lock, so a stalled or duplicate sweeper finds nothing left to do.
   */
  async expireDue(correlationId: string, limit = 50): Promise<{ windows: number; units: number }> {
    const now = this.clock.now();
    const windowIds = await this.read.windowsWithDueHolds(now, limit);
    let windows = 0;
    let units = 0;
    for (const windowId of windowIds) {
      const freed = await this.uow.run(async (tx) => {
        const locked = await tx.lockWindow(windowId, { skipLocked: true });
        if (!locked) return 0;
        const current = await expireDueHoldsOf(tx, this.ids, locked, now, correlationId);
        const released = locked.held - current.held;
        if (released === 0) return 0;
        await tx.updateWindow(current, locked.version);
        return released;
      });
      if (freed > 0) {
        windows += 1;
        units += freed;
      }
    }
    return { windows, units };
  }

  /** Drop completed idempotency records past their retention. */
  async purgeIdempotency(retentionMs: number, limit = 500): Promise<number> {
    return this.read.purgeIdempotency(retentionMs, limit);
  }

  private async lockedWindow(
    tx: Parameters<Parameters<SchedulingUnitOfWork['run']>[0]>[0],
    id: string,
  ): Promise<CapacityWindowState> {
    const window = await tx.lockWindow(id);
    if (!window) throw new SchedulingError('WINDOW_NOT_FOUND', 'Window not found.');
    return window;
  }
}
