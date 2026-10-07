/**
 * Application refusals. Transport maps each code to one HTTP status; the
 * application layer itself knows nothing about HTTP.
 */
export type ApplicationErrorCode =
  | 'AUTH_REQUIRED'
  | 'AUTH_FORBIDDEN'
  | 'IDENTITY_UNAVAILABLE'
  | 'VEHICLE_NOT_FOUND'
  | 'REVISION_REQUIRED'
  | 'REVISION_CONFLICT'
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'IDEMPOTENCY_KEY_INVALID'
  | 'IDEMPOTENCY_KEY_REUSED';

export class ApplicationError extends Error {
  constructor(readonly code: ApplicationErrorCode) {
    super(code);
    this.name = 'ApplicationError';
  }
}
