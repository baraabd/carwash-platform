/** Application refusals; transport maps each code to one geo.v1 error envelope. */
export type ApplicationErrorCode =
  | 'ZONE_NOT_FOUND'
  | 'REVISION_CONFLICT'
  | 'RATE_LIMITED'
  | 'AUTH_REQUIRED'
  | 'AUTH_FORBIDDEN'
  | 'IDENTITY_UNAVAILABLE';

export class ApplicationError extends Error {
  constructor(
    readonly code: ApplicationErrorCode,
    /** Milliseconds until a RATE_LIMITED caller may try again. */
    readonly retryAfterMs: number | null = null,
  ) {
    super(code);
    this.name = 'ApplicationError';
  }
}
