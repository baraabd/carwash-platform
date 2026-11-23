import { storageUnavailable, type ContentType } from '../../domain';
import type { ObjectStore, PresignedRequest, StoredRead } from '../../ports';
import {
  EMPTY_SHA256,
  MAX_PRESIGN_SECONDS,
  payloadHash,
  presignUrl,
  signHeaders,
  type SigningCredentials,
} from './sigv4';

export interface S3Config {
  /** Origin of the S3 API, e.g. `https://s3.example.internal`; path-style addressing. */
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** Bound on one request including its body. */
  readonly requestTimeoutMs: number;
  /** Bound on finalize reads held in memory at once (each ≤ 10 MiB + 1). */
  readonly maxConcurrentReads: number;
}

/** Counting semaphore; waiters are served in arrival order. */
class Gate {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    } else {
      this.active += 1;
    }
    try {
      return await work();
    } finally {
      const next = this.queue.shift();
      if (next) next();
      else this.active -= 1;
    }
  }
}

/**
 * S3 adapter on global fetch with Signature V4 (no SDK dependency).
 *
 * Fail closed: a network error, a timeout, a 5xx or any answer this adapter
 * does not positively recognise is STORAGE_UNAVAILABLE; only a definite 404
 * is "missing". Errors never carry the URL, key, signature or response body,
 * so nothing secret or personal can reach a log through them.
 */
export class S3ObjectStore implements ObjectStore {
  private readonly credentials: SigningCredentials;
  private readonly origin: URL;
  private readonly reads: Gate;

  constructor(
    private readonly config: S3Config,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.credentials = {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      region: config.region,
    };
    this.origin = new URL(config.endpoint);
    this.reads = new Gate(config.maxConcurrentReads);
  }

  private url(key: string | null): URL {
    const url = new URL(this.origin.origin);
    url.pathname = key === null ? `/${this.config.bucket}` : `/${this.config.bucket}/${key}`;
    return url;
  }

  presignUpload(
    key: string,
    content: {
      readonly contentType: ContentType;
      readonly contentLength: number;
      readonly sha256Hex: string;
    },
    expiresAt: Date,
    now: Date,
  ): PresignedRequest {
    // The signature binds the type, the exact length and the checksum header.
    // Whether the store also verifies the checksum is NOT relied on: finalize
    // re-reads the bytes and verifies length, SHA-256 and signature itself.
    const headers = {
      'content-type': content.contentType,
      'content-length': String(content.contentLength),
      'x-amz-checksum-sha256': Buffer.from(content.sha256Hex, 'hex').toString('base64'),
    };
    const seconds = lifetime(expiresAt, now);
    const url = presignUrl({
      method: 'PUT',
      url: this.url(key),
      headers,
      expiresInSeconds: seconds,
      at: now,
      credentials: this.credentials,
    });
    return { method: 'PUT', url: url.toString(), headers, expiresAt: after(now, seconds) };
  }

  presignDownload(key: string, expiresAt: Date, now: Date): PresignedRequest {
    const seconds = lifetime(expiresAt, now);
    const url = presignUrl({
      method: 'GET',
      url: this.url(key),
      headers: {},
      expiresInSeconds: seconds,
      at: now,
      credentials: this.credentials,
    });
    return { method: 'GET', url: url.toString(), headers: {}, expiresAt: after(now, seconds) };
  }

  read(key: string, limit: number): Promise<StoredRead> {
    return this.reads.run(async () => {
      const signal = AbortSignal.timeout(this.config.requestTimeoutMs);
      const response = await this.send('GET', this.url(key), {}, EMPTY_SHA256, null, signal);
      if (response.status === 404) {
        await discard(response);
        return { kind: 'MISSING' };
      }
      if (response.status !== 200 || !response.body) {
        await discard(response);
        throw storageUnavailable();
      }
      const chunks: Buffer[] = [];
      let size = 0;
      let truncated = false;
      try {
        for await (const chunk of response.body) {
          const buffer = Buffer.from(chunk);
          if (size + buffer.length > limit) {
            chunks.push(buffer.subarray(0, limit - size));
            size = limit;
            truncated = true;
            break;
          }
          chunks.push(buffer);
          size += buffer.length;
        }
      } catch {
        throw storageUnavailable();
      }
      if (truncated) await response.body.cancel().catch(() => undefined);
      return { kind: 'FOUND', bytes: Buffer.concat(chunks, size), truncated };
    });
  }

  async write(key: string, bytes: Uint8Array, contentType: ContentType): Promise<void> {
    const signal = AbortSignal.timeout(this.config.requestTimeoutMs);
    const digest = payloadHash(bytes);
    // Two digests of the body: the signed payload hash (AWS S3 verifies it)
    // and the checksum header (also verified by SeaweedFS, which does not
    // check the payload hash). A body altered in transit is refused.
    const response = await this.send(
      'PUT',
      this.url(key),
      {
        'content-type': contentType,
        'x-amz-checksum-sha256': Buffer.from(digest, 'hex').toString('base64'),
      },
      digest,
      bytes,
      signal,
    );
    await discard(response);
    if (response.status !== 200) throw storageUnavailable();
  }

  async remove(key: string): Promise<void> {
    const signal = AbortSignal.timeout(this.config.requestTimeoutMs);
    const response = await this.send('DELETE', this.url(key), {}, EMPTY_SHA256, null, signal);
    await discard(response);
    if (response.status !== 204 && response.status !== 200 && response.status !== 404) {
      throw storageUnavailable();
    }
  }

  /**
   * Provisioning helper for disposable test stacks only. Production buckets
   * (private, encrypted, lifecycle-managed) are provisioned by the platform.
   */
  async createBucketIfMissing(): Promise<void> {
    const signal = AbortSignal.timeout(this.config.requestTimeoutMs);
    const response = await this.send('PUT', this.url(null), {}, EMPTY_SHA256, null, signal);
    await discard(response);
    if (response.status !== 200 && response.status !== 409) throw storageUnavailable();
  }

  private async send(
    method: string,
    url: URL,
    headers: Readonly<Record<string, string>>,
    hash: string,
    body: Uint8Array | null,
    signal: AbortSignal,
  ): Promise<Response> {
    const signed = signHeaders({
      method,
      url,
      headers,
      payloadHash: hash,
      at: new Date(),
      credentials: this.credentials,
    });
    try {
      return await this.fetchImpl(url, {
        method,
        headers: signed,
        redirect: 'error',
        signal,
        ...(body === null ? {} : { body }),
      });
    } catch {
      throw storageUnavailable();
    }
  }
}

function lifetime(expiresAt: Date, now: Date): number {
  const seconds = Math.floor((expiresAt.getTime() - now.getTime()) / 1_000);
  if (seconds < 1 || seconds > MAX_PRESIGN_SECONDS) throw new Error('PRESIGN_LIFETIME_INVALID');
  return seconds;
}

/** The instant the store stops honouring a URL signed at `now` for `seconds`. */
function after(now: Date, seconds: number): Date {
  return new Date(now.getTime() + seconds * 1_000);
}

async function discard(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The response is not used; a body that cannot be cancelled is irrelevant.
  }
}
