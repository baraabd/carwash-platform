import {
  SchedulingError,
  convertHeldToReserved,
  holdChangedEvent,
  isDue,
  releaseCommitment,
  releaseReservedUnits,
  replaceCommitment,
  type CapacityWindowState,
  type HoldState,
} from '../domain';
import type {
  Clock,
  IdGenerator,
  RequestMeta,
  SchedulingReadModel,
  SchedulingTransaction,
  SchedulingUnitOfWork,
  StoredResponse,
} from '../ports';
import { actorKey, requireScope } from './authorization';
import { assertUuid } from './capacity.service';
import { emit, eventActor, expireDueHoldsOf } from './expiry';
import { CONTRACT, fingerprint, holdView, requireKey, settle } from './holds-v1.service';

/**
 * Booking-only changes to a COMMITTED booking (REQUESTED scheduling.v1
 * additions, CR-P04-C1): give the reserved unit back when the booking is
 * cancelled, and move the commitment to another hold when it is rescheduled.
 *
 * Both are replay-safe by booking, not only by Idempotency-Key: Booking's saga
 * may lose a response and retry with the same key, or a recovered worker may
 * retry after the key's record was purged; either way the second call reports
 * the already-applied state and changes nothing.
 *
 * Lock order (extends the service-wide order): idempotency record -> windows in
 * ascending id -> holds in ascending id. The expiry sweeper takes one window
 * with SKIP LOCKED and the other commands one window, so no cycle is possible.
 */
