/** Application refusals; transport maps each code to one status. */
export type ApplicationErrorCode = 'ZONE_NOT_FOUND' | 'REVISION_CONFLICT' | 'RATE_LIMITED';

export class ApplicationError extends Error {
  constructor(readonly code: ApplicationErrorCode) {
    super(code);
    this.name = 'ApplicationError';
  }
}
