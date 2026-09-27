import type { INestApplication } from '@nestjs/common';
import { loadServiceRuntimeConfig, type ServiceRuntimeConfig } from './config';
import { AppExceptionFilter } from './http-filter';
import type { Logger } from './logging';
import { instrumentApplication, serviceTelemetry } from '@carwash/observability';

export interface BootstrapOptions {
  readonly service: string;
  readonly businessReady: boolean;
  readonly createApplication: () => Promise<INestApplication>;
  readonly env?: NodeJS.ProcessEnv;
  readonly installSignalHandlers?: boolean;
  readonly exit?: (code: number) => void;
}

export interface ServiceRuntime {
  readonly app: INestApplication;
  readonly config: ServiceRuntimeConfig;
  readonly logger: Logger;
  shutdown(signal: NodeJS.Signals | 'TEST'): Promise<void>;
}

function withTimeout<T>(label: string, promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}_TIMEOUT`)), timeoutMs);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export async function bootstrapService(options: BootstrapOptions): Promise<ServiceRuntime> {
  const config = loadServiceRuntimeConfig(options.service, options.env);
  const telemetry = serviceTelemetry(options.service, options.env);
  const logger = telemetry.logger;
  const exit = options.exit ?? ((code: number) => process.exit(code));

  const app = await withTimeout(
    'STARTUP_CREATE_APPLICATION',
    options.createApplication(),
    config.startupTimeoutMs,
  ).catch(async (error: unknown) => {
    await telemetry.shutdown();
    throw error;
  });
  instrumentApplication(app, options.service, options.env);

  app.useGlobalFilters(new AppExceptionFilter(logger));

  try {
    await withTimeout(
      'STARTUP_LISTEN',
      app.listen(config.port, config.host),
      config.startupTimeoutMs,
    );
  } catch (error: unknown) {
    await withTimeout('STARTUP_ROLLBACK', app.close(), config.shutdownTimeoutMs).catch(() => {});
    await telemetry.shutdown();
    throw error;
  }

  logger.info('service_started', {
    port: config.port,
    host: config.host,
    businessReady: options.businessReady,
  });

  let shuttingDown: Promise<void> | undefined;
  const shutdown = (signal: NodeJS.Signals | 'TEST'): Promise<void> => {
    if (shuttingDown) return shuttingDown;
    shuttingDown = (async () => {
      logger.info('service_stopping', { signal });
      try {
        await withTimeout('SHUTDOWN', app.close(), config.shutdownTimeoutMs);
        logger.info('service_stopped', { signal });
        await telemetry.shutdown();
        if (signal !== 'TEST') exit(0);
      } catch (error: unknown) {
        logger.error('service_stop_failed', { signal, error });
        await telemetry.shutdown();
        if (signal !== 'TEST') exit(1);
        else throw error;
      }
    })();
    return shuttingDown;
  };

  if (options.installSignalHandlers !== false) {
    process.once('SIGTERM', () => {
      void shutdown('SIGTERM');
    });
    process.once('SIGINT', () => {
      void shutdown('SIGINT');
    });
  }

  return { app, config, logger, shutdown };
}
