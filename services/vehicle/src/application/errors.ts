/**
 * Application refusals, already in the shared vehicle.v1 error vocabulary
 * (packages/contracts common/errors). Transport turns each one into the
 * contract error envelope; the application layer knows nothing about HTTP.
 */
export type ApplicationErrorCode =
  | 'REQUEST_INVALID'
  | 'AUTH_REQUIRED'
  | 'AUTH_FORBIDDEN'
  | 'DEPENDENCY_UNAVAILABLE'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'REVISION_REQUIRED'
  | 'REVISION_CONFLICT'
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'IDEMPOTENCY_CONFLICT';

/** Owner-allowlisted refinements (vehicle.v1 reasons). */
export type VehicleReason = 'VEHICLE_NOT_FOUND' | 'VEHICLE_ARCHIVED' | 'VEHICLE_LIMIT_REACHED';

export class ApplicationError extends Error {
  constructor(
    readonly code: ApplicationErrorCode,
    readonly reason: VehicleReason | null = null,
    /** Pointer to the offending header, query or path part, for REQUEST_INVALID. */
    readonly field: string | null = null,
  ) {
    super(code);
    this.name = 'ApplicationError';
  }
}