import 'reflect-metadata';
import { bootstrapService, createLogger } from '@carwash/service-kit';
import { BUSINESS_READY, SERVICE_NAME } from './app.module';
import { createHttpApplication } from './transport/http/create-app';
import { CustomerTransportExceptionFilter } from './transport/http/customer-contract.filter';

void bootstrapService({
  service: SERVICE_NAME,
  businessReady: BUSINESS_READY,
  createApplication: createHttpApplication,
  createExceptionFilter: (logger) => new CustomerTransportExceptionFilter(logger),
}).catch((error: unknown) => {
  createLogger({ service: 'customer' }).error('bootstrap_failed', { error });
  process.exitCode = 1;
});
