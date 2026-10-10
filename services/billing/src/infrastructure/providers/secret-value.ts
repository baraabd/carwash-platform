import { readFileSync, statSync } from 'node:fs';
import { inspect } from 'node:util';

const MAX_SECRET_BYTES = 4_096;
const REDACTED = '[redacted]';

export class SecretUnavailable extends Error {
  constructor(readonly secretName: string) {
    super(`SECRET_UNAVAILABLE:${secretName}`);
    this.name = 'SecretUnavailable';
  }
}

/**
 * A provider credential held in memory only. It is read from a mounted file
 * (`<NAME>_FILE`, injected by the platform: Lane E secret delivery), never from
 * a plain environment value, and it renders as "[redacted]" in every string,
 * JSON or inspect form so a log line or error can never carry it. Only an
 * adapter that signs or verifies with it calls reveal().
 */
export class SecretValue {
  readonly #value: string;

  private constructor(
    readonly name: string,
    value: string,
  ) {
    this.#value = value;
  }

  /** Reads `<name>_FILE`; returns null when the deployment does not configure it. */
  static fromFileEnv(
    name: string,
    env: Readonly<Record<string, string | undefined>>,
  ): SecretValue | null {
    if (env[name] !== undefined) throw new SecretUnavailable(name);
    const path = env[`${name}_FILE`];
    if (path === undefined || path === '') return null;
    try {
      if (statSync(path).size > MAX_SECRET_BYTES) throw new SecretUnavailable(name);
      const value = readFileSync(path, 'utf8').replace(/\r?\n$/, '');
      if (value.length === 0) throw new SecretUnavailable(name);
      return new SecretValue(name, value);
    } catch (error: unknown) {
      if (error instanceof SecretUnavailable) throw error;
      // The file system error may contain the path only; never the content.
      throw new SecretUnavailable(name);
    }
  }

  /** For tests and in-memory provisioning; production uses fromFileEnv. */
  static of(name: string, value: string): SecretValue {
    if (value.length === 0 || Buffer.byteLength(value) > MAX_SECRET_BYTES)
      throw new SecretUnavailable(name);
    return new SecretValue(name, value);
  }

  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [inspect.custom](): string {
    return REDACTED;
  }
}
