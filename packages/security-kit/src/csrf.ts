import { keyedDigest, opaqueSecret, safeEqual, secretDigest } from './opaque';

/** Signed double-submit token bound to the current session's refresh secret (or pre-auth nonce). */
export class CsrfTokens {
  private readonly key: Buffer;
  constructor(key: Uint8Array) {
    if (key.byteLength < 32) throw new Error('CSRF_KEY_TOO_SHORT');
    this.key = Buffer.from(key);
  }
  issue(bindingSecret: string): string {
    if (!bindingSecret) throw new Error('CSRF_BINDING_REQUIRED');
    const nonce = opaqueSecret();
    return `${nonce}.${keyedDigest(this.key, 'csrf-v1', `${secretDigest(bindingSecret)}.${nonce}`)}`;
  }
  verify(header: unknown, cookie: unknown, bindingSecret: unknown): boolean {
    if (
      typeof header !== 'string' ||
      typeof cookie !== 'string' ||
      typeof bindingSecret !== 'string'
    )
      return false;
    if (
      !bindingSecret ||
      !/^[A-Za-z0-9_-]{43}\.[a-f0-9]{64}$/.test(header) ||
      !safeEqual(header, cookie)
    )
      return false;
    const [nonce, signature] = header.split('.');
    if (!nonce || !signature) return false;
    return safeEqual(
      signature,
      keyedDigest(this.key, 'csrf-v1', `${secretDigest(bindingSecret)}.${nonce}`),
    );
  }
}
export function allowedOrigin(
  origin: unknown,
  allowed: readonly string[],
  fetchSite?: unknown,
): boolean {
  if (
    fetchSite !== undefined &&
    fetchSite !== 'same-origin' &&
    fetchSite !== 'same-site' &&
    fetchSite !== 'none'
  )
    return false;
  if (typeof origin !== 'string' || origin === 'null') return false;
  try {
    return new URL(origin).origin === origin && allowed.includes(origin);
  } catch {
    return false;
  }
}

/** Duplicate names fail closed instead of allowing intermediary/parser disagreement. */
export function readCookies(header: unknown): Readonly<Record<string, string>> {
  const cookies: Record<string, string> = Object.create(null) as Record<string, string>;
  if (header === undefined) return cookies;
  if (typeof header !== 'string' || header.length > 16_384)
    throw new Error('INVALID_COOKIE_HEADER');
  for (const part of header.split(';')) {
    const split = part.indexOf('=');
    if (split < 1) continue;
    const name = part.slice(0, split).trim();
    const value = part.slice(split + 1).trim();
    if (Object.hasOwn(cookies, name)) throw new Error('DUPLICATE_COOKIE');
    cookies[name] = value;
  }
  return cookies;
}
export function sessionCookie(
  name: string,
  value: string,
  options: { secure: boolean; httpOnly: boolean; maxAge: number },
): string {
  if (!/^[A-Za-z0-9_-]+$/.test(name) || /[^A-Za-z0-9._-]/.test(value))
    throw new Error('INVALID_COOKIE_VALUE');
  if (name.startsWith('__Host-') && !options.secure) throw new Error('HOST_COOKIE_REQUIRES_SECURE');
  if (!Number.isSafeInteger(options.maxAge) || options.maxAge < 0)
    throw new Error('INVALID_COOKIE_AGE');
  return `${name}=${value}; Path=/; Max-Age=${options.maxAge}; SameSite=Strict${options.httpOnly ? '; HttpOnly' : ''}${options.secure ? '; Secure' : ''}`;
}
