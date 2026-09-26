import 'reflect-metadata';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { GatewayService } from './application/gateway.service';
import { BoundedHttpClient } from './infrastructure/http-client';
import { PublicIdentityClient } from './infrastructure/identity-client';
import { validateGatewayConfig, type GatewayConfig } from './infrastructure/config';
import { GatewayController, GATEWAY_SERVICE } from './transport/http/controller';
import { GatewayFilter } from './transport/http/filter';
import { contextFor, type GatewayRequest, type GatewayResponse } from './transport/http/context';
export { loadGatewayConfig, type GatewayConfig } from './infrastructure/config';
export { gatewayOpenApi } from './transport/http/openapi';
export { routeMatch, idempotencyKey, GatewayFault } from './domain/policy';
export { BoundedHttpClient } from './infrastructure/http-client';
export async function createGatewayApplication(config: GatewayConfig): Promise<INestApplication> {
  validateGatewayConfig(config);
  const http = new BoundedHttpClient(config);
  const gateway = new GatewayService(http, new PublicIdentityClient(http, config), config);
  @Module({
    controllers: [GatewayController],
    providers: [{ provide: GATEWAY_SERVICE, useValue: gateway }],
  })
  class GatewayModule {}
  const app = await NestFactory.create<NestExpressApplication>(GatewayModule, {
    logger: false,
    bodyParser: false,
    abortOnError: false,
  });
  app.use((request: GatewayRequest, response: GatewayResponse, next: () => void) => {
    const context = contextFor(request.headers);
    request.gatewayContext = context;
    response.setHeader('x-request-id', context.requestId);
    response.setHeader('x-correlation-id', context.correlationId);
    response.setHeader('traceparent', context.traceparent);
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('cache-control', 'no-store');
    next();
  });
  // Nest's platform adapter supplies JSON parsing; no additional HTTP framework dependency.
  app.useBodyParser('json', { limit: '64kb', strict: true });
  app.useGlobalFilters(new GatewayFilter());
  return app;
}
