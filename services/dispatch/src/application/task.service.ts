import { createHash } from 'node:crypto';
import {
  DispatchError,
  arrive,
  assertNoteAllowed,
  assertTaskRevision,
  closeTask,
  declareLateCash,
  depart,
  document,
  evidencePhaseAllowed,
  finish,
  isTerminal,
  markUnassigned,
  noteText,
  release,
  setCheck,
  setConditionNote,
  startService,
  touch,
  uuid,
  withdraw,
  type AssignmentState,
  type CollectionInput,
  type EvidenceLink,
  type EvidencePhase,
  type EvidenceSlot,
  type Money,
  type NoteKind,
  type OfferState,
  type TaskState,
  type WorkState,
  workStateOf,
} from '../domain';
import type {
  Clock,
  DispatchReadModel,
  DispatchTransaction,
  DispatchUnitOfWork,
  EvidenceObjects,
  IdGenerator,
  RequestMeta,
  TaskHistoryEntry,
  TaskNote,
} from '../ports';
import { WORK_EXECUTE, WORK_READ, requirePermission } from './authorization';
import { Effects } from './effects';
import { assertIdempotencyKey, revision, runIdempotent } from './idempotency';

export interface TaskDetail {
  readonly task: TaskState;
  /** Every link ever made, current ones have `removedAt === null`. */
  readonly evidence: readonly EvidenceLink[];
  readonly notes: readonly TaskNote[];
  readonly history: readonly TaskHistoryEntry[];
}

export interface WorkView {
  readonly assignment: AssignmentState;
  readonly task: TaskState | null;
  readonly workState: WorkState;
}

export interface TechnicianJobs {
  readonly offers: ReadonlyArray<{
    readonly offer: OfferState;
    readonly assignment: AssignmentState;
  }>;
  readonly tasks: readonly TaskState[];
}

export interface TaskCommandResult {
  readonly value: TaskDetail;
  readonly replayed: boolean;
}

/** Closed and ended tasks stay visible to their technician this long. */
export const RECENT_TASK_WINDOW_MS = 7 * 24 * 3_600_000;

const EVIDENCE_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp'];

interface Context {
  readonly tx: DispatchTransaction;
  readonly task: TaskState;
  readonly assignment: AssignmentState;
  readonly now: Date;
}

/**
 * Deterministic UUID (version 8, RFC 9562) of a name: the evidence link id
 * and the Media claim reference for (task, object), so a retried attach
 * re-uses the same claim instead of creating another one.
 */
