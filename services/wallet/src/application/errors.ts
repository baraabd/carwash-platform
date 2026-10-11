/** Closed application error codes with their HTTP status. */
const STATUS = {
  REQUEST_INVALID: 400,
  AUTH_REQUIRED: 401,
  AUTH_FORBIDDEN: 403,
  INBOX_CONFLICT: 409,
  AUTH_UNAVAILABLE: 503,
} as const;

export type WalletErrorCode = keyof typeof STATUS;

export class WalletApplicationError extends Error {
  readonly status: number;
  constructor(readonly code: WalletErrorCode) {
    super(code);
    this.name = 'WalletApplicationError';
    this.status = STATUS[code];
  }
}
