import {
  ContractViolation,
  CORRELATION_ID_HEADER,
  IDEMPOTENCY_HEADER,
  IF_MATCH_HEADER,
  TRACEPARENT_HEADER,
  apiError,
  formatIfMatch,
  parseApiErrorEnvelope,
  parseIdempotencyKey,
  type ApiErrorEnvelope,
} from '@carwash/contracts';

/**
 * Minimal fetch surface so the client runs in browsers, Node 24 and tests
 * without DOM type dependencies.
 */
export interface FetchResponse {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
}
export type FetchLike = (
  url: string,
  init: {
    readonly method: string;
    readonly headers: Record<string, string>;
    readonly body?: string;
    readonly signal: AbortSignal;
    readonly credentials?: 'include' | 'same-origin' | 'omit';
  },
) => Promise<FetchResponse>;

export interface ClientOptions {
  /** Absolute origin + prefix, e.g. https://api.example/api/v1 or http://pricing:3000. */
  readonly baseUrl: string;
  readonly fetch: FetchLike;
  readonly timeoutMs?: number;
  readonly credentials?: 'include' | 'same-origin' | 'omit';
  /** Static headers such as a service bearer; never per-user secrets in logs. */
  readonly headers?: () => Record<string, string>;
}

export interface CallContext {
  readonly correlationId?: string;
  readonly traceparent?: string;
  readonly signal?: AbortSignal;
}

export interface RequestSpec<T> {
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly path: string;
  readonly query?: Readonly<Record<string, string | number | undefined>>;
  readonly body?: unknown;
  /** Required for every mutating business command. Reuse the SAME key when retrying. */
  readonly idempotencyKey?: string;
  readonly expectedRevision?: number;
  readonly parse: (value: unknown) => T;
  /** Read-only POST (route flag `safe`): no key required, a timeout is a plain read failure. */
  readonly safe?: boolean;
}

export type ApiResult<T> =
  | {
      readonly ok: true;
      readonly status: number;
      readonly value: T;
      readonly revision: number | null;
    }
  | { readonly ok: false; readonly status: number; readonly error: ApiErrorEnvelope['error'] };

const LOCAL = { requestId: 'client', correlationId: 'client' } as const;

function localError(
  status: number,
  code: Parameters<typeof apiError>[0],
  message: string,
  correlationId: string | undefined,
): ApiResult<never> {
  return {
    ok: false,
    status,
    error: apiError(code, message, {
      ...LOCAL,
      correlationId: correlationId ?? LOCAL.correlationId,
    }).error,
  };
}

/** Substitute `:name` segments. Values are encoded; unknown or missing params throw. */
export function expandPath(template: string, params: Readonly<Record<string, string>>): string {
  const used = new Set<string>();
  const path = template.replace(/:([A-Za-z]+)/g, (_match, name: string) => {
    const value = params[name];
    if (value === undefined || value.length === 0)
      throw new ContractViolation('MISSING_PATH_PARAM', name);
    used.add(name);
    return encodeURIComponent(value);
  });
  for (const name of Object.keys(params)) {
    if (!used.has(name)) throw new ContractViolation('UNEXPECTED_PATH_PARAM', name);
  }
  return path;
}

export class HttpClient {
  private readonly timeoutMs: number;

  constructor(private readonly options: ClientOptions) {
    this.timeoutMs = options.timeoutMs ?? 3000;
    if (!/^https?:\/\/[^/?#]+(\/[^?#]*)?$/.test(options.baseUrl) || options.baseUrl.endsWith('/')) {
      throw new ContractViolation('INVALID_BASE_URL', 'baseUrl');
    }
  }

  async request<T>(spec: RequestSpec<T>, context: CallContext = {}): Promise<ApiResult<T>> {
    const mutating = spec.method !== 'GET' && spec.safe !== true;
    const headers: Record<string, string> = {
      accept: 'application/json',
      ...this.options.headers?.(),
    };
    if (context.correlationId) headers[CORRELATION_ID_HEADER] = context.correlationId;
    if (context.traceparent) headers[TRACEPARENT_HEADER] = context.traceparent;
    if (mutating) {
      if (spec.idempotencyKey === undefined) {
        return localError(
          428,
          'IDEMPOTENCY_KEY_REQUIRED',
          'idempotency key required',
          context.correlationId,
        );
      }
      headers[IDEMPOTENCY_HEADER] = parseIdempotencyKey(spec.idempotencyKey);
    }
    if (spec.expectedRevision !== undefined)
      headers[IF_MATCH_HEADER] = formatIfMatch(spec.expectedRevision);
    let body: string | undefined;
    if (spec.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(spec.body);
    }

    const controller = new AbortController();
    const abortFromCaller = (): void => controller.abort();
    context.signal?.addEventListener('abort', abortFromCaller, { once: true });
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: FetchResponse;
    let raw: string;
    try {
      response = await this.options.fetch(this.url(spec), {
        method: spec.method,
        headers,
        ...(body === undefined ? {} : { body }),
        signal: controller.signal,
        ...(this.options.credentials ? { credentials: this.options.credentials } : {}),
      });
      raw = await response.text();
    } catch {
      // A lost response to a mutation is NOT a failure and NOT a success.
      return mutating
        ? localError(
            504,
            'OUTCOME_UNKNOWN',
            'mutation outcome unknown; reconcile before retrying',
            context.correlationId,
          )
        : localError(
            504,
            'UPSTREAM_TIMEOUT',
            'request timed out or network failed',
            context.correlationId,
          );
    } finally {
      clearTimeout(timer);
      context.signal?.removeEventListener('abort', abortFromCaller);
    }

    let json: unknown = null;
    if (raw.length > 0) {
      try {
        json = JSON.parse(raw);
      } catch {
        return this.invalid(mutating, response.status, context);
      }
    }
    if (response.status >= 200 && response.status < 300) {
      try {
        return {
          ok: true,
          status: response.status,
          value: spec.parse(json),
          revision: etagRevision(response),
        };
      } catch {
        // A 2xx we cannot understand: for a mutation the server DID something.
        return this.invalid(mutating, response.status, context);
      }
    }
    try {
      return { ok: false, status: response.status, error: parseApiErrorEnvelope(json).error };
    } catch {
      return this.invalid(mutating, response.status, context);
    }
  }

  private invalid(mutating: boolean, status: number, context: CallContext): ApiResult<never> {
    return mutating && status >= 200 && status < 300
      ? localError(
          502,
          'OUTCOME_UNKNOWN',
          'unreadable success response to a mutation',
          context.correlationId,
        )
      : localError(
          502,
          'UPSTREAM_INVALID',
          'response violated the contract',
          context.correlationId,
        );
  }

  private url(spec: RequestSpec<unknown>): string {
    const query = Object.entries(spec.query ?? {})
      .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    return `${this.options.baseUrl}${spec.path}${query ? `?${query}` : ''}`;
  }
}

function etagRevision(response: FetchResponse): number | null {
  const etag = response.headers.get('etag');
  const match = etag ? /^"([1-9][0-9]{0,9})"$/.exec(etag) : null;
  return match?.[1] ? Number(match[1]) : null;
}

/** 128-bit random key in the contract alphabet. Persist it with the pending command. */
export function newIdempotencyKey(random: (bytes: Uint8Array) => Uint8Array): string {
  const bytes = random(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
