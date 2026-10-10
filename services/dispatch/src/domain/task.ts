import { DispatchError, invalid } from './errors';
import type { Currency, Money } from './money';

/**
 * Execution of one accepted job by the technician who accepted it.
 *
 * The task lives in the same aggregate as the assignment: every technician
 * step is decided under the assignment's row lock and only while the task is
 * the current one, so a reassigned, released or ineligible technician can
 * never advance a job (decision P03-C-D1).
 *
 *   ACCEPTED -> EN_ROUTE -> ARRIVED -> IN_SERVICE -> DOCUMENTING -> FINISHED -> CLOSED
 *   ACCEPTED -> RELEASED                       (technician returns it before leaving)
 *   any open stage -> WITHDRAWN | CANCELLED    (operations / eligibility / slot)
 *
 * Reference stages (approved technician prototype): accepted, route, before,
 * wash, after, handoff, closed. Gates mirror the reference: one before photo
 * to start, every required check to document, one after photo to finish, an
 * explicit handoff declaration to close. A CLOSED task only accepts one late
 * cash declaration and never reopens.
 */
export const TASK_STAGES = [
  'ACCEPTED',
  'EN_ROUTE',
  'ARRIVED',
  'IN_SERVICE',
  'DOCUMENTING',
  'FINISHED',
  'CLOSED',
  'RELEASED',
  'WITHDRAWN',
  'CANCELLED',
] as const;
export type TaskStage = (typeof TASK_STAGES)[number];

export const TERMINAL_STAGES: readonly TaskStage[] = ['RELEASED', 'WITHDRAWN', 'CANCELLED'];
/** Stages in which the technician is in the field; at most one task per technician. */
export const FIELD_STAGES: readonly TaskStage[] = [
  'EN_ROUTE',
  'ARRIVED',
  'IN_SERVICE',
  'DOCUMENTING',
  'FINISHED',
];

export type TaskEndReason =
  'RELEASED_BY_TECHNICIAN' | 'REASSIGNED' | 'UNASSIGNED' | 'RESOURCE_INELIGIBLE' | 'JOB_CANCELLED';

export const EVIDENCE_PHASES = ['BEFORE', 'AFTER'] as const;
export type EvidencePhase = (typeof EVIDENCE_PHASES)[number];
export const EVIDENCE_SLOTS = [0, 1] as const;
export type EvidenceSlot = (typeof EVIDENCE_SLOTS)[number];

export const NOTE_KINDS = ['HELP', 'CASH_ISSUE', 'PAYMENT_FOLLOW_UP'] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

export const CHECKLIST_VERSION = 'washgo.checklist.v1' as const;

export interface ChecklistItem {
  readonly code: string;
  readonly required: boolean;
  readonly checked: boolean;
}

/**
 * Checklist snapshot taken when the task is created. The four items are the
 * approved reference's checks (body/glass, rims/tires, cabin, final quality);
 * the per-service rule is an owner policy still pending, so every item is
 * required. The reference's hard-coded exclusion for one seed booking is a
 * demo rule and is not reproduced.
 */
export const CHECKLIST_V1: readonly ChecklistItem[] = Object.freeze([
  { code: 'exterior', required: true, checked: false },
  { code: 'wheels', required: true, checked: false },
  { code: 'interior', required: true, checked: false },
  { code: 'quality', required: true, checked: false },
]);

export type CollectionOutcome = 'CASH_COLLECTED' | 'CASH_NOT_COLLECTED' | 'NOT_CASH';

export type CollectionInput =
  | { readonly outcome: 'CASH_COLLECTED'; readonly amount: Money }
  | { readonly outcome: 'CASH_NOT_COLLECTED'; readonly reason: string }
  | { readonly outcome: 'NOT_CASH' };

/** The technician's handoff declaration; Billing decides what was received. */
export interface CollectionDeclaration {
  readonly outcome: CollectionOutcome;
  readonly currency: Currency | null;
  readonly amountMinor: bigint | null;
  readonly reason: string | null;
  readonly declaredAt: Date;
  readonly lateAmountMinor: bigint | null;
  readonly lateDeclaredAt: Date | null;
}

