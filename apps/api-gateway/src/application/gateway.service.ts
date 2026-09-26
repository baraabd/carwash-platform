import type { GatewayRoute } from '@carwash/contracts';
import {
  GatewayFault,
  idempotencyKey,
  routeMatch,
  upstreamFault,
  type Match,
} from '../domain/policy';
import type {
  GatewayInput,
  HttpPort,
  AuthPort,
  UpstreamReply,
  VerifiedIdentity,
} from '../ports/http';
import { identityHeaders } from '../application/identity-headers';
import type { GatewayConfig } from '../ports/config';
/** Read composition only: no local transaction, database or business decision. */
export class GatewayService {
  constructor(
    private readonly http: HttpPort,
    private readonly auth: AuthPort,
    private readonly config: GatewayConfig,
  ) {}
  async dispatch(input: GatewayInput): Promise<UpstreamReply> {
    const matched = routeMatch(input.method, input.url);
    const list: readonly Match[] = Array.isArray(matched) ? matched : [matched as Match];
    const unsafe = input.method !== 'GET';
    if (
      unsafe &&
      (!input.headers['content-type']?.toLowerCase().startsWith('application/json') ||
        typeof input.body !== 'object' ||
        input.body === null ||
        Array.isArray(input.body))
    )
      throw new GatewayFault(400, 'REQUEST_INVALID');
    if (
      unsafe &&
      input.headers.origin &&
      !this.config.allowedOrigins.includes(input.headers.origin)
    )
      throw new GatewayFault(403, 'AUTH_CSRF');
    if (unsafe && input.headers['sec-fetch-site'] === 'cross-site')
      throw new GatewayFault(403, 'AUTH_CSRF');
    const requiresAuth = list.some(({ route }) => !!route.permission);
    const identity = requiresAuth
      ? await this.auth.authenticate(input.headers, unsafe, input.context)
      : undefined;
    for (const { route } of list)
      if (route.permission && !identity?.session.permissions.includes(route.permission))
        throw new GatewayFault(403, 'AUTH_FORBIDDEN');
    const results = await Promise.all(list.map((match) => this.forward(match, input, identity)));
    if (Array.isArray(matched)) {
      const body = Object.fromEntries(
        list.map(({ route }, index) => [route.id, results[index]?.body]),
      );
      return { status: 200, body, cookies: [] };
    }
    return results[0]!;
  }
  private async forward(
    match: Match,
    input: GatewayInput,
    identity: VerifiedIdentity | undefined,
  ): Promise<UpstreamReply> {
    const { route, upstream } = match;
    const headers = route.authTransport
      ? identityHeaders(input.headers, this.config, input.context)
      : this.verifiedHeaders(identity, input);
    if (route.idempotency === 'required')
      headers['idempotency-key'] = idempotencyKey(input.headers['idempotency-key']);
    const reply = await this.http.request(route.owner, upstream, route.method, headers, input.body);
    if (reply.status >= 300) throw upstreamFault(reply.status, reply.body);
    return {
      ...reply,
      cookies: route.authTransport
        ? reply.cookies.filter((cookie) => this.allowedCookie(cookie))
        : [],
    };
  }
  private allowedCookie(cookie: string): boolean {
    return ['access', 'refresh', 'csrf', 'pre'].some((suffix) =>
      cookie.startsWith(`${this.config.cookiePrefix}${suffix}=`),
    );
  }
  private verifiedHeaders(
    identity: VerifiedIdentity | undefined,
    input: GatewayInput,
  ): Record<string, string> {
    if (!identity) throw new GatewayFault(401, 'AUTH_REQUIRED');
    return {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${identity.token}`,
      'x-request-id': input.context.requestId,
      'x-correlation-id': input.context.correlationId,
      traceparent: input.context.traceparent,
      'x-auth-subject': identity.session.subject,
      'x-auth-session': identity.session.sessionId,
      'x-auth-version': String(identity.session.authVersion),
    };
  }
  async dependencies(): Promise<Readonly<Record<string, boolean>>> {
    const probes = await Promise.all(
      Object.keys(this.config.origins).map(async (owner) => {
        try {
          const result = await this.http.request(
            owner as GatewayRoute['owner'],
            '/health/ready',
            'GET',
            {},
          );
          return [owner, result.status === 200] as const;
        } catch {
          return [owner, false] as const;
        }
      }),
    );
    return Object.fromEntries(probes);
  }
}
