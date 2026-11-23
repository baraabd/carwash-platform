import { createHash, createHmac } from 'node:crypto';

/**
 * AWS Signature Version 4 for S3, implemented on node:crypto only.
 *
 * Reference: "Authenticating Requests (AWS Signature Version 4)" and
 * "Authenticating Requests: Using Query Parameters" in the Amazon S3 API
 * documentation. Both published examples are reproduced by unit tests.
 *
 * S3 differs from other services in two ways handled here: the canonical URI
 * is the path encoded ONCE (no double encoding), and the payload hash is the
 * literal `UNSIGNED-PAYLOAD` for presigned URLs.
 */
export interface SigningCredentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly region: string;
  readonly service?: string;
}

export const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';
export const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const ALGORITHM = 'AWS4-HMAC-SHA256';
/** S3's own upper bound for a presigned URL lifetime (7 days). */
export const MAX_PRESIGN_SECONDS = 604_800;

const hex = (value: string | Uint8Array): string =>
  createHash('sha256').update(value).digest('hex');
const hmac = (key: string | Buffer, value: string): Buffer =>
  createHmac('sha256', key).update(value, 'utf8').digest();

/** RFC 3986 unreserved characters stay; everything else is %XX upper-case. */
export function uriEncode(value: string, encodeSlash = true): string {
  let out = '';
  for (const byte of Buffer.from(value, 'utf8')) {
    const char = String.fromCharCode(byte);
    if (/[A-Za-z0-9\-._~]/.test(char) || (char === '/' && !encodeSlash)) out += char;
    else out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

/** `20130524T000000Z` */
export function amzDate(at: Date): string {
  return at
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

function canonicalQuery(query: ReadonlyArray<readonly [string, string]>): string {
  return query
    .map(([name, value]) => [uriEncode(name), uriEncode(value)] as const)
    .sort(([a, av], [b, bv]) => (a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
    .map(([name, value]) => `${name}=${value}`)
    .join('&');
}

function normalizeHeaders(
  headers: Readonly<Record<string, string>>,
): ReadonlyArray<readonly [string, string]> {
  return Object.entries(headers)
    .map(([name, value]) => [name.toLowerCase(), value.trim().replace(/\s+/g, ' ')] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

export interface CanonicalInput {
  readonly method: string;
  /** Raw (decoded) path, e.g. `/bucket/objects/<id>`; encoded once here. */
  readonly path: string;
  readonly query: ReadonlyArray<readonly [string, string]>;
  /** Every signed header including `host`, any case; values are trimmed. */
  readonly headers: Readonly<Record<string, string>>;
  readonly payloadHash: string;
}

export function canonicalRequest(input: CanonicalInput): {
  readonly text: string;
  readonly signedHeaders: string;
} {
  const headers = normalizeHeaders(input.headers);
  const signedHeaders = headers.map(([name]) => name).join(';');
  const text = [
    input.method,
    uriEncode(input.path, false),
    canonicalQuery(input.query),
    headers.map(([name, value]) => `${name}:${value}\n`).join(''),
    signedHeaders,
    input.payloadHash,
  ].join('\n');
  return { text, signedHeaders };
}

function scopeOf(at: Date, credentials: SigningCredentials): string {
  return `${amzDate(at).slice(0, 8)}/${credentials.region}/${credentials.service ?? 's3'}/aws4_request`;
}

export function stringToSign(at: Date, scope: string, canonical: string): string {
  return [ALGORITHM, amzDate(at), scope, hex(canonical)].join('\n');
}

export function signingKey(at: Date, credentials: SigningCredentials): Buffer {
  const date = hmac(`AWS4${credentials.secretAccessKey}`, amzDate(at).slice(0, 8));
  const region = hmac(date, credentials.region);
  const service = hmac(region, credentials.service ?? 's3');
  return hmac(service, 'aws4_request');
}

function signature(at: Date, credentials: SigningCredentials, canonical: string): string {
  const toSign = stringToSign(at, scopeOf(at, credentials), canonical);
  return createHmac('sha256', signingKey(at, credentials)).update(toSign, 'utf8').digest('hex');
}

/**
 * Presigned URL (query-string authentication). `headers` are the headers the
 * caller MUST send with exactly these values; `host` is taken from the URL.
 */
export function presignUrl(input: {
  readonly method: 'GET' | 'PUT' | 'HEAD' | 'DELETE';
  readonly url: URL;
  readonly headers: Readonly<Record<string, string>>;
  readonly expiresInSeconds: number;
  readonly at: Date;
  readonly credentials: SigningCredentials;
}): URL {
  if (
    !Number.isSafeInteger(input.expiresInSeconds) ||
    input.expiresInSeconds < 1 ||
    input.expiresInSeconds > MAX_PRESIGN_SECONDS
  ) {
    throw new Error('PRESIGN_EXPIRY_OUT_OF_RANGE');
  }
  const headers = { ...input.headers, host: input.url.host };
  const signedHeaders = normalizeHeaders(headers)
    .map(([name]) => name)
    .join(';');
  const query: Array<readonly [string, string]> = [
    ...[...input.url.searchParams.entries()],
    ['X-Amz-Algorithm', ALGORITHM],
    [
      'X-Amz-Credential',
      `${input.credentials.accessKeyId}/${scopeOf(input.at, input.credentials)}`,
    ],
    ['X-Amz-Date', amzDate(input.at)],
    ['X-Amz-Expires', String(input.expiresInSeconds)],
    ['X-Amz-SignedHeaders', signedHeaders],
  ];
  const { text } = canonicalRequest({
    method: input.method,
    path: decodeURIComponent(input.url.pathname),
    query,
    headers,
    payloadHash: UNSIGNED_PAYLOAD,
  });
  const sig = signature(input.at, input.credentials, text);
  const out = new URL(input.url.origin);
  out.pathname = uriEncode(decodeURIComponent(input.url.pathname), false);
  out.search = `${canonicalQuery(query)}&X-Amz-Signature=${sig}`;
  return out;
}

/**
 * Header authentication. Returns the headers to send: the given ones plus
 * `x-amz-date`, `x-amz-content-sha256` and `authorization` (`host` is set by
 * the HTTP client from the URL and is signed with that value).
 */
export function signHeaders(input: {
  readonly method: string;
  readonly url: URL;
  readonly headers: Readonly<Record<string, string>>;
  readonly payloadHash: string;
  readonly at: Date;
  readonly credentials: SigningCredentials;
}): Record<string, string> {
  const sent: Record<string, string> = {
    ...input.headers,
    'x-amz-date': amzDate(input.at),
    'x-amz-content-sha256': input.payloadHash,
  };
  const { text, signedHeaders } = canonicalRequest({
    method: input.method,
    path: decodeURIComponent(input.url.pathname),
    query: [...input.url.searchParams.entries()],
    headers: { ...sent, host: input.url.host },
    payloadHash: input.payloadHash,
  });
  const sig = signature(input.at, input.credentials, text);
  const credential = `${input.credentials.accessKeyId}/${scopeOf(input.at, input.credentials)}`;
  return {
    ...sent,
    authorization: `${ALGORITHM} Credential=${credential}, SignedHeaders=${signedHeaders}, Signature=${sig}`,
  };
}

export function payloadHash(bytes: Uint8Array): string {
  return hex(bytes);
}
