import { AccessTokenVerifier, readCookies } from '@carwash/security-kit';
import {
  IDENTITY_V1,
  isAccessPrincipal,
  isIdentityRole,
  isIdentityPermission,
  type IdentitySessionView,
} from '@carwash/contracts';
import type { AuthPort, HttpPort, RequestContext, VerifiedIdentity } from '../ports/http';
import { identityHeaders } from '../application/identity-headers';
import { GatewayFault, upstreamFault } from '../domain/policy';
import type { GatewayConfig } from './config';
export class PublicIdentityClient implements AuthPort {
  private readonly verifier: AccessTokenVerifier;
  constructor(
    private readonly http: HttpPort,
    private readonly config: GatewayConfig,
  ) {
    this.verifier = new AccessTokenVerifier(
      { issuer: config.issuer, audience: config.audience },
      new URL(`${config.origins.identity}${IDENTITY_V1}/.well-known/jwks.json`),
    );
  }
  async authenticate(
    headers: Readonly<Record<string, string>>,
    unsafe: boolean,
    context: RequestContext,
  ): Promise<VerifiedIdentity> {
    let cookies: Readonly<Record<string, string>>;
    try {
      cookies = readCookies(headers.cookie);
    } catch {
      throw new GatewayFault(400, 'REQUEST_INVALID');
    }
    const cookieToken = cookies[this.config.cookiePrefix + 'access'];
    const authorization = headers.authorization;
    if (authorization && !/^Bearer [A-Za-z0-9_.-]+$/.test(authorization))
      throw new GatewayFault(401, 'AUTH_REQUIRED');
    const bearer = authorization?.slice(7);
    if (bearer && cookieToken && bearer !== cookieToken)
      throw new GatewayFault(401, 'AUTH_REQUIRED');
    const token = bearer ?? cookieToken;
    if (!token) throw new GatewayFault(401, 'AUTH_REQUIRED');
    let principal;
    try {
      principal = await this.verifier.verify(token);
    } catch {
      throw new GatewayFault(401, 'AUTH_REQUIRED');
    }
    const forwarded = identityHeaders(headers, this.config, context);
    forwarded.authorization = `Bearer ${token}`;
    const cookieWrite = unsafe && !!cookieToken;
    const response = await this.http.request(
      'identity',
      `${IDENTITY_V1}/${cookieWrite ? 'authorize' : 'session'}`,
      cookieWrite ? 'POST' : 'GET',
      forwarded,
      cookieWrite ? {} : undefined,
    );
    if (response.status !== 200) throw upstreamFault(response.status, response.body);
    const body = response.body;
    if (!isAccessPrincipal(body)) throw new GatewayFault(502, 'UPSTREAM_INVALID');
    const session = body as IdentitySessionView;
    if (
      !Array.isArray(session.roles) ||
      !session.roles.every(isIdentityRole) ||
      !Array.isArray(session.permissions) ||
      !session.permissions.every(isIdentityPermission) ||
      session.subject !== principal.subject ||
      session.sessionId !== principal.sessionId ||
      session.authVersion !== principal.authVersion
    )
      throw new GatewayFault(502, 'UPSTREAM_INVALID');
    return { session, token };
  }
}
