import type { SubmissionOutcome } from '../../domain/notification';
import type { NotificationProvider, ProviderSubmission } from '../../ports/notification.ports';

const MESSAGE_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const MAX_RESPONSE_BYTES = 4_096;
/** Errors raised before any byte reached the provider: provably not submitted. */
const NOT_CONNECTED = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
]);

export interface HttpProviderConfig {
  readonly endpoint: URL;
  readonly token: string;
  /** Set only when the provider's documentation guarantees idempotency-key deduplication. */
  readonly idempotentSubmission: boolean;
}

function errorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

async function boundedJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) return undefined;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Deployment-configured HTTPS delivery connector. There is no default or fake
 * provider in production code: without configuration the delivery worker
 * refuses to start rather than pretending to send.
 *
 * Plain HTTP is accepted only for a loopback endpoint (local test servers).
 * The bearer token and the recipient never appear in errors or logs.
 */
export class HttpNotificationProvider implements NotificationProvider {
  readonly name = 'http-webhook';
  readonly idempotentSubmission: boolean;

  constructor(private readonly config: HttpProviderConfig) {
    const { endpoint, token } = config;
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname);
    if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && loopback))
      throw new Error('PROVIDER_HTTPS_REQUIRED');
    if (endpoint.username || endpoint.password || endpoint.hash)
      throw new Error('INVALID_PROVIDER_URL');
    if (!/^[A-Za-z0-9._~+/=-]{16,512}$/.test(token)) throw new Error('INVALID_PROVIDER_TOKEN');
    this.idempotentSubmission = config.idempotentSubmission;
  }

  async submit(submission: ProviderSubmission, signal: AbortSignal): Promise<SubmissionOutcome> {
    let response: Response;
    try {
      response = await fetch(this.config.endpoint, {
        method: 'POST',
        redirect: 'error',
        signal,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.config.token}`,
          'idempotency-key': submission.idempotencyKey,
        },
        body: JSON.stringify({
          channel: submission.channel,
          recipientRef: submission.recipientRef,
          template: { key: submission.templateKey, version: submission.templateVersion },
          parameters: submission.parameters,
        }),
      });
    } catch (error: unknown) {
      if (signal.aborted) return { kind: 'AMBIGUOUS', code: 'PROVIDER_TIMEOUT' };
      const code = errorCode(error);
      if (code && NOT_CONNECTED.has(code))
        return { kind: 'NOT_SUBMITTED', code: 'PROVIDER_UNREACHABLE' };
      return { kind: 'AMBIGUOUS', code: 'PROVIDER_TRANSPORT_ERROR' };
    }

    if (response.status >= 200 && response.status < 300) {
      let body: unknown;
      try {
        body = await boundedJson(response);
      } catch {
        return {
          kind: 'AMBIGUOUS',
          code: signal.aborted ? 'PROVIDER_TIMEOUT' : 'PROVIDER_RESPONSE_INVALID',
        };
      }
      const messageId = (body as { messageId?: unknown } | undefined)?.messageId;
      if (typeof messageId === 'string' && MESSAGE_ID.test(messageId))
        return { kind: 'ACCEPTED', providerMessageId: messageId };
      // It said yes, but we cannot correlate it: possibly sent, not proven.
      return { kind: 'AMBIGUOUS', code: 'PROVIDER_RESPONSE_INVALID' };
    }
    await response.body?.cancel().catch(() => undefined);
    // Refused before processing; safe to retry later.
    if ([401, 403, 408, 429].includes(response.status))
      return { kind: 'REJECTED', code: `PROVIDER_REFUSED_${response.status}`, retryable: true };
    if (response.status >= 400 && response.status < 500)
      return { kind: 'REJECTED', code: `PROVIDER_REJECTED_${response.status}`, retryable: false };
    // 5xx: the provider may have processed the request before failing.
    return { kind: 'AMBIGUOUS', code: `PROVIDER_SERVER_${response.status}` };
  }
}

export function httpProviderFromEnv(env: NodeJS.ProcessEnv): HttpNotificationProvider {
  const url = env.NOTIFICATION_PROVIDER_URL;
  const token = env.NOTIFICATION_PROVIDER_TOKEN;
  if (!url || !token) throw new Error('PROVIDER_NOT_CONFIGURED');
  const idempotent = env.NOTIFICATION_PROVIDER_IDEMPOTENT;
  if (idempotent !== 'true' && idempotent !== 'false')
    throw new Error('PROVIDER_IDEMPOTENCY_UNDECLARED');
  return new HttpNotificationProvider({
    endpoint: new URL(url),
    token,
    idempotentSubmission: idempotent === 'true',
  });
}
