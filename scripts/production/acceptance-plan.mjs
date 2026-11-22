import assert from 'node:assert/strict';

const cOwners = ['scheduling', 'workforce', 'media', 'booking', 'dispatch'];
const dOwners = [
  'catalog',
  'communications',
  'reporting',
  'support',
  'configuration',
  'identity',
  'workforce',
];

/** Each entry is a required, independently isolated CI job; none is a release approval. */
export const BUSINESS_SUITES = Object.freeze({
  'a-owners': {
    lane: 'A',
    services: ['identity', 'customer', 'vehicle', 'geo'],
    browser: false,
    scope:
      'Real owner HTTP APIs, production Gateway, Identity, PostgreSQL and Redis; captured OTP delivery. Additional Customer contract suite uses an explicit Identity HTTP double. No browser or external provider.',
  },
  'a-customer-browser': {
    lane: 'A',
    services: ['identity', 'customer', 'vehicle'],
    browser: true,
    scope:
      'Real Chromium using the production customer bundle/static runtime, Gateway, Identity, Customer and Vehicle on PostgreSQL/Redis. Guest recovery, profile and garage persistence; no Catalog/Pricing/checkout or external provider approval.',
  },
  ...Object.fromEntries(
    ['catalog', 'pricing', 'billing', 'subscription', 'wallet'].map((service) => [
      `b-${service}`,
      {
        lane: 'B',
        services: [service],
        browser: false,
        scope:
          'Real owner PostgreSQL migrations, upgrades, least-privilege persistence and HTTP contracts; declared upstream doubles. No live payment provider.',
      },
    ]),
  ),
  'b-wallet-broker': {
    lane: 'B',
    services: ['billing', 'wallet'],
    browser: false,
    scope:
      'Real PostgreSQL/RabbitMQ delivery from Billing custody outbox through the production relay and Wallet consumer, with scoped broker identities, restart/redelivery and permission denial checks. No live payment provider.',
  },
  ...Object.fromEntries(
    cOwners.map((service) => [
      `c-${service}`,
      {
        lane: 'C',
        services: cOwners,
        browser: false,
        scope:
          'Owner unit, PostgreSQL, restart and published-contract suites on real PostgreSQL/RabbitMQ/S3; Identity/other owner doubles are declared in individual suites.',
      },
    ]),
  ),
  'c-p06': {
    lane: 'C',
    services: cOwners,
    browser: true,
    scope:
      'Real Workforce/Dispatch/Booking/Media, PostgreSQL/RabbitMQ/S3 and technician browser. Identity/Booking owner doubles and a Gateway harness; Billing custody is not proved.',
  },
  'c-operator-fixtures': {
    lane: 'C',
    services: [],
    browser: true,
    scope:
      'Operator runtime, journeys, accessibility and frozen visual comparison using fixture doubles and a Gateway harness. This is not service integration evidence.',
  },
  'd-services': {
    lane: 'D',
    // Support's real owner HTTP suite starts Booking and Billing as well.
    // Their generated clients and test harnesses must exist on a clean runner.
    services: [...dOwners, 'booking', 'billing'],
    browser: false,
    scope:
      'Real PostgreSQL, RabbitMQ, Redis and owner HTTP integration for communications, reporting, configuration and support; individual suites declare their producers/doubles.',
  },
  'd-admin-browser': {
    lane: 'D',
    services: [...dOwners, 'booking', 'dispatch', 'billing'],
    browser: true,
    scope:
      'Admin Chromium journeys through real Gateway/Identity and owner HTTP APIs on PostgreSQL/Redis. Booking upstream and Pricing doubles; selected projections enter their owner handlers directly.',
  },
});

export function businessSuite(id) {
  assert.ok(Object.hasOwn(BUSINESS_SUITES, id), `Unknown business acceptance suite: ${id}`);
  return BUSINESS_SUITES[id];
}

/** A partial matrix, old artifact, dirty tree or cancelled job cannot certify this invocation. */
export function assertBusinessEvidence(reports, { sha, tree, runId, attempt }) {
  assert.match(sha ?? '', /^[a-f0-9]{40}$/);
  assert.match(tree ?? '', /^[a-f0-9]{40}$/);
  assert.deepEqual(reports.map((r) => r.suite).sort(), Object.keys(BUSINESS_SUITES).sort());
  for (const report of reports) {
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.accepted, true, `${report.suite} did not pass`);
    assert.equal(report.source.sha, sha, `${report.suite} source SHA differs`);
    assert.equal(report.source.tree, tree, `${report.suite} source tree differs`);
    assert.equal(report.source.dirty, false, `${report.suite} source was dirty`);
    assert.equal(report.github.runId, runId, `${report.suite} artifact is from another run`);
    assert.equal(
      report.github.attempt,
      attempt,
      `${report.suite} artifact is from another attempt`,
    );
    assert.equal(report.scope, businessSuite(report.suite).scope);
    assert.ok(report.steps.length > 0 && report.steps.every((s) => s.status === 'PASSED'));
    assert.ok(report.evidence.length > 0, `${report.suite} has no test evidence`);
    assert.equal(report.cleanup, 'PASSED');
  }
}
