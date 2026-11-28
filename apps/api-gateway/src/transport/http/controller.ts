import { All, Controller, Get, Inject, Req, Res } from '@nestjs/common';
import { GatewayService } from '../../application/gateway.service';
import { contextFor, scalarHeaders, type GatewayRequest, type GatewayResponse } from './context';
import { gatewayOpenApi } from './openapi';
import { gatewayRoutingConfigured, REQUIRED_GATEWAY_OWNERS } from '../../infrastructure/config';
import type { GatewayConfig } from '../../ports/config';
export const GATEWAY_SERVICE = Symbol('GATEWAY_SERVICE');
export const GATEWAY_CONFIG = Symbol('GATEWAY_CONFIG');
@Controller()
export class GatewayController {
  constructor(
    @Inject(GATEWAY_SERVICE) private readonly gateway: GatewayService,
    @Inject(GATEWAY_CONFIG) private readonly config: GatewayConfig,
  ) {}
  @Get('health/live') live() {
    return {
      service: 'api-gateway',
      live: true,
      capability: 'routing-v1',
      scope: 'http-api',
      businessReady: gatewayRoutingConfigured(this.config),
    };
  }
  @Get('health/dependencies') dependencies() {
    return this.gateway.dependencies();
  }
  @Get('health/ready') async ready(@Res() response: GatewayResponse) {
    const dependencies = await this.gateway.dependencies();
    const businessReady = gatewayRoutingConfigured(this.config);
    const ready =
      businessReady && REQUIRED_GATEWAY_OWNERS.every((owner) => dependencies[owner] === true);
    return response.status(ready ? 200 : 503).json({
      service: 'api-gateway',
      scope: 'http-api',
      ready,
      businessReady,
      code: !businessReady ? 'UPSTREAMS_NOT_CONFIGURED' : ready ? 'READY' : 'DEPENDENCY_DOWN',
      missingOwners: REQUIRED_GATEWAY_OWNERS.filter((owner) => !this.config.origins[owner]),
      dependencies,
    });
  }
  @Get('api/v1/contracts') contracts() {
    return gatewayOpenApi();
  }
  @All(['api/v1/{*route}', 'api/operator/{*route}']) async route(
    @Req() request: GatewayRequest,
    @Res() response: GatewayResponse,
  ) {
    const context = request.gatewayContext ?? contextFor(request.headers);
    const reply = await this.gateway.dispatch({
      method: request.method,
      url: request.originalUrl,
      headers: scalarHeaders(request.headers),
      body: request.body,
      ...(request.rawBody ? { rawBody: request.rawBody } : {}),
      context,
    });
    response.setHeader('cache-control', 'no-store');
    if (reply.etag) response.setHeader('etag', reply.etag);
    if (reply.idempotentReplayed === true) response.setHeader('idempotent-replayed', 'true');
    if (reply.cookies.length) response.setHeader('set-cookie', reply.cookies);
    if (reply.status === 204) {
      response.status(204).end();
      return;
    }
    response.status(reply.status).json(reply.body);
  }
}
