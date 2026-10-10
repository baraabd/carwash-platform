import { mediaPolicy, type PolicySeconds } from '../../application/policy';
import { storageUnavailable } from '../../domain';
import type { MediaPolicy, ObjectStore } from '../../ports';
import { parseServiceClients, type ServiceClient } from '../security/service-clients';
import { S3ObjectStore, type S3Config } from '../storage/s3-object-store';

/**
 * Fail-fast configuration of the media processes (API and purge worker).
 *
 * Every value is validated when the process starts; an invalid or missing one
 * stops it with a code naming the variable, never echoing its value (some are
 * secrets). Nothing is guessed: there is no default endpoint, bucket or key.
 */
type Env = Readonly<Record<string, string | undefined>>;

function fail(name: string): never {
  throw new Error(`MEDIA_CONFIG_INVALID_${name}`);
}

function required(env: Env, name: string, pattern: RegExp): string {
  const value = env[name];
  if (value === undefined || !pattern.test(value)) fail(name);
  return value;
}

function integer(env: Env, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d{1,9}$/.test(raw)) fail(name);
  const value = Number(raw);
  if (value < min || value > max) fail(name);
  return value;
}

function optionalSeconds(env: Env, name: string): number | undefined {
  const raw = env[name];
  if (raw === undefined || raw === '') return undefined;
  if (!/^\d{1,9}$/.test(raw)) fail(name);
  return Number(raw);
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** http(s) origin only: no credentials, path, query or fragment. */
function endpoint(env: Env): string {
  const raw = env.MEDIA_S3_ENDPOINT;
  if (raw === undefined) fail('MEDIA_S3_ENDPOINT');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    fail('MEDIA_S3_ENDPOINT');
  }
  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    url.username !== '' ||
    url.password !== '' ||
    (url.pathname !== '/' && url.pathname !== '') ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    fail('MEDIA_S3_ENDPOINT');
  }
  // Plain HTTP only to a loopback store or with an explicit opt-in for a
  // private network segment; credentials-bearing traffic is TLS otherwise.
  if (
    url.protocol === 'http:' &&
    !LOOPBACK.has(url.hostname) &&
    env.MEDIA_S3_ALLOW_PLAINTEXT !== 'true'
  ) {
    fail('MEDIA_S3_ENDPOINT');
  }
  return url.origin;
}

export function loadS3Config(env: Env): S3Config {
  return {
    endpoint: endpoint(env),
    region: required(env, 'MEDIA_S3_REGION', /^[a-z0-9-]{2,32}$/),
    // S3 bucket naming rules (lower-case, 3-63, no leading/trailing dot or dash).
    bucket: required(env, 'MEDIA_S3_BUCKET', /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/),
    accessKeyId: required(env, 'MEDIA_S3_ACCESS_KEY_ID', /^[A-Za-z0-9]{3,128}$/),
    secretAccessKey: required(env, 'MEDIA_S3_SECRET_ACCESS_KEY', /^[\x21-\x7e]{8,256}$/),
    // ≤ 10 s: the purge worker holds a row lock across one request (see
    // WORKER_IDLE_IN_TRANSACTION_TIMEOUT_MS and the store transaction timeout).
    requestTimeoutMs: integer(env, 'MEDIA_S3_TIMEOUT_MS', 5_000, 100, 10_000),
    maxConcurrentReads: integer(env, 'MEDIA_S3_MAX_CONCURRENT_READS', 4, 1, 32),
  };
}

export function loadPolicy(env: Env): MediaPolicy {
  const seconds: PolicySeconds = {};
  const set = (key: keyof MediaPolicy, name: string): void => {
    const value = optionalSeconds(env, name);
    if (value !== undefined) seconds[key] = value;
  };
  set('reservationTtlMs', 'MEDIA_RESERVATION_TTL_SECONDS');
  set('uploadUrlTtlMs', 'MEDIA_UPLOAD_URL_TTL_SECONDS');
  set('readUrlTtlMs', 'MEDIA_READ_URL_TTL_SECONDS');
  set('retentionMs', 'MEDIA_UNCLAIMED_RETENTION_SECONDS');
  set('claimGuardMs', 'MEDIA_CLAIM_GUARD_SECONDS');
  set('expiryGraceMs', 'MEDIA_EXPIRY_GRACE_SECONDS');
  try {
    return mediaPolicy(seconds);
  } catch (error: unknown) {
    throw new Error(`MEDIA_CONFIG_INVALID_POLICY:${error instanceof Error ? error.message : ''}`, {
      cause: error,
    });
  }
}

export interface ApiConfig {
  readonly databaseUrl: string;
  readonly s3: S3Config;
  readonly policy: MediaPolicy;
  readonly identityUrl: string;
  readonly identityTimeoutMs: number;
  readonly serviceClients: readonly ServiceClient[];
  readonly userRequestsPerMinute: number;
  readonly serviceRequestsPerMinute: number;
}

export function loadApiConfig(env: Env): ApiConfig {
  const identityUrl = env.IDENTITY_URL;
  if (identityUrl === undefined || !/^https?:\/\/[^\s]+$/.test(identityUrl)) fail('IDENTITY_URL');
  try {
    new URL(identityUrl);
  } catch {
    fail('IDENTITY_URL');
  }
  let serviceClients: ServiceClient[];
  try {
    serviceClients = parseServiceClients(env.MEDIA_SERVICE_CLIENTS);
  } catch {
    fail('MEDIA_SERVICE_CLIENTS');
  }
  return {
    databaseUrl: required(env, 'DATABASE_URL', /^postgres(?:ql)?:\/\/\S+$/),
    s3: loadS3Config(env),
    policy: loadPolicy(env),
    identityUrl,
    identityTimeoutMs: integer(env, 'IDENTITY_TIMEOUT_MS', 2_000, 100, 30_000),
    serviceClients,
    userRequestsPerMinute: integer(env, 'MEDIA_USER_REQUESTS_PER_MINUTE', 120, 1, 100_000),
    serviceRequestsPerMinute: integer(
      env,
      'MEDIA_SERVICE_REQUESTS_PER_MINUTE',
      6_000,
      1,
      1_000_000,
    ),
  };
}

export interface WorkerConfig {
  readonly databaseUrl: string;
  readonly s3: S3Config;
  readonly policy: MediaPolicy;
}

export function loadWorkerConfig(env: Env): WorkerConfig {
  return {
    databaseUrl: required(env, 'DATABASE_URL', /^postgres(?:ql)?:\/\/\S+$/),
    s3: loadS3Config(env),
    policy: loadPolicy(env),
  };
}

/**
 * Store used when the module is composed without any S3 settings (a module
 * compile check). It fails closed on every call. The real process entry
 * points (main.ts, purge.main.ts) refuse to start without a valid S3 config.
 */
export const UNCONFIGURED_STORE: ObjectStore = {
  presignUpload: () => {
    throw storageUnavailable();
  },
  presignDownload: () => {
    throw storageUnavailable();
  },
  read: () => Promise.reject(storageUnavailable()),
  write: () => Promise.reject(storageUnavailable()),
  remove: () => Promise.reject(storageUnavailable()),
};

export function objectStoreFromEnv(env: Env): ObjectStore {
  const keys = Object.keys(env).filter((name) => name.startsWith('MEDIA_S3_'));
  if (keys.length === 0) return UNCONFIGURED_STORE;
  return new S3ObjectStore(loadS3Config(env));
}
