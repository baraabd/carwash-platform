// Runtime policy and composition tests. SQL ports below are explicit doubles;
// the Catalog PostgreSQL integration suite separately proves real DB/schema IO.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

const require = createRequire(import.meta.url);
const {
  HealthController,
  configurationCapability,
  schemaReadinessProbe,
} = require('../../../packages/service-kit/dist/health.js');
const catalog = JSON.parse(
  readFileSync(new URL('../../../architecture/service-catalog.json', import.meta.url)),
);
const owners = catalog.services.map(({ id }) => id).filter((id) => id !== 'identity');
const load = (owner) => require(`../../../services/${owner}/dist/app.module.js`);
const grant = (scopes) => JSON.stringify([{ id: 'booking', tokenSha256: 'a'.repeat(64), scopes }]);
const testOrigin = 'https://owner.readiness-fixture.invalid';
const token = 'readiness-fixture-credential-'.repeat(2);

function configuration(owner) {
  const env = {
    DATABASE_URL: `postgresql://cw_${owner}_app:fixture@127.0.0.1/cw_${owner}?schema=app`,
  };
  for (const key of [
    'IDENTITY_SESSION_ORIGIN',
    'CUSTOMER_IDENTITY_ORIGIN',
    'VEHICLE_IDENTITY_ORIGIN',
    'GEO_IDENTITY_ORIGIN',
    'IDENTITY_URL',
    'IDENTITY_ORIGIN',
    'CATALOG_ORIGIN',
    'SUBSCRIPTION_ORIGIN',
    'BILLING_DISPATCH_ORIGIN',
    'SUBSCRIPTION_BILLING_ORIGIN',
    'SUBSCRIPTION_PRICING_ORIGIN',
    'PRICING_ORIGIN',
    'BILLING_ORIGIN',
    'BOOKING_ORIGIN',
    'REVIEWS_BOOKING_ORIGIN',
    'BOOKING_DISPATCH_URL',
  ])
    env[key] = testOrigin;
  for (const dependency of [
    'pricing',
    'billing',
    'scheduling',
    'subscription',
    'customer',
    'vehicle',
  ]) {
    env[dependency.toUpperCase() + '_URL'] = testOrigin;
    env['BOOKING_TOKEN_' + dependency.toUpperCase()] = token;
  }
  for (const prefix of ['BOOKING_DISPATCH', 'DISPATCH_WORKFORCE', 'DISPATCH_MEDIA']) {
    env[prefix + '_URL'] = testOrigin;
    env[prefix + '_CLIENT_ID'] = 'booking';
    env[prefix + '_CLIENT_TOKEN'] = token;
  }
  env.BILLING_PRICING_SERVICE_TOKEN = token;
  env.SUBSCRIPTION_BILLING_CLIENT_ID = 'subscription';
  env.SUBSCRIPTION_BILLING_SERVICE_TOKEN = token;
  env.BILLING_SHAM_CASH_MERCHANT_ACCOUNTS = 'fixture-sham-cash';
  env.BILLING_SYRIATEL_CASH_MERCHANT_ACCOUNTS = 'fixture-syriatel-cash';
  env.PRICING_CURRENCY_POLICY = JSON.stringify({
    revision: 'test-policy',
    currency: 'USD',
    minorUnitExponent: 2,
    maxAmountMinor: '100000',
  });
  env.PRICING_QUOTE_TTL_SECONDS = '600';
  env.CUSTOMER_SERVICE_CLIENTS = grant(['customer.address-snapshot.resolve']);
  env.VEHICLE_SERVICE_CLIENTS = grant(['vehicle.snapshot.resolve']);
  env.GEO_SERVICE_CLIENTS = grant(['geo.serviceability.validate']);
  env.CONFIGURATION_SERVICE_CLIENTS = grant(['configuration.read']);
  for (const [id, scopes] of Object.entries({
    billing: 'BILLING_SERVICE_SCOPES',
    pricing: 'PRICING_SERVICE_SCOPES',
    subscription: 'SERVICE_SCOPES',
    workforce: 'WORKFORCE_SCOPES',
    dispatch: 'DISPATCH_SCOPES',
    scheduling: 'SCHEDULING_SCOPES',
    media: 'MEDIA_SCOPES',
  })) {
    env[id.toUpperCase() + '_SERVICE_CLIENTS'] = grant(
      require(`../../../services/${id}/dist/ports/index.js`)[scopes],
    );
  }
  env.MEDIA_S3_ENDPOINT = 'http://127.0.0.1:1';
  env.MEDIA_S3_REGION = 'us-east-1';
  env.MEDIA_S3_BUCKET = 'readiness-fixture';
  env.MEDIA_S3_ACCESS_KEY_ID = 'ReadinessFixtureAccess';
  env.MEDIA_S3_SECRET_ACCESS_KEY = token;
  return env;
}

