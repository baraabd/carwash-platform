import {
  GATEWAY_V1,
  GATEWAY_ROUTES,
  GATEWAY_COMPOSITIONS,
  API_ERROR_CODES,
  type GatewayErrorCode,
} from '@carwash/contracts';

const ERROR_CODES: readonly GatewayErrorCode[] = API_ERROR_CODES;
const ERROR_RESPONSES = Object.fromEntries(
  [400, 401, 403, 404, 409, 412, 413, 422, 428, 429, 500, 502, 503, 504].map((status) => [
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
    const path = ((route.prefix ?? GATEWAY_V1) + route.path).replace(
      /:([A-Za-z][A-Za-z0-9]*)/g,
      '{$1}',
    );
    const current = (paths[path] ?? {}) as Record<string, unknown>;
    current[route.method.toLowerCase()] = {
      operationId: route.id,
      'x-owning-service': route.owner,
      ...(!route.permission &&
      !route.anyPermission &&
      !route.public &&
      !route.authTransport &&
      !route.providerIngress
        ? { security: SECURITY }
        : {}),
      ...(route.permission
        ? { 'x-required-permission': route.permission, security: SECURITY }
        : {}),
      ...(route.anyPermission
        ? { 'x-any-permission': route.anyPermission, security: SECURITY }
        : {}),
      ...(route.safe ? { 'x-read-only': true } : {}),
      ...(route.authTransport ? { 'x-auth-enforcement-owner': 'identity' } : {}),
      ...(route.public ? { 'x-public': true, security: [] } : {}),
      ...(route.providerIngress
        ? {
            'x-provider-ingress': true,
            'x-signature-verification-owner': route.owner,
            security: [],
          }
        : {}),
      parameters: [
        ...CORRELATION_PARAMETERS,
        ...[...route.path.matchAll(/:([A-Za-z][A-Za-z0-9]*)/g)].map((match) => ({
          in: 'path',
          name: match[1],
          required: true,
          schema: route.pathEnums?.[match[1]!]
            ? { type: 'string', enum: route.pathEnums[match[1]!] }
            : route.pathPatterns?.[match[1]!]
              ? { type: 'string', pattern: route.pathPatterns[match[1]!]!.source }
              : { type: 'string', format: 'uuid' },
        })),
        ...(route.query ?? []).map((parameter) => ({
          in: 'query',
          name: parameter.name,
          required: false,
          schema: { type: 'string', pattern: parameter.pattern.source },
        })),
        ...(route.revisioned
          ? [
              {
                in: 'header',
                name: 'If-Match',
                required: true,
                schema: { type: 'string', pattern: '^"[1-9][0-9]{0,8}"$' },
              },
            ]
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
    const permissionGroups: string[][] = [];
    const permissions = read.routes.flatMap((id) => {
      const route = GATEWAY_ROUTES.find((candidate) => candidate.id === id);
      if (
        !route ||
        route.method !== 'GET' ||
        (!route.permission && !route.anyPermission?.length && !route.public)
      )
        throw new Error('INVALID_GATEWAY_COMPOSITION_CONTRACT');
      if (route.permission) permissionGroups.push([route.permission]);
      if (route.anyPermission) permissionGroups.push([...route.anyPermission].sort());
      return route.permission ? [route.permission] : [];
    });
    paths[GATEWAY_V1 + read.path] = {
      get: {
        operationId: read.id,
        'x-read-only': true,
        'x-composes': read.routes,
        'x-required-permissions': [...new Set(permissions)].sort(),
        // All groups must be satisfied; any permission within a group suffices.
        'x-required-permission-groups': permissionGroups,
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
              required: [
                'code',
                'reason',
                'message',
                'requestId',
                'correlationId',
                'retryable',
                'retryAfterMs',
                'issues',
              ],
              properties: {
                code: { type: 'string', enum: ERROR_CODES },
                reason: {
                  type: ['string', 'null'],
                  description:
                    'Only a reason published by the owning service for a recognized HTTP failure.',
                },
                message: {
                  type: 'string',
                  description: 'Fixed public text; never raw owner exceptions.',
                },
                requestId: { type: 'string', format: 'uuid' },
                correlationId: { type: 'string', format: 'uuid' },
                retryable: {
                  type: 'boolean',
                  description:
                    'Shared API_ERROR_RETRYABLE semantics. Unknown mutation outcomes require reconciliation with the same key.',
                },
                retryAfterMs: { type: ['integer', 'null'], minimum: 0, maximum: 3600000 },
                issues: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['field', 'code'],
                    properties: { field: { type: 'string' }, code: { type: 'string' } },
                  },
                },
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
