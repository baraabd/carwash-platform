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
  | 'NOTED'
  | 'STALE'
  | 'ALREADY_OPEN'
  | 'BOOKING_CONFLICT'
  | 'NOTHING_TO_CANCEL';

const CONSUMER: Actor = { kind: 'SYSTEM', component: 'hold-changed-consumer' };

/**
 * Applies one hold change inside the inbox transaction (the inbox row and this
 * effect commit together). Per-hold serialisation and the version watermark
 * make redelivery, duplicates and out-of-order arrival harmless.
 */
export class HoldChangeHandler {
  constructor(
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

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
    if (inserted === 'DUPLICATE_HOLD') return 'ALREADY_OPEN';
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
    const offer = await tx.lockCurrentOffer(assignment.id);
    if (offer) await tx.updateOffer(withdraw(offer, 'JOB_CANCELLED', now), offer.version);
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
        holdState: message.state,
      },
    });
    return 'CANCELLED';
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
