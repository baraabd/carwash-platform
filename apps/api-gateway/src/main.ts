import { serviceTelemetry } from '@carwash/observability';
import { createGatewayApplication, loadGatewayConfig } from './index';

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 4000);
  const shutdownMs = Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 10000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('INVALID_PORT');
  if (!Number.isInteger(shutdownMs) || shutdownMs < 100 || shutdownMs > 300000)
    throw new Error('INVALID_SHUTDOWN_TIMEOUT');
  const app = await createGatewayApplication(loadGatewayConfig());
  const telemetry = serviceTelemetry('api-gateway');
  try {
    await app.listen(port, process.env.HOST ?? '127.0.0.1');
  } catch (error: unknown) {
    await app.close();
    throw error;
  }
  telemetry.logger.info('service_started', { port });

  let stopping: Promise<void> | undefined;
  const shutdown = (signal: NodeJS.Signals): Promise<void> => {
    stopping ??= (async () => {
      let timer: NodeJS.Timeout | undefined;
      let code = 0;
      telemetry.logger.info('service_stopping', { signal });
      try {
        await Promise.race([
          app.close(),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error('SHUTDOWN_TIMEOUT')), shutdownMs);
          }),
        ]);
        telemetry.logger.info('service_stopped', { signal });
      } catch (error: unknown) {
        code = 1;
        telemetry.logger.error('service_stop_failed', { signal, error });
      } finally {
        if (timer) clearTimeout(timer);
        await telemetry.shutdown();
      }
      process.exit(code);
    })();
    return stopping;
  };
  // Own the exit after bounded cleanup; Nest's re-raised signal would exit 143.
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });
}
void main().catch(async (error: unknown) => {
  const telemetry = serviceTelemetry('api-gateway');
  telemetry.logger.error('gateway_startup_failed', { error });
  await telemetry.shutdown();
  process.exitCode = 1;
});
