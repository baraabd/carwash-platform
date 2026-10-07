import { createHash } from 'node:crypto';
import {
  SCHEDULING_EVENTS_EXCHANGE,
  SchedulingError,
  assertUnits,
  assertWindowDefinition,
  changeCapacity,
  closeWindow,
  confirm,
  convertHeldToReserved,
  expire,
  holdCreatedEvent,
  holdExpiredEvent,
  holdTtlSeconds,
  holdUnits,
  invalid,
  isDue,
  release,
  releaseHeldUnits,
  releaseReservedUnits,
  type CapacityWindowState,
  type HoldState,
  type ReleaseReason,
  type SchedulingEvent,
} from '../domain';
import type {
  Actor,
  Clock,
  IdGenerator,
  RequestMeta,
  SchedulingReadModel,
  SchedulingTransaction,
  SchedulingUnitOfWork,
} from '../ports';
import {
  availabilityAudience,
  isOperations,
  requireOperations,
  requireScope,
} from './authorization';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/;
const MAX_AVAILABILITY_RANGE_MS = 14 * 24 * 60 * 60_000;

export interface DefineWindowCommand {
  readonly zoneId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly capacity: number;
}

export interface AcquireHoldCommand {
  readonly windowId: string;
  readonly holderRef: string;
  readonly units: number;
  readonly ttlSeconds?: number;
  readonly idempotencyKey: string;
}

export type Replayable<T> = { readonly value: T; readonly replayed: boolean };

export interface CustomerSlotView {
  readonly windowId: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly available: boolean;
}

export interface DetailedSlotView extends CustomerSlotView {
  readonly zoneId: string;
  readonly status: CapacityWindowState['status'];
  readonly capacity: number;
  readonly reserved: number;
  readonly freeUnits: number;
  readonly version: number;
}

/** Thrown inside a transaction so it rolls back, then resolved outside it. */
class IdempotencyRace extends Error {}

