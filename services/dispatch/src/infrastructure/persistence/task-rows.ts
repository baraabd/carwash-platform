import {
  CHECKLIST_VERSION,
  TASK_STAGES,
  isCurrency,
  type ChecklistItem,
  type CollectionDeclaration,
  type CollectionOutcome,
  type Eligibility,
  type EvidenceLink,
  type EvidencePhase,
  type EvidenceSlot,
  type NoteKind,
  type ResourceObservation,
  type TaskEndReason,
  type TaskStage,
  type TaskState,
} from '../../domain';
import type { TaskHistoryEntry, TaskNote } from '../../ports';

/**
 * Row <-> state mapping for the task tables. Every value read back is checked
 * against the closed domain vocabulary: a row the domain cannot represent is
 * an integrity failure, never silently coerced.
 */
export interface TaskRow {
  id: string;
  assignment_id: string;
  offer_id: string;
  booking_id: string;
  resource_id: string;
  technician_subject: string;
  stage: string;
  checklist_version: string;
  checklist: unknown;
  condition_note: string | null;
  accepted_at: Date;
  departed_at: Date | null;
  arrived_at: Date | null;
  arrival_method: string | null;
  started_at: Date | null;
  documented_at: Date | null;
  finished_at: Date | null;
  closed_at: Date | null;
  ended_at: Date | null;
  end_reason: string | null;
  release_reason: string | null;
  attention_reason: string | null;
  collection_outcome: string | null;
  collection_currency: string | null;
  collection_amount_minor: string | null;
  collection_reason: string | null;
  collection_declared_at: Date | null;
  late_amount_minor: string | null;
  late_declared_at: Date | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

/** BIGINT columns are cast to text so no amount ever passes through a JS number. */
export const TASK_COLUMNS = `id::text, assignment_id::text, offer_id::text, booking_id::text,
  resource_id::text, technician_subject::text, stage, checklist_version, checklist, condition_note,
  accepted_at, departed_at, arrived_at, arrival_method, started_at, documented_at, finished_at,
  closed_at, ended_at, end_reason, release_reason, attention_reason, collection_outcome,
  collection_currency, collection_amount_minor::text AS collection_amount_minor, collection_reason,
  collection_declared_at, late_amount_minor::text AS late_amount_minor, late_declared_at, version,
  created_at, updated_at`;

export const OPEN_STAGES_SQL = `('ACCEPTED','EN_ROUTE','ARRIVED','IN_SERVICE','DOCUMENTING','FINISHED')`;

function integrity(what: string): Error {
  return new Error(`TASK_ROW_INTEGRITY:${what}`);
}

function stage(value: string): TaskStage {
  const match = TASK_STAGES.find((candidate) => candidate === value);
  if (!match) throw integrity('stage');
  return match;
}

const END_REASONS: readonly TaskEndReason[] = [
  'RELEASED_BY_TECHNICIAN',
  'REASSIGNED',
  'UNASSIGNED',
  'RESOURCE_INELIGIBLE',
  'JOB_CANCELLED',
];

function endReason(value: string | null): TaskEndReason | null {
  if (value === null) return null;
  const match = END_REASONS.find((candidate) => candidate === value);
  if (!match) throw integrity('end_reason');
  return match;
}

function checklist(value: unknown): ChecklistItem[] {
  if (!Array.isArray(value)) throw integrity('checklist');
  return value.map((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) throw integrity('checklist_item');
    const { code, required, checked } = entry as Record<string, unknown>;
    if (typeof code !== 'string' || typeof required !== 'boolean' || typeof checked !== 'boolean') {
      throw integrity('checklist_item');
    }
    return { code, required, checked };
  });
}

const OUTCOMES: readonly CollectionOutcome[] = ['CASH_COLLECTED', 'CASH_NOT_COLLECTED', 'NOT_CASH'];

function collection(row: TaskRow): CollectionDeclaration | null {
  if (row.collection_outcome === null) return null;
  const outcome = OUTCOMES.find((candidate) => candidate === row.collection_outcome);
  if (!outcome || row.collection_declared_at === null) throw integrity('collection');
  const currency = row.collection_currency;
  if (currency !== null && !isCurrency(currency)) throw integrity('collection_currency');
  return {
    outcome,
    currency,
    amountMinor: row.collection_amount_minor === null ? null : BigInt(row.collection_amount_minor),
    reason: row.collection_reason,
    declaredAt: row.collection_declared_at,
    lateAmountMinor: row.late_amount_minor === null ? null : BigInt(row.late_amount_minor),
    lateDeclaredAt: row.late_declared_at,
  };
}

