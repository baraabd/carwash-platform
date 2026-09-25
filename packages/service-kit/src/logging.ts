/**
 * Structured, redacted logging.
 *
 * Redaction is applied to the serialized record, not only to known key names,
 * because an unexpected nested field is exactly the case that leaks. This is a
 * defence-in-depth control, not a licence to put personal data in log calls.
 */

const SECRET_KEY =
  /(pass(word)?|secret|token|authorization|apikey|api_key|credential|connection_?string|dsn|url)/i;

/** Postgres/AMQP URLs carry credentials in the authority section. */
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/)([^:/?#\s]+):([^@/?#\s]+)@/gi;

export const REDACTED = '[REDACTED]';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogFields {
  readonly [key: string]: unknown;
}

export interface Logger {
  readonly service: string;
  child(fields: LogFields): Logger;
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

export function redactValue(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(URL_CREDENTIALS, `$1$2:${REDACTED}@`);
  return value;
}

export function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (depth > 6) return '[TRUNCATED_DEPTH]';
  if (value === null || typeof value !== 'object') return redactValue(value);
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, depth + 1, seen));
  if (value instanceof Error) {
    return { name: value.name, message: String(redactValue(value.message)) };
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_KEY.test(key) ? REDACTED : redact(item, depth + 1, seen);
  }
  return out;
}

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LoggerOptions {
  readonly service: string;
  readonly level?: LogLevel;
  /** Injected so tests can assert output without capturing the real stream. */
  readonly sink?: (line: string) => void;
  readonly clock?: () => Date;
  readonly base?: LogFields;
}

export function createLogger(options: LoggerOptions): Logger {
  const level = options.level ?? 'info';
  const sink = options.sink ?? ((line: string) => process.stdout.write(`${line}\n`));
  const clock = options.clock ?? (() => new Date());
  const base = options.base ?? {};

  const emit = (logLevel: LogLevel, message: string, fields?: LogFields): void => {
    if (ORDER[logLevel] < ORDER[level]) return;
    const record = {
      ts: clock().toISOString(),
      level: logLevel,
      service: options.service,
      msg: String(redactValue(message)),
      ...(redact({ ...base, ...(fields ?? {}) }) as Record<string, unknown>),
    };
    sink(JSON.stringify(record));
  };

  const logger: Logger = {
    service: options.service,
    child: (fields: LogFields) =>
      createLogger({
        service: options.service,
        level,
        sink,
        clock,
        base: { ...base, ...fields },
      }),
    debug: (message, fields) => emit('debug', message, fields),
    info: (message, fields) => emit('info', message, fields),
    warn: (message, fields) => emit('warn', message, fields),
    error: (message, fields) => emit('error', message, fields),
  };
  return logger;
}
