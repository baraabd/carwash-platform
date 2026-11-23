import { statSync } from 'node:fs';
import path from 'node:path';

const SUITES = Object.freeze({
  customer: [
    'tests/production/A/customer.integration.test.mjs',
    'tests/production/A/customer-contract.http-pg.test.mjs',
  ],
  vehicle: ['tests/production/A/vehicle.integration.test.mjs'],
  geo: ['tests/production/A/geo.integration.test.mjs'],
  booking: [],
  billing: [],
});

/** Validate every selected suite before credentials, artifacts or infrastructure exist. */
export function acceptancePlan(args, root) {
  if (
    args[0] !== '--services' ||
    !args[1] ||
    args.length > 4 ||
    args
      .slice(2)
      .some((arg) => !['--keep', '--customer-browser', '--booking-billing'].includes(arg)) ||
    new Set(args.slice(2)).size !== args.slice(2).length
  ) {
    throw new Error(
      'usage: acceptance-a.mjs --services customer[,vehicle,geo] [--customer-browser] [--keep]; or --services booking,billing --booking-billing [--keep]',
    );
  }
  const services = args[1].split(',');
  if (
    new Set(services).size !== services.length ||
    services.some((service) => !Object.hasOwn(SUITES, service))
  ) {
    throw new Error('INVALID_SERVICE_SELECTION');
  }
  const suites = services.flatMap((service) => SUITES[service]);
  const bookingBilling = args.includes('--booking-billing');
  if (bookingBilling) {
    if (
      services.length !== 2 ||
      !services.includes('booking') ||
      !services.includes('billing') ||
      args.includes('--customer-browser')
    )
      throw new Error('BOOKING_BILLING_REQUIRES_EXACT_OWNERS');
    suites.push('tests/production/A/booking-billing.integration.test.mjs');
  } else if (services.some((service) => service === 'booking' || service === 'billing')) {
    throw new Error('BOOKING_BILLING_FLAG_REQUIRED');
  }
  const gatewayOwners = services.includes('customer') && services.includes('vehicle');
  if (gatewayOwners) suites.push('tests/production/A/gateway-owner.integration.test.mjs');
  const customerBrowser = args.includes('--customer-browser');
  if (customerBrowser && !gatewayOwners) throw new Error('CUSTOMER_BROWSER_REQUIRES_REAL_OWNERS');
  if (customerBrowser) suites.push('tests/production/A/customer-production.browser.test.mjs');
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
  const identityUsed =
    bookingBilling || services.some((service) => ['customer', 'vehicle', 'geo'].includes(service));
  const scope =
    'Real PostgreSQL 16 (least-privilege roles from infra/postgres/provision.sh), ' +
    `real owner-service HTTP adapters on loopback (${services.join(', ')}). ` +
    (identityUsed
      ? 'Real Identity Nest application and Redis; only the OTP delivery port is captured in-process. '
      : 'Identity database is migrated and Redis is provisioned; Identity authentication and Redis behavior are not exercised by the geo suite. ') +
    (services.includes('customer')
      ? 'The additional Customer published-contract suite uses an explicit Identity HTTP double. '
      : '') +
    (gatewayOwners
      ? 'Additional production Gateway-to-Identity/Customer/Vehicle HTTP journeys use real owners and sessions. '
      : bookingBilling
        ? 'Production Booking adapter to Billing with real Identity and principal Gateway reads; explicit Pricing and other owner port doubles. '
        : 'No Gateway. ') +
    (customerBrowser
      ? 'Real Chromium guest, profile and garage journey against those owners and the production bundle. '
      : 'No browser. ') +
    'No broker relay, no production deployment.';
  return {
    services,
    suites,
    scope,
    gatewayOwners,
    customerBrowser,
    bookingBilling,
    keep: args.includes('--keep'),
  };
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
