import { traceHeaders } from '@carwash/service-kit';
import type { UserCredential } from '../../ports';

/**
 * Outbound HTTP to one owner service, with the resilience rules every Booking
 * adapter shares:
 *   - an explicit timeout on every call (AbortSignal), never an open wait;
 *   - a per-owner circuit breaker: after `failureThreshold` consecutive
 *     transport failures/5xx it fails fast for `openMs`, then lets one probe
 *     through (half-open);
 *   - correlation id and W3C trace parent propagated on every call;
 *   - bounded response size; no request/response body or credential is logged.
 *
 * The client never retries by itself: whether a call may be repeated is a
 * decision of the saga (same idempotency key) or of the caller, not of HTTP.
 * Its outcome distinguishes "not sent" (safe to treat as not executed) from
 * "sent, no answer" (a mutation's outcome is UNKNOWN).
 */
export type HttpOutcome =
  | { readonly kind: 'RESPONSE'; readonly status: number; readonly body: unknown }
  | { readonly kind: 'NOT_SENT'; readonly error: 'NOT_CONFIGURED' | 'CIRCUIT_OPEN' }
  | { readonly kind: 'NO_RESPONSE'; readonly error: 'TIMEOUT' | 'NETWORK' | 'BAD_BODY' };

export interface ServiceCredential {
  readonly clientId: string;
  readonly token: string;
}

export interface OwnerHttpOptions {
  readonly owner: string;
  readonly baseUrl: string | undefined;
  readonly timeoutMs: number;
  /** Interim workload credential (x-service-client / x-service-token), see CR-P02-C2. */
  readonly service: ServiceCredential | null;
  readonly failureThreshold?: number;
  readonly openMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
}

const MAX_BODY_BYTES = 256 * 1024;

export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;
  private probing = false;

  constructor(
    private readonly threshold: number,
    private readonly openMs: number,
    private readonly now: () => number,
  ) {}

  /** Whether a call may be made now. In half-open state only one probe at a time. */
  allow(): boolean {
    if (this.openedAt === null) return true;
    if (this.now() - this.openedAt < this.openMs || this.probing) return false;
    this.probing = true;
    return true;
  }

  success(): void {
    this.failures = 0;
    this.openedAt = null;
    this.probing = false;
  }

  failure(): void {
    this.probing = false;
    this.failures += 1;
    if (this.failures >= this.threshold) this.openedAt = this.now();
  }

  get state(): 'CLOSED' | 'OPEN' {
    return this.openedAt === null ? 'CLOSED' : 'OPEN';
  }
}

export class OwnerHttpClient {
  readonly breaker: CircuitBreaker;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OwnerHttpOptions) {
    const now = options.now ?? Date.now;
    this.breaker = new CircuitBreaker(options.failureThreshold ?? 5, options.openMs ?? 10_000, now);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  get owner(): string {
    return this.options.owner;
  }

  async call(input: {
    readonly method: 'GET' | 'POST';
    readonly path: string;
    readonly correlationId: string;
    readonly body?: unknown;
    readonly idempotencyKey?: string;
    /** On-behalf-of read; mutually exclusive with the service credential. */
    readonly credential?: UserCredential;
  }): Promise<HttpOutcome> {
    if (!this.options.baseUrl) return { kind: 'NOT_SENT', error: 'NOT_CONFIGURED' };
    if (!input.credential && !this.options.service)
      return { kind: 'NOT_SENT', error: 'NOT_CONFIGURED' };
    if (!this.breaker.allow()) return { kind: 'NOT_SENT', error: 'CIRCUIT_OPEN' };

    const headers: Record<string, string> = {
      accept: 'application/json',
      'x-correlation-id': input.correlationId,
      ...traceHeaders(),
    };
    delete headers['x-request-id'];
    if (input.credential) headers.authorization = input.credential.authorizationHeader();
    else if (this.options.service) {
      headers['x-service-client'] = this.options.service.clientId;
      headers['x-service-token'] = this.options.service.token;
    }
    if (input.idempotencyKey) headers['idempotency-key'] = input.idempotencyKey;
    if (input.body !== undefined) headers['content-type'] = 'application/json';

    let response: Response;
    try {
      response = await this.fetchImpl(new URL(input.path, this.options.baseUrl), {
        method: input.method,
        headers,
        ...(input.body !== undefined ? { body: JSON.stringify(input.body) } : {}),
        redirect: 'error',
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch (error) {
      this.breaker.failure();
      const timeout =
        error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      return { kind: 'NO_RESPONSE', error: timeout ? 'TIMEOUT' : 'NETWORK' };
    }

    let body: unknown;
    try {
      const text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) throw new Error('BODY_TOO_LARGE');
      body = text.length === 0 ? null : JSON.parse(text);
    } catch {
      this.breaker.failure();
      return { kind: 'NO_RESPONSE', error: 'BAD_BODY' };
    }
    if (response.status >= 500) this.breaker.failure();
    else this.breaker.success();
    return { kind: 'RESPONSE', status: response.status, body };
  }
}

/** `{error:{code, reason}}` of the platform error envelope; anything else is null. */
export function errorOf(
  body: unknown,
): { readonly code: string; readonly reason: string | null } | null {
  if (typeof body !== 'object' || body === null) return null;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) return null;
  const { code, reason } = error as { code?: unknown; reason?: unknown };
  if (typeof code !== 'string' || !/^[A-Z][A-Z0-9_]{1,63}$/.test(code)) return null;
  return {
    code,
    reason: typeof reason === 'string' && /^[A-Z][A-Z0-9_]{2,63}$/.test(reason) ? reason : null,
  };
}