export interface TaskState {
  readonly id: string;
  readonly assignmentId: string;
  readonly offerId: string;
  readonly bookingId: string;
  readonly resourceId: string;
  readonly technicianSubject: string;
  readonly stage: TaskStage;
  readonly checklistVersion: typeof CHECKLIST_VERSION;
  readonly checklist: readonly ChecklistItem[];
  readonly conditionNote: string | null;
  readonly acceptedAt: Date;
  readonly departedAt: Date | null;
  readonly arrivedAt: Date | null;
  readonly arrivalMethod: 'MANUAL_CONFIRMATION' | null;
  readonly startedAt: Date | null;
  readonly documentedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly closedAt: Date | null;
  readonly endedAt: Date | null;
  readonly endReason: TaskEndReason | null;
  readonly releaseReason: string | null;
  readonly attentionReason: 'RESOURCE_INELIGIBLE' | null;
  readonly collection: CollectionDeclaration | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface EvidenceLink {
  readonly id: string;
  readonly taskId: string;
  readonly phase: EvidencePhase;
  readonly slot: EvidenceSlot;
  readonly mediaObjectId: string;
  readonly attachedAt: Date;
  readonly removedAt: Date | null;
}

export function isTerminal(stage: TaskStage): boolean {
  return TERMINAL_STAGES.includes(stage);
}

export function isOpen(task: TaskState): boolean {
  return !isTerminal(task.stage) && task.stage !== 'CLOSED';
}

export function createTask(input: {
  readonly id: string;
  readonly assignmentId: string;
  readonly offerId: string;
  readonly bookingId: string;
  readonly resourceId: string;
  readonly technicianSubject: string;
  readonly now: Date;
}): TaskState {
  return {
    ...input,
    stage: 'ACCEPTED',
    checklistVersion: CHECKLIST_VERSION,
    checklist: CHECKLIST_V1.map((item) => ({ ...item })),
    conditionNote: null,
    acceptedAt: input.now,
    departedAt: null,
    arrivedAt: null,
    arrivalMethod: null,
    startedAt: null,
    documentedAt: null,
    finishedAt: null,
    closedAt: null,
    endedAt: null,
    endReason: null,
    releaseReason: null,
    attentionReason: null,
    collection: null,
    version: 1,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function assertTaskRevision(task: TaskState, expectedRevision: number): void {
  if (task.version !== expectedRevision) {
    throw new DispatchError('REVISION_CONFLICT', 'The task changed; refetch it.');
  }
}

function bump(task: TaskState, change: Partial<TaskState>, now: Date): TaskState {
  return { ...task, ...change, version: task.version + 1, updatedAt: now };
}

function requireStage(task: TaskState, ...stages: TaskStage[]): void {
  if (isTerminal(task.stage)) {
    throw new DispatchError('TASK_CLOSED', 'The task is no longer yours to work on.');
  }
  if (!stages.includes(task.stage)) {
    throw new DispatchError('TASK_STAGE_INVALID', 'The task is not in a stage that allows this.');
  }
}

export function depart(task: TaskState, now: Date): TaskState {
  requireStage(task, 'ACCEPTED');
  return bump(task, { stage: 'EN_ROUTE', departedAt: now }, now);
}

/** Manual confirmation only: no location is claimed to have been verified. */
export function arrive(task: TaskState, now: Date): TaskState {
  requireStage(task, 'EN_ROUTE');
  return bump(
    task,
    { stage: 'ARRIVED', arrivedAt: now, arrivalMethod: 'MANUAL_CONFIRMATION' },
    now,
  );
}

export function evidencePhaseAllowed(task: TaskState, phase: EvidencePhase): void {
  requireStage(task, phase === 'BEFORE' ? 'ARRIVED' : 'DOCUMENTING');
}

/** Evidence links change the task revision so every client sees a newer view. */
export function touch(task: TaskState, now: Date): TaskState {
  return bump(task, {}, now);
}

export function hasCurrentEvidence(
  links: readonly EvidenceLink[],
  taskId: string,
  phase: EvidencePhase,
): boolean {
  return links.some(
    (link) => link.taskId === taskId && link.phase === phase && link.removedAt === null,
  );
}

export function startService(
  task: TaskState,
  links: readonly EvidenceLink[],
  now: Date,
): TaskState {
  requireStage(task, 'ARRIVED');
  if (!hasCurrentEvidence(links, task.id, 'BEFORE')) {
    throw new DispatchError('EVIDENCE_REQUIRED', 'At least one before photo is required.');
  }
  return bump(task, { stage: 'IN_SERVICE', startedAt: now }, now);
}

export function setCheck(task: TaskState, code: string, checked: boolean, now: Date): TaskState {
  requireStage(task, 'IN_SERVICE');
  const index = task.checklist.findIndex((item) => item.code === code);
  if (index < 0) throw new DispatchError('CHECK_NOT_FOUND', 'Unknown checklist item.');
  const current = task.checklist[index];
  if (!current || current.checked === checked) return task;
  const checklist = task.checklist.map((item, i) => (i === index ? { ...item, checked } : item));
  return bump(task, { checklist }, now);
}

export function checklistComplete(task: TaskState): boolean {
  return task.checklist.every((item) => !item.required || item.checked);
}

export function document(task: TaskState, now: Date): TaskState {
  requireStage(task, 'IN_SERVICE');
  if (!checklistComplete(task)) {
    throw new DispatchError('CHECKLIST_INCOMPLETE', 'Every required check must be completed.');
  }
  return bump(task, { stage: 'DOCUMENTING', documentedAt: now }, now);
}

export function finish(task: TaskState, links: readonly EvidenceLink[], now: Date): TaskState {
  requireStage(task, 'DOCUMENTING');
  if (!hasCurrentEvidence(links, task.id, 'AFTER')) {
    throw new DispatchError('EVIDENCE_REQUIRED', 'At least one after photo is required.');
  }
  return bump(task, { stage: 'FINISHED', finishedAt: now }, now);
}

const NOTE_MIN = 3;
const NOTE_MAX = 500;
const CONDITION_MAX = 800;

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return (code <= 0x1f && code !== 0x0a && code !== 0x0d) || code === 0x7f;
  });
}

