import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import {
  createLogger,
  loadServiceRuntimeConfig,
  resolveCorrelationId,
  CORRELATION_HEADER,
} from '@carwash/service-kit';
import { AppModule, SERVICE_NAME } from './app.module';

/**
 * support bootstrap.
 *
 * Notably absent: any migration call. Schema changes are a separate job run by a
 * separate database identity; replicas that migrate on startup race each other
 * and make rollbacks unpredictable.
 */
async function bootstrap(): Promise<void> {
  const config = loadServiceRuntimeConfig(SERVICE_NAME);
  const logger = createLogger({ service: SERVICE_NAME, level: config.logLevel });

  const app = await NestFactory.create(AppModule, { bufferLogs: false });

  // Correlation propagation: a caller-supplied id is accepted only when it is a
  // well-formed UUID, so an untrusted header can never become a log label.
  app.use(
    (
      req: { headers: Record<string, unknown> },
      res: { setHeader(k: string, v: string): void },
      next: () => void,
    ) => {
      const correlationId = resolveCorrelationId(req.headers[CORRELATION_HEADER]);
      req.headers[CORRELATION_HEADER] = correlationId;
      res.setHeader(CORRELATION_HEADER, correlationId);
      next();
    },
  );

  app.enableShutdownHooks();

  // Loopback unless HOST is set explicitly: exposing a foundation shell on all
  // interfaces is never implicit.
  await app.listen(config.port, config.host);
  logger.info('service_started', { port: config.port, host: config.host, businessReady: false });

  const shutdown = (signal: string): void => {
    logger.info('service_stopping', { signal });
    // Controlled close: in-flight requests finish, then the process exits 0.
    void app
      .close()
      .then(() => {
        logger.info('service_stopped', { signal });
        process.exit(0);
      })
      .catch((error: unknown) => {
        logger.error('service_stop_failed', {
          error: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
        });
        process.exit(1);
      });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

void bootstrap().catch((error: unknown) => {
  // Structured, redacted: a DSN in a startup error must not reach the log.
  createLogger({ service: SERVICE_NAME }).error('bootstrap_failed', { error });
  process.exitCode = 1;
});