export function nameUuid(name: string): string {
  const hex = createHash('sha256').update(name, 'utf8').digest('hex');
  const variant = ((parseInt(hex.charAt(16), 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Technician task execution. Every command:
 *   1. runs under (technician, operation, task, Idempotency-Key) idempotency,
 *   2. locks the task's assignment, then the task (documented lock order),
 *   3. refuses a task that is not the technician's (404, no probing) or that
 *      ended (409 TASK_CLOSED: reassigned, released, ineligible, cancelled),
 *   4. checks the client's expectedRevision (412),
 *   5. applies the pure stage rule and writes history, outbox and audit in
 *      the same transaction.
 * The database repeats the gates (trigger + constraints), so a defect here
 * cannot persist an impossible task.
 */
export class TaskService {
  private readonly effects: Effects;

  constructor(
    private readonly uow: DispatchUnitOfWork,
    private readonly read: DispatchReadModel,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly media: EvidenceObjects | null = null,
  ) {
    this.effects = new Effects(ids);
  }

  // ---------------------------------------------------------------- queries

  async listMyJobs(meta: RequestMeta): Promise<TechnicianJobs> {
    const user = requirePermission(meta.actor, WORK_READ);
    const now = this.clock.now();
    const offers = (await this.read.listTechnicianOffers(user.subject, now)).filter(
      (entry) => entry.offer.status === 'OFFERED',
    );
    const tasks = await this.read.listTechnicianTasks(
      user.subject,
      new Date(now.getTime() - RECENT_TASK_WINDOW_MS),
    );
    return { offers, tasks };
  }

  /**
   * The caller's own work on one booking (Billing's WorkAuthority reads this
   * with the technician's credential before accepting a cash receipt). Only the
   * technician currently assigned, or whose task closed the job, gets an answer;
   * everyone else gets 404 so bookings cannot be probed.
   */
  async workForBooking(meta: RequestMeta, bookingId: string): Promise<WorkView> {
    const user = requirePermission(meta.actor, WORK_READ);
    const assignment = await this.read.findAssignmentByBooking(uuid(bookingId, 'bookingId'));
    if (!assignment) throw taskNotFound();
    const task = await this.read.findLiveTask(assignment.id);
    const current =
      assignment.status === 'ASSIGNED' && assignment.technicianSubject === user.subject;
    if (!current || (task !== null && task.technicianSubject !== user.subject)) {
      throw taskNotFound();
    }
    return { assignment, task, workState: workStateOf(task) };
  }

  async getMyTask(meta: RequestMeta, taskId: string): Promise<TaskDetail> {
    const user = requirePermission(meta.actor, WORK_READ);
    const task = await this.read.findTask(uuid(taskId, 'taskId'));
    if (!task || task.technicianSubject !== user.subject) throw taskNotFound();
    return this.detail(task);
  }

  // --------------------------------------------------------- stage commands

  depart(meta: RequestMeta, taskId: string, expected: number, key: string | undefined) {
    return this.stage(meta, taskId, 'depart', expected, key, 'departed', (c) =>
      depart(c.task, c.now),
    );
  }

  arrive(meta: RequestMeta, taskId: string, expected: number, key: string | undefined) {
    return this.stage(meta, taskId, 'arrive', expected, key, 'arrived', (c) =>
      arrive(c.task, c.now),
    );
  }

  start(meta: RequestMeta, taskId: string, expected: number, key: string | undefined) {
    return this.stage(meta, taskId, 'start', expected, key, 'started', async (c) =>
      startService(c.task, await c.tx.listEvidence(c.task.id), c.now),
    );
  }

  document(meta: RequestMeta, taskId: string, expected: number, key: string | undefined) {
    return this.stage(meta, taskId, 'document', expected, key, 'documented', (c) =>
      document(c.task, c.now),
    );
  }

  finish(meta: RequestMeta, taskId: string, expected: number, key: string | undefined) {
    return this.stage(meta, taskId, 'finish', expected, key, 'finished', async (c) =>
      finish(c.task, await c.tx.listEvidence(c.task.id), c.now),
    );
  }

  // ------------------------------------------------------ in-stage commands

  setCheck(
    meta: RequestMeta,
    taskId: string,
    code: string,
    input: { readonly expectedRevision: number; readonly checked: boolean },
    key: string | undefined,
  ): Promise<TaskCommandResult> {
    const expected = revision(input.expectedRevision);
    if (typeof input.checked !== 'boolean')
      throw new DispatchError('INVALID_INPUT', 'checked must be a boolean.');
    if (!/^[a-z][a-z0-9-]{1,31}$/.test(code))
      throw new DispatchError('CHECK_NOT_FOUND', 'Unknown checklist item.');
    const body = { code, checked: input.checked, expectedRevision: expected };
    return this.mutate(meta, taskId, `check:${code}`, body, expected, key, async (c) => {
      const next = setCheck(c.task, code, input.checked, c.now);
      if (next === c.task) return;
      await c.tx.updateTask(next, c.task.version);
      await c.tx.appendTaskHistory(next.id, input.checked ? 'check.done' : 'check.undone', c.now);
    });
  }

  setConditionNote(
    meta: RequestMeta,
    taskId: string,
    input: { readonly expectedRevision: number; readonly text: unknown },
    key: string | undefined,
  ): Promise<TaskCommandResult> {
    const expected = revision(input.expectedRevision);
    const body = { text: input.text, expectedRevision: expected };
    return this.mutate(meta, taskId, 'condition-note', body, expected, key, async (c) => {
      const next = setConditionNote(c.task, input.text, c.now);
      if (next === c.task) return;
      await c.tx.updateTask(next, c.task.version);
      await c.tx.appendTaskHistory(next.id, 'condition-note.saved', c.now);
    });
  }

  /**
   * Links a Media object to a photo slot. Media is read and the object
   * claimed BEFORE the transaction (no network while holding row locks). The
   * claim is idempotent per (object, claimRef); if the local commit then
   * fails, the object stays claimed and is merely retained longer, which is
   * the safe direction for evidence (documented saga, no compensation needed).
   */
  async attachEvidence(
    meta: RequestMeta,
    taskId: string,
    phase: EvidencePhase,
    slot: EvidenceSlot,
    input: { readonly expectedRevision: number; readonly mediaObjectId: string },
    key: string | undefined,
  ): Promise<TaskCommandResult> {
    const user = requirePermission(meta.actor, WORK_EXECUTE);
    const id = uuid(taskId, 'taskId');
    const expected = revision(input.expectedRevision);
    const objectId = uuid(input.mediaObjectId, 'mediaObjectId');
    assertIdempotencyKey(key);
    const seen = await this.read.findTask(id);
    if (!seen || seen.technicianSubject !== user.subject) throw taskNotFound();
    if (isTerminal(seen.stage)) throw taskClosed();
    evidencePhaseAllowed(seen, phase);
    if (this.media === null) {
      throw new DispatchError('EVIDENCE_UNAVAILABLE', 'Evidence storage is unavailable.');
    }
    const object = await this.media.inspect(objectId, meta.correlationId);
    if (
      !object ||
      object.ownerSubjectId !== user.subject ||
      object.status !== 'AVAILABLE' ||
      object.purpose !== 'WORK_EVIDENCE' ||
      !EVIDENCE_TYPES.includes(object.contentType)
    ) {
      throw new DispatchError('EVIDENCE_INVALID', 'The photo is not usable evidence.');
    }
    const linkId = nameUuid(`dispatch.task-evidence:${id}:${objectId}`);
    await this.media.claim(objectId, linkId, meta.correlationId);
    const body = { phase, slot, mediaObjectId: objectId, expectedRevision: expected };
    return this.mutate(meta, id, `evidence:${phase}:${slot}`, body, expected, key, async (c) => {
      evidencePhaseAllowed(c.task, phase);
      const links = await c.tx.listEvidence(c.task.id);
      const current = links.find(
        (link) => link.phase === phase && link.slot === slot && link.removedAt === null,
      );
      if (current) await c.tx.markEvidenceRemoved(current.id, c.now);
      await c.tx.insertEvidence({
        id: linkId,
        taskId: c.task.id,
        phase,
        slot,
        mediaObjectId: objectId,
        attachedAt: c.now,
        removedAt: null,
      });
      const next = touch(c.task, c.now);
      await c.tx.updateTask(next, c.task.version);
      await c.tx.appendTaskHistory(next.id, `evidence.${phase.toLowerCase()}.attached`, c.now);
      await this.effects.audit(
        c.tx,
        meta,
        'task.evidence-attached',
        { type: 'TASK', id: next.id },
        {
          phase,
          slot,
          mediaObjectId: objectId,
          replacedLinkId: current?.id ?? null,
        },
      );
    });
  }

  removeEvidence(
    meta: RequestMeta,
    taskId: string,
    phase: EvidencePhase,
    slot: EvidenceSlot,
    input: { readonly expectedRevision: number },
    key: string | undefined,
  ): Promise<TaskCommandResult> {
    const expected = revision(input.expectedRevision);
    const body = { phase, slot, expectedRevision: expected };
    return this.mutate(
      meta,
      taskId,
      `evidence-remove:${phase}:${slot}`,
      body,
      expected,
      key,
      async (c) => {
        evidencePhaseAllowed(c.task, phase);
        const current = (await c.tx.listEvidence(c.task.id)).find(
          (link) => link.phase === phase && link.slot === slot && link.removedAt === null,
        );
        if (!current) return;
        await c.tx.markEvidenceRemoved(current.id, c.now);
        const next = touch(c.task, c.now);
        await c.tx.updateTask(next, c.task.version);
        await c.tx.appendTaskHistory(next.id, `evidence.${phase.toLowerCase()}.removed`, c.now);
        await this.effects.audit(
          c.tx,
          meta,
          'task.evidence-removed',
          { type: 'TASK', id: next.id },
          {
            phase,
            slot,
            linkId: current.id,
          },
        );
      },
    );
  }

  /** Handoff: explicit delivery plus the technician's collection declaration. */
  close(
    meta: RequestMeta,
    taskId: string,
    input: { readonly expectedRevision: number; readonly collection: CollectionInput },
    key: string | undefined,
  ): Promise<TaskCommandResult> {
    const expected = revision(input.expectedRevision);
    const body = { collection: collectionBody(input.collection), expectedRevision: expected };
    return this.mutate(meta, taskId, 'close', body, expected, key, async (c) => {
      const next = closeTask(c.task, input.collection, c.now);
      await c.tx.updateTask(next, c.task.version);
      await this.effects.taskProgressed(c.tx, next, 'closed', meta);
      await this.effects.cashDeclared(c.tx, next, meta, false);
      await this.effects.audit(
        c.tx,
        meta,
        'task.closed',
        { type: 'TASK', id: next.id },
        {
          outcome: input.collection.outcome,
          currency:
            input.collection.outcome === 'CASH_COLLECTED' ? input.collection.amount.currency : null,
        },
      );
    });
  }

  declareLateCash(
    meta: RequestMeta,
    taskId: string,
    input: { readonly expectedRevision: number; readonly amount: Money },
    key: string | undefined,
  ): Promise<TaskCommandResult> {
    const expected = revision(input.expectedRevision);
    const body = {
      amount: { currency: input.amount.currency, amountMinor: input.amount.amountMinor.toString() },
      expectedRevision: expected,
    };
    return this.mutate(meta, taskId, 'cash-collection', body, expected, key, async (c) => {
      const next = declareLateCash(c.task, input.amount, c.now);
      await c.tx.updateTask(next, c.task.version);
      await c.tx.appendTaskHistory(next.id, 'cash.late-declared', c.now);
      await this.effects.cashDeclared(c.tx, next, meta, true);
      await this.effects.audit(
        c.tx,
        meta,
        'task.cash-late-declared',
        { type: 'TASK', id: next.id },
        {
          currency: input.amount.currency,
        },
      );
    });
  }

  /**
   * The technician returns an accepted job before leaving. The accepted offer
   * is withdrawn and the job goes back to operations (UNASSIGNED) in the same
   * transaction: an authoritative release, not a local note.
   */
  release(
    meta: RequestMeta,
    taskId: string,
    input: { readonly expectedRevision: number; readonly reason: unknown },
    key: string | undefined,
  ): Promise<TaskCommandResult> {
    const expected = revision(input.expectedRevision);
    const reason = noteText(input.reason, 'reason');
    const body = { reason, expectedRevision: expected };
    return this.mutate(
      meta,
      taskId,
      'release',
      body,
      expected,
      key,
      async (c) => {
        const next = release(c.task, reason, c.now);
        const offer = await c.tx.lockOffer(c.task.offerId);
        if (!offer || offer.status !== 'ACCEPTED')
          throw new Error('RELEASE_WITHOUT_ACCEPTED_OFFER');
        await c.tx.updateOffer(withdraw(offer, 'RELEASED_BY_TECHNICIAN', c.now), offer.version);
        await c.tx.updateTask(next, c.task.version);
        const unassigned = markUnassigned(c.assignment, c.now);
        await c.tx.updateAssignment(unassigned, c.assignment.version);
        await this.effects.assignmentChanged(c.tx, unassigned, meta);
        await this.effects.taskProgressed(c.tx, next, 'released', meta);
        await this.effects.audit(
          c.tx,
          meta,
          'task.released',
          { type: 'TASK', id: next.id },
          {
            assignmentId: c.assignment.id,
            offerId: offer.id,
          },
        );
      },
      { lockOffer: true },
    );
  }

  addNote(
    meta: RequestMeta,
    taskId: string,
    input: { readonly kind: NoteKind; readonly text: unknown },
    key: string | undefined,
  ): Promise<TaskCommandResult> {
    const text = noteText(input.text);
    const body = { kind: input.kind, text };
    return this.mutate(
      meta,
      taskId,
      'note',
      body,
      null,
      key,
      async (c) => {
        assertNoteAllowed(c.task, input.kind);
        await c.tx.insertNote({
          id: this.ids.next(),
          taskId: c.task.id,
          kind: input.kind,
          text,
          createdAt: c.now,
        });
        await c.tx.appendTaskHistory(
          c.task.id,
          `note.${input.kind.toLowerCase().replaceAll('_', '-')}`,
          c.now,
        );
        await this.effects.audit(
          c.tx,
          meta,
          'task.note-added',
          { type: 'TASK', id: c.task.id },
          {
            kind: input.kind,
          },
        );
      },
      { allowClosed: true },
    );
  }

  // --------------------------------------------------------------- internals

  private stage(
    meta: RequestMeta,
    taskId: string,
    operation: string,
    expectedRevision: number,
    key: string | undefined,
    action: string,
    rule: (context: Context) => TaskState | Promise<TaskState>,
  ): Promise<TaskCommandResult> {
    const expected = revision(expectedRevision);
    return this.mutate(
      meta,
      taskId,
      operation,
      { expectedRevision: expected },
      expected,
      key,
      async (c) => {
        const next = await rule(c);
        // TECHNICIAN_BUSY from the in-field partial unique index rolls back.
        await c.tx.updateTask(next, c.task.version);
        await this.effects.taskProgressed(c.tx, next, action, meta);
        await this.effects.audit(
          c.tx,
          meta,
          `task.${action}`,
          { type: 'TASK', id: next.id },
          {
            stage: next.stage,
          },
        );
      },
    );
  }

  private async mutate(
    meta: RequestMeta,
    taskId: string,
    operation: string,
    body: unknown,
    expectedRevision: number | null,
    key: string | undefined,
    apply: (context: Context) => Promise<void>,
    options: { readonly lockOffer?: boolean; readonly allowClosed?: boolean } = {},
  ): Promise<TaskCommandResult> {
    const user = requirePermission(meta.actor, WORK_EXECUTE);
    const id = uuid(taskId, 'taskId');
    const now = this.clock.now();
    const { replayed } = await runIdempotent(
      this.uow,
      meta,
      { operation, target: id },
      key,
      body,
      async (tx) => {
        const seen = await tx.readTask(id);
        if (!seen || seen.technicianSubject !== user.subject) throw taskNotFound();
        // Lock order: assignment -> offer -> task.
        const assignment = await tx.lockAssignment(seen.assignmentId);
        if (options.lockOffer) await tx.lockOffer(seen.offerId);
        const task = await tx.lockTask(id);
        if (!assignment || !task) throw taskNotFound();
        if (isTerminal(task.stage)) throw taskClosed();
        if (task.stage === 'CLOSED' && !options.allowClosed && operation !== 'cash-collection') {
          throw new DispatchError('TASK_STAGE_INVALID', 'The task is already closed.');
        }
        // Fence: an open task is always the current assignment's, held by this technician.
        if (
          task.stage !== 'CLOSED' &&
          (assignment.status !== 'ASSIGNED' || assignment.technicianSubject !== user.subject)
        ) {
          throw taskClosed();
        }
        if (expectedRevision !== null) assertTaskRevision(task, expectedRevision);
        await apply({ tx, task, assignment, now });
        return { kind: 'DONE', result: { resultType: 'TASK', resultId: id } };
      },
    );
    const task = await this.read.findTask(id);
    if (!task) throw taskNotFound();
    return { value: await this.detail(task), replayed };
  }

  private async detail(task: TaskState): Promise<TaskDetail> {
    const [evidence, notes, history] = await Promise.all([
      this.read.listTaskEvidence(task.id),
      this.read.listTaskNotes(task.id),
      this.read.listTaskHistory(task.id),
    ]);
    return { task, evidence, notes, history };
  }
}

function collectionBody(collection: CollectionInput): Record<string, string> {
  if (collection.outcome === 'CASH_COLLECTED') {
    return {
      outcome: collection.outcome,
      currency: collection.amount.currency,
      amountMinor: collection.amount.amountMinor.toString(),
    };
  }
  if (collection.outcome === 'CASH_NOT_COLLECTED') {
    return { outcome: collection.outcome, reason: collection.reason };
  }
  return { outcome: collection.outcome };
}

function taskNotFound(): DispatchError {
  return new DispatchError('TASK_NOT_FOUND', 'The task was not found.');
}

function taskClosed(): DispatchError {
  return new DispatchError('TASK_CLOSED', 'The task is no longer yours to work on.');
}
