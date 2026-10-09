/**
 * Vehicle domain refusals.
 *
 * `field` is a JSON-path-like pointer into the request body ("$.plate.text") and
 * `issue` uses the contract parser's vocabulary (MISSING_FIELD, INVALID_LENGTH,
 * ...). Messages never echo the refused value, so a plate cannot leak into a
 * log through an error.
 */
export type ValidationIssue =
  | 'EXPECTED_OBJECT'
  | 'EXPECTED_STRING'
  | 'MISSING_FIELD'
  | 'UNEXPECTED_FIELD'
  | 'INVALID_ENUM'
  | 'INVALID_LENGTH'
  | 'INVALID_CHARACTERS'
  | 'INVALID_FORMAT'
  | 'INVALID_UUID'
  | 'INVALID_INTEGER';

export class VehicleValidationError extends Error {
  constructor(
    readonly field: string,
    readonly issue: ValidationIssue,
  ) {
    super(`${issue} at ${field}`);
    this.name = 'VehicleValidationError';
  }
}

/** Business-rule refusals; the codes are vehicle.v1 owner reasons. */
export type VehicleRule = 'VEHICLE_LIMIT_REACHED' | 'VEHICLE_ARCHIVED';

export class VehicleRuleError extends Error {
  constructor(readonly reason: VehicleRule) {
    super(reason);
    this.name = 'VehicleRuleError';
  }
}
