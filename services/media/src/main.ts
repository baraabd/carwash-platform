import 'reflect-metadata';
import { bootstrapService, createLogger } from '@carwash/service-kit';
import { BUSINESS_READY, SERVICE_NAME } from './app.module';
import { loadApiConfig } from './infrastructure/config/media-config';
import { createHttpApplication } from './transport/http/create-app';

const logger = createLogger({ service: 'media' });

/** Fail fast: an invalid configuration stops the process before it listens. */
function validConfiguration(): boolean {
  try {
    loadApiConfig(process.env);
    return true;
  } catch (error: unknown) {
    // The code names the variable; values (some secret) are never echoed.
    logger.error('configuration_invalid', {
      code: error instanceof Error ? error.message : 'UNKNOWN',
    });
    process.exitCode = 1;
    return false;
  }
}

if (validConfiguration()) {
  void bootstrapService({
    service: SERVICE_NAME,
    businessReady: BUSINESS_READY,
    createApplication: createHttpApplication,
  }).catch((error: unknown) => {
    logger.error('bootstrap_failed', { error });
    process.exitCode = 1;
  });
}
