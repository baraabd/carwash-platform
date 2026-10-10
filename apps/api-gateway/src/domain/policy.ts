import {
  GATEWAY_COMPOSITIONS,
  GATEWAY_ROUTES,
  GATEWAY_V1,
  OWNER_CONTRACTS,
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
/** Match exact allowlisted path segments. Never derive an origin from request data. */
export function routeMatch(method: string, raw: string): Match | readonly Match[] {
  if (
    !raw.startsWith(`${GATEWAY_V1}/`) ||
    raw.includes('?') ||
    /[%\\#]/.test(raw) ||
    [...raw].some((char) => char.charCodeAt(0) <= 32)
  )
    throw new GatewayFault(404, 'NOT_FOUND');
  const path = raw.slice(GATEWAY_V1.length);
  const parts = path.split('/');
  if (parts.some((x) => x === '.' || x === '..')) throw new GatewayFault(404, 'NOT_FOUND');
  const composition = GATEWAY_COMPOSITIONS.find((c) => c.path === path);
  if (composition && method === 'GET')
    return composition.routes.map((id) => {
      const route = GATEWAY_ROUTES.find((r) => r.id === id);
      if (!route || route.method !== 'GET') throw new GatewayFault(500, 'INTERNAL_ERROR');
      return { route, upstream: route.upstream };
    });
  for (const route of GATEWAY_ROUTES) {
    if (route.method !== method) continue;
    const expected = route.path.split('/');
    if (expected.length !== parts.length) continue;
    let id = '';
    if (
      !expected.every((part, i) =>
        part === ':id' ? UUID.test((id = parts[i] ?? '')) : part === parts[i],
      )
    )
      continue;
    return { route, upstream: route.upstream.replace(':id', id) };
  }
  throw new GatewayFault(404, 'NOT_FOUND');
}
export function idempotencyKey(value: string | undefined): string {
  if (!value || !/^[A-Za-z0-9_-]{16,128}$/.test(value))
    throw new GatewayFault(400, 'REQUEST_INVALID');
  return value;
}
/** Published reasons of the owner's merged contract; an unpublished owner forwards none. */
function publishedReason(owner: GatewayOwner | undefined, code: unknown): string | undefined {
  if (typeof code !== 'string' || owner === undefined) return undefined;
  const contract = OWNER_CONTRACTS.find((candidate) => candidate.owner === owner);
  return (contract?.reasons as readonly string[] | undefined)?.includes(code) ? code : undefined;
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
    412: 'CONFLICT',
    422: 'VALIDATION_FAILED',
    429: 'RATE_LIMITED',
  };
  // Business-rule rejections keep the owner's published reason (CR-B-01); nothing else does.
  const reason = [409, 412, 422].includes(status) ? publishedReason(owner, code) : undefined;
  return new GatewayFault(
    status in known ? status : 502,
    known[status] ?? 'UPSTREAM_UNAVAILABLE',
    reason,
  );
}
