import type { EventActor } from '@carwash/event-contracts';
import {
  DISPATCH_ASSIGNMENT_CHANGED_V1,
  DISPATCH_CASH_DECLARED_V1,
  DISPATCH_EVENTS_EXCHANGE,
  DISPATCH_TASK_PROGRESSED_V1,
  assignmentChangedEvent,
  cancelTask,
  cashDeclaredEvent,
  taskProgressedEvent,
  withdrawTask,
  type AssignmentState,
  type TaskEndReason,
  type TaskState,
} from '../domain';
import type { Actor, DispatchTransaction, IdGenerator, RequestMeta } from '../ports';

export function eventActor(actor: Actor): EventActor {
  if (actor.kind === 'USER') return { kind: 'account', id: actor.subject };
  if (actor.kind === 'SERVICE') return { kind: 'service', id: actor.clientId };
  return { kind: 'system', id: null };
}

/**
 * Outbox/audit/history writes that accompany a state change. They are always
 * written in the SAME transaction as the change, so the change, its event and
 * its audit row commit or roll back together.
 */
export class Effects {
  constructor(private readonly ids: IdGenerator) {}

  async assignmentChanged(
    tx: DispatchTransaction,
    assignment: AssignmentState,
    meta: RequestMeta,
    causationId: string | null = null,
  ): Promise<void> {
    await tx.appendEvent({
      event: assignmentChangedEvent({
        eventId: this.ids.next(),
        correlationId: meta.correlationId,
        causationId,
        actor: eventActor(meta.actor),
        assignment,
      }),
      exchange: DISPATCH_EVENTS_EXCHANGE,
      routingKey: DISPATCH_ASSIGNMENT_CHANGED_V1,
    });
  }

  /** Stage change: history entry + task-progressed event. */
  async taskProgressed(
    tx: DispatchTransaction,
    task: TaskState,
    action: string,
    meta: RequestMeta,
    causationId: string | null = null,
  ): Promise<void> {
    await tx.appendTaskHistory(task.id, action, task.updatedAt);
    await tx.appendEvent({
      event: taskProgressedEvent({
        eventId: this.ids.next(),
        correlationId: meta.correlationId,
        causationId,
        actor: eventActor(meta.actor),
        task,
      }),
      exchange: DISPATCH_EVENTS_EXCHANGE,
      routingKey: DISPATCH_TASK_PROGRESSED_V1,
    });
  }

  async cashDeclared(
    tx: DispatchTransaction,
    task: TaskState,
    meta: RequestMeta,
    late: boolean,
  ): Promise<void> {
    await tx.appendEvent({
      event: cashDeclaredEvent({
        eventId: this.ids.next(),
        correlationId: meta.correlationId,
        causationId: null,
        actor: eventActor(meta.actor),
        task,
        late,
      }),
      exchange: DISPATCH_EVENTS_EXCHANGE,
      routingKey: DISPATCH_CASH_DECLARED_V1,
    });
  }

  async audit(
    tx: DispatchTransaction,
    meta: RequestMeta,
    action: string,
    target: {
      readonly type: 'ASSIGNMENT' | 'OFFER' | 'HOLD' | 'TASK' | 'RESOURCE';
      readonly id: string;
    },
    details: Readonly<Record<string, string | number | boolean | null>>,
  ): Promise<void> {
    await tx.appendAudit({
      action,
      actor: meta.actor,
      targetType: target.type,
      targetId: target.id,
      correlationId: meta.correlationId,
      details,
    });
  }

  /**
   * Ends the live task of a locked assignment because the job was taken away
   * (reassign/unassign/eligibility) or cancelled. A CLOSED task is never
   * touched. Returns the task as stored afterwards (or null if none was live).
   */
  async endLiveTask(
    tx: DispatchTransaction,
    assignmentId: string,
    reason: Exclude<TaskEndReason, 'RELEASED_BY_TECHNICIAN'>,
    now: Date,
    meta: RequestMeta,
    causationId: string | null = null,
  ): Promise<TaskState | null> {
    const task = await tx.lockLiveTask(assignmentId);
    if (!task || task.stage === 'CLOSED') return task;
    const ended =
      reason === 'JOB_CANCELLED' ? cancelTask(task, now) : withdrawTask(task, reason, now);
    if (ended === task) return task;
    await tx.updateTask(ended, task.version);
    await this.taskProgressed(
      tx,
      ended,
      reason === 'JOB_CANCELLED' ? 'cancelled' : 'withdrawn',
      meta,
      causationId,
    );
    return ended;
  }
}