export class CommitmentsService {
  constructor(
    private readonly uow: SchedulingUnitOfWork,
    private readonly read: SchedulingReadModel,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  /** Booking cancelled: CONFIRMED -> CANCELLED (BOOKING_CANCELLED), reserved unit freed. */
  async releaseCommitment(
    meta: RequestMeta,
    bookingId: string,
    body: { readonly holdId: string },
    rawKey: string | undefined,
  ): Promise<StoredResponse> {
    const service = requireScope(meta.actor, 'scheduling.commitment.change');
    const key = requireKey(rawKey);
    const booking = id(bookingId, 'bookingId');
    const holdId = id(body.holdId, 'holdId');
    const known = await this.read.findHold(holdId);
    if (!known) throw new SchedulingError('HOLD_NOT_FOUND', 'Hold not found.');
    const actor = actorKey(service);
    const scope = `${CONTRACT}:releaseCommitment:${actor}`;
    const print = fingerprint('releaseCommitment', actor, booking, { holdId });
    const now = this.clock.now();

    return this.uow.run(async (tx) => {
      const replay = settle(await tx.claimIdempotency(scope, key, print));
      if (replay) return replay;
      const window = await this.lockedWindow(tx, known.windowId);
      const hold = await this.lockedHold(tx, holdId);
      const result = releaseCommitment(hold, { bookingId: booking, now });
      if (!result.replay) {
        await tx.updateHold(result.hold, hold.version);
        await tx.updateWindow(releaseReservedUnits(window, hold.units), window.version);
        await this.changed(tx, meta, result.hold);
        await tx.appendAudit({
          action: 'reservation.cancelled',
          actor: meta.actor,
          targetType: 'CAPACITY_HOLD',
          targetId: hold.id,
          correlationId: meta.correlationId,
          details: {
            windowId: window.id,
            bookingId: booking,
            units: hold.units,
            reason: 'BOOKING_CANCELLED',
          },
        });
      }
      const response: StoredResponse = { status: 200, body: holdView(result.hold) };
      await tx.completeIdempotency(scope, key, response);
      return response;
    });
  }

  /**
   * Booking rescheduled: in ONE transaction the new hold becomes CONFIRMED for
   * the booking and the old one CANCELLED (RESCHEDULED). The old row is
   * updated first so the "one CONFIRMED hold per booking" index never sees two.
   * If the new hold's deadline passed, its expiry is committed and the call
   * answers HOLD_EXPIRED; the old commitment is untouched.
   */
  async replaceCommitment(
    meta: RequestMeta,
    bookingId: string,
    body: {
      readonly fromHoldId: string;
      readonly toHoldId: string;
      readonly toExpectedRevision: number;
    },
    rawKey: string | undefined,
  ): Promise<StoredResponse> {
    const service = requireScope(meta.actor, 'scheduling.commitment.change');
    const key = requireKey(rawKey);
    const booking = id(bookingId, 'bookingId');
    const fromId = id(body.fromHoldId, 'fromHoldId');
    const toId = id(body.toHoldId, 'toHoldId');
    const [fromKnown, toKnown] = await Promise.all([
      this.read.findHold(fromId),
      this.read.findHold(toId),
    ]);
    if (!fromKnown || !toKnown) throw new SchedulingError('HOLD_NOT_FOUND', 'Hold not found.');
    const actor = actorKey(service);
    const scope = `${CONTRACT}:replaceCommitment:${actor}`;
    const print = fingerprint('replaceCommitment', actor, booking, {
      fromHoldId: fromId,
      toHoldId: toId,
      toExpectedRevision: body.toExpectedRevision,
    });
    const now = this.clock.now();

    const outcome = await this.uow.run(async (tx) => {
      const replay = settle(await tx.claimIdempotency(scope, key, print));
      if (replay) return replay;
      const windows = await this.lockWindows(tx, [fromKnown.windowId, toKnown.windowId]);
      const [first, second] = fromId < toId ? [fromId, toId] : [toId, fromId];
      const lockedFirst = await this.lockedHold(tx, first);
      const lockedSecond = await this.lockedHold(tx, second);
      const from = lockedFirst.id === fromId ? lockedFirst : lockedSecond;
      const to = lockedFirst.id === toId ? lockedFirst : lockedSecond;
      const toWindow = windowOf(windows, to.windowId);
      if (isDue(to, now)) {
        const current = await expireDueHoldsOf(tx, this.ids, toWindow, now, meta.correlationId);
        await tx.updateWindow(current, toWindow.version);
        await tx.abandonIdempotency(scope, key);
        return EXPIRED;
      }
      const result = replaceCommitment(from, to, {
        bookingId: booking,
        expectedRevision: body.toExpectedRevision,
        now,
      });
      if (!result.replay) {
        // Old commitment first: the partial unique index allows one CONFIRMED hold per booking.
        await tx.updateHold(result.from, from.version);
        await tx.updateHold(result.to, to.version);
        await this.moveUnits(tx, windows, from, to);
        await this.changed(tx, meta, result.from);
        await this.changed(tx, meta, result.to);
        await tx.appendAudit({
          action: 'reservation.rescheduled',
          actor: meta.actor,
          targetType: 'CAPACITY_HOLD',
          targetId: to.id,
          correlationId: meta.correlationId,
          details: {
            bookingId: booking,
            fromHoldId: from.id,
            fromWindowId: from.windowId,
            toWindowId: to.windowId,
          },
        });
      }
      const response: StoredResponse = {
        status: 200,
        body: {
          bookingId: booking,
          released: holdView(result.from),
          committed: holdView(result.to),
        },
      };
      await tx.completeIdempotency(scope, key, response);
      return response;
    });
    if (outcome === EXPIRED) throw new SchedulingError('HOLD_EXPIRED', 'Hold has expired.');
    return outcome;
  }

  /** New hold: held -> reserved; old hold: reserved freed. Each window is written once. */
  private async moveUnits(
    tx: SchedulingTransaction,
    windows: ReadonlyMap<string, CapacityWindowState>,
    from: HoldState,
    to: HoldState,
  ): Promise<void> {
    const before = windowOf(windows, to.windowId);
    if (from.windowId === to.windowId) {
      const next = releaseReservedUnits(convertHeldToReserved(before, to.units), from.units);
      await tx.updateWindow({ ...next, version: before.version + 1 }, before.version);
      return;
    }
    const old = windowOf(windows, from.windowId);
    await tx.updateWindow(convertHeldToReserved(before, to.units), before.version);
    await tx.updateWindow(releaseReservedUnits(old, from.units), old.version);
  }

  private async lockWindows(
    tx: SchedulingTransaction,
    ids: readonly string[],
  ): Promise<Map<string, CapacityWindowState>> {
    const locked = new Map<string, CapacityWindowState>();
    for (const windowId of [...new Set(ids)].sort()) {
      locked.set(windowId, await this.lockedWindow(tx, windowId));
    }
    return locked;
  }

  private async lockedWindow(tx: SchedulingTransaction, windowId: string) {
    const window = await tx.lockWindow(windowId);
    if (!window) throw new SchedulingError('WINDOW_NOT_FOUND', 'Window not found.');
    return window;
  }

  private async lockedHold(tx: SchedulingTransaction, holdId: string): Promise<HoldState> {
    const hold = await tx.lockHold(holdId);
    if (!hold) throw new SchedulingError('HOLD_NOT_FOUND', 'Hold not found.');
    return hold;
  }

  private async changed(
    tx: SchedulingTransaction,
    meta: RequestMeta,
    hold: HoldState,
  ): Promise<void> {
    await emit(
      tx,
      holdChangedEvent({
        eventId: this.ids.next(),
        correlationId: meta.correlationId,
        hold,
        zoneId: hold.zoneId,
        actor: eventActor(meta.actor),
      }),
    );
  }
}

/** The new hold's deadline passed: its expiry is committed, nothing is replayed. */
const EXPIRED = Symbol('EXPIRED');

function id(value: string, field: string): string {
  assertUuid(value, field);
  return value.toLowerCase();
}

function windowOf(
  windows: ReadonlyMap<string, CapacityWindowState>,
  windowId: string,
): CapacityWindowState {
  const window = windows.get(windowId);
  if (!window) throw new Error('WINDOW_NOT_LOCKED');
  return window;
}
