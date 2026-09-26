import { All, Controller, Get, Inject, Req, Res } from '@nestjs/common';
import { GatewayService } from '../../application/gateway.service';
import { contextFor, scalarHeaders, type GatewayRequest, type GatewayResponse } from './context';
import { gatewayOpenApi } from './openapi';
export const GATEWAY_SERVICE = Symbol('GATEWAY_SERVICE');
@Controller()
export class GatewayController {
  constructor(@Inject(GATEWAY_SERVICE) private readonly gateway: GatewayService) {}
  @Get('health/live') live() {
    return {
      service: 'api-gateway',
      live: true,
      capability: 'routing-foundation',
      businessReady: false,
    };
  }
  @Get('health/dependencies') dependencies() {
    return this.gateway.dependencies();
  }
  @Get('health/ready') async ready(@Res() response: GatewayResponse) {
    const dependencies = await this.gateway.dependencies();
    const ready =
      Object.values(dependencies).length > 0 && Object.values(dependencies).every(Boolean);
    return response
      .status(ready ? 200 : 503)
      .json({ service: 'api-gateway', ready, businessReady: false, dependencies });
  }
  @Get('api/v1/contracts') contracts() {
    return gatewayOpenApi();
  }
  @All('api/v1/{*route}') async route(
    @Req() request: GatewayRequest,
    @Res() response: GatewayResponse,
  ) {
    const context = request.gatewayContext ?? contextFor(request.headers);
    const reply = await this.gateway.dispatch({
      method: request.method,
      url: request.originalUrl,
      headers: scalarHeaders(request.headers),
      body: request.body,
      context,
    });
    response.setHeader('cache-control', 'no-store');
    if (reply.cookies.length) response.setHeader('set-cookie', reply.cookies);
    if (reply.status === 204) {
      response.status(204).end();
      return;
    }
    response.status(reply.status).json(reply.body);
  }
}
