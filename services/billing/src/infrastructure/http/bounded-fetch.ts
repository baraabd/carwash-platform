/**
 * Shared outbound-HTTP hygiene for Billing's upstream adapters (Identity,
 * Pricing): origin validation and a bounded response body. No retries live
 * here: a caller that cannot know an outcome reports it as unavailable.
 */
export const MAX_RESPONSE_BYTES = 16_384;

export interface UpstreamConfig {
  /** null when not configured: every dependent request then fails closed. */
  readonly origin: URL | null;
  readonly timeoutMs: number;
}

export function upstreamConfigFromEnv(
  env: NodeJS.ProcessEnv,
  originKey: string,
  timeoutKey: string,
): UpstreamConfig {
  const rawTimeout = env[timeoutKey] ?? '2000';
  const timeoutMs = Number(rawTimeout);
  if (!/^[0-9]+$/.test(rawTimeout) || timeoutMs < 100 || timeoutMs > 10_000)
    throw new Error(`${timeoutKey}_INVALID`);
  const raw = env[originKey];
  if (raw === undefined || raw === '') return { origin: null, timeoutMs };
  const origin = new URL(raw);
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname);
  if (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && loopback))
    throw new Error(`${originKey}_HTTPS_REQUIRED`);
  if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/')
    throw new Error(`${originKey}_INVALID`);
  return { origin, timeoutMs };
}

/** Reads at most MAX_RESPONSE_BYTES; returns null when the body is larger. */
export async function boundedText(response: Response): Promise<string | null> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    return null;
  }
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;
export const MAX_CREDENTIAL = 8_192;

export function isBearer(credential: unknown): credential is string {
  return (
    typeof credential === 'string' && credential.length <= MAX_CREDENTIAL && BEARER.test(credential)
  );
}