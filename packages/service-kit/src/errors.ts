/** Framework-free public error vocabulary shared by transports. */
export const ERROR_STATUS = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  UNAVAILABLE: 503,
} as const;

export interface ErrorResponseBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly correlationId: string;
    readonly status: number;
  };
}

export interface AppErrorOptions {
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(options: AppErrorOptions) {
    super(options.message);
    this.name = 'AppError';
    if (!Number.isInteger(options.status) || options.status < 400 || options.status > 599) {
      throw new Error('INVALID_APP_ERROR_STATUS');
    }
    this.status = options.status;
    this.code = options.code;
    if (options.details !== undefined) this.details = options.details;
  }
}

export class DomainError extends Error {
  readonly code: string;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(code: string, message: string, details?: Readonly<Record<string, unknown>>) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

const STATUS_MESSAGE: Readonly<
  Record<number, Readonly<{ code: string; message: string }>>
> = {
  400: { code: 'BAD_REQUEST', message: 'The request is invalid.' },
  401: { code: 'UNAUTHORIZED', message: 'Authentication is required.' },
  403: { code: 'FORBIDDEN', message: 'The operation is not allowed.' },
  404: { code: 'NOT_FOUND', message: 'The requested resource was not found.' },
  409: { code: 'CONFLICT', message: 'The request conflicts with current state.' },
  422: { code: 'UNPROCESSABLE_ENTITY', message: 'The request could not be processed.' },
  429: { code: 'RATE_LIMITED', message: 'Too many requests.' },
  503: { code: 'SERVICE_UNAVAILABLE', message: 'The service is temporarily unavailable.' },
};

const FALLBACK = {
  code: 'INTERNAL_ERROR',
  message: 'The request could not be completed.',
} as const;

function frameworkHttpStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;
  const getStatus = (error as { getStatus?: unknown }).getStatus;
  if (typeof getStatus !== 'function') return null;
  try {
    const status: unknown = (getStatus as () => unknown).call(error);
    return typeof status === 'number' &&
      Number.isInteger(status) &&
      status >= 400 &&
      status <= 599
      ? status
      : ERROR_STATUS.INTERNAL;
  } catch {
    return ERROR_STATUS.INTERNAL;
  }
}

export function errorStatusOf(error: unknown): number {
  if (error instanceof AppError) return error.status;
  if (error instanceof DomainError) return ERROR_STATUS.UNPROCESSABLE;
  return frameworkHttpStatus(error) ?? ERROR_STATUS.INTERNAL;
}

export function toErrorResponse(error: unknown, correlationId: string): ErrorResponseBody {
  const status = errorStatusOf(error);
  if (error instanceof AppError || error instanceof DomainError) {
    return { error: { code: error.code, message: error.message, correlationId, status } };
  }
  const mapped = STATUS_MESSAGE[status] ?? FALLBACK;
  return { error: { code: mapped.code, message: mapped.message, correlationId, status } };
}
