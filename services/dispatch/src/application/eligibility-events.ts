import { WORKFORCE_ELIGIBILITY_CHANGED_V1 } from '@carwash/event-contracts';
import {
  decideObservation,
  flagIneligible,
  markUnassigned,
  withdraw,
  type Eligibility,
} from '../domain';
import type { Clock, DispatchTransaction, IdGenerator, RequestMeta } from '../ports';
import { Effects } from './effects';

/**
 * Consumer side of the PUBLISHED `workforce.eligibility-changed.v1`
 * (envelope v2, aggregate `capacity-resource`, version = eligibilityRevision).
 * Parsing uses the published parser, so a message the contract rejects never
 * reaches the handler.
 */
export interface EligibilityChangedMessage {
  readonly eventId: string;
  readonly eventType: typeof WORKFORCE_ELIGIBILITY_CHANGED_V1.eventType;
  readonly correlationId: string;
  readonly resourceId: string;
  readonly revision: number;
  readonly eligibility: Eligibility;
}

export function parseEligibilityChanged(raw: unknown): EligibilityChangedMessage {
  const event = WORKFORCE_ELIGIBILITY_CHANGED_V1.parse(raw);
  return {
    eventId: event.eventId.toLowerCase(),
    eventType: event.eventType,
    correlationId: event.correlationId.toLowerCase(),
    resourceId: event.aggregate.id.toLowerCase(),
    revision: event.aggregate.version,
    eligibility: event.data.eligibility,
  };
}

export type EligibilityApplyOutcome = 'STALE' | 'NOTED' | 'WITHDREW' | 'FLAGGED' | 'NO_WORK';

/**
 * Applies one eligibility change inside the inbox transaction.
 *
 * INELIGIBLE: every live offer to the resource is withdrawn and every task it
 * accepted but has not started (stage ACCEPTED) is withdrawn too, returning
 * those jobs to operations. A task already in the field is NOT cancelled
 * behind the technician's back: it is flagged for operations, who decide.
 * ELIGIBLE only moves the watermark; nothing is re-offered automatically.
 *
 * Lock order: resource watermark (exclusive) -> assignments ascending -> offer
 * -> task. Offer/accept commands take the same watermark lock (shared) before
 * any assignment, so an offer can never slip in unseen.
 */
export class EligibilityChangeHandler {
  private readonly effects: Effects;

  constructor(
    private readonly clock: Clock,
    ids: IdGenerator,
  ) {
    this.effects = new Effects(ids);
  }

  async apply(
    tx: DispatchTransaction,
    message: EligibilityChangedMessage,
  ): Promise<EligibilityApplyOutcome> {
    const next = {
      resourceId: message.resourceId,
      eligibility: message.eligibility,
      revision: message.revision,
    };
    const previous = await tx.lockResourceObservation(message.resourceId);
    if (decideObservation(previous, next) === 'STALE') return 'STALE';
    await tx.saveResourceObservation(next);
    if (message.eligibility === 'ELIGIBLE') return 'NOTED';

    const meta: RequestMeta = {
      actor: { kind: 'SYSTEM', component: 'eligibility-consumer' },
      correlationId: message.correlationId,
    };
    const now = this.clock.now();
    let withdrew = 0;
    let flagged = 0;
    for (const assignmentId of await tx.assignmentsTouchingResource(message.resourceId)) {
      const assignment = await tx.lockAssignment(assignmentId);
      if (!assignment) continue;
      const offer = await tx.lockCurrentOffer(assignment.id);
      const task = await tx.lockLiveTask(assignment.id);
      if (offer && offer.resourceId === message.resourceId && offer.status === 'OFFERED') {
        await tx.updateOffer(withdraw(offer, 'RESOURCE_INELIGIBLE', now), offer.version);
        const unassigned = markUnassigned(assignment, now);
        await tx.updateAssignment(unassigned, assignment.version);
        await this.effects.assignmentChanged(tx, unassigned, meta, message.eventId);
        await this.audit(tx, meta, 'offer.withdrawn-ineligible', offer.id, assignment.id, message);
        withdrew += 1;
        continue;
      }
      if (!task || task.resourceId !== message.resourceId || task.stage === 'CLOSED') continue;
      if (task.stage === 'ACCEPTED' && offer && offer.status === 'ACCEPTED') {
        await tx.updateOffer(withdraw(offer, 'RESOURCE_INELIGIBLE', now), offer.version);
        await this.effects.endLiveTask(
          tx,
          assignment.id,
          'RESOURCE_INELIGIBLE',
          now,
          meta,
          message.eventId,
        );
        const unassigned = markUnassigned(assignment, now);
        await tx.updateAssignment(unassigned, assignment.version);
        await this.effects.assignmentChanged(tx, unassigned, meta, message.eventId);
        await this.audit(tx, meta, 'task.withdrawn-ineligible', task.id, assignment.id, message);
        withdrew += 1;
        continue;
      }
      const marked = flagIneligible(task, now);
      if (marked !== task) {
        await tx.updateTask(marked, task.version);
        await tx.appendTaskHistory(marked.id, 'flagged.ineligible', now);
        await this.audit(tx, meta, 'task.eligibility-lost', task.id, assignment.id, message);
        flagged += 1;
      }
    }
    if (withdrew > 0) return 'WITHDREW';
    if (flagged > 0) return 'FLAGGED';
    return 'NO_WORK';
  }

  private async audit(
    tx: DispatchTransaction,
    meta: RequestMeta,
    action: string,
    targetId: string,
    assignmentId: string,
    message: EligibilityChangedMessage,
  ): Promise<void> {
    await this.effects.audit(
      tx,
      meta,
      action,
      { type: action.startsWith('task.') ? 'TASK' : 'OFFER', id: targetId },
      { assignmentId, resourceId: message.resourceId, eligibilityRevision: message.revision },
    );
  }
}
