import { SCHEDULING_HOLD_CHANGED_V1 } from '@carwash/event-contracts';
import {
  DISPATCH_ASSIGNMENT_CHANGED_V1,
  DISPATCH_EVENTS_EXCHANGE,
  assignmentChangedEvent,
  cancel,
  decideHoldChange,
  openAssignment,
  withdraw,
  type AssignmentState,
  type HoldEventState,
} from '../domain';
import type { Actor, Clock, DispatchTransaction, IdGenerator } from '../ports';
import { confirmRebind } from './booking-change.service';
import { Effects } from './effects';

/**
 * Consumer side of the PUBLISHED `scheduling.hold-changed.v1` (envelope v2,
 * @carwash/event-contracts business-v1). Parsing uses the published parser
 * itself, so a message the contract rejects can never reach the handler.
 */
export interface HoldChangedMessage {
  /** InboxConsumer's ParsedEvent fields. */
  readonly eventId: string;
  readonly eventType: typeof SCHEDULING_HOLD_CHANGED_V1.eventType;
  readonly correlationId: string;
  readonly holdId: string;
  readonly version: number;
  readonly state: HoldEventState;
  readonly zoneId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly bookingId: string | null;
}

export function parseHoldChanged(raw: unknown): HoldChangedMessage {
  const event = SCHEDULING_HOLD_CHANGED_V1.parse(raw);
  return {
    eventId: event.eventId.toLowerCase(),
    eventType: event.eventType,
    correlationId: event.correlationId.toLowerCase(),
    holdId: event.aggregate.id.toLowerCase(),
    version: event.aggregate.version,
    state: event.data.state,
    zoneId: event.data.zoneId.toLowerCase(),
    startsAt: new Date(event.data.startsAt),
    endsAt: new Date(event.data.endsAt),
    bookingId: event.data.bookingId === null ? null : event.data.bookingId.toLowerCase(),
  };
}

export type HoldApplyOutcome =
  | 'OPENED'
  | 'CANCELLED'
  | 'COMPLETED_KEPT'
  | 'NOTED'
  | 'STALE'
  | 'ALREADY_OPEN'
  | 'BOOKING_CONFLICT'
  | 'NOTHING_TO_CANCEL'
  /** P04-C2: the booking was cancelled before its job was opened. */
  | 'SUPPRESSED_CANCELLED'
  /** P04-C2: the COMMITTED event of a rebind's new hold made the binding final. */
  | 'BINDING_CONFIRMED'
  /** P04-C2: the bound hold is not committed yet; Booking confirms or reverts. */
  | 'PENDING_BINDING_KEPT';

const CONSUMER: Actor = { kind: 'SYSTEM', component: 'hold-changed-consumer' };

/**
 * Applies one hold change inside the inbox transaction (the inbox row and this
 * effect commit together). Per-hold serialisation and the version watermark
 * make redelivery, duplicates and out-of-order arrival harmless.
 */
export class HoldChangeHandler {
  private readonly effects: Effects;

