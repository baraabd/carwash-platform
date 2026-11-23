/**
 * Real customer production bundle, static runtime, Gateway and owner services.
 * The loopback ingress only selects the static server or Gateway; it defines no
 * business routes, auth decisions or fixture responses. Insecure cookies are
 * limited to this explicit loopback acceptance origin.
 */
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createWebRuntime } from '../../../infra/web-runtime.mjs';
import { ROOT, context, startIdentity, startService } from './_support.mjs';

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

export async function startCustomerStack() {
  const web = createWebRuntime({ documentRoot: path.join(ROOT, 'apps/customer-web/dist') });
  const webPort = await listen(web);
  const front = createServer();
  const port = await listen(front);
  const origin = `http://127.0.0.1:${port}`;
  const apps = [];
  async function stop() {
    for (const server of [front, web]) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    for (const app of apps.reverse()) await app.close().catch(() => {});
  }
  try {
    const identity = await startIdentity({ origins: [origin], cookieSecure: false });
    apps.push(identity.app);
    const customer = await startService('customer', context.services.customer.app, {
      CUSTOMER_IDENTITY_ORIGIN: identity.base,
      CUSTOMER_IDENTITY_TIMEOUT_MS: '3000',
    });
    apps.push(customer.app);
    const vehicle = await startService('vehicle', context.services.vehicle.app, {
      VEHICLE_IDENTITY_ORIGIN: identity.base,
      VEHICLE_IDENTITY_TIMEOUT_MS: '3000',
    });
    apps.push(vehicle.app);
    const own = createRequire(path.join(ROOT, 'apps/api-gateway/package.json'));
    const { createGatewayApplication } = own('./dist/index.js');
    const gateway = await createGatewayApplication({
      origins: { identity: identity.base, customer: customer.base, vehicle: vehicle.base },
      issuer: 'https://identity.washgo.invalid',
      audience: 'washgo-web',
      cookiePrefix: 'wg_',
      timeoutMs: 5000,
      responseLimit: 262144,
      allowedOrigins: [origin],
    });
    apps.push(gateway);
    await gateway.listen(0, '127.0.0.1');
    const gatewayPort = Number(new URL(await gateway.getUrl()).port);
    front.on('request', (request, response) => {
      const upstream = httpRequest(
        {
          hostname: '127.0.0.1',
          port: request.url?.startsWith('/api/') ? gatewayPort : webPort,
          method: request.method,
          path: request.url,
          headers: request.headers,
          timeout: 10000,
        },
        (reply) => {
          response.writeHead(reply.statusCode ?? 502, reply.headers);
          reply.pipe(response);
        },
      );
      upstream.on('timeout', () => upstream.destroy());
      upstream.on('error', () => response.destroy());
      request.pipe(upstream);
    });
    return { origin, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
