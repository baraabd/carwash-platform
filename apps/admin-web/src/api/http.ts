/**
 * The console's only door to the backend: the Gateway at `/api/v1` on the same
 * origin. Credentials are Identity's HttpOnly session cookies; the browser
 * never sees or stores a bearer token.
 *
 * Every failure is a typed outcome. A mutation that times out or loses its
 * connection is UNKNOWN_OUTCOME, never success and never a silent retry.
 */
export const API_BASE = '/api/v1';
const READ_TIMEOUT_MS = 8_000;
const WRITE_TIMEOUT_MS = 10_000;

export type Failure =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INVALID'
  | 'RATE_LIMITED'
  | 'UNAVAILABLE'
  | 'UNKNOWN_OUTCOME'
  | 'MALFORMED';

export type Result<T> =
  | { readonly ok: true; readonly value: T; readonly correlationId: string }
  | {
      readonly ok: false;
      readonly failure: Failure;
      readonly code: string | null;
      readonly correlationId: string;
    };

export type Reader<T> = (body: unknown) => T;

export class MalformedResponse extends Error {
  readonly path: string;
  constructor(path: string) {
    super(`MALFORMED_RESPONSE ${path}`);
    this.path = path;
    this.name = 'MalformedResponse';
  }
}

/** Identity's CSRF cookie is readable by design (double submit); its name depends on the transport. */
export function csrfToken(cookie: string = document.cookie): string {
  for (const part of cookie.split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === '__Host-wg_csrf' || name === 'wg_csrf') return value.join('=');
  }
  return '';
}

/** 24 random bytes, base64url: within the Gateway's 16-128 character key rule. */
export function idempotencyKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

const STATUS: Readonly<Record<number, Failure>> = {
  400: 'INVALID',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  // A stale expectedRevision (Dispatch, Billing): the record changed; reload it.
  412: 'CONFLICT',
  422: 'INVALID',
  429: 'RATE_LIMITED',
};

function errorCode(body: unknown): string | null {
  if (body === null || typeof body !== 'object') return null;
  const error = (body as { error?: unknown }).error;
  if (error === null || typeof error !== 'object') return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && /^[A-Z_]{2,64}$/.test(code) ? code : null;
}

export interface RequestOptions<T> {
  readonly method?: 'GET' | 'POST';
  readonly query?: Readonly<Record<string, string | undefined>>;
  readonly body?: unknown;
  readonly idempotencyKey?: string;
  readonly read: Reader<T>;
}

export async function request<T>(path: string, options: RequestOptions<T>): Promise<Result<T>> {
  const method = options.method ?? 'GET';
  const correlationId = crypto.randomUUID();
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(options.query ?? {}))
    if (value !== undefined) params.set(key, value);
  const url = `${API_BASE}${path}${params.size > 0 ? `?${params.toString()}` : ''}`;
  const headers: Record<string, string> = {
    accept: 'application/json',
    'x-correlation-id': correlationId,
  };
  if (method !== 'GET') {
    headers['content-type'] = 'application/json';
    headers['x-csrf-token'] = csrfToken();
  }
  if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;
  const fail = (failure: Failure, code: string | null = null): Result<T> => ({
    ok: false,
    failure,
    code,
    correlationId,
  });

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(method === 'GET' ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS),
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
  } catch {
    // A read can simply be repeated; a write may or may not have happened.
    return fail(method === 'GET' ? 'UNAVAILABLE' : 'UNKNOWN_OUTCOME');
  }

  let body: unknown = null;
  try {
    const text = await response.text();
    body = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    if (response.ok) return fail(method === 'GET' ? 'MALFORMED' : 'UNKNOWN_OUTCOME');
  }
  if (!response.ok) {
    const failure = STATUS[response.status];
    if (failure) return fail(failure, errorCode(body));
    // 5xx after a write: the owner may have committed before failing to answer.
    return fail(method === 'GET' ? 'UNAVAILABLE' : 'UNKNOWN_OUTCOME', errorCode(body));
  }
  try {
    return { ok: true, value: options.read(body), correlationId };
  } catch {
    return fail(method === 'GET' ? 'MALFORMED' : 'UNKNOWN_OUTCOME');
  }
}

/* --------------------------- tolerant-but-strict readers --------------------------- */

export function object(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new MalformedResponse(path);
  return value as Record<string, unknown>;
}

export function text(value: unknown, path: string, pattern?: RegExp): string {
  if (typeof value !== 'string' || (pattern && !pattern.test(value)))
    throw new MalformedResponse(path);
  return value;
}

export function nullableText(value: unknown, path: string, pattern?: RegExp): string | null {
  return value === null ? null : text(value, path, pattern);
}

export function integer(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new MalformedResponse(path);
  return value;
}

export function bool(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new MalformedResponse(path);
  return value;
}

export function oneOf<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  path: string,
): T[number] {
  if (typeof value !== 'string' || !allowed.includes(value)) throw new MalformedResponse(path);
  return value;
}

export function list<T>(value: unknown, path: string, item: (v: unknown, p: string) => T): T[] {
  if (!Array.isArray(value) || value.length > 500) throw new MalformedResponse(path);
  return value.map((v, i) => item(v, `${path}[${i}]`));
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
