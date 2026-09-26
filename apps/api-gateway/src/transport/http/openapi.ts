import { GATEWAY_V1, GATEWAY_ROUTES, GATEWAY_COMPOSITIONS } from '@carwash/contracts';
export function gatewayOpenApi() {
  const paths: Record<string, unknown> = {};
  for (const route of GATEWAY_ROUTES) {
    const path = (GATEWAY_V1 + route.path).replace(':id', '{id}');
    const current = (paths[path] ?? {}) as Record<string, unknown>;
    current[route.method.toLowerCase()] = {
      operationId: route.id,
      'x-owning-service': route.owner,
      ...(route.permission
        ? { 'x-required-permission': route.permission, security: [{ bearer: [] }, { session: [] }] }
        : {}),
      parameters: [
        ...(route.path.includes(':id')
          ? [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }]
          : []),
        ...(route.idempotency
          ? [
              {
                in: 'header',
                name: 'Idempotency-Key',
                required: true,
                schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{16,128}$' },
              },
            ]
          : []),
      ],
      responses: {
        '200': {
          description: 'Owning service response; route-specific schema belongs to the owner.',
        },
        '400': { description: 'Invalid request' },
        '401': { description: 'Authentication required' },
        '403': { description: 'Forbidden' },
        '502': { description: 'Unavailable owner' },
        '504': { description: 'Owner timeout' },
      },
    };
    paths[path] = current;
  }
  for (const read of GATEWAY_COMPOSITIONS)
    paths[GATEWAY_V1 + read.path] = {
      get: {
        operationId: read.id,
        'x-read-only': true,
        'x-composes': read.routes,
        responses: { '200': { description: 'Read-only composition of owner responses' } },
      },
    };
  return {
    openapi: '3.1.0',
    info: {
      title: 'WashGo Gateway/BFF foundation',
      version: '1.0.0',
      description: 'Routing discovery only; does not assert business endpoints are implemented.',
    },
    paths,
    components: {
      securitySchemes: {
        bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        session: { type: 'apiKey', in: 'cookie', name: '__Host-wg_access' },
      },
    },
  };
}
