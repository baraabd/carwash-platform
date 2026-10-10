/**
 * Outbound service-to-service HTTP for Dispatch's adapters.
 *
 * - explicit per-attempt timeout and a bounded total budget,
 * - interim service credentials (`x-service-client` / `x-service-token`)
 *   until platform workload identity exists (CR-P02-C3 §4),
 * - correlation id propagation,
 * - at most one jittered retry, and ONLY for idempotent requests on a
 *   timeout, network failure or 5xx,
 * - response body capped; nothing from the body or credentials is logged.
 *
 * Every failure is reported as `unavailable`; callers map it to a 503 and
 * never to a guessed success.
 */
export interface ServiceCredential {
  readonly clientId: string;
  readonly token: string;
}

export interface ServiceHttpOptions {
  readonly baseUrl: string;
  readonly credential: ServiceCredential;
  readonly timeoutMs: number;
  readonly fetchImpl?: typeof fetch;
}

export type HttpOutcome =
  | { readonly kind: 'ok'; readonly status: number; readonly body: unknown }
  | { readonly kind: 'status'; readonly status: number }
  | { readonly kind: 'unavailable' };

const MAX_BODY_BYTES = 256 * 1024;

export function parseServiceTarget(
  env: Readonly<Record<string, string | undefined>>,
  prefix: string,
): ServiceHttpOptions | null {
  const baseUrl = env[`${prefix}_URL`];
  const clientId = env[`${prefix}_CLIENT_ID`];
  const token = env[`${prefix}_CLIENT_TOKEN`];
  const timeout = env[`${prefix}_TIMEOUT_MS`];
  if (baseUrl === undefined && clientId === undefined && token === undefined) return null;
  if (!baseUrl || !clientId || !token) throw new Error(`${prefix}_INCOMPLETE`);
  const url = new URL(baseUrl);
  if (url.username || url.password || url.search || url.hash)
    throw new Error(`${prefix}_URL_INVALID`);
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(clientId) || token.length < 32 || token.length > 256) {
    throw new Error(`${prefix}_CREDENTIAL_INVALID`);
  }
  const timeoutMs = timeout === undefined || timeout === '' ? 1_500 : Number(timeout);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10_000) {
    throw new Error(`${prefix}_TIMEOUT_INVALID`);
  }
  return { baseUrl: url.toString(), credential: { clientId, token }, timeoutMs };
}

export class ServiceHttp {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ServiceHttpOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async request(
    method: 'GET' | 'POST',
    path: string,
    correlationId: string,
    body?: unknown,
    options: { readonly idempotent?: boolean } = {},
  ): Promise<HttpOutcome> {
    // A POST is retried here only when the caller declares it idempotent.
    const attempts = method === 'GET' || options.idempotent === true ? 2 : 1;
    for (let attempt = 1; ; attempt += 1) {
      const outcome = await this.once(method, path, correlationId, body);
      const retryable =
        outcome.kind === 'unavailable' || (outcome.kind === 'status' && outcome.status >= 500);
      if (!retryable || attempt >= attempts) return outcome;
      await new Promise((resolve) => setTimeout(resolve, 50 + Math.random() * 100));
    }
  }

  private async once(
    method: 'GET' | 'POST',
    path: string,
    correlationId: string,
    body: unknown,
  ): Promise<HttpOutcome> {
    let response: Response;
    try {
      response = await this.fetchImpl(new URL(path, this.options.baseUrl), {
        method,
        headers: {
          accept: 'application/json',
          'x-correlation-id': correlationId,
          'x-service-client': this.options.credential.clientId,
          'x-service-token': this.options.credential.token,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: 'error',
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch {
      return { kind: 'unavailable' };
    }
    if (response.status < 200 || response.status >= 300) {
      await response.body?.cancel().catch(() => undefined);
      return { kind: 'status', status: response.status };
    }
    try {
      const text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) return { kind: 'unavailable' };
      return { kind: 'ok', status: response.status, body: JSON.parse(text) as unknown };
    } catch {
      return { kind: 'unavailable' };
    }
  }
}
