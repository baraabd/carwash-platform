#!/usr/bin/env node
/**
 * P06-B — commerce/finance functional matrix checker.
 *
 *   node scripts/production/B/check-finance-matrix.mjs [--root <tree>] [--json]
 *
 * Verifies docs/production/B/finance-matrix.json against the EXACT source tree
 * it is run on (default: this repository; --root checks another worktree such
 * as a merge candidate):
 *
 *  1. Every route of the published catalog.v1 / pricing.v1 / billing.v1 owner
 *     contracts and every Gateway route owned by a Lane B service is claimed by
 *     exactly one matrix function (no silent, unmapped contract surface).
 *  2. Every HTTP route actually served by a Lane B service controller is
 *     claimed by an IMPLEMENTED function or declared legacy (no marker-only or
 *     unused finance path survives unnoticed).
 *  3. An IMPLEMENTED function's contract routes are really served at the
 *     contract path, and its files, tests and tables exist in the owner service.
 *  4. Non-implemented functions carry a PR or blockers; every blocker is
 *     classified (external or lane-owned) with an owner and a tracking reference.
 *
 * Requires `pnpm --filter @carwash/contracts run build` (reads the compiled
 * published contracts; nothing is copied). Exit 1 on any problem.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVICES = ['catalog', 'pricing', 'billing', 'wallet', 'subscription'];
const STATUSES = ['IMPLEMENTED', 'IN_REVIEW', 'BLOCKED'];
const GATES = ['OPEN', 'FAIL_CLOSED'];
const EXTERNAL_KINDS = ['PROVIDER', 'OWNER_DECISION', 'CREDENTIALS'];
const LANES = ['A', 'B', 'C', 'D', 'E'];
const METHOD_DECORATORS = {
  Get: 'GET',
  Post: 'POST',
  Put: 'PUT',
  Patch: 'PATCH',
  Delete: 'DELETE',
};

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

/** `/a/:x/b` and `a/:id/b` normalise to the same key; parameter names are irrelevant. */
export function routeKey(method, ...parts) {
  const joined = parts
    .filter((part) => part !== undefined && part !== '')
    .join('/')
    .split('/')
    .filter(Boolean)
    .map((segment) => (segment.startsWith(':') ? ':p' : segment))
    .join('/');
  return `${method.toUpperCase()} /${joined}`;
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** Statically extracts Nest routes; prefixes are resolved from string constants in the service. */
export function servedRoutes(root, service) {
  const src = path.join(root, 'services', service, 'src');
  const files = walk(src).filter((file) => file.endsWith('.ts'));
  const constants = new Map();
  for (const file of files) {
    for (const m of readFileSync(file, 'utf8').matchAll(
      /export const ([A-Z0-9_]+)\s*=\s*'([^']+)'/g,
    ))
      constants.set(m[1], m[2]);
  }
  const routes = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const controller = /@Controller\(\s*(?:'([^']*)'|([A-Z0-9_]+))?\s*\)/.exec(text);
    if (!controller) continue;
    const prefix = controller[1] ?? (controller[2] ? constants.get(controller[2]) : '') ?? null;
    if (prefix === null || prefix === undefined)
      throw new Error(`unresolved controller prefix in ${path.relative(root, file)}`);
    for (const m of text.matchAll(/@(Get|Post|Put|Patch|Delete)\(\s*(?:'([^']*)')?\s*\)/g)) {
      routes.push({
        key: routeKey(METHOD_DECORATORS[m[1]], prefix, m[2] ?? ''),
        file: path.relative(root, file).replaceAll('\\', '/'),
      });
    }
  }
  return routes;
}

const routeCache = new Map();
function cachedRoutes(root, service) {
  const cacheKey = `${root}|${service}`;
  if (!routeCache.has(cacheKey)) routeCache.set(cacheKey, servedRoutes(root, service));
  return routeCache.get(cacheKey);
}

const tableCache = new Map();
function migrationTables(root, service) {
  const cacheKey = `${root}|${service}`;
  if (!tableCache.has(cacheKey)) tableCache.set(cacheKey, readMigrationTables(root, service));
  return tableCache.get(cacheKey);
}