export function toTask(row: TaskRow): TaskState {
  if (row.checklist_version !== CHECKLIST_VERSION) throw integrity('checklist_version');
  if (row.arrival_method !== null && row.arrival_method !== 'MANUAL_CONFIRMATION') {
    throw integrity('arrival_method');
  }
  if (row.attention_reason !== null && row.attention_reason !== 'RESOURCE_INELIGIBLE') {
    throw integrity('attention_reason');
  }
  return {
    id: row.id,
    assignmentId: row.assignment_id,
    offerId: row.offer_id,
    bookingId: row.booking_id,
    resourceId: row.resource_id,
    technicianSubject: row.technician_subject,
    stage: stage(row.stage),
    checklistVersion: CHECKLIST_VERSION,
    checklist: checklist(row.checklist),
    conditionNote: row.condition_note,
    acceptedAt: row.accepted_at,
    departedAt: row.departed_at,
    arrivedAt: row.arrived_at,
    arrivalMethod: row.arrival_method === null ? null : 'MANUAL_CONFIRMATION',
    startedAt: row.started_at,
    documentedAt: row.documented_at,
    finishedAt: row.finished_at,
    closedAt: row.closed_at,
    endedAt: row.ended_at,
    endReason: endReason(row.end_reason),
    releaseReason: row.release_reason,
    attentionReason: row.attention_reason === null ? null : 'RESOURCE_INELIGIBLE',
    collection: collection(row),
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Positional parameters $2.. for INSERT/UPDATE of the mutable+immutable task columns. */
export function taskParameters(task: TaskState): unknown[] {
  const c = task.collection;
  return [
    task.stage,
    JSON.stringify(task.checklist),
    task.conditionNote,
    task.departedAt,
    task.arrivedAt,
    task.arrivalMethod,
    task.startedAt,
    task.documentedAt,
    task.finishedAt,
    task.closedAt,
    task.endedAt,
    task.endReason,
    task.releaseReason,
    task.attentionReason,
    c?.outcome ?? null,
    c?.currency ?? null,
    c?.currency ? 2 : null,
    c?.amountMinor === null || c === null ? null : c.amountMinor.toString(),
    c?.reason ?? null,
    c?.declaredAt ?? null,
    c?.lateAmountMinor === null || c === null ? null : c.lateAmountMinor.toString(),
    c?.lateDeclaredAt ?? null,
    task.version,
    task.updatedAt,
  ];
}

export interface EvidenceRow {
  id: string;
  task_id: string;
  phase: string;
  slot: number;
  media_object_id: string;
  attached_at: Date;
  removed_at: Date | null;
}

export const EVIDENCE_COLUMNS = `id::text, task_id::text, phase, slot, media_object_id::text,
  attached_at, removed_at`;

export function toEvidence(row: EvidenceRow): EvidenceLink {
  const phase: EvidencePhase | null =
    row.phase === 'BEFORE' ? 'BEFORE' : row.phase === 'AFTER' ? 'AFTER' : null;
  const slot: EvidenceSlot | null = row.slot === 0 ? 0 : row.slot === 1 ? 1 : null;
  if (phase === null || slot === null) throw integrity('evidence');
  return {
    id: row.id,
    taskId: row.task_id,
    phase,
    slot,
    mediaObjectId: row.media_object_id,
    attachedAt: row.attached_at,
    removedAt: row.removed_at,
  };
}

export interface NoteRow {
  id: string;
  task_id: string;
  kind: string;
  text: string;
  created_at: Date;
}

const NOTE_KINDS: readonly NoteKind[] = ['HELP', 'CASH_ISSUE', 'PAYMENT_FOLLOW_UP'];

export function toNote(row: NoteRow): TaskNote {
  const kind = NOTE_KINDS.find((candidate) => candidate === row.kind);
  if (!kind) throw integrity('note_kind');
  return { id: row.id, taskId: row.task_id, kind, text: row.text, createdAt: row.created_at };
}

export function toHistory(row: {
  seq: number;
  action: string;
  occurred_at: Date;
}): TaskHistoryEntry {
  return { seq: row.seq, action: row.action, occurredAt: row.occurred_at };
}

export function toObservation(row: {
  resource_id: string;
  eligibility: string;
  revision: number;
}): ResourceObservation {
  const eligibility: Eligibility | null =
    row.eligibility === 'ELIGIBLE'
      ? 'ELIGIBLE'
      : row.eligibility === 'INELIGIBLE'
        ? 'INELIGIBLE'
        : null;
  if (eligibility === null) throw integrity('eligibility');
  return { resourceId: row.resource_id, eligibility, revision: row.revision };
}
