/**
 * Application-level failures with a fixed public code. The transport maps the
 * status/code to the shared error envelope; free-text internals never leak.
 */
export type CatalogErrorCode =
  | 'REQUEST_INVALID'
  | 'IDEMPOTENCY_KEY_INVALID'
  | 'AUTH_REQUIRED'
  | 'AUTH_FORBIDDEN'
  | 'AUTH_UNAVAILABLE'
  | 'NOT_FOUND'
  | 'CATALOG_NOT_PUBLISHED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'DEFINITIONS_INVALID';

const STATUS: Readonly<Record<CatalogErrorCode, number>> = {
  REQUEST_INVALID: 400,
  IDEMPOTENCY_KEY_INVALID: 400,
  AUTH_REQUIRED: 401,
  AUTH_FORBIDDEN: 403,
  AUTH_UNAVAILABLE: 503,
  NOT_FOUND: 404,
  CATALOG_NOT_PUBLISHED: 404,
  IDEMPOTENCY_CONFLICT: 409,
  DEFINITIONS_INVALID: 422,
};

export class CatalogApplicationError extends Error {
  readonly status: number;
  constructor(
    readonly code: CatalogErrorCode,
    readonly details?: Readonly<Record<string, string>>,
  ) {
    super(code);
    this.name = 'CatalogApplicationError';
    this.status = STATUS[code];
  }
}