/** NFC, trimmed, bounded, printable (line breaks allowed). */
export function cleanText(value: unknown, field: string, min: number, max: number): string {
  if (typeof value !== 'string') throw invalid(`${field} must be a string.`);
  const text = value.normalize('NFC').trim();
  const length = [...text].length;
  if (length < min || length > max || hasControlCharacter(text)) {
    throw invalid(`${field} must contain ${min}-${max} printable characters.`);
  }
  return text;
}

export function noteText(value: unknown, field = 'text'): string {
  return cleanText(value, field, NOTE_MIN, NOTE_MAX);
}

export function setConditionNote(task: TaskState, raw: unknown, now: Date): TaskState {
  requireStage(task, 'ARRIVED', 'IN_SERVICE');
  const text =
    typeof raw === 'string' && raw.trim() === '' ? null : cleanText(raw, 'text', 1, CONDITION_MAX);
  if (text === task.conditionNote) return task;
  return bump(task, { conditionNote: text }, now);
}

export function closeTask(task: TaskState, collection: CollectionInput, now: Date): TaskState {
  requireStage(task, 'FINISHED');
  const declaration: CollectionDeclaration =
    collection.outcome === 'CASH_COLLECTED'
      ? {
          outcome: 'CASH_COLLECTED',
          currency: collection.amount.currency,
          amountMinor: collection.amount.amountMinor,
          reason: null,
          declaredAt: now,
          lateAmountMinor: null,
          lateDeclaredAt: null,
        }
      : collection.outcome === 'CASH_NOT_COLLECTED'
        ? {
            outcome: 'CASH_NOT_COLLECTED',
            currency: null,
            amountMinor: null,
            reason: noteText(collection.reason, 'collection.reason'),
            declaredAt: now,
            lateAmountMinor: null,
            lateDeclaredAt: null,
          }
        : {
            outcome: 'NOT_CASH',
            currency: null,
            amountMinor: null,
            reason: null,
            declaredAt: now,
            lateAmountMinor: null,
            lateDeclaredAt: null,
          };
  return bump(task, { stage: 'CLOSED', closedAt: now, collection: declaration }, now);
}

