/**
 * Dispatch domain errors. Codes are stable machine values; the transport maps
 * them onto the shared API error envelope. Messages are diagnostic English and
 * never carry personal data.
 */
export type DispatchErrorCode =
  | 'INVALID_INPUT'
  | 'FORBIDDEN'
  | 'ASSIGNMENT_NOT_FOUND'
  | 'OFFER_NOT_FOUND'
  | 'ASSIGNMENT_CANCELLED'
  | 'ASSIGNMENT_ALREADY_ASSIGNED'
  | 'ASSIGNMENT_NOT_ASSIGNED'
  | 'LIVE_OFFER_EXISTS'
  | 'OFFER_NOT_LIVE'
  | 'OFFER_EXPIRED'
  | 'JOB_WINDOW_PASSED'
  | 'RESOURCE_BUSY'
  | 'REVISION_CONFLICT'
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'RESOURCE_INELIGIBLE'
  | 'ELIGIBILITY_UNAVAILABLE'
  | 'TASK_NOT_FOUND'
  | 'TASK_CLOSED'
  | 'TASK_STAGE_INVALID'
  | 'TECHNICIAN_BUSY'
  | 'CHECK_NOT_FOUND'
  | 'CHECKLIST_INCOMPLETE'
  | 'EVIDENCE_REQUIRED'
  | 'EVIDENCE_INVALID'
  | 'EVIDENCE_IN_USE'
  | 'EVIDENCE_UNAVAILABLE'
  | 'COLLECTION_NOT_OPEN';

export class DispatchError extends Error {
  constructor(
    readonly code: DispatchErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DispatchError';
  }
}

export function invalid(message: string): DispatchError {
  return new DispatchError('INVALID_INPUT', message);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Opaque identifiers are UUIDs, compared and stored in lower case. */
export function uuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw invalid(`${field} must be a UUID.`);
  return value.toLowerCase();
}
