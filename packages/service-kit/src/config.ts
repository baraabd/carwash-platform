/** Fail-closed runtime configuration. An invalid value stops the process. */

export interface ServiceRuntimeConfig {
  readonly service: string;
  readonly port: number;
  readonly host: string;
  readonly logLevel: 'debug' | 'info' | 'warn' | 'error';
}

const LOG_LEVELS = new Set(['debug', 'info', 'warn', 'error']);

export function parsePort(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  if (!/^[0-9]{1,5}$/.test(value)) throw new Error('INVALID_PORT');
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('INVALID_PORT');
  return port;
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
    // Loopback by default: exposing a foundation shell is never implicit.
    host: env.HOST ?? '127.0.0.1',
    logLevel: logLevel as ServiceRuntimeConfig['logLevel'],
  };
}