function readMigrationTables(root, service) {
  const dir = path.join(root, 'services', service, 'prisma', 'migrations');
  const tables = new Set();
  for (const file of walk(dir).filter((f) => f.endsWith('.sql'))) {
    for (const m of readFileSync(file, 'utf8').matchAll(
      /CREATE TABLE (?:IF NOT EXISTS )?(?:"?[a-z_]+"?\.)?"?([a-z_]+)"?/gi,
    ))
      tables.add(m[1]);
  }
  return tables;
}

function loadContracts(root) {
  const entry = path.join(root, 'packages', 'contracts', 'dist', 'index.js');
  if (!existsSync(entry))
    throw new Error(
      'packages/contracts/dist is missing: run pnpm --filter @carwash/contracts run build',
    );
  const contracts = createRequire(entry)(entry);
  return {
    owners: {
      catalog: contracts.catalogV1.CATALOG_V1,
      pricing: contracts.pricingV1.PRICING_V1,
      billing: contracts.billingV1.BILLING_V1,
    },
    gateway: contracts.GATEWAY_ROUTES,
  };
}

export function checkMatrix(root, matrix) {
  const problems = [];
  const fail = (message) => problems.push(message);
  const { owners, gateway } = loadContracts(root);
  const blockers = new Map();
  for (const b of matrix.blockers ?? []) {
    if (blockers.has(b.id)) fail(`blocker ${b.id}: duplicate id`);
    blockers.set(b.id, b);
    if (typeof b.summary !== 'string' || b.summary.length < 20)
      fail(`blocker ${b.id}: summary too short`);
    if (/\b(TODO|FIXME|TBD)\b/.test(b.summary)) fail(`blocker ${b.id}: generic TODO wording`);
    if (typeof b.external !== 'boolean') fail(`blocker ${b.id}: external must be boolean`);
    if (b.external && !EXTERNAL_KINDS.includes(b.kind))
      fail(`blocker ${b.id}: external kind must be one of ${EXTERNAL_KINDS.join('/')}`);
    if (!b.external && !LANES.includes(b.lane))
      fail(`blocker ${b.id}: lane-owned blocker needs a lane`);
    if (typeof b.tracking !== 'string' || b.tracking.length === 0)
      fail(`blocker ${b.id}: tracking reference required`);
    else if (
      !/^(PR #\d+|POLICY [A-Z]-\d+)$/.test(b.tracking) &&
      !existsSync(path.join(root, b.tracking))
    )
      fail(
        `blocker ${b.id}: tracking ${b.tracking} is neither a PR, a policy id nor an existing file`,
      );
  }

  const served = new Map();
  for (const service of SERVICES)
    for (const r of cachedRoutes(root, service))
      served.set(`${service}|${r.key}`, { ...r, owner: service });

  const claimedContract = new Map();
  const claimedGateway = new Map();
  const claimedServed = new Set();
  const usedBlockers = new Set();
  const ids = new Set();

  for (const f of matrix.functions ?? []) {
    const where = `function ${f.id}`;
    if (ids.has(f.id)) fail(`${where}: duplicate id`);
    ids.add(f.id);
    if (!SERVICES.includes(f.owner)) fail(`${where}: owner ${f.owner} is not a Lane B service`);
    if (!STATUSES.includes(f.status)) fail(`${where}: status ${f.status}`);
    if (!GATES.includes(f.productionGate)) fail(`${where}: productionGate ${f.productionGate}`);
    for (const id of f.blockers ?? []) {
      usedBlockers.add(id);
      if (!blockers.has(id)) fail(`${where}: unknown blocker ${id}`);
    }
    if (f.productionGate === 'FAIL_CLOSED' && (f.blockers ?? []).length === 0)
      fail(`${where}: a fail-closed function must name the blocker that keeps it closed`);
    if (f.status === 'IN_REVIEW' && !Number.isInteger(f.pr) && typeof f.child !== 'string')
      fail(`${where}: IN_REVIEW needs a pr number or child id`);
    if (f.status === 'BLOCKED' && (f.blockers ?? []).length === 0)
      fail(`${where}: BLOCKED without blockers`);

    for (const name of f.contractRoutes ?? []) {
      const contract = owners[f.owner];
      const spec = contract?.routes?.[name];
      if (!spec) {
        fail(`${where}: ${f.owner} contract has no route ${name}`);
        continue;
      }
      const key = `${f.owner}.${name}`;
      if (claimedContract.has(key))
        fail(`${where}: contract route ${key} already claimed by ${claimedContract.get(key)}`);
      claimedContract.set(key, f.id);
      if (f.status === 'IMPLEMENTED') {
        const servedKey = `${f.owner}|${routeKey(spec.method, contract.prefix, spec.path)}`;
        if (!served.has(servedKey))
          fail(
            `${where}: IMPLEMENTED but ${routeKey(spec.method, contract.prefix, spec.path)} (${key}) is not served`,
          );
        claimedServed.add(servedKey);
      }
    }
    for (const id of f.gatewayRoutes ?? []) {
      const route = gateway.find((g) => g.id === id);
      if (!route) fail(`${where}: no Gateway route ${id}`);
      else if (route.owner !== f.owner)
        fail(`${where}: Gateway route ${id} is owned by ${route.owner}`);
      if (claimedGateway.has(id))
        fail(`${where}: Gateway route ${id} already claimed by ${claimedGateway.get(id)}`);
      claimedGateway.set(id, f.id);
      if (route && f.status === 'IMPLEMENTED') {
        const servedKey = `${route.owner}|${routeKey(route.method, route.upstream)}`;
        if (!served.has(servedKey))
          fail(
            `${where}: IMPLEMENTED but Gateway upstream ${route.method} ${route.upstream} (${id}) is not served`,
          );
      }
    }
    for (const r of f.ownerRoutes ?? []) {
      const [method, ...rest] = r.split(' ');
      const key = `${f.owner}|${routeKey(method, rest.join(' '))}`;
      if (f.status === 'IMPLEMENTED' && !served.has(key))
        fail(`${where}: owner route ${r} is not served`);
      claimedServed.add(key);
    }
    if (f.status === 'IMPLEMENTED') {
      if ((f.tests ?? []).length === 0) fail(`${where}: IMPLEMENTED without tests`);
      for (const file of [...(f.files ?? []), ...(f.tests ?? [])])
        if (!existsSync(path.join(root, file))) fail(`${where}: missing ${file}`);
      for (const file of f.tests ?? []) {
        const full = path.join(root, file);
        if (existsSync(full) && !/\b(test|it)\(/.test(readFileSync(full, 'utf8')))
          fail(`${where}: ${file} contains no test`);
      }
      const tables = migrationTables(root, f.owner);
      for (const table of f.tables ?? [])
        if (!tables.has(table))
          fail(`${where}: table ${table} is not created by ${f.owner} migrations`);
    }
  }

  for (const legacy of matrix.legacyRoutes ?? []) {
    const [method, ...rest] = legacy.route.split(' ');
    const key = `${legacy.owner}|${routeKey(method, rest.join(' '))}`;
    if (!ids.has(legacy.supersededBy))
      fail(`legacy ${legacy.route}: unknown supersededBy ${legacy.supersededBy}`);
    if (served.has(key)) claimedServed.add(key);
  }

  for (const [owner, contract] of Object.entries(owners))
    for (const name of Object.keys(contract.routes))
      if (!claimedContract.has(`${owner}.${name}`))
        fail(`unmapped contract route ${owner}.${name}`);
  for (const route of gateway)
    if (SERVICES.includes(route.owner) && !claimedGateway.has(route.id))
      fail(`unmapped Gateway route ${route.id} (${route.owner})`);
  for (const [key, r] of served)
    if (!claimedServed.has(key))
      fail(`served route ${r.owner} ${r.key} (${r.file}) is not claimed by the matrix`);
  for (const id of blockers.keys())
    if (!usedBlockers.has(id)) fail(`blocker ${id} is not referenced`);
  return problems;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const root = path.resolve(arg('root') ?? here);
  const matrix = JSON.parse(
    readFileSync(path.join(root, 'docs/production/B/finance-matrix.json'), 'utf8'),
  );
  const problems = checkMatrix(root, matrix);
  const counts = {};
  for (const f of matrix.functions) counts[f.status] = (counts[f.status] ?? 0) + 1;
  if (process.argv.includes('--json'))
    console.log(
      JSON.stringify({ root, functions: matrix.functions.length, counts, problems }, null, 2),
    );
  else {
    console.log(`finance matrix: ${matrix.functions.length} functions ${JSON.stringify(counts)}`);
    for (const p of problems) console.log(`  PROBLEM ${p}`);
    console.log(problems.length === 0 ? 'PASSED' : `FAILED (${problems.length})`);
  }
  process.exit(problems.length === 0 ? 0 : 1);
}
