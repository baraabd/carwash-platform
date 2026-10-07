/**
 * Route metadata every owner contract declares. It is the single source for the
 * Gateway route table, service-to-service scope grants, generated OpenAPI and
 * the typed clients — never re-typed elsewhere.
 *
 * access:
 *  - 'public'                 no authentication (e.g. published catalog)
 *  - 'principal'              the authenticated account OR guest acts on its own records
 *  - 'permission:<name>'      staff permission issued by Identity
 *  - 'service:<scope>'        workload identity with that scope; never reachable from the Gateway
 *
 * Mutations require `idempotent: true` unless `safe: true` (a POST that only
 * reads/validates and changes no owner state). `revisioned` routes require
 * `If-Match`; commands that carry `expectedRevision` in the body are not
 * additionally revisioned.
 */
export type RouteAccess = 'public' | 'principal' | `permission:${string}` | `service:${string}`;

export interface RouteSpec {
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly path: string;
  readonly access: RouteAccess;
  readonly idempotent?: true;
  readonly revisioned?: true;
  readonly safe?: true;
  readonly paged?: true;
}

export interface OwnerContract {
  readonly id: string;
  readonly owner: string;
  readonly prefix: string;
  readonly routes: Readonly<Record<string, RouteSpec>>;
  readonly reasons: readonly string[];
}

const PATH = /^(\/(?:[a-z0-9-]+|:[a-zA-Z]+))+$/;
const ACCESS = /^(public|principal|permission:[a-z][a-z.:-]{2,63}|service:[a-z][a-z.-]{2,63})$/;
const REASON = /^[A-Z][A-Z0-9_]{2,63}$/;

/** Structural lint for a contract descriptor; used by the contract test suite and CI. */
export function contractProblems(contract: OwnerContract): string[] {
  const problems: string[] = [];
  if (!/^[a-z]+\.v[1-9][0-9]*$/.test(contract.id)) problems.push(`${contract.id}: id`);
  if (contract.prefix !== `/internal/v${contract.id.split('.v')[1]}/${contract.owner}`) {
    problems.push(`${contract.id}: prefix must be /internal/v<major>/<owner>`);
  }
  const seen = new Set<string>();
  for (const [name, route] of Object.entries(contract.routes)) {
    const where = `${contract.id}.${name}`;
    if (!PATH.test(route.path)) problems.push(`${where}: path`);
    if (!ACCESS.test(route.access)) problems.push(`${where}: access`);
    const key = `${route.method} ${route.path.replace(/:[a-zA-Z]+/g, ':')}`;
    if (seen.has(key)) problems.push(`${where}: duplicate ${key}`);
    seen.add(key);
    const mutating = route.method !== 'GET';
    if (mutating && !route.idempotent && !route.safe)
      problems.push(`${where}: mutation needs idempotent or safe`);
    if (route.safe && (route.method !== 'POST' || route.idempotent || route.revisioned)) {
      problems.push(`${where}: safe is only for read-only POST`);
    }
    if (!mutating && (route.idempotent || route.revisioned)) problems.push(`${where}: GET flags`);
    if (route.paged && route.method !== 'GET') problems.push(`${where}: paged must be GET`);
    if (route.access === 'public' && mutating) problems.push(`${where}: public mutation`);
  }
  for (const reason of contract.reasons)
    if (!REASON.test(reason)) problems.push(`${contract.id}: reason ${reason}`);
  if (new Set(contract.reasons).size !== contract.reasons.length)
    problems.push(`${contract.id}: duplicate reason`);
  return problems;
}
