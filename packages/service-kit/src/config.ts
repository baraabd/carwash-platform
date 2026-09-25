/** Fail-closed runtime configuration. An invalid value stops the process. */
export interface ServiceRuntimeConfig {
  readonly service: string;
  readonly port: number;
  readonly host: string;
  readonly logLevel: 'debug' | 'info' | 'warn' | 'error';
  readonly startupTimeoutMs: number;
  readonly shutdownTimeoutMs: number;
}

const LOG_LEVELS = new Set(['debug', 'info', 'warn', 'error']);
export const DEFAULT_STARTUP_TIMEOUT_MS = 30_000;
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;
const TIMEOUT_MIN_MS = 100;
const TIMEOUT_MAX_MS = 300_000;

export function parsePort(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  if (!/^[0-9]{1,5}$/.test(value)) throw new Error('INVALID_PORT');
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('INVALID_PORT');
  return port;
}

export function parseDurationMs(
  value: string | undefined,
  fallback: number,
  errorCode: string,
): number {
  if (value === undefined || value === '') return fallback;
  if (!/^[0-9]{1,7}$/.test(value)) throw new Error(errorCode);
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < TIMEOUT_MIN_MS || parsed > TIMEOUT_MAX_MS) {
    throw new Error(errorCode);
  }
  return parsed;
}

export function loadServiceRuntimeConfig(
  service: string,
  env: NodeJS.ProcessEnv = process.env,
): ServiceRuntimeConfig {
  const logLevel = env.LOG_LEVEL ?? 'info';
  if (!LOG_LEVELS.has(logLevel)) throw new Error('INVALID_LOG_LEVEL');
  return {
    service,
    port: parsePort(env.PORT, 3000),
    host: env.HOST ?? '127.0.0.1',
    logLevel: logLevel as ServiceRuntimeConfig['logLevel'],
    startupTimeoutMs: parseDurationMs(
      env.STARTUP_TIMEOUT_MS,
      DEFAULT_STARTUP_TIMEOUT_MS,
      'INVALID_STARTUP_TIMEOUT_MS',
    ),
    shutdownTimeoutMs: parseDurationMs(
      env.SHUTDOWN_TIMEOUT_MS,
      DEFAULT_SHUTDOWN_TIMEOUT_MS,
      'INVALID_SHUTDOWN_TIMEOUT_MS',
    ),
  };
}
