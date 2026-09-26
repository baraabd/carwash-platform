import { createPrivateKey, createPublicKey, randomUUID, type KeyObject } from 'node:crypto';
import { SignJWT, calculateJwkThumbprint, exportJWK, type JSONWebKeySet } from 'jose';
import type { AccessPrincipal } from '@carwash/contracts';
import type { AccessSigner } from '../../ports/identity.ports';
import { AUTH_POLICY } from '../../domain/auth-policy';

/** Only Identity loads a private user-token key. Callers receive public JWKS only. */
export class IdentitySigningKeys implements AccessSigner {
  private constructor(
    private readonly key: KeyObject,
    readonly kid: string,
    readonly jwks: JSONWebKeySet,
    private readonly issuer: string,
    private readonly audience: string,
  ) {}
  static async load(
    pem: string,
    issuer: string,
    audience: string,
    previous: JSONWebKeySet = { keys: [] },
  ): Promise<IdentitySigningKeys> {
    const key = createPrivateKey(pem);
    if (key.asymmetricKeyType !== 'rsa' || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 3_072)
      throw new Error('RSA_3072_PRIVATE_KEY_REQUIRED');
    const publicJwk = await exportJWK(createPublicKey(key));
    const kid = await calculateJwkThumbprint(publicJwk, 'sha256');
    const current = { ...publicJwk, kid, alg: 'RS256', use: 'sig' };
    if (
      !issuer ||
      !audience ||
      previous.keys.length > 9 ||
      previous.keys.some(
        (item) =>
          item.kty !== 'RSA' ||
          !item.kid ||
          item.kid === kid ||
          item.alg !== 'RS256' ||
          ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth'].some((field) => field in item),
      )
    )
      throw new Error('INVALID_SIGNING_KEY_CONFIG');
    const keys = [current, ...previous.keys];
    if (new Set(keys.map((item) => item.kid)).size !== keys.length)
      throw new Error('DUPLICATE_KEY_ID');
    return new IdentitySigningKeys(key, kid, { keys }, issuer, audience);
  }
  sign(principal: AccessPrincipal): Promise<string> {
    return new SignJWT({ sid: principal.sessionId, ver: principal.authVersion })
      .setProtectedHeader({ alg: 'RS256', kid: this.kid, typ: 'at+jwt' })
      .setSubject(principal.subject)
      .setIssuer(this.issuer)
      .setAudience(this.audience)
      .setIssuedAt()
      .setJti(randomUUID())
      .setExpirationTime(`${AUTH_POLICY.accessTtlSeconds}s`)
      .sign(this.key);
  }
}