export class SchedulingService {
  constructor(
    private readonly uow: SchedulingUnitOfWork,
    private readonly read: SchedulingReadModel,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  // ---------------------------------------------------------------- windows

  async defineWindow(
    meta: RequestMeta,
    command: DefineWindowCommand,
  ): Promise<Replayable<CapacityWindowState>> {
    requireOperations(meta.actor);
    assertUuid(command.zoneId, 'zoneId');
    assertWindowDefinition({ ...command, now: this.clock.now() });

    const window: CapacityWindowState = {
      id: this.ids.next(),
      zoneId: command.zoneId,
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
    // Same zone and start: a replay only if the definition is identical.
    const existing = await this.read.findWindowByStart(command.zoneId, command.startsAt);
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
      const current = await this.expireDueHolds(tx, locked, now, meta.correlationId);
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

  async availability(
    meta: RequestMeta,
    query: { readonly zoneId: string; readonly from: Date; readonly to: Date },
  ): Promise<CustomerSlotView[] | DetailedSlotView[]> {
    const audience = availabilityAudience(meta.actor);
    assertUuid(query.zoneId, 'zoneId');
    const span = query.to.getTime() - query.from.getTime();
    if (!Number.isFinite(span) || span <= 0 || span > MAX_AVAILABILITY_RANGE_MS) {
      throw invalid('Availability range is invalid.');
    }
    const now = this.clock.now();
    const rows = await this.read.availability({ ...query, now });
    return rows.map(({ window, freeUnits: free }) => {
      const base: CustomerSlotView = {
        windowId: window.id,
        startsAt: window.startsAt.toISOString(),
        endsAt: window.endsAt.toISOString(),
        available:
          window.status === 'OPEN' && window.startsAt.getTime() > now.getTime() && free > 0,
      };
      if (audience === 'CUSTOMER') return base;
      return {
        ...base,
        zoneId: window.zoneId,
        status: window.status,
        capacity: window.capacity,
        reserved: window.reserved,
        freeUnits: free,
        version: window.version,
      };
    });
  }

  // ------------------------------------------------------------------ holds

  async acquireHold(
    meta: RequestMeta,
    command: AcquireHoldCommand,
  ): Promise<Replayable<HoldState>> {
    const service = requireScope(meta.actor, 'scheduling.holds.write');
    assertUuid(command.windowId, 'windowId');
    assertUuid(command.holderRef, 'holderRef');
    assertUnits(command.units);
    const ttlSeconds = holdTtlSeconds(command.ttlSeconds);
    if (!IDEMPOTENCY_KEY.test(command.idempotencyKey)) throw invalid('Idempotency-Key is invalid.');
    const fingerprint = fingerprintOf(command, ttlSeconds);

    const prior = await this.read.findHoldByIdempotencyKey(
      service.clientId,
      command.idempotencyKey,
    );
    if (prior) return { value: replay(prior, fingerprint), replayed: true };

    const now = this.clock.now();
    try {
      const hold = await this.uow.run(async (tx) => {
        const locked = await this.lockedWindow(tx, command.windowId);
        const current = await this.expireDueHolds(tx, locked, now, meta.correlationId);
        const next = holdUnits(current, command.units, now);
        const created: HoldState = {
          id: this.ids.next(),
          windowId: locked.id,
          clientId: service.clientId,
          holderRef: command.holderRef,
          units: command.units,
          status: 'ACTIVE',
          expiresAt: new Date(now.getTime() + ttlSeconds * 1000),
          idempotencyKey: command.idempotencyKey,
          requestFingerprint: fingerprint,
          releaseReason: null,
          createdAt: now,
          updatedAt: now,
          version: 1,
        };
        if ((await tx.insertHold(created)) === 'DUPLICATE_IDEMPOTENCY_KEY')
          throw new IdempotencyRace();
        await tx.updateWindow(next, locked.version);
        await this.emit(
          tx,
          holdCreatedEvent({
            eventId: this.ids.next(),
            correlationId: meta.correlationId,
            hold: created,
            window: next,
          }),
        );
        await tx.appendAudit({
          action: 'hold.acquired',
          actor: meta.actor,
          targetType: 'CAPACITY_HOLD',
          targetId: created.id,
          correlationId: meta.correlationId,
          details: { windowId: locked.id, units: created.units, ttlSeconds },
        });
        return created;
      });
      return { value: hold, replayed: false };
    } catch (error) {
      if (!(error instanceof IdempotencyRace)) throw error;
      // A concurrent request with the same key committed first.
      const winner = await this.read.findHoldByIdempotencyKey(
        service.clientId,
        command.idempotencyKey,
      );
      if (!winner) throw new Error('IDEMPOTENCY_RACE_UNRESOLVED', { cause: error });
      return { value: replay(winner, fingerprint), replayed: true };
    }
  }

  async confirmHold(meta: RequestMeta, holdId: string): Promise<Replayable<HoldState>> {
    const service = requireScope(meta.actor, 'scheduling.holds.write');
    const known = await this.ownedHold(holdId, service.clientId);
    const now = this.clock.now();
    const outcome = await this.uow.run(async (tx) => {
      const locked = await this.lockedWindow(tx, known.windowId);
      const hold = await this.lockedHold(tx, holdId);
      if (hold.status === 'CONFIRMED') return { kind: 'REPLAY' as const, hold };
      if (isDue(hold, now)) {
        // Commit the expiry, then report it: the deadline is a server fact.
        const current = await this.expireDueHolds(tx, locked, now, meta.correlationId);
        await tx.updateWindow(current, locked.version);
        return { kind: 'EXPIRED' as const, hold };
      }
      const confirmed = confirm(hold, now);
      const next = convertHeldToReserved(locked, hold.units);
      await tx.updateHold(confirmed, hold.version);
      await tx.updateWindow(next, locked.version);
      await tx.appendAudit({
        action: 'hold.confirmed',
        actor: meta.actor,
        targetType: 'CAPACITY_HOLD',
        targetId: hold.id,
        correlationId: meta.correlationId,
        details: { windowId: locked.id, units: hold.units },
      });
      return { kind: 'CONFIRMED' as const, hold: confirmed };
    });
    if (outcome.kind === 'EXPIRED') throw new SchedulingError('HOLD_EXPIRED', 'Hold has expired.');
    return { value: outcome.hold, replayed: outcome.kind === 'REPLAY' };
  }

  async releaseHold(meta: RequestMeta, holdId: string, reason: ReleaseReason): Promise<HoldState> {
    const actor = meta.actor;
    let known: HoldState;
    if (isOperations(actor)) {
      if (reason !== 'OPERATIONS_OVERRIDE')
        throw invalid('Operations releases use OPERATIONS_OVERRIDE.');
      known = await this.existingHold(holdId);
    } else {
      const service = requireScope(actor, 'scheduling.holds.write');
      if (reason === 'OPERATIONS_OVERRIDE') throw invalid('Reason is reserved for operations.');
      known = await this.ownedHold(holdId, service.clientId);
    }
    const now = this.clock.now();
    return this.uow.run(async (tx) => {
      const locked = await this.lockedWindow(tx, known.windowId);
      const hold = await this.lockedHold(tx, holdId);
      if (isDue(hold, now)) {
        const current = await this.expireDueHolds(tx, locked, now, meta.correlationId);
        await tx.updateWindow(current, locked.version);
        return expire(hold, now);
      }
      const { hold: released, freed } = release(hold, reason, now);
      if (freed === null) return hold;
      const next =
        freed === 'HELD'
          ? releaseHeldUnits(locked, hold.units)
          : releaseReservedUnits(locked, hold.units);
      await tx.updateHold(released, hold.version);
      await tx.updateWindow(next, locked.version);
      await tx.appendAudit({
        action: freed === 'HELD' ? 'hold.released' : 'reservation.cancelled',
        actor,
        targetType: 'CAPACITY_HOLD',
        targetId: hold.id,
        correlationId: meta.correlationId,
        details: { windowId: locked.id, units: hold.units, reason },
      });
      return released;
    });
  }

  async getHold(meta: RequestMeta, holdId: string): Promise<HoldState> {
    if (isOperations(meta.actor)) return this.existingHold(holdId);
    const service = requireScope(meta.actor, 'scheduling.holds.write');
    return this.ownedHold(holdId, service.clientId);
  }

  // ---------------------------------------------------------------- expiry

  /**
   * Expire due holds across windows. Safe to run on any number of replicas at
   * once: each window is taken with SKIP LOCKED, and every change is re-derived
   * from rows read under that lock, so a stalled or duplicate sweeper finds
   * nothing left to do instead of double-releasing units.
   */
  async expireDue(correlationId: string, limit = 50): Promise<{ windows: number; holds: number }> {
    const now = this.clock.now();
    const windowIds = await this.read.windowsWithDueHolds(now, limit);
    let windows = 0;
    let holds = 0;
    for (const windowId of windowIds) {
      const expired = await this.uow.run(async (tx) => {
        const locked = await tx.lockWindow(windowId, { skipLocked: true });
        if (!locked) return 0;
        const due = await tx.lockDueHolds(windowId, now);
        if (due.length === 0) return 0;
        const current = await this.applyExpiry(tx, locked, due, now, correlationId);
        await tx.updateWindow(current, locked.version);
        return due.length;
      });
      if (expired > 0) {
        windows += 1;
        holds += expired;
      }
    }
    return { windows, holds };
  }

  // --------------------------------------------------------------- helpers

  private async lockedWindow(tx: SchedulingTransaction, id: string): Promise<CapacityWindowState> {
    const window = await tx.lockWindow(id);
    if (!window) throw new SchedulingError('WINDOW_NOT_FOUND', 'Window not found.');
    return window;
  }

  private async lockedHold(tx: SchedulingTransaction, id: string): Promise<HoldState> {
    const hold = await tx.lockHold(id);
    if (!hold) throw new SchedulingError('HOLD_NOT_FOUND', 'Hold not found.');
    return hold;
  }

  private async existingHold(id: string): Promise<HoldState> {
    assertUuid(id, 'holdId');
    const hold = await this.read.findHold(id);
    if (!hold) throw new SchedulingError('HOLD_NOT_FOUND', 'Hold not found.');
    return hold;
  }

  /** Another client's hold is reported as absent, never as forbidden. */
  private async ownedHold(id: string, clientId: string): Promise<HoldState> {
    const hold = await this.existingHold(id);
    if (hold.clientId !== clientId) throw new SchedulingError('HOLD_NOT_FOUND', 'Hold not found.');
    return hold;
  }

  /**
   * Expire the due holds of a window the caller has locked. Returns the window
   * state to persist; the caller writes it once, guarded by the locked version.
   */
  private async expireDueHolds(
    tx: SchedulingTransaction,
    window: CapacityWindowState,
    now: Date,
    correlationId: string,
  ): Promise<CapacityWindowState> {
    const due = await tx.lockDueHolds(window.id, now);
    return this.applyExpiry(tx, window, due, now, correlationId);
  }

  private async applyExpiry(
    tx: SchedulingTransaction,
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
      await this.emit(
        tx,
        holdExpiredEvent({
          eventId: this.ids.next(),
          correlationId,
          hold: expired,
          zoneId: window.zoneId,
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

  private emit(tx: SchedulingTransaction, event: SchedulingEvent): Promise<void> {
    return tx.appendEvent({
      event,
      exchange: SCHEDULING_EVENTS_EXCHANGE,
      routingKey: event.eventType,
    });
  }
}

const SYSTEM_ACTOR: Actor = { kind: 'SYSTEM', component: 'hold-expiry' };

function assertUuid(value: string, field: string): void {
  if (typeof value !== 'string' || !UUID.test(value)) throw invalid(`${field} must be a UUID.`);
}

function fingerprintOf(command: AcquireHoldCommand, ttlSeconds: number): string {
  const canonical = JSON.stringify([
    command.windowId.toLowerCase(),
    command.holderRef.toLowerCase(),
    command.units,
    ttlSeconds,
  ]);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function replay(prior: HoldState, fingerprint: string): HoldState {
  if (prior.requestFingerprint !== fingerprint) {
    throw new SchedulingError(
      'IDEMPOTENCY_KEY_REUSED',
      'Idempotency-Key was used for a different request.',
    );
  }
  return prior;
}
