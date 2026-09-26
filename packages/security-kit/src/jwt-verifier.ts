import { createLocalJWKSet, createRemoteJWKSet, jwtVerify, type JSONWebKeySet } from 'jose';

export interface VerifiedIdentity {
  readonly subject: string;
  readonly sessionId: string;
  readonly authVersion: number;
}
export interface TokenPolicy {
  readonly issuer: string;
  readonly audience: string;
  readonly maxAgeSeconds?: number;
}
export class AccessTokenVerifier {
  private readonly resolve:
    ReturnType<typeof createLocalJWKSet> | ReturnType<typeof createRemoteJWKSet>;
  constructor(
    private readonly policy: TokenPolicy,
    source: JSONWebKeySet | URL,
  ) {
    if (!policy.issuer || !policy.audience) throw new Error('JWT_POLICY_REQUIRED');
    if (source instanceof URL) {
      const local =
        source.hostname === '127.0.0.1' ||
        source.hostname === 'localhost' ||
        source.hostname === '[::1]';
      if (source.protocol !== 'https:' && !(source.protocol === 'http:' && local))
        throw new Error('JWKS_HTTPS_REQUIRED');
      if (source.username || source.password || source.hash) throw new Error('INVALID_JWKS_URL');
      this.resolve = createRemoteJWKSet(source, {
        timeoutDuration: 3_000,
        cooldownDuration: 30_000,
        cacheMaxAge: 300_000,
      });
    } else {
      if (
        source.keys.length < 1 ||
        source.keys.length > 10 ||
        source.keys.some((key) => key.kty !== 'RSA' || !key.kid || 'd' in key)
      )
        throw new Error('INVALID_PUBLIC_JWKS');
      this.resolve = createLocalJWKSet(source);
    }
  }
  async verify(token: string): Promise<VerifiedIdentity> {
    if (typeof token !== 'string' || token.length > 8_192) throw new Error('AUTH_INVALID');
    const { payload, protectedHeader } = await jwtVerify(token, this.resolve, {
      algorithms: ['RS256'],
      issuer: this.policy.issuer,
      audience: this.policy.audience,
      typ: 'at+jwt',
      requiredClaims: ['sub', 'sid', 'ver', 'exp', 'iat', 'jti'],
      clockTolerance: 5,
      maxTokenAge: this.policy.maxAgeSeconds ?? 300,
    });
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (
      typeof protectedHeader.kid !== 'string' ||
      !/^[A-Za-z0-9_-]{8,80}$/.test(protectedHeader.kid) ||
      protectedHeader.jku !== undefined ||
      protectedHeader.x5u !== undefined
    )
      throw new Error('AUTH_INVALID');
    if (
      typeof payload.sub !== 'string' ||
      !uuid.test(payload.sub) ||
      typeof payload.sid !== 'string' ||
      !uuid.test(payload.sid) ||
      typeof payload.ver !== 'number' ||
      !Number.isSafeInteger(payload.ver) ||
      payload.ver < 1
    )
      throw new Error('AUTH_INVALID');
    return { subject: payload.sub, sessionId: payload.sid, authVersion: payload.ver };
  }
}