async function health(options) {
  const captured = {};
  const response = {
    status(status) {
      captured.status = status;
      return response;
    },
    json(body) {
      captured.body = body;
      return body;
    },
  };
  await new HealthController({ ...options, logger: undefined }).ready(response);
  return captured;
}

function client(tables, owner, role = `cw_${owner}_app`) {
  const calls = [];
  return {
    calls,
    client: {
      $queryRaw: async (sql, ...parameters) => {
        calls.push({ query: sql.join('?'), parameters });
        if (sql.join('').includes('information_schema.tables'))
          return tables.map((table_name) => ({
            table_name,
            role_name: role,
            session_role: role,
            database_name: `cw_${owner}`,
          }));
        return [{ value: 1 }];
      },
    },
  };
}

test('every non-foundation owner schema probe exactly covers its current Prisma model tables', () => {
  assert.equal(owners.length, 18);
  for (const owner of owners) {
    const schema = readFileSync(
      new URL(`../../../services/${owner}/prisma/schema.prisma`, import.meta.url),
      'utf8',
    );
    const tables = [...schema.matchAll(/model\s+(\w+)\s*\{([^}]*)\}/g)].map(
      ([, name, body]) => /@@map\("([^"]+)"\)/.exec(body)?.[1] ?? name,
    );
    assert.ok(tables.length > 1, owner);
    assert.deepEqual([...load(owner).RUNTIME_TABLES].sort(), tables.sort(), owner);
  }
});

test('all 18 owner compositions stay unready with healthy SQL but missing API prerequisites', async () => {
  for (const owner of owners) {
    const module = load(owner);
    const prisma = client(module.RUNTIME_TABLES, owner);
    const result = await health(
      module.runtimeHealthOptions(prisma, configuration(owner).DATABASE_URL, {}),
    );
    assert.equal(result.status, 503, owner);
    assert.equal(result.body.businessReady, false, owner);
    assert.equal(result.body.code, 'FOUNDATION_NOT_READY', owner);
    assert.ok(
      result.body.capabilities.some((capability) => capability.required && !capability.available),
      owner,
    );
    const query = prisma.calls.find((call) => call.query.includes('information_schema.tables'));
    assert.deepEqual(query.parameters, ['app'], owner);
  }
});

test('all 18 owner capabilities can become ready only with complete local prerequisites and own schema probes', async (t) => {
  const calls = [];
  const s3 = createServer((req, res) => {
    calls.push({ method: req.method, url: req.url, authorization: req.headers.authorization });
    res.writeHead(200);
    res.end();
  });
  await new Promise((resolve) => s3.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    s3.closeAllConnections();
    return new Promise((resolve) => s3.close(resolve));
  });
  for (const owner of owners) {
    const module = load(owner);
    const env = configuration(owner);
    env.MEDIA_S3_ENDPOINT = `http://127.0.0.1:${s3.address().port}`;
    const options = module.runtimeHealthOptions(
      client(module.RUNTIME_TABLES, owner),
      env.DATABASE_URL,
      env,
    );
    const result = await health(options);
    assert.equal(result.status, 200, `${owner}: ${JSON.stringify(result.body)}`);
    assert.equal(result.body.ready, true, owner);
    assert.equal(result.body.scope, 'http-api', owner);
    assert.ok(result.body.dependencies.length >= 2, owner);
    assert.ok(
      result.body.dependencies.every((dependency) => dependency.status === 'UP'),
      owner,
    );
    if (owner === 'billing') {
      const capability = result.body.capabilities.find(
        (entry) => entry.name === 'automated-provider-confirmation',
      );
      assert.equal(
        capability.available,
        false,
        'manual account configuration is never automated merchant acceptance',
      );
    }
    const noSchema = await health({
      ...options,
      dependencies: [
        options.dependencies[0],
        schemaReadinessProbe(module.RUNTIME_TABLES, async () => module.RUNTIME_TABLES.slice(1)),
      ],
    });
    assert.equal(noSchema.status, 503, owner);
    assert.equal(noSchema.body.code, 'DEPENDENCY_DOWN', owner);
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'HEAD');
  assert.equal(calls[0].url, '/readiness-fixture');
  assert.match(calls[0].authorization, /^AWS4-HMAC-SHA256 /);
});