  constructor(
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {
    this.effects = new Effects(ids);
  }

  async apply(tx: DispatchTransaction, message: HoldChangedMessage): Promise<HoldApplyOutcome> {
    const previous = await tx.lockHoldObservation(message.holdId);
    const decision = decideHoldChange(previous, message);
    if (decision === 'STALE') return 'STALE';
    await tx.saveHoldObservation({
      holdId: message.holdId,
      version: message.version,
      state: message.state,
    });
    const now = this.clock.now();
    if (decision === 'NOTE') return 'NOTED';
    if (decision === 'OPEN') return this.open(tx, message, now);
    return this.cancel(tx, message, now);
  }

  private async open(
    tx: DispatchTransaction,
    message: HoldChangedMessage,
    now: Date,
  ): Promise<HoldApplyOutcome> {
    // The published parser binds bookingId to COMMITTED exactly.
    if (message.bookingId === null) throw new Error('COMMITTED_WITHOUT_BOOKING');
    // Booking lock: serialises against Booking's cancellation and rebind commands.
    await tx.lockBooking(message.bookingId);
    const cancellation = await tx.findCancellation(message.bookingId);
    if (cancellation) {
      await tx.appendAudit({
        action: 'hold.commit-after-cancellation',
        actor: CONSUMER,
        targetType: 'HOLD',
        targetId: message.holdId,
        correlationId: message.correlationId,
        details: { bookingId: message.bookingId, changeId: cancellation.changeId },
      });
      return 'SUPPRESSED_CANCELLED';
    }
    const assignment = openAssignment({
      id: this.ids.next(),
      bookingId: message.bookingId,
      holdId: message.holdId,
      zoneId: message.zoneId,
      startsAt: message.startsAt,
      endsAt: message.endsAt,
      now,
    });
    const inserted = await tx.insertAssignment(assignment);
    if (inserted === 'DUPLICATE_HOLD') return this.confirmPending(tx, message, now);
    if (inserted === 'DUPLICATE_BOOKING') {
      // A second, different committed hold for one booking is a cross-service
      // anomaly; it is recorded for reconciliation, never silently merged.
      await tx.appendAudit({
        action: 'hold.booking-conflict',
        actor: CONSUMER,
        targetType: 'HOLD',
        targetId: message.holdId,
        correlationId: message.correlationId,
        details: { bookingId: message.bookingId, holdVersion: message.version },
      });
      return 'BOOKING_CONFLICT';
    }
    await this.emit(tx, assignment, message);
    await tx.appendAudit({
      action: 'assignment.opened',
      actor: CONSUMER,
      targetType: 'ASSIGNMENT',
      targetId: assignment.id,
      correlationId: message.correlationId,
      details: { bookingId: assignment.bookingId, holdId: assignment.holdId },
    });
    return 'OPENED';
  }

  private async cancel(
    tx: DispatchTransaction,
    message: HoldChangedMessage,
    now: Date,
  ): Promise<HoldApplyOutcome> {
    const assignment = await tx.lockAssignmentByHold(message.holdId);
    if (!assignment || assignment.status === 'CANCELLED') return 'NOTHING_TO_CANCEL';
    if (assignment.pendingChangeId !== null) {
      // Booking bound the job to this hold for a reschedule but has not
      // committed it (or it could not be committed): Booking's saga confirms or
      // reverts the binding. A release of an uncommitted hold must not cancel
      // the booking's job.
      await tx.appendAudit({
        action: 'hold.released-while-rebinding',
        actor: CONSUMER,
        targetType: 'ASSIGNMENT',
        targetId: assignment.id,
        correlationId: message.correlationId,
        details: { holdState: message.state, changeId: assignment.pendingChangeId },
      });
      return 'PENDING_BINDING_KEPT';
    }
    const offer = await tx.lockCurrentOffer(assignment.id);
    const live = await tx.lockLiveTask(assignment.id);
    if (live?.stage === 'CLOSED') {
      // The work was delivered; a slot released afterwards never erases it.
      // Recorded for reconciliation with Scheduling/Booking instead.
      await tx.appendAudit({
        action: 'hold.released-after-completion',
        actor: CONSUMER,
        targetType: 'TASK',
        targetId: live.id,
        correlationId: message.correlationId,
        details: {
          assignmentId: assignment.id,
          holdState: message.state,
          holdVersion: message.version,
        },
      });
      return 'COMPLETED_KEPT';
    }
    if (offer) await tx.updateOffer(withdraw(offer, 'JOB_CANCELLED', now), offer.version);
    const endedTask = await this.effects.endLiveTask(
      tx,
      assignment.id,
      'JOB_CANCELLED',
      now,
      { actor: CONSUMER, correlationId: message.correlationId },
      message.eventId,
    );
    const cancelled = cancel(
      assignment,
      message.state === 'EXPIRED' ? 'HOLD_EXPIRED' : 'HOLD_RELEASED',
      now,
    );
    await tx.updateAssignment(cancelled, assignment.version);
    await this.emit(tx, cancelled, message);
    await tx.appendAudit({
      action: 'assignment.cancelled',
      actor: CONSUMER,
      targetType: 'ASSIGNMENT',
      targetId: assignment.id,
      correlationId: message.correlationId,
      details: {
        previousStatus: assignment.status,
        withdrawnOfferId: offer?.id ?? null,
        cancelledTaskId: endedTask?.id ?? null,
        holdState: message.state,
      },
    });
    return 'CANCELLED';
  }

  /** The hold already has its job: if a rebind is waiting for this commit, make it final. */
  private async confirmPending(
    tx: DispatchTransaction,
    message: HoldChangedMessage,
    now: Date,
  ): Promise<HoldApplyOutcome> {
    const bound = await tx.lockAssignmentByHold(message.holdId);
    if (!bound || bound.pendingChangeId === null || bound.bookingId !== message.bookingId) {
      return 'ALREADY_OPEN';
    }
    const change = await tx.findBookingChange(bound.pendingChangeId);
    if (!change || change.state !== 'REBOUND') return 'ALREADY_OPEN';
    await confirmRebind(
      tx,
      this.effects,
      { actor: CONSUMER, correlationId: message.correlationId },
      change,
      now,
    );
    return 'BINDING_CONFIRMED';
  }

  private async emit(
    tx: DispatchTransaction,
    assignment: AssignmentState,
    message: HoldChangedMessage,
  ): Promise<void> {
    await tx.appendEvent({
      event: assignmentChangedEvent({
        eventId: this.ids.next(),
        correlationId: message.correlationId,
        causationId: message.eventId,
        actor: { kind: 'system', id: null },
        assignment,
      }),
      exchange: DISPATCH_EVENTS_EXCHANGE,
      routingKey: DISPATCH_ASSIGNMENT_CHANGED_V1,
    });
  }
}
