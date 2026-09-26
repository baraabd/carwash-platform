import { readFileSync } from 'node:fs';
import type { JSONWebKeySet } from 'jose';

export interface IdentityConfig {
  readonly databaseUrl: string;
  readonly redisUrl: string;
  readonly issuer: string;
  readonly audience: string;
  readonly privateKeyPem: string;
  readonly previousJwks: JSONWebKeySet;
  readonly otpPepper: Uint8Array;
  readonly csrfKey: Uint8Array;
  readonly rateKey: Uint8Array;
  readonly origins: readonly string[];
  readonly cookieSecure: boolean;
  readonly deliveryUrl: string;
  readonly deliveryToken: string;
}
export function loadIdentityConfig(env: NodeJS.ProcessEnv = process.env): IdentityConfig {
  const required = (name: string): string => {
    const value = env[name];
    if (!value) throw new Error(`${name}_REQUIRED`);
    return value;
  };
  const environment = required('APP_ENV');
  if (!['production', 'staging', 'development'].includes(environment))
    throw new Error('INVALID_APP_ENV');
  const hardened = environment !== 'development';
  const readSecret = (name: string): Buffer => {
    const value = readFileSync(required(name));
    if (value.length < 32 || value.length > 256) throw new Error(`${name}_INVALID_LENGTH`);
    return value;
  };
  const cookieSecure = env.COOKIE_SECURE !== 'false';
  if (env.COOKIE_SECURE !== undefined && !['true', 'false'].includes(env.COOKIE_SECURE))
    throw new Error('INVALID_COOKIE_SECURE');
  if (hardened && !cookieSecure) throw new Error('SECURE_COOKIES_REQUIRED');
  const origins = required('IDENTITY_ALLOWED_ORIGINS')
    .split(',')
    .map((item) => item.trim());
  if (origins.length < 1 || origins.length > 10 || new Set(origins).size !== origins.length)
    throw new Error('INVALID_AUTH_ORIGINS');
  for (const origin of origins) {
    const parsed = new URL(origin);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
    if (
      parsed.origin !== origin ||
      (parsed.protocol !== 'https:' && (hardened || !loopback || parsed.protocol !== 'http:'))
    )
      throw new Error('INVALID_AUTH_ORIGIN');
  }
  const redisUrl = required('IDENTITY_REDIS_URL');
  const redis = new URL(redisUrl);
  if (
    !['redis:', 'rediss:'].includes(redis.protocol) ||
    (hardened && redis.protocol !== 'rediss:') ||
    !redis.username ||
    !redis.password
  )
    throw new Error('AUTHENTICATED_REDIS_REQUIRED');
  if (
    !hardened &&
    redis.protocol === 'redis:' &&
    !['localhost', '127.0.0.1', '[::1]'].includes(redis.hostname)
  )
    throw new Error('LOCAL_REDIS_LOOPBACK_REQUIRED');
  const issuer = required('IDENTITY_ISSUER');
  const parsedIssuer = new URL(issuer);
  if (
    parsedIssuer.username ||
    parsedIssuer.password ||
    parsedIssuer.hash ||
    parsedIssuer.search ||
    (hardened && parsedIssuer.protocol !== 'https:')
  )
    throw new Error('INVALID_IDENTITY_ISSUER');
  const previousJwks = env.IDENTITY_PREVIOUS_JWKS_FILE
    ? (JSON.parse(readFileSync(env.IDENTITY_PREVIOUS_JWKS_FILE, 'utf8')) as JSONWebKeySet)
    : { keys: [] };
  if (!Array.isArray(previousJwks.keys)) throw new Error('INVALID_PUBLIC_JWKS');
  return {
    databaseUrl: required('DATABASE_URL'),
    redisUrl,
    issuer,
    audience: required('IDENTITY_AUDIENCE'),
    privateKeyPem: readFileSync(required('IDENTITY_PRIVATE_KEY_FILE'), 'utf8'),
    previousJwks,
    otpPepper: readSecret('IDENTITY_OTP_PEPPER_FILE'),
    csrfKey: readSecret('IDENTITY_CSRF_KEY_FILE'),
    rateKey: readSecret('IDENTITY_RATE_KEY_FILE'),
    origins,
    cookieSecure,
    deliveryUrl: required('IDENTITY_OTP_DELIVERY_URL'),
    deliveryToken: readFileSync(required('IDENTITY_OTP_DELIVERY_TOKEN_FILE'), 'utf8').trim(),
  };
}
