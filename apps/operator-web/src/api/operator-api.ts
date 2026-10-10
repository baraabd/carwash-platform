import { call, type Request, type Result } from './client';
import {
  parseAvailability,
  parseBooking,
  parseJobs,
  parseObject,
  parseOffer,
  parseReadUrl,
  parseReserved,
  parseSession,
  parseTask,
} from './parse';
import type {
  AvailabilityView,
  BookingTechView,
  CheckCode,
  EvidencePhase,
  JobsView,
  Money,
  NoteKind,
  ObjectView,
  OfferView,
  PresignedRead,
  ReservedObject,
  SessionView,
  TaskView,
} from './types';

/** The C5 browser routes (docs/production/C/P03-C-interfaces.md). */

const enc = encodeURIComponent;
const task = (taskId: string, rest = ''): string => `/api/operator/tasks/${enc(taskId)}${rest}`;

export const readSession = (): Promise<Result<SessionView>> =>
  call({ method: 'GET', path: '/api/operator/session', parse: parseSession });
export const readAvailability = (): Promise<Result<AvailabilityView>> =>
  call({ method: 'GET', path: '/api/operator/availability', parse: parseAvailability });
export const readJobs = (): Promise<Result<JobsView>> =>
  call({ method: 'GET', path: '/api/operator/jobs', parse: parseJobs });
export const readTask = (taskId: string): Promise<Result<TaskView>> =>
  call({ method: 'GET', path: task(taskId), parse: parseTask });
export const readBooking = (bookingId: string): Promise<Result<BookingTechView>> =>
  call({ method: 'GET', path: `/api/operator/bookings/${enc(bookingId)}`, parse: parseBooking });

/** A mutation is fully described by its request so a retry can resend it byte-for-byte. */
export interface MutationRequest {
  readonly method: 'POST' | 'PUT' | 'DELETE';
  readonly path: string;
  readonly body: Readonly<Record<string, unknown>>;
}

export const sendMutation = (
  request: MutationRequest,
  idempotencyKey: string,
): Promise<Result<unknown>> =>
  call({ ...request, idempotencyKey, parse: null } satisfies Request<unknown>);

export const putAvailability = (
  status: AvailabilityView['status'],
  expectedRevision: number,
  idempotencyKey: string,
): Promise<Result<AvailabilityView>> =>
  call({
    method: 'PUT',
    path: '/api/operator/availability',
    body: { status, expectedRevision },
    idempotencyKey,
    parse: parseAvailability,
  });

export const acceptOffer = (offerId: string, idempotencyKey: string): Promise<Result<OfferView>> =>
  call({
    method: 'POST',
    path: `/api/operator/offers/${enc(offerId)}/accept`,
    body: {},
    idempotencyKey,
    parse: (v) => parseOffer(v),
  });

export const M = {
  decline: (offerId: string, note: string): MutationRequest => ({
    method: 'POST',
    path: `/api/operator/offers/${enc(offerId)}/decline`,
    body: { reason: 'OTHER', note },
  }),
  depart: (t: TaskView): MutationRequest => ({
    method: 'POST',
    path: task(t.taskId, '/depart'),
    body: { expectedRevision: t.revision },
  }),
  arrive: (t: TaskView): MutationRequest => ({
    method: 'POST',
    path: task(t.taskId, '/arrive'),
    body: { expectedRevision: t.revision },
  }),
  attach: (
    t: TaskView,
    phase: EvidencePhase,
    slot: number,
    mediaObjectId: string,
  ): MutationRequest => ({
    method: 'PUT',
    path: task(t.taskId, `/evidence/${phase}/${slot}`),
    body: { expectedRevision: t.revision, mediaObjectId },
  }),
  detach: (t: TaskView, phase: EvidencePhase, slot: number): MutationRequest => ({
    method: 'DELETE',
    path: task(t.taskId, `/evidence/${phase}/${slot}`),
    body: { expectedRevision: t.revision },
  }),
  conditionNote: (t: TaskView, text: string): MutationRequest => ({
    method: 'PUT',
    path: task(t.taskId, '/condition-note'),
    body: { expectedRevision: t.revision, text },
  }),
  start: (t: TaskView): MutationRequest => ({
    method: 'POST',
    path: task(t.taskId, '/start'),
    body: { expectedRevision: t.revision },
  }),
  check: (t: TaskView, code: CheckCode, checked: boolean): MutationRequest => ({
    method: 'PUT',
    path: task(t.taskId, `/checklist/${code}`),
    body: { expectedRevision: t.revision, checked },
  }),
  document: (t: TaskView): MutationRequest => ({
    method: 'POST',
    path: task(t.taskId, '/document'),
    body: { expectedRevision: t.revision },
  }),
  finish: (t: TaskView): MutationRequest => ({
    method: 'POST',
    path: task(t.taskId, '/finish'),
    body: { expectedRevision: t.revision },
  }),
  closeCollected: (t: TaskView, amount: Money): MutationRequest => ({
    method: 'POST',
    path: task(t.taskId, '/close'),
    body: { expectedRevision: t.revision, collection: { outcome: 'CASH_COLLECTED', amount } },
  }),
  closeNotCollected: (t: TaskView, reason: string): MutationRequest => ({
    method: 'POST',
    path: task(t.taskId, '/close'),
    body: { expectedRevision: t.revision, collection: { outcome: 'CASH_NOT_COLLECTED', reason } },
  }),
  closeNotCash: (t: TaskView): MutationRequest => ({
    method: 'POST',
    path: task(t.taskId, '/close'),
    body: { expectedRevision: t.revision, collection: { outcome: 'NOT_CASH' } },
  }),
  lateCash: (t: TaskView, amount: Money): MutationRequest => ({
    method: 'POST',
    path: task(t.taskId, '/cash-collection'),
    body: { expectedRevision: t.revision, amount },
  }),
  release: (t: TaskView, reason: string): MutationRequest => ({
    method: 'POST',
    path: task(t.taskId, '/release'),
    body: { expectedRevision: t.revision, reason },
  }),
  note: (t: TaskView, kind: NoteKind, text: string): MutationRequest => ({
    method: 'POST',
    path: task(t.taskId, '/notes'),
    body: { kind, text },
  }),
};

export const reserveUpload = (
  input: { readonly byteLength: number; readonly sha256: string },
  idempotencyKey: string,
): Promise<Result<ReservedObject>> =>
  call({
    method: 'POST',
    path: '/api/operator/media/uploads',
    body: {
      purpose: 'WORK_EVIDENCE',
      contentType: 'image/jpeg',
      byteLength: input.byteLength,
      sha256: input.sha256,
    },
    idempotencyKey,
    parse: parseReserved,
  });

export const freshUploadUrl = (objectId: string): Promise<Result<ReservedObject>> =>
  call({
    method: 'POST',
    path: `/api/operator/media/objects/${enc(objectId)}/upload-url`,
    body: {},
    parse: parseReserved,
  });

export const finalizeUpload = (
  objectId: string,
  idempotencyKey: string,
): Promise<Result<ObjectView>> =>
  call({
    method: 'POST',
    path: `/api/operator/media/objects/${enc(objectId)}/finalize`,
    body: {},
    idempotencyKey,
    parse: parseObject,
  });

export const readUrl = (objectId: string): Promise<Result<PresignedRead>> =>
  call({
    method: 'POST',
    path: `/api/operator/media/objects/${enc(objectId)}/read-url`,
    body: {},
    parse: parseReadUrl,
  });
