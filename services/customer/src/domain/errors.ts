/**
 * Customer domain refusals.
 *
 * Codes are stable wire vocabulary; messages never echo the refused value so a
 * phone number or address line cannot leak into a log through an error.
 */
export type CustomerErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_DISPLAY_NAME'
  | 'INVALID_PHONE'
  | 'INVALID_LOCALE'
  | 'INVALID_ADDRESS_LABEL'
  | 'INVALID_ADDRESS_LINE'
  | 'INVALID_ACCESS_NOTE'
  | 'INVALID_LOCATION'
  | 'INVALID_COORDINATES'
  | 'ADDRESS_LIMIT_REACHED'
  | 'ADDRESS_ARCHIVED';

export class CustomerDomainError extends Error {
  constructor(
    readonly code: CustomerErrorCode,
    readonly field?: string,
  ) {
    super(code);
    this.name = 'CustomerDomainError';
  }
}
