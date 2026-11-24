import {
  GATEWAY_COMPOSITIONS,
  GATEWAY_ROUTES,
  GATEWAY_V1,
  API_ERROR_CODES,
  API_ERROR_STATUS,
  contractsOf,
  type GatewayErrorCode,
  type GatewayOwner,
  type GatewayRoute,
} from '@carwash/contracts';
export class GatewayFault extends Error {
  constructor(
    readonly status: number,
    readonly code: GatewayErrorCode,
    /** Owner business reason from that owner's MERGED contract; never free text. */
    readonly reason?: string,
  ) {
    super(code);
  }
}
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export interface Match {
  readonly route: GatewayRoute;
  readonly upstream: string;
}
/** Re-encode only a route's published GET query. No query can select an origin or path. */
function allowedQuery(route: GatewayRoute, search: string | undefined): string {
  if (search === undefined) return '';
  if (!route.query || route.method !== 'GET') throw new GatewayFault(404, 'NOT_FOUND');
  if (search.length > 2048) throw new GatewayFault(400, 'REQUEST_INVALID');
  const out = new URLSearchParams();
  for (const [name, value] of new URLSearchParams(search)) {
    const rule = route.query.find((entry) => entry.name === name);
    if (!rule || out.has(name) || !rule.pattern.test(value))
      throw new GatewayFault(400, 'REQUEST_INVALID');
    out.set(name, value);
  }
  return out.size ? `?${out.toString()}` : '';
}
/** Match exact allowlisted path segments. Never derive an origin from request data. */
export function routeMatch(method: string, full: string): Match | readonly Match[] {
  const [raw = '', search, extra] = full.split('?');
  const prefix = [GATEWAY_V1, '/api/operator'].find((candidate) => raw.startsWith(`${candidate}/`));
  if (
    !prefix ||
    extra !== undefined ||
    /[%\\#]/.test(raw) ||
    [...full].some((char) => char.charCodeAt(0) <= 32) ||
    /[\\#]/.test(full)
  )
    throw new GatewayFault(404, 'NOT_FOUND');
  const path = raw.slice(prefix.length);
  const parts = path.split('/');
  if (parts.some((x) => x === '.' || x === '..')) throw new GatewayFault(404, 'NOT_FOUND');
  const composition =
    prefix === GATEWAY_V1 ? GATEWAY_COMPOSITIONS.find((c) => c.path === path) : undefined;
  if (composition && search !== undefined) throw new GatewayFault(404, 'NOT_FOUND');
  if (composition && method === 'GET')
    return composition.routes.map((id) => {
      const route = GATEWAY_ROUTES.find((r) => r.id === id);
      if (!route || route.method !== 'GET') throw new GatewayFault(500, 'INTERNAL_ERROR');
      return { route, upstream: route.upstream };
    });
  for (const route of GATEWAY_ROUTES) {
    if (route.method !== method || (route.prefix ?? GATEWAY_V1) !== prefix) continue;
    const expected = route.path.split('/');
    if (expected.length !== parts.length) continue;
    const values: Record<string, string> = {};
    if (
      !expected.every((part, i) => {
        if (!part.startsWith(':')) return part === parts[i];
        const name = part.slice(1);
        const value = parts[i] ?? '';
        const choices = route.pathEnums?.[name];
        if (choices ? !choices.includes(value) : !UUID.test(value)) return false;
        values[name] = value;
        return true;
      })
    )
      continue;
    return {
      route,
      upstream:
        route.upstream.replace(
          /:([A-Za-z][A-Za-z0-9]*)/g,
          (_parameter, name: string) => values[name] ?? '',
        ) + allowedQuery(route, search),
    };
  }
  throw new GatewayFault(404, 'NOT_FOUND');
}
export function idempotencyKey(value: string | undefined): string {
  if (value === undefined) throw new GatewayFault(428, 'IDEMPOTENCY_KEY_REQUIRED');
  if (!value || !/^[A-Za-z0-9_-]{16,128}$/.test(value))
    throw new GatewayFault(400, 'REQUEST_INVALID');
  return value;
}
/**
 * Published reasons of the owner's merged contracts (an owner may serve more than
 * one, e.g. pricing.v1 + promotion.v1); an unpublished owner forwards none.
 */
function publishedReason(owner: GatewayOwner | undefined, code: unknown): string | undefined {
  if (typeof code !== 'string' || owner === undefined) return undefined;
  const reasons = contractsOf(owner).flatMap((contract): readonly string[] => contract.reasons);
  return reasons.includes(code) ? code : undefined;
}
export function upstreamFault(status: number, body: unknown, owner?: GatewayOwner): GatewayFault {
  const error =
    typeof body === 'object' && body !== null ? (body as Record<string, unknown>).error : undefined;
  const code =
    typeof error === 'object' && error !== null
      ? (error as Record<string, unknown>).code
      : undefined;
  if (status === 403 && code === 'AUTH_CSRF') return new GatewayFault(403, 'AUTH_CSRF');
  const known: Record<number, GatewayErrorCode> = {
    400: 'REQUEST_INVALID',
    401: 'AUTH_REQUIRED',
    403: 'AUTH_FORBIDDEN',
    404: 'NOT_FOUND',
    409: 'CONFLICT',
    // CR-D-P03-08: a stale expectedRevision stays a conflict, never a 502.
    412: 'REVISION_CONFLICT',
    413: 'REQUEST_INVALID',
    428: 'REVISION_REQUIRED',
    422: 'VALIDATION_FAILED',
    429: 'RATE_LIMITED',
  };
  // A reason is public only if the merged owner contract publishes it. This
  // includes a missing profile (404): clients must distinguish an absent profile
  // from a missing route before offering the canonical bootstrap operation.
  const explicitReason =
    typeof error === 'object' && error !== null
      ? (error as Record<string, unknown>).reason
      : undefined;
  // A published common code with its documented HTTP status keeps its semantics,
  // especially IDEMPOTENCY_IN_PROGRESS: a retry must retain the same request key.
  const sharedCode = API_ERROR_CODES.find(
    (candidate) => candidate === code && API_ERROR_STATUS[candidate] === status,
  );
  const reason =
    sharedCode || status in known
      ? (publishedReason(owner, explicitReason) ?? publishedReason(owner, code))
      : undefined;
  return new GatewayFault(
    sharedCode || status in known ? status : 502,
    sharedCode ?? known[status] ?? 'UPSTREAM_UNAVAILABLE',
    reason,
  );
}
