import type { AssignmentView, TaskDetail } from '../../application';
import {
  CURRENCY_SCALE,
  moneyToWire,
  type AssignmentState,
  type EvidenceLink,
  type EvidencePhase,
  type OfferState,
  type TaskState,
} from '../../domain';

export function offerView(offer: OfferState) {
  return {
    offerId: offer.id,
    revision: offer.version,
    status: offer.status,
    resourceId: offer.resourceId,
    technicianSubjectId: offer.technicianSubject,
    expiresAt: offer.expiresAt.toISOString(),
    declineReason: offer.declineReason,
    withdrawReason: offer.withdrawReason,
    createdAt: offer.createdAt.toISOString(),
    updatedAt: offer.updatedAt.toISOString(),
  };
}

export function assignmentView(assignment: AssignmentState) {
  return {
    assignmentId: assignment.id,
    revision: assignment.version,
    bookingId: assignment.bookingId,
    holdId: assignment.holdId,
    zoneId: assignment.zoneId,
    startsAt: assignment.startsAt.toISOString(),
    endsAt: assignment.endsAt.toISOString(),
    status: assignment.status,
    resourceId: assignment.resourceId,
    technicianSubjectId: assignment.technicianSubject,
    cancelReason: assignment.cancelReason,
    createdAt: assignment.createdAt.toISOString(),
    updatedAt: assignment.updatedAt.toISOString(),
  };
}

/** Operations summary of the live task (no notes, photos or declaration amounts). */
function operationsTask(task: TaskState) {
  return {
    taskId: task.id,
    revision: task.version,
    stage: task.stage,
    attentionReason: task.attentionReason,
    updatedAt: task.updatedAt.toISOString(),
  };
}

/** Operations view: the job, its current offer and its live task stage. */
export function operationsView(view: AssignmentView) {
  return {
    ...assignmentView(view.assignment),
    offer: view.offer ? offerView(view.offer) : null,
    task: view.task ? operationsTask(view.task) : null,
  };
}

/**
 * Technician view of an offer: their own offer and the job window only. No
 * booking revision, no other technician, no resource of another offer.
 */
export function technicianView(
  offer: OfferState,
  assignment: AssignmentState,
  taskId: string | null,
) {
  return {
    offerId: offer.id,
    revision: offer.version,
    status: offer.status,
    expiresAt: offer.expiresAt.toISOString(),
    taskId,
    job: {
      assignmentId: assignment.id,
      bookingId: assignment.bookingId,
      zoneId: assignment.zoneId,
      startsAt: assignment.startsAt.toISOString(),
      endsAt: assignment.endsAt.toISOString(),
      status: assignment.status,
    },
  };
}

function iso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

function slots(evidence: readonly EvidenceLink[], phase: EvidencePhase) {
  return ([0, 1] as const).map((slot) => {
    const link = evidence.find(
      (entry) => entry.phase === phase && entry.slot === slot && entry.removedAt === null,
    );
    return link
      ? { mediaObjectId: link.mediaObjectId, attachedAt: link.attachedAt.toISOString() }
      : null;
  });
}

function collectionView(task: TaskState) {
  const c = task.collection;
  if (c === null) return null;
  const amount = (minor: bigint | null) =>
    minor === null || c.currency === null
      ? null
      : moneyToWire({
          currency: c.currency,
          amountMinor: minor,
          scale: CURRENCY_SCALE[c.currency],
        });
  return {
    outcome: c.outcome,
    amount: amount(c.amountMinor),
    reason: c.reason,
    declaredAt: c.declaredAt.toISOString(),
    lateAmount: amount(c.lateAmountMinor),
    lateDeclaredAt: iso(c.lateDeclaredAt),
  };
}

/** Task summary used in the technician's job list. */
export function taskSummary(task: TaskState) {
  return {
    taskId: task.id,
    revision: task.version,
    stage: task.stage,
    assignmentId: task.assignmentId,
    bookingId: task.bookingId,
    acceptedAt: task.acceptedAt.toISOString(),
    closedAt: iso(task.closedAt),
    endedAt: iso(task.endedAt),
    endReason: task.endReason,
    attentionReason: task.attentionReason,
    collection: collectionView(task),
    updatedAt: task.updatedAt.toISOString(),
  };
}

/** Full technician task view (interface spec C4). */
export function taskDetailView(
  detail: TaskDetail,
  window: { startsAt: Date; endsAt: Date; zoneId: string } | null,
) {
  const { task } = detail;
  return {
    taskId: task.id,
    revision: task.version,
    stage: task.stage,
    assignmentId: task.assignmentId,
    bookingId: task.bookingId,
    zoneId: window?.zoneId ?? null,
    startsAt: window ? window.startsAt.toISOString() : null,
    endsAt: window ? window.endsAt.toISOString() : null,
    acceptedAt: task.acceptedAt.toISOString(),
    departedAt: iso(task.departedAt),
    arrivedAt: iso(task.arrivedAt),
    arrivalMethod: task.arrivalMethod,
    startedAt: iso(task.startedAt),
    documentedAt: iso(task.documentedAt),
    finishedAt: iso(task.finishedAt),
    closedAt: iso(task.closedAt),
    endedAt: iso(task.endedAt),
    endReason: task.endReason,
    releaseReason: task.releaseReason,
    attentionReason: task.attentionReason,
    conditionNote: task.conditionNote,
    checklist: {
      version: task.checklistVersion,
      items: task.checklist.map((item) => ({ ...item })),
    },
    evidence: { BEFORE: slots(detail.evidence, 'BEFORE'), AFTER: slots(detail.evidence, 'AFTER') },
    collection: collectionView(task),
    notes: detail.notes.map((note) => ({
      noteId: note.id,
      kind: note.kind,
      text: note.text,
      createdAt: note.createdAt.toISOString(),
    })),
    history: detail.history.map((entry) => ({
      at: entry.occurredAt.toISOString(),
      action: entry.action,
    })),
  };
}