test('invalid/missing scope, contract-incompatible price policy and invalid private transport remain unready', async () => {
  const cases = [
    ['customer', { CUSTOMER_SERVICE_CLIENTS: '[]' }],
    ['vehicle', { VEHICLE_SERVICE_CLIENTS: grant(['forged.scope']) }],
    ['booking', { BOOKING_TOKEN_BILLING: '' }],
    ['dispatch', { DISPATCH_MEDIA_CLIENT_TOKEN: undefined }],
    ['billing', { BILLING_SHAM_CASH_MERCHANT_ACCOUNTS: '' }],
    [
      'pricing',
      {
        PRICING_CURRENCY_POLICY: JSON.stringify({
          revision: 'test-policy',
          currency: 'USD',
          minorUnitExponent: 0,
          maxAmountMinor: '100000',
        }),
      },
    ],
    ['catalog', { IDENTITY_SESSION_ORIGIN: 'http://identity.railway.internal' }],
  ];
  for (const [owner, changes] of cases) {
    const module = load(owner);
    const env = { ...configuration(owner), ...changes };
    const result = await health(
      module.runtimeHealthOptions(client(module.RUNTIME_TABLES, owner), env.DATABASE_URL, env),
    );
    assert.equal(result.status, 503, owner);
    assert.equal(result.body.businessReady, false, owner);
    assert.doesNotMatch(
      JSON.stringify(result.body),
      /readiness-fixture-credential|postgresql:\/\//,
    );
  }
});

test('dynamic capability failure, missing probes and invalid config never yield readiness', async () => {
  let configured = false;
  const options = {
    service: 'test',
    businessReady: false,
    runtimeCapabilities: [configurationCapability('configured-adapter', () => configured)],
    dependencies: [{ name: 'database', kind: 'postgres', check: async () => {} }],
  };
  assert.equal((await health(options)).status, 503);
  configured = true;
  assert.equal((await health(options)).status, 200);
  assert.equal((await health({ ...options, dependencies: [] })).status, 503);
  assert.equal((await health({ ...options, runtimeCapabilities: [] })).status, 503);
  const invalid = await health({
    ...options,
    runtimeCapabilities: [
      configurationCapability('invalid', () => {
        throw new Error('postgresql://secret-password');
      }),
    ],
  });
  assert.equal(invalid.status, 503);
  assert.equal(invalid.body.capabilities[0].code, 'CONFIGURATION_INVALID');
  assert.doesNotMatch(JSON.stringify(invalid.body), /secret-password/);
});

test('visible owner tables do not make a migration, superuser or another owner connection ready', async () => {
  for (const owner of owners) {
    const module = load(owner);
    const env = configuration(owner);
    for (const role of [`cw_${owner}_migrate`, 'postgres', 'cw_wrong_owner_app']) {
      const options = module.runtimeHealthOptions(
        client(module.RUNTIME_TABLES, owner, role),
        env.DATABASE_URL,
        env,
      );
      const result = await health({
        ...options,
        dependencies: options.dependencies.filter((probe) => probe.kind === 'postgres'),
      });
      assert.equal(result.status, 503, owner);
      assert.equal(
        result.body.dependencies.find((probe) => probe.name === 'postgres-schema').status,
        'DOWN',
        owner,
      );
    }
  }
});

test('Media authenticated bucket failures are dependency failures without object writes', async (t) => {
  const s3 = createServer((_req, res) => {
    res.writeHead(403);
    res.end();
  });
  await new Promise((resolve) => s3.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    s3.closeAllConnections();
    return new Promise((resolve) => s3.close(resolve));
  });
  const module = load('media');
  const env = configuration('media');
  env.MEDIA_S3_ENDPOINT = `http://127.0.0.1:${s3.address().port}`;
  const result = await health(
    module.runtimeHealthOptions(client(module.RUNTIME_TABLES, 'media'), env.DATABASE_URL, env),
  );
  assert.equal(result.status, 503);
  assert.equal(result.body.businessReady, true);
  assert.equal(
    result.body.dependencies.find((dependency) => dependency.name === 'object-store').status,
    'DOWN',
  );
  assert.doesNotMatch(JSON.stringify(result.body), /readiness-fixture-credential|AWS4-HMAC-SHA256/);
});
