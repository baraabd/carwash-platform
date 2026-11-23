import type { ExactAmount, OwnerOutcome } from '../../domain';
import { OwnerReadError, type OnBehalfOf } from '../../ports';

/**
 * Outbound HTTP hygiene for the owner adapters: origin validation, explicit
 * timeouts, bounded bodies and NO retries. A command whose answer is lost is
 * UNKNOWN; only a staff resend (same key, same body) ever repeats it.
 */
const MAX_RESPONSE_BYTES = 65_536;
const BEARER = /^Bearer [A-Za-z0-9_.-]{20,8192}$/;
const ERROR_CODE = /^[A-Z][A-Z0-9_]{1,63}$/;

export interface OwnerEndpoint {
  /** null when not configured: reads fail closed and nothing is ever sent. */
  readonly origin: URL | null;
  readonly timeoutMs: number;
}

export function ownerEndpointFromEnv(
  env: NodeJS.ProcessEnv,
  originKey: string,
  timeoutKey: string,
): OwnerEndpoint {
  const rawTimeout = env[timeoutKey] ?? '3000';
  const timeoutMs = Number(rawTimeout);
  if (!/^[0-9]+$/.test(rawTimeout) || timeoutMs < 100 || timeoutMs > 15_000)
    throw new Error(`${timeoutKey}_INVALID`);
  const raw = env[originKey];
  if (raw === undefined || raw === '') return { origin: null, timeoutMs };
  const origin = new URL(raw);
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname);
  // Plain HTTP only for loopback or a dotless private service name.
  const internalName = !origin.hostname.includes('.');
  if (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && (loopback || internalName)))
    throw new Error(`${originKey}_INVALID`);
  if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/')
    throw new Error(`${originKey}_INVALID`);
  return { origin, timeoutMs };
}

export interface OwnerResponse {
  readonly status: number;
  readonly body: unknown;
}

function headers(auth: OnBehalfOf, extra: Record<string, string> = {}): Record<string, string> {
  if (!BEARER.test(auth.credential)) throw new OwnerReadError('OWNER_FORBIDDEN');
  return {
    accept: 'application/json',
    authorization: auth.credential,
    'x-correlation-id': auth.correlationId,
    ...extra,
  };
}

async function bounded(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error('OWNER_RESPONSE_TOO_LARGE');
    }
    chunks.push(value);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? (JSON.parse(text) as unknown) : null;
}

/** A read: any transport failure is OWNER_UNAVAILABLE, never an empty answer. */
export async function ownerGet(
  endpoint: OwnerEndpoint,
  path: string,
  auth: OnBehalfOf,
): Promise<OwnerResponse> {
  if (!endpoint.origin) throw new OwnerReadError('OWNER_UNAVAILABLE');
  const init = { method: 'GET', redirect: 'error' as const, headers: headers(auth) };
  let response: Response;
  try {
    response = await fetch(new URL(path, endpoint.origin), {
      ...init,
      signal: AbortSignal.timeout(endpoint.timeoutMs),
    });
  } catch {
    throw new OwnerReadError('OWNER_UNAVAILABLE');
  }
  try {
    return { status: response.status, body: await bounded(response) };
  } catch {
    throw new OwnerReadError('OWNER_INVALID_RESPONSE');
  }
}

/**
 * A command. 2xx is the owner's APPLIED answer; a definite refusal is
 * REJECTED with the owner's code; a timeout, a lost connection, 408, 429 or
 * any 5xx is UNKNOWN, because the owner may or may not have acted.
 */
export async function ownerPost(
  endpoint: OwnerEndpoint,
  path: string,
  auth: OnBehalfOf,
  key: string,
  body: unknown,
  appliedState: (body: unknown) => string | null,
): Promise<OwnerOutcome> {
  if (!endpoint.origin) return { kind: 'UNAVAILABLE', code: 'OWNER_NOT_CONFIGURED' };
  let requestHeaders: Record<string, string>;
  try {
    requestHeaders = headers(auth, { 'content-type': 'application/json', 'idempotency-key': key });
  } catch {
    return { kind: 'REJECTED', ownerStatus: 401, code: 'AUTH_REQUIRED' };
  }
  let response: Response;
  try {
    response = await fetch(new URL(path, endpoint.origin), {
      method: 'POST',
      redirect: 'error',
      headers: requestHeaders,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(endpoint.timeoutMs),
    });
  } catch {
    return { kind: 'UNKNOWN', code: 'OWNER_NO_ANSWER' };
  }
  // An unreadable body does not change what the status code already says.
  const parsed = await bounded(response).catch(() => null);
  const status = response.status;
  if (status >= 200 && status < 300)
    return { kind: 'APPLIED', ownerStatus: status, ownerState: appliedState(parsed) };
  if ([400, 401, 403, 404, 409, 412, 422].includes(status))
    return { kind: 'REJECTED', ownerStatus: status, code: errorCode(parsed) ?? `HTTP_${status}` };
  return { kind: 'UNKNOWN', code: errorCode(parsed) ?? `HTTP_${status}` };
}

function errorCode(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && ERROR_CODE.test(code) ? code : null;
}

/* ------------------------- tolerant wire readers ------------------------- */

export function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new OwnerReadError('OWNER_INVALID_RESPONSE');
  return value as Record<string, unknown>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATE = /^[A-Z][A-Z_]{1,39}$/;

export function id(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value))
    throw new OwnerReadError('OWNER_INVALID_RESPONSE');
  return value.toLowerCase();
}

export function state(value: unknown): string {
  if (typeof value !== 'string' || !STATE.test(value))
    throw new OwnerReadError('OWNER_INVALID_RESPONSE');
  return value;
}

export function revision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new OwnerReadError('OWNER_INVALID_RESPONSE');
  return value;
}

export function instant(value: unknown): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value)))
    throw new OwnerReadError('OWNER_INVALID_RESPONSE');
  return new Date(value).toISOString();
}

/** The owner's exact money wire shape; read as text, never as a number. */
export function money(value: unknown): ExactAmount {
  const m = record(value);
  if (
    typeof m.currency !== 'string' ||
    !/^[A-Z]{3}$/.test(m.currency) ||
    typeof m.amountMinor !== 'string' ||
    !/^(0|[1-9][0-9]{0,17})$/.test(m.amountMinor) ||
    typeof m.scale !== 'number' ||
    !Number.isInteger(m.scale) ||
    m.scale < 0 ||
    m.scale > 3
  )
    throw new OwnerReadError('OWNER_INVALID_RESPONSE');
  return { currency: m.currency, amountMinor: m.amountMinor, scale: m.scale };
}
