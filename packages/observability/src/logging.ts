import { writeSync } from 'node:fs';
import pino from 'pino';
import { logContext } from './context';

export const REDACTED = '[REDACTED]';
const SECRET_KEY =
  /(pass(word)?|secret|token|authorization|cookie|otp|pin$|apikey|api_key|credential|connection_?string|dsn|url|body|payload|payment|card|document|evidence|passport|national.?id|email|phone)/i;
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/)([^:/?#\s]+):([^@/?#\s]+)@/gi;
const RESERVED = new Set([
  'service',
  'environment',
  'level',
  'ts',
  'msg',
  'requestId',
  'correlationId',
  'traceId',
  'spanId',
  '__proto__',
  'constructor',
  'prototype',
]);
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
  flush(): Promise<void>;
}
export interface LoggerOptions {
  readonly service: string;
  readonly environment?: string;
  readonly level?: LogLevel;
  readonly sink?: (line: string) => void;
  readonly clock?: () => Date;
  readonly base?: LogFields;
}
export function redactValue(value: unknown): unknown {
  if (typeof value === 'bigint') return '[BIGINT]';
  if (typeof value === 'function' || typeof value === 'symbol') return '[UNSUPPORTED]';
  if (typeof value !== 'string') return value;
  return value
    .slice(0, 2048)
    .replace(URL_CREDENTIALS, `$1$2:${REDACTED}@`)
    .replace(/\bBearer\s+[^\s,;]+/gi, `Bearer ${REDACTED}`)
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, REDACTED)
    .replace(
      /\b(password|token|secret|otp|cookie|authorization)\s*[:=]\s*[^\s,;]+/gi,
      `$1=${REDACTED}`,
    );
}
export function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  try {
    if (depth > 6) return '[TRUNCATED_DEPTH]';
    if (value === null || typeof value !== 'object') return redactValue(value);
    if (seen.has(value)) return '[CIRCULAR]';
    seen.add(value);
    if (value instanceof Error) return { name: 'Error', message: REDACTED };
    if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) return REDACTED;
    if (Array.isArray(value))
      return value.slice(0, 50).map((item) => redact(item, depth + 1, seen));
    const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    // Descriptors avoid executing getters and toJSON on untrusted log objects.
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of Object.keys(descriptors).slice(0, 100)) {
      const descriptor = descriptors[key];
      if (!descriptor || !descriptor.enumerable) continue;
      out[key] = SECRET_KEY.test(key)
        ? REDACTED
        : 'value' in descriptor
          ? redact(descriptor.value, depth + 1, seen)
          : '[ACCESSOR]';
    }
    return out;
  } catch {
    return '[UNREADABLE]';
  }
}
function fields(value: unknown): Record<string, unknown> {
  const result = redact(value);
  if (result === null || typeof result !== 'object' || Array.isArray(result)) return {};
  return Object.fromEntries(Object.entries(result).filter(([key]) => !RESERVED.has(key)));
}
export function createLogger(options: LoggerOptions): Logger {
  const sink =
    options.sink ??
    ((line: string) => {
      writeSync(1, `${line}\n`);
    });
  const clock = options.clock ?? (() => new Date());
  const destination = {
    write: (line: string): void => {
      try {
        sink(line.trimEnd());
      } catch {
        /* Telemetry is never a business dependency. */
      }
    },
  };
  const logger = pino(
    {
      level: options.level ?? 'info',
      base: null,
      timestamp: () => {
        try {
          return `,"ts":${JSON.stringify(clock().toISOString())}`;
        } catch {
          return ',"ts":null,"clockError":true';
        }
      },
      formatters: { level: (label) => ({ level: label }) },
    },
    destination,
  );
  const base = fields(options.base ?? {});
  const emit = (level: LogLevel, message: string, extra?: LogFields): void => {
    try {
      // Event names are static identifiers; arbitrary exception/body text is forbidden.
      const event = /^[a-zA-Z0-9_.:-]{1,100}$/.test(message) ? message : REDACTED;
      logger[level](
        {
          ...base,
          ...fields(extra ?? {}),
          service: options.service,
          environment: options.environment ?? 'development',
          ...logContext(),
        },
        event,
      );
    } catch {
      /* Includes hostile serializers, clocks and destination failures. */
    }
  };
  return {
    service: options.service,
    child: (extra) => createLogger({ ...options, base: { ...base, ...fields(extra) } }),
    debug: (message, extra) => emit('debug', message, extra),
    info: (message, extra) => emit('info', message, extra),
    warn: (message, extra) => emit('warn', message, extra),
    error: (message, extra) => emit('error', message, extra),
    // The destination writes synchronously; resolving proves all accepted writes completed.
    flush: () => Promise.resolve(),
  };
}

export function bestEffortLog(
  logger: Pick<Logger, 'debug' | 'info' | 'warn' | 'error'> | undefined,
  level: LogLevel,
  event: string,
  fields?: LogFields,
): void {
  try {
    logger?.[level](event, fields);
  } catch {
    /* An observer cannot change delivery semantics. */
  }
}
