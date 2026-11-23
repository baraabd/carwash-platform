/**
 * Application failures expressed in the published API error vocabulary
 * (@carwash/contracts common/errors API_ERROR_CODES subset). The transport
 * renders them as the shared error envelope; internal text never leaks.
 *
 * `reason` is set only for reasons in catalog.v1's allowlist
 * (DEFINITION_RETIRED, DUPLICATE_CODE); every other rule violation is
 * explained through `issues` so the Gateway never drops a reason silently.
 */
export type CatalogErrorCode =
  | 'REQUEST_INVALID'
  | 'VALIDATION_FAILED'
  | 'AUTH_REQUIRED'
  | 'AUTH_FORBIDDEN'
  | 'NOT_FOUND'
  | 'REVISION_CONFLICT'
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'BUSINESS_RULE_VIOLATION'
  | 'DEPENDENCY_UNAVAILABLE';

export const CATALOG_ERROR_STATUS: Readonly<Record<CatalogErrorCode, number>> = {
  REQUEST_INVALID: 400,
  VALIDATION_FAILED: 422,
  AUTH_REQUIRED: 401,
  AUTH_FORBIDDEN: 403,
  NOT_FOUND: 404,
  REVISION_CONFLICT: 412,
  IDEMPOTENCY_KEY_REQUIRED: 428,
  IDEMPOTENCY_CONFLICT: 409,
  BUSINESS_RULE_VIOLATION: 422,
  DEPENDENCY_UNAVAILABLE: 503,
};

/** catalog.v1 `reasons`. */
export const CATALOG_REASONS = ['DEFINITION_RETIRED', 'DUPLICATE_CODE'] as const;
export type CatalogReason = (typeof CATALOG_REASONS)[number];

export interface FieldIssue {
  readonly field: string;
  readonly code: string;
}

export class CatalogApplicationError extends Error {
  readonly status: number;
  readonly reason: CatalogReason | null;
  readonly issues: readonly FieldIssue[];

  constructor(
    readonly code: CatalogErrorCode,
    options: { readonly reason?: CatalogReason; readonly issues?: readonly FieldIssue[] } = {},
  ) {
    super(code);
    this.name = 'CatalogApplicationError';
    this.status = CATALOG_ERROR_STATUS[code];
    this.reason = options.reason ?? null;
    this.issues = options.issues ?? [];
  }
}
