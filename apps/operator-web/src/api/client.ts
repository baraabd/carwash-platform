import { ShapeError, parseError } from './parse';

/**
 * Same-origin fetch wrapper for the gateway paths `/api/operator/*`.
 *
 * - credentials are the gateway session cookie (`same-origin`); no token is
 *   read, stored or sent by script;
 * - every request carries a fresh `x-correlation-id` and an explicit timeout;
 * - mutations carry the caller's stable `Idempotency-Key`;
 * - a timeout, a network failure or a malformed 2xx body on a mutation is
 *   UNKNOWN: the effect may or may not have happened. It is never success.
 */

export const API_PREFIX = '/api/operator/';
export const READ_TIMEOUT_MS = 10_000;
export const WRITE_TIMEOUT_MS = 15_000;

export type Result<T> =
  | { readonly kind: 'ok'; readonly status: number; readonly value: T }
  | {
      readonly kind: 'error';
      readonly status: number;
      readonly code: string;
      readonly reason: string | null;
      readonly retryable: boolean;
    }
  | { readonly kind: 'unknown'; readonly cause: 'timeout' | 'network' | 'shape' };

export interface Request<T> {
  readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  readonly path: string;
  readonly body?: unknown;
  readonly idempotencyKey?: string;
  readonly timeoutMs?: number;
  /** Closed parser; `null` means the body is not relied upon (state is re-read). */
  readonly parse: ((value: unknown) => T) | null;
}

export const newKey = (): string => crypto.randomUUID();

function csrfToken(): string | null {
  // The gateway forwards x-csrf-token; Identity's csrf cookie is readable by design.
  for (const part of document.cookie.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === '__Host-wg_csrf' || name === 'wg_csrf') return decodeURIComponent(rest.join('='));
  }
  return null;
}

export async function call<T>(request: Request<T>): Promise<Result<T>> {
  if (!request.path.startsWith(API_PREFIX) || request.path.includes('..')) {
    throw new Error('OPERATOR_API_PATH_REFUSED');
  }
  const unsafe = request.method !== 'GET';
  const headers: Record<string, string> = {
    accept: 'application/json',
    'x-correlation-id': crypto.randomUUID(),
  };
  if (unsafe) {
    headers['content-type'] = 'application/json';
    const csrf = csrfToken();
    if (csrf) headers['x-csrf-token'] = csrf;
  }
  if (request.idempotencyKey) headers['idempotency-key'] = request.idempotencyKey;
  const controller = new AbortController();
  const timeout = request.timeoutMs ?? (unsafe ? WRITE_TIMEOUT_MS : READ_TIMEOUT_MS);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeout);
  let response: Response;
  let text: string;
  try {
    response = await fetch(request.path, {
      method: request.method,
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
      ...(unsafe ? { body: JSON.stringify(request.body ?? {}) } : {}),
    });
    text = await response.text();
  } catch {
    clearTimeout(timer);
    return { kind: 'unknown', cause: timedOut ? 'timeout' : 'network' };
  }
  clearTimeout(timer);
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
  }
  if (response.ok) {
    if (request.parse === null)
      return { kind: 'ok', status: response.status, value: undefined as T };
    try {
      if (json === undefined) throw new ShapeError('json');
      return { kind: 'ok', status: response.status, value: request.parse(json) };
    } catch (error) {
      if (error instanceof ShapeError) {
        console.warn('operator-web: refused response shape', request.method, error.path);
        return { kind: 'unknown', cause: 'shape' };
      }
      throw error;
    }
  }
  const envelope = parseError(json);
  return {
    kind: 'error',
    status: response.status,
    code: envelope?.code ?? `HTTP_${response.status}`,
    reason: envelope?.reason ?? null,
    retryable: envelope?.retryable ?? response.status >= 500,
  };
}

/** PUT bytes to a presigned object-store URL with exactly the signed headers. */
export async function putBytes(
  url: string,
  headers: Readonly<Record<string, string>>,
  bytes: Blob,
  timeoutMs = 60_000,
): Promise<'ok' | 'failed' | 'unknown'> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'PUT',
      headers: { ...headers },
      body: bytes,
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    });
    return response.ok ? 'ok' : 'failed';
  } catch {
    return 'unknown';
  } finally {
    clearTimeout(timer);
  }
}