/** A cash declaration after a close that recorded no collection. Never reopens work. */
export function declareLateCash(task: TaskState, amount: Money, now: Date): TaskState {
  const collection = task.collection;
  if (task.stage !== 'CLOSED' || collection === null) {
    throw new DispatchError('TASK_STAGE_INVALID', 'Late collection needs a closed task.');
  }
  if (collection.outcome !== 'CASH_NOT_COLLECTED' || collection.lateAmountMinor !== null) {
    throw new DispatchError('COLLECTION_NOT_OPEN', 'No cash collection is outstanding.');
  }
  return bump(
    task,
    {
      collection: {
        ...collection,
        currency: amount.currency,
        lateAmountMinor: amount.amountMinor,
        lateDeclaredAt: now,
      },
    },
    now,
  );
}

/** Technician returns the job before leaving; operations re-offer it. */
export function release(task: TaskState, reason: unknown, now: Date): TaskState {
  requireStage(task, 'ACCEPTED');
  return bump(
    task,
    {
      stage: 'RELEASED',
      endedAt: now,
      endReason: 'RELEASED_BY_TECHNICIAN',
      releaseReason: noteText(reason, 'reason'),
    },
    now,
  );
}

/** Operations or the system took the job away. A CLOSED task is never withdrawn. */
export function withdrawTask(
  task: TaskState,
  reason: Exclude<TaskEndReason, 'RELEASED_BY_TECHNICIAN' | 'JOB_CANCELLED'>,
  now: Date,
): TaskState {
  if (!isOpen(task)) return task;
  return bump(task, { stage: 'WITHDRAWN', endedAt: now, endReason: reason }, now);
}

export function cancelTask(task: TaskState, now: Date): TaskState {
  if (!isOpen(task)) return task;
  return bump(task, { stage: 'CANCELLED', endedAt: now, endReason: 'JOB_CANCELLED' }, now);
}

/** Eligibility was lost while the technician is already working: operations decide. */
export function flagIneligible(task: TaskState, now: Date): TaskState {
  if (!isOpen(task) || task.attentionReason === 'RESOURCE_INELIGIBLE') return task;
  return bump(task, { attentionReason: 'RESOURCE_INELIGIBLE' }, now);
}

export function assertNoteAllowed(task: TaskState, kind: NoteKind): void {
  if (isTerminal(task.stage)) {
    throw new DispatchError('TASK_CLOSED', 'The task is no longer yours to work on.');
  }
  if (task.stage === 'CLOSED' && kind === 'HELP') {
    throw new DispatchError('TASK_STAGE_INVALID', 'Help requests are for unfinished tasks.');
  }
}

export function isNoteKind(value: unknown): value is NoteKind {
  return typeof value === 'string' && NOTE_KINDS.some((kind) => kind === value);
}

export function isEvidencePhase(value: unknown): value is EvidencePhase {
  return typeof value === 'string' && EVIDENCE_PHASES.some((phase) => phase === value);
}

export function evidenceSlot(value: unknown): EvidenceSlot {
  if (value === 0 || value === '0') return 0;
  if (value === 1 || value === '1') return 1;
  throw invalid('slot must be 0 or 1.');
}

/**
 * Work state as the cash and tracking consumers need it (Billing's
 * `WorkEvidence.workState`, P03-B1): the service is COMPLETED once the
 * technician finished it (handoff or closed); it never regresses.
 */
export type WorkState = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export function workStateOf(task: TaskState | null): WorkState {
  if (task === null) return 'NOT_STARTED';
  switch (task.stage) {
    case 'ACCEPTED':
    case 'RELEASED':
    case 'WITHDRAWN':
      return 'NOT_STARTED';
    case 'EN_ROUTE':
    case 'ARRIVED':
    case 'IN_SERVICE':
    case 'DOCUMENTING':
      return 'IN_PROGRESS';
    case 'FINISHED':
    case 'CLOSED':
      return 'COMPLETED';
    case 'CANCELLED':
      return 'CANCELLED';
  }
}
