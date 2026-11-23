import { traceHeaders } from '@carwash/service-kit';
import {
  ASSIGNMENT_STATUSES,
  AssignmentUnavailable,
  type AssignmentStatus,
  type AssignmentVerifier,
  type CurrentAssignee,
  type RandomSource,
} from '../../ports';

/**
 * HTTP adapter of AssignmentVerifier: Dispatch
 * `GET /internal/v1/dispatch/bookings/:bookingId/assignment` with the service
 * scope `dispatch.assignment.read` (interim x-service-client / x-service-token
 * credential, see CR-P03-C3).
 *
 * Resilience rules:
 *   - explicit per-attempt timeout, and a bounded total budget for the call;
 *   - exactly one retry, with jitter, and only on timeout / network failure /
 *     5xx: the request is a safe, idempotent GET;
 *   - a malformed answer, a refused credential (401/403) or any other status is
 *     unknown, never "not assigned" and never "assigned" (fail closed);
 *   - closed parsing of exactly the fields Booking needs; nothing is cached;
 *   - correlation id and W3C trace parent propagated; no body or credential logged.
 */
export interface DispatchAssignmentConfig {
  readonly baseUrl: URL;
  readonly clientId: string;
  readonly token: string;
  /** Per-attempt timeout. */
  readonly timeoutMs: number;
  /** Total time budget for the call including the retry and its jitter. */
  readonly budgetMs: number;
}

const CLIENT_ID = /^[a-z][a-z0-9-]{1,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 64 * 1024;
const MIN_ATTEMPT_MS = 50;
const MAX_JITTER_MS = 150;

/**
 * Startup validation of BOOKING_DISPATCH_*. All absent: not configured (every
 * technician read answers 503, never allowed). Partly present or malformed:
 * the process refuses to start.
 */
export function dispatchAssignmentConfig(env: NodeJS.ProcessEnv): DispatchAssignmentConfig | null {
  const url = env.BOOKING_DISPATCH_URL ?? '';
  const token = env.BOOKING_DISPATCH_CLIENT_TOKEN ?? '';
  const rawClientId = env.BOOKING_DISPATCH_CLIENT_ID ?? '';
  const rawTimeout = env.BOOKING_DISPATCH_TIMEOUT_MS ?? '';
  if (url === '' && token === '' && rawClientId === '' && rawTimeout === '') return null;
  if (url === '' || token === '') throw new Error('BOOKING_DISPATCH_INCOMPLETE');
  let baseUrl: URL;
  try {
    baseUrl = new URL(url);
  } catch {
    throw new Error('INVALID_BOOKING_DISPATCH_URL');
  }
  if (
    (baseUrl.protocol !== 'http:' && baseUrl.protocol !== 'https:') ||
    baseUrl.username !== '' ||
    baseUrl.password !== '' ||
    baseUrl.search !== '' ||
    baseUrl.hash !== ''
  ) {
    throw new Error('INVALID_BOOKING_DISPATCH_URL');
  }
  const clientId = rawClientId === '' ? 'booking' : rawClientId;
  if (!CLIENT_ID.test(clientId)) throw new Error('INVALID_BOOKING_DISPATCH_CLIENT_ID');
  if (token.length < 32 || token.length > 256 || /\s/.test(token)) {
    throw new Error('INVALID_BOOKING_DISPATCH_CLIENT_TOKEN');
  }
  const timeoutMs = rawTimeout === '' ? 1_000 : Number(rawTimeout);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10_000) {
    throw new Error('INVALID_BOOKING_DISPATCH_TIMEOUT_MS');
  }
  return {
    baseUrl,
    clientId,
    token,
    timeoutMs,
    budgetMs: 2 * timeoutMs + MAX_JITTER_MS,
  };
}

type Attempt =
  | { readonly kind: 'ANSWER'; readonly value: CurrentAssignee | 'NOT_FOUND' }
  | { readonly kind: 'RETRYABLE'; readonly reason: 'TIMEOUT' | 'NETWORK' | 'UPSTREAM_5XX' }
  | { readonly kind: 'FINAL'; readonly reason: string };

function isStatus(value: unknown): value is AssignmentStatus {
  return typeof value === 'string' && ASSIGNMENT_STATUSES.some((s) => s === value);
}

