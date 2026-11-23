import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Service-to-service credentials with explicit scopes (deny by default).
 *
 * Shared technical primitive (P04-E3) for the interim mechanism that Dispatch,
 * Media, Scheduling and Workforce each implemented separately, until the
 * platform issues workload identity. It is generic over the OWNER's scope
 * vocabulary: the owner still decides which scopes exist and what each allows.
 *
 * Configuration holds only SHA-256 digests of the credentials, never the
 * credentials. Comparison is constant-time against EVERY configured client,
 * so timing does not reveal which ids exist; unknown clients, unknown scopes
 * and malformed configuration are refused; nothing about a failed attempt is
 * echoed back.
 *
 * Example value of <OWNER>_SERVICE_CLIENTS:
 *   [{"id":"booking","tokenSha256":"<64 hex>","scopes":["billing.obligation.write"]}]
 *
 * Callers send `x-service-client` and `x-service-token`. The token is a secret:
 * read it through readSecret (env or mounted secret file), never log it, never
 * put it in a URL, event or client bundle.
 */
export const SERVICE_CLIENT_HEADER = 'x-service-client' as const;
export const SERVICE_TOKEN_HEADER = 'x-service-token' as const;
export const MAX_SERVICE_CLIENTS = 32;
export const MIN_SERVICE_TOKEN_LENGTH = 32;
export const MAX_SERVICE_TOKEN_LENGTH = 256;

const CLIENT_ID = /^[a-z][a-z0-9-]{1,63}$/;
const DIGEST = /^[0-9a-f]{64}$/;

export interface ServiceClient<TScope extends string> {
  readonly id: string;
  readonly digest: Buffer;
  readonly scopes: readonly TScope[];
}

export type ServiceClientConfigError =
  | 'SERVICE_CLIENTS_INVALID_JSON'
  | 'SERVICE_CLIENTS_INVALID'
  | 'SERVICE_CLIENTS_INVALID_ID'
  | 'SERVICE_CLIENTS_INVALID_DIGEST'
  | 'SERVICE_CLIENTS_INVALID_SCOPE'
  | 'SERVICE_CLIENTS_DUPLICATE_DIGEST';

/**
 * Parses the owner's client list. An absent or empty value means "no service
 * callers" (every service-scoped route is then refused), never "allow all".
 */
export function parseServiceClients<TScope extends string>(
  raw: string | undefined,
  allowedScopes: readonly TScope[],
): ServiceClient<TScope>[] {
  if (raw === undefined || raw.trim() === '') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('SERVICE_CLIENTS_INVALID_JSON' satisfies ServiceClientConfigError);
  }
  if (!Array.isArray(parsed) || parsed.length > MAX_SERVICE_CLIENTS) {
    throw new Error('SERVICE_CLIENTS_INVALID' satisfies ServiceClientConfigError);
  }
  const ids = new Set<string>();
  const digests = new Set<string>();
  return parsed.map((entry: unknown): ServiceClient<TScope> => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error('SERVICE_CLIENTS_INVALID' satisfies ServiceClientConfigError);
    }
    const record = entry as Record<string, unknown>;
    if (Object.keys(record).sort().join(',') !== 'id,scopes,tokenSha256') {
      throw new Error('SERVICE_CLIENTS_INVALID' satisfies ServiceClientConfigError);
    }
    const { id, tokenSha256, scopes } = record;
    if (typeof id !== 'string' || !CLIENT_ID.test(id) || ids.has(id)) {
      throw new Error('SERVICE_CLIENTS_INVALID_ID' satisfies ServiceClientConfigError);
    }
    if (typeof tokenSha256 !== 'string' || !DIGEST.test(tokenSha256)) {
      throw new Error('SERVICE_CLIENTS_INVALID_DIGEST' satisfies ServiceClientConfigError);
    }
    // One credential per client: a shared token would make the caller ambiguous.
    if (digests.has(tokenSha256)) {
      throw new Error('SERVICE_CLIENTS_DUPLICATE_DIGEST' satisfies ServiceClientConfigError);
    }
    if (
      !Array.isArray(scopes) ||
      scopes.length === 0 ||
      new Set(scopes).size !== scopes.length ||
      !scopes.every((scope): scope is TScope => allowedScopes.some((known) => known === scope))
    ) {
      throw new Error('SERVICE_CLIENTS_INVALID_SCOPE' satisfies ServiceClientConfigError);
    }
    ids.add(id);
    digests.add(tokenSha256);
    return { id, digest: Buffer.from(tokenSha256, 'hex'), scopes: [...scopes] };
  });
}

export type ServiceAuthorization<TScope extends string> =
  | { readonly ok: true; readonly clientId: string; readonly scope: TScope }
  | { readonly ok: false; readonly reason: 'UNAUTHENTICATED' | 'SCOPE_DENIED' };

export class ServiceClientAuthenticator<TScope extends string> {
  constructor(private readonly clients: readonly ServiceClient<TScope>[]) {}

  /** The configured client for this credential pair, or null. Constant-time over all clients. */
  authenticate(
    clientId: string | undefined,
    token: string | undefined,
  ): ServiceClient<TScope> | null {
    if (
      typeof clientId !== 'string' ||
      typeof token !== 'string' ||
      !CLIENT_ID.test(clientId) ||
      token.length < MIN_SERVICE_TOKEN_LENGTH ||
      token.length > MAX_SERVICE_TOKEN_LENGTH
    ) {
      return null;
    }
    const presented = createHash('sha256').update(token, 'utf8').digest();
    let match: ServiceClient<TScope> | null = null;
    for (const client of this.clients) {
      const equal = timingSafeEqual(presented, client.digest);
      if (equal && client.id === clientId) match = client;
    }
    return match;
  }

  /** Authenticate AND require one scope. Denied when either fails; the reason is for logs/metrics only. */
  authorize(
    clientId: string | undefined,
    token: string | undefined,
    scope: TScope,
  ): ServiceAuthorization<TScope> {
    const client = this.authenticate(clientId, token);
    if (!client) return { ok: false, reason: 'UNAUTHENTICATED' };
    if (!client.scopes.includes(scope)) return { ok: false, reason: 'SCOPE_DENIED' };
    return { ok: true, clientId: client.id, scope };
  }
}

/** Digest an operator puts into <OWNER>_SERVICE_CLIENTS for a generated token. */
export function serviceTokenDigest(token: string): string {
  if (token.length < MIN_SERVICE_TOKEN_LENGTH || token.length > MAX_SERVICE_TOKEN_LENGTH) {
    throw new Error('SERVICE_TOKEN_INVALID_LENGTH');
  }
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
