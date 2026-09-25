import assert from 'node:assert/strict';
import test from 'node:test';
import { catalogDefinitions, validateCatalogValue } from '../../dist/ownership/catalog.mjs';
import { catalog, schema } from './fixtures.mjs';
test('catalog defines 19 exclusive data owners, one data-less gateway, three apps and twelve shared packages', () => {
  const result = validateCatalogValue(catalog, schema);
  assert.deepEqual(result.errors, []);
  assert.equal(catalogDefinitions(result.catalog).length, 35);
  assert.equal(catalog.services.length, 19);
  assert.equal(catalog.gateway.database, null);
  assert.deepEqual(catalog.gateway.owns, []);
});
const cases = {
  'missing service': (c) => c.services.pop(),
  'duplicate service': (c) => {
    c.services[1] = structuredClone(c.services[0]);
  },
  'extra service': (c) => c.services.push(structuredClone(c.services[0])),
  'unknown service': (c) => {
    c.services[0].id = 'imposter';
  },
  'duplicate data allocation': (c) => c.services[1].owns.push(c.services[0].owns[0]),
  'duplicate database': (c) => {
    c.services[1].database = c.services[0].database;
  },
  'duplicate DB roles': (c) => {
    c.services[0].migrationRole = c.services[0].runtimeRole;
  },
  'missing owner': (c) => {
    delete c.services[0].owner;
  },
  'wrong owner': (c) => {
    c.services[1].owner = c.services[0].owner;
  },
  'empty responsibilities': (c) => {
    c.services[0].responsibilities = [];
  },
  'path traversal': (c) => {
    c.services[0].path = 'services/../billing';
  },
  'mismatched valid path': (c) => {
    c.services[0].path = 'services/other';
  },
  'mismatched package': (c) => {
    c.services[0].packageName = '@carwash/other';
  },
  'wrong API namespace': (c) => {
    c.services[0].api.prefix = '/internal/v1/billing';
  },
  'unversioned API': (c) => {
    c.services[0].api.version = 0;
  },
  'claimed API implementation': (c) => {
    c.services[0].api.status = 'implemented';
  },
  'foreign event publication': (c) => {
    c.services[0].events.published = ['billing.payment-confirmed.v1'];
  },
  'unversioned event': (c) => {
    c.services[0].events.published = ['identity.changed'];
  },
  'empty forbidden implementations': (c) => {
    c.services[0].forbiddenDependencies = [];
  },
  'wrong forbidden implementation': (c) => {
    c.services[0].forbiddenDependencies[0] = '@carwash/not-a-service';
  },
  'gateway database': (c) => {
    c.gateway.database = 'cw_gateway';
  },
  'gateway business data': (c) => {
    c.gateway.owns = ['bookings'];
  },
  'gateway financial event': (c) => {
    c.gateway.events.published = ['billing.payment-confirmed.v1'];
  },
  'duplicate app': (c) => {
    c.apps[0] = structuredClone(c.apps[1]);
  },
  'wrong app audience': (c) => {
    c.apps[0].audience = 'admin';
  },
  'extra shared package': (c) => c.sharedPackages.push(structuredClone(c.sharedPackages[0])),
  'wrong shared zone': (c) => {
    c.sharedPackages[0].zone = 'technical';
  },
  'shared business package': (c) => {
    c.sharedPackages[0].id = 'shared-business';
  },
  'unversioned shared package': (c) => {
    c.sharedPackages[0].version = '*';
  },
  'old vehicle data owner': (c) => {
    const v = c.services.find((s) => s.id === 'vehicle');
    v.owns = v.owns.filter((r) => r !== 'vehicles');
    c.services.find((s) => s.id === 'customer').owns.push('vehicles');
  },
  'undisclosed legacy prototype': (c) => {
    c.legacyPrototypeLocations.pop();
  },
  'changed legacy prototype location': (c) => {
    c.legacyPrototypeLocations[0].path = 'services/pricing/src/domain/quote.ts';
  },
  'cross DB policy weakened': (c) => {
    c.policy.crossServiceDatabaseAccess = true;
  },
  'fake physical isolation proof': (c) => {
    c.policy.databaseIsolationVerified = true;
  },
  'fake independent deployment proof': (c) => {
    c.services[0].deployment.verified = true;
  },
  'unknown schema version': (c) => {
    c.schemaVersion = 3;
  },
  'unknown top-level property': (c) => {
    c.bypass = true;
  },
};
for (const [name, edit] of Object.entries(cases))
  test(`catalog rejects ${name}`, () => {
    const changed = structuredClone(catalog);
    edit(changed);
    assert.notEqual(validateCatalogValue(changed, schema).errors.length, 0);
  });
test('required catalog properties cannot be removed', () => {
  for (const key of schema.required) {
    const changed = structuredClone(catalog);
    delete changed[key];
    assert.notEqual(validateCatalogValue(changed, schema).errors.length, 0, key);
  }
});