/**
 * Closed parse of the fields Booking relies on. Other fields of Dispatch's
 * operations view are not read. Any inconsistency is a contract violation.
 */
export function parseAssignment(body: unknown, bookingId: string): CurrentAssignee | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const { bookingId: id, status, technicianSubjectId, revision } = body as Record<string, unknown>;
  if (typeof id !== 'string' || id.toLowerCase() !== bookingId.toLowerCase()) return null;
  if (!isStatus(status)) return null;
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1) return null;
  if (
    technicianSubjectId !== null &&
    (typeof technicianSubjectId !== 'string' || !UUID.test(technicianSubjectId))
  ) {
    return null;
  }
  if (status === 'ASSIGNED' && technicianSubjectId === null) return null;
  return {
    status,
    technicianSubjectId: technicianSubjectId === null ? null : technicianSubjectId.toLowerCase(),
    revision,
  };
}

export class DispatchAssignmentClient implements AssignmentVerifier {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly config: DispatchAssignmentConfig | null,
    private readonly random: RandomSource,
    options: {
      readonly fetchImpl?: typeof fetch;
      readonly now?: () => number;
      readonly sleep?: (ms: number) => Promise<void>;
    } = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  }

  async currentAssignee(
    bookingId: string,
    correlationId: string,
  ): Promise<CurrentAssignee | 'NOT_FOUND'> {
    const config = this.config;
    if (config === null) throw new AssignmentUnavailable('NOT_CONFIGURED');
    if (!UUID.test(bookingId)) throw new AssignmentUnavailable('INVALID_ID');
    const deadline = this.now() + config.budgetMs;

    const first = await this.attempt(config, bookingId, correlationId, deadline);
    if (first.kind === 'ANSWER') return first.value;
    if (first.kind === 'FINAL') throw new AssignmentUnavailable(first.reason);

    const jitter = Math.floor(this.random.next() * MAX_JITTER_MS);
    if (deadline - this.now() - jitter < MIN_ATTEMPT_MS) {
      throw new AssignmentUnavailable(first.reason);
    }
    await this.sleep(jitter);
    const second = await this.attempt(config, bookingId, correlationId, deadline);
    if (second.kind === 'ANSWER') return second.value;
    throw new AssignmentUnavailable(second.reason);
  }

  private async attempt(
    config: DispatchAssignmentConfig,
    bookingId: string,
    correlationId: string,
    deadline: number,
  ): Promise<Attempt> {
    const timeoutMs = Math.min(config.timeoutMs, deadline - this.now());
    if (timeoutMs < MIN_ATTEMPT_MS) return { kind: 'RETRYABLE', reason: 'TIMEOUT' };
    const headers: Record<string, string> = {
      accept: 'application/json',
      ...traceHeaders(),
      'x-correlation-id': correlationId,
      'x-service-client': config.clientId,
      'x-service-token': config.token,
    };
    delete headers['x-request-id'];
    const url = new URL(
      `/internal/v1/dispatch/bookings/${encodeURIComponent(bookingId)}/assignment`,
      config.baseUrl,
    );
    const signal = AbortSignal.timeout(timeoutMs);
    let response: Response;
    let text: string;
    try {
      response = await this.fetchImpl(url, {
        method: 'GET',
        headers,
        redirect: 'error',
        signal,
      });
      text = await response.text();
    } catch (error) {
      const timeout =
        error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      return { kind: 'RETRYABLE', reason: timeout ? 'TIMEOUT' : 'NETWORK' };
    }
    if (response.status >= 500) return { kind: 'RETRYABLE', reason: 'UPSTREAM_5XX' };
    if (response.status === 404) return { kind: 'ANSWER', value: 'NOT_FOUND' };
    if (response.status !== 200) return { kind: 'FINAL', reason: `UPSTREAM_${response.status}` };
    if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) {
      return { kind: 'FINAL', reason: 'BAD_RESPONSE' };
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return { kind: 'FINAL', reason: 'BAD_RESPONSE' };
    }
    const parsed = parseAssignment(body, bookingId);
    return parsed === null
      ? { kind: 'FINAL', reason: 'BAD_RESPONSE' }
      : { kind: 'ANSWER', value: parsed };
  }
}
