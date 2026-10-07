import { createHash, timingSafeEqual } from 'node:crypto';
import { WORKFORCE_SCOPES, type WorkforceScope } from '../../ports';

export interface ServiceClient {
  readonly id: string;
  readonly digest: Buffer;
  readonly scopes: readonly WorkforceScope[];
}
const CLIENT_ID = /^[a-z][a-z0-9-]{1,63}$/;
export function parseServiceClients(raw: string | undefined): ServiceClient[] {
  if (raw === undefined || raw.trim() === '') return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error('SERVICE_CLIENTS_INVALID_JSON'); }
  if (!Array.isArray(parsed) || parsed.length > 32) throw new Error('SERVICE_CLIENTS_INVALID');
  const ids = new Set<string>();
  return parsed.map((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) throw new Error('SERVICE_CLIENTS_INVALID');
    const { id, tokenSha256, scopes } = entry as Record<string, unknown>;
    if (typeof id !== 'string' || !CLIENT_ID.test(id) || ids.has(id)) throw new Error('SERVICE_CLIENTS_INVALID_ID');
    if (typeof tokenSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(tokenSha256)) throw new Error('SERVICE_CLIENTS_INVALID_DIGEST');
    if (!Array.isArray(scopes) || scopes.length === 0 ||
      !scopes.every((scope): scope is WorkforceScope => WORKFORCE_SCOPES.some((known) => known === scope))) {
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
    for (const client of this.clients) {
      const equal = timingSafeEqual(presented, client.digest);
      if (equal && client.id === clientId) match = client;
    }
    return match;
  }
}
