import {
  GATEWAY_V1,
  GATEWAY_ROUTES,
  GATEWAY_COMPOSITIONS,
  type GatewayErrorCode,
} from '@carwash/contracts';

const ERROR_CODES: readonly GatewayErrorCode[] = [
  'REQUEST_INVALID',
  'AUTH_REQUIRED',
  'AUTH_FORBIDDEN',
  'AUTH_CSRF',
  'NOT_FOUND',
  'CONFLICT',
  'VALIDATION_FAILED',
  'RATE_LIMITED',
  'UPSTREAM_UNAVAILABLE',
  'UPSTREAM_TIMEOUT',
  'UPSTREAM_INVALID',
  'INTERNAL_ERROR',
];
const ERROR_RESPONSES = Object.fromEntries(
  [400, 401, 403, 404, 409, 413, 422, 429, 500, 502, 503, 504].map((status) => [
    String(status),
    { $ref: '#/components/responses/GatewayError' },
  ]),
);
const SECURITY = [{ bearer: [] }, { session: [] }];
const CORRELATION_PARAMETERS = [
  {
    in: 'header',
    name: 'X-Correlation-Id',
    required: false,
    description: 'A UUID is preserved; absent or invalid values are replaced by the gateway.',
    schema: { type: 'string', format: 'uuid' },
  },
  {
    in: 'header',
    name: 'traceparent',
    required: false,
    description: 'Valid W3C version-00 trace context preserves the trace ID with a new span ID.',
    schema: { type: 'string' },
  },
];
const RESPONSE_HEADERS = {
  'X-Request-Id': {
    description: 'Server-generated request UUID. External values are not trusted.',
    schema: { type: 'string', format: 'uuid' },
  },
  'X-Correlation-Id': { schema: { type: 'string', format: 'uuid' } },
  traceparent: { schema: { type: 'string' } },
};

/** Discovery describes gateway transport only; domain schemas remain owner-owned. */
export function gatewayOpenApi() {
  const paths: Record<string, unknown> = {};
  for (const route of GATEWAY_ROUTES) {
    const path = (GATEWAY_V1 + route.path).replace(':id', '{id}');
    const current = (paths[path] ?? {}) as Record<string, unknown>;
    current[route.method.toLowerCase()] = {
      operationId: route.id,
      'x-owning-service': route.owner,
      ...(route.permission
        ? { 'x-required-permission': route.permission, security: SECURITY }
        : {}),
      ...(route.authTransport ? { 'x-auth-enforcement-owner': 'identity' } : {}),
      parameters: [
        ...CORRELATION_PARAMETERS,
        ...(route.path.includes(':id')
          ? [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }]
          : []),
        ...(route.idempotency
          ? [
              {
                in: 'header',
                name: 'Idempotency-Key',
                required: true,
                description:
                  'Forwarded unchanged. A timeout is an unknown outcome, not rollback; never retry with a new key.',
                schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{16,128}$' },
              },
            ]
          : []),
      ],
      responses: {
        '200': {
          description: 'Owning service response; route-specific schema belongs to the owner.',
          headers: RESPONSE_HEADERS,
        },
        ...(route.method !== 'GET'
          ? {
              '201': { description: 'Owner reports creation.', headers: RESPONSE_HEADERS },
              '202': {
                description: 'Owner accepted the command; completion is not implied.',
                headers: RESPONSE_HEADERS,
              },
              '204': {
                description: 'Owner reports success without a response body.',
                headers: RESPONSE_HEADERS,
              },
            }
          : {}),
        ...ERROR_RESPONSES,
      },
    };
    paths[path] = current;
  }
  for (const read of GATEWAY_COMPOSITIONS) {
    const permissions = read.routes.map((id) => {
      const route = GATEWAY_ROUTES.find((candidate) => candidate.id === id);
      if (!route || route.method !== 'GET' || !route.permission)
        throw new Error('INVALID_GATEWAY_COMPOSITION_CONTRACT');
      return route.permission;
    });
    paths[GATEWAY_V1 + read.path] = {
      get: {
        operationId: read.id,
        'x-read-only': true,
        'x-composes': read.routes,
        'x-required-permissions': [...new Set(permissions)].sort(),
        security: SECURITY,
        parameters: CORRELATION_PARAMETERS,
        responses: {
          '200': {
            description: 'Read-only composition of owner responses',
            headers: RESPONSE_HEADERS,
          },
          ...ERROR_RESPONSES,
        },
      },
    };
  }
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
      schemas: {
        GatewayErrorEnvelope: {
          type: 'object',
          additionalProperties: false,
          required: ['error'],
          properties: {
            error: {
              type: 'object',
              additionalProperties: false,
              required: ['code', 'message', 'requestId', 'correlationId'],
              properties: {
                code: { type: 'string', enum: ERROR_CODES },
                message: {
                  type: 'string',
                  description: 'Fixed public text; never raw owner exceptions.',
                },
                requestId: { type: 'string', format: 'uuid' },
                correlationId: { type: 'string', format: 'uuid' },
              },
            },
          },
        },
      },
      responses: {
        GatewayError: {
          description:
            'Sanitized gateway error. No stack, SQL, cookies or credentials are returned.',
          headers: RESPONSE_HEADERS,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/GatewayErrorEnvelope' } },
          },
        },
      },
    },
  };
}
