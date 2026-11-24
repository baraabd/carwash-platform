import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { apiError } from '@carwash/contracts';
import { productionSession } from '../src/data/productionSession.ts';
import { buildHomeViewModel } from '../src/features/home/homeViewModel.ts';

const profile = {
  customerId: '11111111-1111-4111-8111-111111111111',
  principal: { kind: 'guest', subjectId: '22222222-2222-4222-8222-222222222222' },
  revision: 1,
  status: 'ACTIVE',
  contact: { displayName: 'عميل الخدمة', phone: '+963912345678', phoneVerification: 'unverified' },
  preferences: { locale: 'ar' },
  createdAt: '2026-11-22T09:00:00.000Z',
  updatedAt: '2026-11-22T09:00:00.000Z',
};
const definition = {
  definitionId: '33333333-3333-4333-8333-333333333333',
  kind: 'PACKAGE',
  code: 'server-package',
  name: { ar: 'الباقة المنشورة', en: null },
  description: { ar: 'وصف الخدمة المنشور', en: null },
  durationMinutes: 45,
  vehicleTypes: ['sedan'],
  status: 'PUBLISHED',
  sortOrder: 1,
  revision: 4,
};
const catalog = {
  catalogRevision: 4,
  publishedAt: '2026-11-22T09:00:00.000Z',
  items: [definition],
};

async function gateway(t, responses) {
  const seen = [];
  const server = createServer((request, response) => {
    seen.push({ path: request.url, method: request.method, headers: request.headers });
    const result = responses[request.url] ?? { status: 404, body: {} };
    response.writeHead(result.status ?? 200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(result.body));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return { origin: `http://127.0.0.1:${server.address().port}`, seen };
}

test('production Home displays validated owner definitions and profile over real HTTP without inventing prices', async (t) => {
  const { origin, seen } = await gateway(t, {
    '/api/v1/customer/packages': { body: catalog },
    '/api/v1/customer/profile': { body: profile },
  });
  const credentials = new Map();
  const state = await productionSession(origin, (url, init) => {
    credentials.set(new URL(url).pathname, init.credentials);
    return fetch(url, init);
  });
  assert.equal(state.runtimeMode, 'production');
  assert.deepEqual(state.profile, {
    name: profile.contact.displayName,
    phone: profile.contact.phone,
  });
  assert.equal(state.productionData.profileStatus, 'available');
  assert.deepEqual(state.productionData.catalog, catalog);
  const view = buildHomeViewModel(state);
  assert.equal(view.greetingName, profile.contact.displayName);
  assert.deepEqual(
    view.packages.map((item) => [item.id, item.name, item.price]),
    [[definition.definitionId, definition.name.ar, null]],
  );
  assert.equal(view.startingPrice, null, 'a Catalog definition is not a Pricing quote');
  assert.equal(credentials.get('/api/v1/customer/packages'), 'omit');
  assert.equal(credentials.get('/api/v1/customer/profile'), 'same-origin');
  assert.ok(seen.every((request) => request.method === 'GET'));
  assert.deepEqual(state.orders, []);
  assert.equal(state.pendingHandoff, null);
});

test('anonymous and unavailable reads never fall back to customer or catalog fixtures', async (t) => {
  const ids = { requestId: 'test', correlationId: 'test' };
  const { origin } = await gateway(t, {
    '/api/v1/customer/packages': {
      status: 503,
      body: apiError('DEPENDENCY_UNAVAILABLE', 'Unavailable', ids),
    },
    '/api/v1/customer/profile': { status: 401, body: apiError('AUTH_REQUIRED', 'Sign in', ids) },
  });
  const state = await productionSession(origin, fetch);
  assert.equal(state.productionData.catalogStatus, 'unavailable');
  assert.equal(state.productionData.profileStatus, 'anonymous');
  assert.deepEqual(state.profile, { name: '', phone: '' });
  const view = buildHomeViewModel(state);
  assert.deepEqual(view.packages, []);
  assert.deepEqual(view.packageDetails, []);
  assert.equal(view.startingPrice, null);
});

test('malformed successful owner responses fail closed instead of overriding the fixture boundary', async (t) => {
  const { origin } = await gateway(t, {
    '/api/v1/customer/packages': { body: { ...catalog, items: [{ ...definition, price: 500 }] } },
    '/api/v1/customer/profile': { body: { ...profile, runtimeMode: 'parity' } },
  });
  const state = await productionSession(origin, fetch);
  assert.equal(state.runtimeMode, 'production');
  assert.equal(state.productionData.catalogStatus, 'unavailable');
  assert.equal(state.productionData.profileStatus, 'unavailable');
  assert.deepEqual(state.profile, { name: '', phone: '' });
  assert.deepEqual(buildHomeViewModel(state).packages, []);
});

test('closed profiles are not personalized and retired or extra definitions are not advertised as packages', async (t) => {
  const { origin } = await gateway(t, {
    '/api/v1/customer/packages': {
      body: {
        ...catalog,
        items: [
          { ...definition, status: 'RETIRED' },
          {
            ...definition,
            definitionId: '44444444-4444-4444-8444-444444444444',
            code: 'extra-code',
            kind: 'EXTRA',
          },
        ],
      },
    },
    '/api/v1/customer/profile': { body: { ...profile, status: 'CLOSED' } },
  });
  const state = await productionSession(origin, fetch);
  assert.equal(state.productionData.catalogStatus, 'available');
  assert.equal(state.productionData.profileStatus, 'unavailable');
  assert.deepEqual(state.profile, { name: '', phone: '' });
  assert.deepEqual(buildHomeViewModel(state).packages, []);
});
