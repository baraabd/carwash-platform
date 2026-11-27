import 'reflect-metadata';
import { createLogger, serviceTelemetry } from '@carwash/service-kit';
import { runRuntime } from './runtime';

/** Deploy this entrypoint once per worker replica; the API process remains HTTP-only. */
export async function main(): Promise<void> {
  const controller = new AbortController();
  const stop = (): void => controller.abort();
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  const telemetry = serviceTelemetry('scheduling');
  try {
    await runRuntime(process.env, controller.signal);
  } finally {
    process.removeListener('SIGTERM', stop);
    process.removeListener('SIGINT', stop);
    await telemetry.shutdown();
  }
}

if (require.main === module)
  void main().catch((error: unknown) => {
    createLogger({ service: 'scheduling' }).error('runtime_worker_fatal', {
      error: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
    });
    process.exitCode = 1;
  });
