/**
 * Stable Workforce rule violations. Framework-free: HTTP maps these codes.
 * Messages are diagnostic only and never include profile data.
 */
export type WorkforceErrorCode =
  | 'INVALID_INPUT'
  | 'FORBIDDEN'
  | 'OPERATOR_NOT_FOUND'
  | 'OPERATOR_EXISTS'
  | 'CASE_NOT_FOUND'
  | 'CASE_NOT_PENDING'
  | 'PENDING_CASE_EXISTS'
  | 'SELF_REVIEW_FORBIDDEN'
  | 'SKILL_EXISTS'
  | 'SKILL_NOT_FOUND'
  | 'SHIFT_NOT_FOUND'
  | 'SHIFT_NOT_ACTIVE'
  | 'SHIFT_OVERLAPS'
  | 'VERSION_CONFLICT'
  | 'IDEMPOTENCY_KEY_REUSED';

export class WorkforceError extends Error {
  constructor(
    readonly code: WorkforceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'WorkforceError';
  }
}

export function invalid(message = 'Invalid workforce request.'): never {
  throw new WorkforceError('INVALID_INPUT', message);
}
