import 'reflect-metadata';
import { bootstrapService, createLogger } from '@carwash/service-kit';
import { BUSINESS_READY, SERVICE_NAME } from './app.module';
import { createHttpApplication } from './transport/http/create-app';

void bootstrapService({
  service: SERVICE_NAME,
  businessReady: BUSINESS_READY,
  createApplication: createHttpApplication,
}).catch((error: unknown) => {
  createLogger({ service: 'workforce' }).error('bootstrap_failed', { error });
  process.exitCode = 1;
});
