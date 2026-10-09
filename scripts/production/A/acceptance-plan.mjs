import { statSync } from 'node:fs';
import path from 'node:path';

const SUITES = Object.freeze({
  customer: 'tests/production/A/customer.integration.test.mjs',
  vehicle: 'tests/production/A/vehicle.integration.test.mjs',
  geo: 'tests/production/A/geo.integration.test.mjs',
});

/** Validate every selected suite before credentials, artifacts or infrastructure exist. */
export function acceptancePlan(args, root) {
  if (
    args[0] !== '--services' ||
    !args[1] ||
    args.length > 3 ||
    (args.length === 3 && args[2] !== '--keep')
  ) {
    throw new Error('usage: acceptance-a.mjs --services customer[,vehicle,geo] [--keep]');
  }
  const services = args[1].split(',');
  if (
    new Set(services).size !== services.length ||
    services.some((service) => !Object.hasOwn(SUITES, service))
  ) {
    throw new Error('INVALID_SERVICE_SELECTION');
  }
  const suites = services.map((service) => SUITES[service]);
  for (const suite of suites) {
    let present = false;
    try {
      present = statSync(path.join(root, suite)).isFile();
    } catch {
      // Report a bounded path, not infrastructure or user-provided input.
    }
    if (!present) throw new Error(`MISSING_ACCEPTANCE_SUITE: ${suite}`);
  }
  // Since P02-A3 every Lane A suite authorizes through the real Identity (geo included).
  const identityUsed = services.some((service) => ['customer', 'vehicle', 'geo'].includes(service));
  const scope =
    'Real PostgreSQL 16 (least-privilege roles from infra/postgres/provision.sh), ' +
    `real owner-service HTTP adapters on loopback (${services.join(', ')}). ` +
    (identityUsed
      ? 'Real Identity Nest application and Redis; only the OTP delivery port is captured in-process. '
      : 'Identity database is migrated and Redis is provisioned; Identity authentication and Redis behavior are not exercised by the geo suite. ') +
    'No broker relay, no gateway, no browser, no production deployment.';
  return { services, suites, scope, keep: args.includes('--keep') };
}

export function suiteAccepted(result, counts) {
  return (
    result.code === 0 &&
    result.outcome === 'exited' &&
    !result.signal &&
    Number.isSafeInteger(counts.tests) &&
    counts.tests > 0 &&
    counts.pass === counts.tests &&
    ['fail', 'skipped', 'todo', 'cancelled'].every((name) => counts[name] === 0)
  );
}
