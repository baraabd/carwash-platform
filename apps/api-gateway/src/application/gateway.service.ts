import {
  PROVIDER_INGRESS_CONTENT_TYPES,
  PROVIDER_INGRESS_HEADERS,
  PROVIDER_INGRESS_MAX_BYTES,
  type GatewayRoute,
} from '@carwash/contracts';
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
    const single = Array.isArray(matched) ? undefined : (matched as Match);
    if (single?.route.providerIngress) return this.providerIngress(single, input);
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
    const headers = route.public
      ? this.publicHeaders(input)
      : route.authTransport
        ? identityHeaders(input.headers, this.config, input.context)
        : this.verifiedHeaders(identity, input);
    if (route.idempotency === 'required')
      headers['idempotency-key'] = idempotencyKey(input.headers['idempotency-key']);
    const reply = await this.http.request(route.owner, upstream, route.method, headers, input.body);
    if (reply.status >= 300) throw upstreamFault(reply.status, reply.body, route.owner);
    return {
      ...reply,
      cookies: route.authTransport
        ? reply.cookies.filter((cookie) => this.allowedCookie(cookie))
        : [],
    };
  }
  /**
   * Provider server notification (P04-E2). The Gateway authenticates nothing
   * here: the OWNER verifies the provider signature over the exact bytes. The
   * Gateway's job is to keep those bytes intact and bounded and to make sure
   * no browser credential or spoofable identity header ever reaches the owner.
   */
  private async providerIngress(match: Match, input: GatewayInput): Promise<UpstreamReply> {
    const { route, upstream } = match;
    const type = (input.headers['content-type'] ?? '').split(';', 1)[0]?.trim().toLowerCase();
    if (!PROVIDER_INGRESS_CONTENT_TYPES.some((allowed) => allowed === type))
      throw new GatewayFault(400, 'REQUEST_INVALID');
    const raw = input.rawBody;
    if (!raw || raw.length === 0) throw new GatewayFault(400, 'REQUEST_INVALID');
    if (raw.length > PROVIDER_INGRESS_MAX_BYTES) throw new GatewayFault(413, 'REQUEST_INVALID');
    const headers: Record<string, string> = {
      accept: 'application/json',
      'content-type': input.headers['content-type'] ?? '',
      'x-request-id': input.context.requestId,
      'x-correlation-id': input.context.correlationId,
      traceparent: input.context.traceparent,
    };
    for (const name of PROVIDER_INGRESS_HEADERS) {
      const value = input.headers[name];
      if (value === undefined) continue;
      if (value.length > 512) throw new GatewayFault(400, 'REQUEST_INVALID');
      headers[name] = value;
    }
    const reply = await this.http.request(route.owner, upstream, 'POST', headers, raw);
    if (reply.status >= 300) throw upstreamFault(reply.status, reply.body, route.owner);
    return { status: reply.status, body: reply.body, cookies: [] };
  }
  private allowedCookie(cookie: string): boolean {
    return ['access', 'refresh', 'csrf', 'pre'].some((suffix) =>
      cookie.startsWith(`${this.config.cookiePrefix}${suffix}=`),
    );
  }
  /** Anonymous forwarding: correlation only. Credentials never reach a public owner route. */
  private publicHeaders(input: GatewayInput): Record<string, string> {
    return {
      accept: 'application/json',
      'x-request-id': input.context.requestId,
      'x-correlation-id': input.context.correlationId,
      traceparent: input.context.traceparent,
    };
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
      'x-auth-principal-kind': identity.session.principalKind,
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
