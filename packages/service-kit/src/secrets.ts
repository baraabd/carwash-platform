import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Secret source interface (P04-E3). A secret comes from exactly one of:
 *  - `<NAME>_FILE`: an absolute path to a file mounted by the secret manager
 *    (Kubernetes/Docker secret, Vault agent, ...). Preferred in production.
 *  - `<NAME>`: the environment variable itself (local and CI only).
 * Both set is a configuration error (ambiguous rotation). Neither set returns
 * null, so the caller fails closed (e.g. provider NOT_CONFIGURED, readiness 503).
 *
 * Secrets never belong in the repository, a client bundle, a URL, a log line
 * or an event. Errors name the variable, never the value.
 *
 * A file may hold several secrets, one per line (rotation: newest first); blank
 * lines and surrounding whitespace are ignored.
 */
export type SecretError =
  | 'SECRET_AMBIGUOUS'
  | 'SECRET_FILE_NOT_ABSOLUTE'
  | 'SECRET_FILE_UNREADABLE'
  | 'SECRET_TOO_SHORT'
  | 'SECRET_TOO_MANY'
  | 'SECRET_NAME_INVALID';

export class SecretConfigurationError extends Error {
  constructor(
    readonly code: SecretError,
    readonly variable: string,
  ) {
    super(`${code}: ${variable}`);
    this.name = 'SecretConfigurationError';
  }
}

const NAME = /^[A-Z][A-Z0-9_]{2,63}$/;
const MAX_FILE_BYTES = 16_384;
const MAX_SECRETS = 4;

export interface SecretOptions {
  /** Minimum length of each secret in bytes (UTF-8). Default 32. */
  readonly minBytes?: number;
}

function raw(env: NodeJS.ProcessEnv, name: string): string | null {
  if (!NAME.test(name)) throw new SecretConfigurationError('SECRET_NAME_INVALID', name);
  const direct = env[name];
  const file = env[`${name}_FILE`];
  const hasDirect = direct !== undefined && direct !== '';
  const hasFile = file !== undefined && file !== '';
  if (hasDirect && hasFile) throw new SecretConfigurationError('SECRET_AMBIGUOUS', name);
  if (hasDirect) return direct;
  if (!hasFile) return null;
  if (!path.isAbsolute(file)) throw new SecretConfigurationError('SECRET_FILE_NOT_ABSOLUTE', name);
  try {
    if (statSync(file).size > MAX_FILE_BYTES) throw new Error('too large');
    return readFileSync(file, 'utf8');
  } catch {
    throw new SecretConfigurationError('SECRET_FILE_UNREADABLE', name);
  }
}

/** All active secrets for NAME (newest first), or [] when not configured. */
export function readSecrets(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
  options: SecretOptions = {},
): Buffer[] {
  const value = raw(env, name);
  if (value === null) return [];
  const secrets = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  if (secrets.length > MAX_SECRETS) throw new SecretConfigurationError('SECRET_TOO_MANY', name);
  const minBytes = options.minBytes ?? 32;
  return secrets.map((secret) => {
    const bytes = Buffer.from(secret, 'utf8');
    if (bytes.length < minBytes) throw new SecretConfigurationError('SECRET_TOO_SHORT', name);
    return bytes;
  });
}

/** Exactly one secret (the newest when rotating), or null when not configured. */
export function readSecret(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
  options: SecretOptions = {},
): Buffer | null {
  return readSecrets(name, env, options)[0] ?? null;
}
