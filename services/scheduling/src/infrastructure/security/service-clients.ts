import { createHash, timingSafeEqual } from 'node:crypto';
import { SCHEDULING_SCOPES, type SchedulingScope } from '../../ports';

/**
 * Service-to-service credentials for internal callers (e.g. the Booking saga).
 *
 * Interim mechanism until the platform publishes workload identity (requested
 * from Lane E in CR-C1). Configuration holds only SHA-256 digests of the
 * credentials, never the credentials. Comparison is constant-time, unknown
 * clients and unknown scopes are rejected, and nothing about a failed attempt
 * is echoed back.
 *
 * Example value of SCHEDULING_SERVICE_CLIENTS:
 *   [{"id":"booking","tokenSha256":"<64 hex>","scopes":["scheduling.hold.commit"]}]
 */
export interface ServiceClient {
  readonly id: string;
  readonly digest: Buffer;
  readonly scopes: readonly SchedulingScope[];
}

const CLIENT_ID = /^[a-z][a-z0-9-]{1,63}$/;

export function parseServiceClients(raw: string | undefined): ServiceClient[] {
  if (raw === undefined || raw.trim() === '') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('SERVICE_CLIENTS_INVALID_JSON');
  }
  if (!Array.isArray(parsed) || parsed.length > 32) throw new Error('SERVICE_CLIENTS_INVALID');
  const ids = new Set<string>();
  return parsed.map((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) throw new Error('SERVICE_CLIENTS_INVALID');
    const { id, tokenSha256, scopes } = entry as Record<string, unknown>;
    if (typeof id !== 'string' || !CLIENT_ID.test(id) || ids.has(id)) {
      throw new Error('SERVICE_CLIENTS_INVALID_ID');
    }
    if (typeof tokenSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(tokenSha256)) {
      throw new Error('SERVICE_CLIENTS_INVALID_DIGEST');
    }
    if (
      !Array.isArray(scopes) ||
      scopes.length === 0 ||
      !scopes.every((s): s is SchedulingScope => SCHEDULING_SCOPES.some((k) => k === s))
    ) {
      throw new Error('SERVICE_CLIENTS_INVALID_SCOPE');
    }
    ids.add(id);
    return { id, digest: Buffer.from(tokenSha256, 'hex'), scopes };
  });
}

export class ServiceClientAuthenticator {
  constructor(private readonly clients: readonly ServiceClient[]) {}

  authenticate(clientId: string, token: string): ServiceClient | null {
    if (!CLIENT_ID.test(clientId) || token.length < 32 || token.length > 256) return null;
    const presented = createHash('sha256').update(token, 'utf8').digest();
    let match: ServiceClient | null = null;
    // Compare against every client so timing does not reveal which ids exist.
    for (const client of this.clients) {
      const equal = timingSafeEqual(presented, client.digest);
      if (equal && client.id === clientId) match = client;
    }
    return match;
  }
}
