import { ReviewsError } from '../../application/errors';

export interface OwnerEndpoint {
  readonly origin: URL | null;
  readonly timeoutMs: number;
}

export function ownerEndpoint(
  env: NodeJS.ProcessEnv,
  originKey: string,
  timeoutKey: string,
): OwnerEndpoint {
  const rawTimeout = env[timeoutKey] ?? '2000';
  const timeoutMs = Number(rawTimeout);
  if (!/^[0-9]+$/.test(rawTimeout) || timeoutMs < 100 || timeoutMs > 10_000)
    throw new Error(`${timeoutKey}_INVALID`);
  const raw = env[originKey];
  if (!raw) return { origin: null, timeoutMs };
  let origin: URL;
  try {
    origin = new URL(raw);
  } catch {
    throw new Error(`${originKey}_INVALID`);
  }
  if (
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== '/' ||
    (origin.protocol !== 'https:' &&
      !(
        origin.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)
      ))
  )
    throw new Error(`${originKey}_INVALID`);
  return { origin, timeoutMs };
}

export function bearer(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 8192 &&
    /^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)
  );
}

export async function ownerGet(
  endpoint: OwnerEndpoint,
  path: string,
  credential: string,
  correlationId: string,
  fetcher: typeof fetch,
): Promise<Response> {
  if (!endpoint.origin) throw new ReviewsError('DEPENDENCY_UNAVAILABLE');
  try {
    return await fetcher(new URL(path, endpoint.origin), {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: credential,
        'x-correlation-id': correlationId,
      },
      redirect: 'error',
      signal: AbortSignal.timeout(endpoint.timeoutMs),
    });
  } catch {
    throw new ReviewsError('DEPENDENCY_UNAVAILABLE');
  }
}

/** Deadline covers the streamed body too; no HTML, oversized body or private error is retained. */
export async function ownerJson(response: Response, maxBytes: number): Promise<unknown> {
  try {
    if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
      await response.body?.cancel();
      throw new Error('OWNER_CONTENT_TYPE');
    }
    if (Number(response.headers.get('content-length') ?? 0) > maxBytes) {
      await response.body?.cancel();
      throw new Error('OWNER_BODY_LIMIT');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('OWNER_BODY_MISSING');
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error('OWNER_BODY_LIMIT');
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new ReviewsError('UPSTREAM_INVALID');
  }
}
