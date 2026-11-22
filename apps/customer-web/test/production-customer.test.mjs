import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { apiError } from '@carwash/contracts/common';
import { parseProfileInputV1 } from '@carwash/contracts/customer-v1';
import { parseVehicleInputV1 } from '@carwash/contracts/vehicle-v1';
import {
  browserCsrf,
  parseCustomerIdentity,
  ProductionCustomer,
} from '../src/data/productionCustomer.ts';

const uuid = (n) => `${String(n).padStart(8, '0')}-1234-4123-8123-123456789012`;
const instant = '2026-11-22T12:00:00.000Z';
const identity = (n = 1) => ({
  subject: uuid(n),
  sessionId: uuid(n + 100),
  authVersion: 1,
  principalKind: 'guest',
  roles: [],
  permissions: ['profile.read:self', 'profile.write:self'],
});
const contact = { displayName: 'عميل الخدمة', phone: '+963912345678', locale: 'ar' };
const editor = {
  type: 'sedan',
  carName: 'سيارتي',
  plate: 'ab  12',
  color: 'أبيض',
  saveVehicle: true,
};
const error = (status, code, reason) => ({
  status,
  body: apiError(
    code,
    code,
    { requestId: 'test', correlationId: 'test' },
    reason ? { reason } : {},
  ),
});
const profile = (session = identity(), revision = 1, input = contact) => ({
  customerId: uuid(200),
  principal: { kind: session.principalKind, subjectId: session.subject },
  revision,
  status: 'ACTIVE',
  contact: { displayName: input.displayName, phone: input.phone, phoneVerification: 'unverified' },
  preferences: { locale: input.locale },
  createdAt: instant,
  updatedAt: instant,
});
const vehicle = (id = 300, extra = {}) => ({
  vehicleId: uuid(id),
  revision: 1,
  archived: false,
  type: 'sedan',
  make: 'كيا',
  model: 'ريو',
  nickname: 'سيارتي',
  color: 'أبيض',
  plate: { text: 'AB 12', region: 'دمشق' },
  createdAt: instant,
  updatedAt: instant,
  ...extra,
});
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

/** HTTP transport fixtures test the browser adapter; real owners run in Lane A. */
async function gateway(t, { authenticated = true, hasProfile = true, saved = [] } = {}) {
  const initial = identity();
  const state = {
    session: authenticated ? initial : null,
    csrf: '',
    recoveryCode: 'A'.repeat(43),
    recoveryNumber: 0,
    profiles: new Map(hasProfile ? [[initial.subject, profile(initial)]] : []),
    vehicles: new Map([[initial.subject, saved]]),
    receipts: new Map(),
    nextVehicle: 400,
    override: null,
    afterWrite: null,
    refreshSession: null,
  };
  const requests = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString();
    const entry = {
      path: request.url,
      method: request.method,
      headers: request.headers,
      body: raw ? JSON.parse(raw) : null,
    };
    requests.push(entry);
    const send = (result) => {
      if (result.destroy) {
        response.destroy();
        return;
      }
      response.writeHead(result.status ?? 200, {
        'content-type': 'application/json',
        ...result.headers,
      });
      response.end(result.status === 204 ? undefined : JSON.stringify(result.body));
    };
    try {
      const overridden = await state.override?.(entry);
      if (overridden) {
        send(overridden);
        return;
      }
      if (entry.path === '/api/v1/auth/csrf') {
        state.csrf = `csrf_${String(requests.length).padStart(24, '0')}`;
        send({
          body: { csrfToken: state.csrf },
          headers: { 'set-cookie': `wg_csrf=${state.csrf}; Path=/; SameSite=Lax` },
        });
        return;
      }
      if (entry.method !== 'GET' && entry.headers['x-csrf-token'] !== state.csrf) {
        send(error(403, 'AUTH_FORBIDDEN'));
        return;
      }
      if (entry.path === '/api/v1/auth/session') {
        send(state.session ? { body: state.session } : error(401, 'AUTH_REQUIRED'));
        return;
      }
      if (entry.path === '/api/v1/auth/refresh') {
        state.session = state.refreshSession;
        send(state.session ? { body: state.session } : error(401, 'AUTH_REQUIRED'));
        return;
      }
      if (
        entry.path === '/api/v1/auth/guest-sessions' ||
        entry.path === '/api/v1/auth/guest-sessions/recover'
      ) {
        const recovering = entry.path.endsWith('/recover');
        if (recovering && entry.body.recoveryCode !== state.recoveryCode) {
          send(error(401, 'AUTH_REQUIRED'));
          return;
        }
        state.recoveryNumber++;
        state.session = { ...initial, sessionId: uuid(110 + state.recoveryNumber) };
        state.recoveryCode = String.fromCharCode(65 + state.recoveryNumber).repeat(43);
        send({
          status: recovering ? 200 : 201,
          body: {
            session: state.session,
            recoveryCode: state.recoveryCode,
            guestExpiresAt: '2026-12-22T12:00:00.000Z',
          },
        });
        return;
      }
      if (entry.path === '/api/v1/auth/logout') {
        state.session = null;
        send({ status: 204 });
        return;
      }
      if (!state.session) {
        send(error(401, 'AUTH_REQUIRED'));
        return;
      }
      const owner = state.session.subject;
      const cars = state.vehicles.get(owner) ?? [];
      if (entry.method === 'GET') {
        if (entry.path === '/api/v1/customer/profile') {
          send(
            state.profiles.has(owner)
              ? { body: state.profiles.get(owner) }
              : error(404, 'NOT_FOUND', 'PROFILE_NOT_FOUND'),
          );
          return;
        }
        if (entry.path.startsWith('/api/v1/customer/vehicles?')) {
          send({ body: { items: cars, nextCursor: null, asOf: instant } });
          return;
        }
      }
      const key = entry.headers['idempotency-key'];
      if (!key) {
        send(error(428, 'IDEMPOTENCY_KEY_REQUIRED'));
        return;
      }
      const receiptKey = `${owner}:${entry.method}:${entry.path}:${key}`;
      const prior = state.receipts.get(receiptKey);
      if (prior) {
        if (prior.body !== raw || prior.revision !== entry.headers['if-match'])
          send(error(409, 'CONFLICT'));
        else send(prior.result);
        return;
      }
      let result;
      if (entry.path === '/api/v1/customer/profile') {
        const input = parseProfileInputV1(entry.body);
        const current = state.profiles.get(owner);
        if (entry.method === 'PATCH' && entry.headers['if-match'] !== `"${current?.revision}"`) {
          send(error(412, 'REVISION_CONFLICT'));
          return;
        }
        const value =
          entry.method === 'PUT' && current
            ? current
            : profile(state.session, (current?.revision ?? 0) + 1, input);
        state.profiles.set(owner, value);
        result = {
          status: entry.method === 'PUT' && !current ? 201 : 200,
          body: value,
          headers: { etag: `"${value.revision}"` },
        };
      } else if (entry.path === '/api/v1/customer/vehicles' && entry.method === 'POST') {
        const value = vehicle(state.nextVehicle++, parseVehicleInputV1(entry.body));
        state.vehicles.set(owner, [...cars, value]);
        result = { status: 201, body: value, headers: { etag: '"1"' } };
      } else {
        const match = /^\/api\/v1\/customer\/vehicles\/([^/]+)(\/archive)?$/.exec(entry.path);
        const current = cars.find((car) => car.vehicleId === match?.[1]);
        if (!current) {
          send(error(404, 'NOT_FOUND', 'VEHICLE_NOT_FOUND'));
          return;
        }
        if (entry.headers['if-match'] !== `"${current.revision}"`) {
          send(error(412, 'REVISION_CONFLICT'));
          return;
        }
        const value = {
          ...current,
          ...(match[2] ? { archived: true } : parseVehicleInputV1(entry.body)),
          revision: current.revision + 1,
        };
        state.vehicles.set(
          owner,
          value.archived
            ? cars.filter((car) => car !== current)
            : cars.map((car) => (car === current ? value : car)),
        );
        result = { status: 200, body: value, headers: { etag: `"${value.revision}"` } };
      }
      state.receipts.set(receiptKey, { result, body: raw, revision: entry.headers['if-match'] });
      send((await state.afterWrite?.(entry, result)) ?? result);
    } catch (cause) {
      send(error(400, 'REQUEST_INVALID'));
      state.unexpected = cause;
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    if (state.unexpected) throw state.unexpected;
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  let keys = 0;
  const makeClient = () =>
    new ProductionCustomer({
      origin,
      fetch: async (url, init) => {
        assert.equal(init.credentials, 'same-origin');
        const response = await fetch(url, {
          ...init,
          headers: { ...init.headers, cookie, ...(init.method === 'GET' ? {} : { origin }) },
        });
        const setCookie = response.headers.get('set-cookie');
        if (setCookie) cookie = setCookie.split(';')[0];
        return response;
      },
      csrf: () => browserCsrf(cookie),
      newKey: () => `client_key_${String(++keys).padStart(20, '0')}`,
    });
  return { state, requests, client: makeClient(), makeClient };
}

test('anonymous loading is read-only and never creates a guest or fixture profile', async (t) => {
  const { client, requests } = await gateway(t, { authenticated: false });
  await Promise.all([client.load(), client.load()]);
  assert.equal(client.getSnapshot().authStatus, 'anonymous');
  assert.equal(client.getSnapshot().profile, null);
  assert.deepEqual(client.getSnapshot().vehicles, []);
  assert.deepEqual(
    requests.map((r) => [r.method, r.path]),
    [['GET', '/api/v1/auth/session']],
  );
});

test('explicit guest entry displays the actual one-time receipt and bootstraps canonical contact', async (t) => {
  const { client, requests } = await gateway(t, { authenticated: false, hasProfile: false });
  await client.load();
  const guest = await client.guest();
  assert.equal(guest.ok, true);
  assert.equal(client.getSnapshot().recovery.recoveryCode, 'B'.repeat(43));
  assert.equal(client.getSnapshot().profileStatus, 'missing');
  client.acknowledgeRecovery();
  assert.equal(client.getSnapshot().recovery, null);
  assert.equal((await client.saveProfile({ ...contact, phone: '0912345678' }, null)).status, 400);
  const saved = await client.saveProfile(contact, null);
  assert.equal(saved.ok, true);
  assert.equal(saved.value.contact.phoneVerification, 'unverified');
  const writes = requests.filter((r) => ['PUT', 'PATCH'].includes(r.method));
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].body, contact);
  assert.equal(writes[0].headers['if-match'], undefined);
  assert.ok(writes[0].headers['idempotency-key']);
  assert.equal(client.getSnapshot().session.principalKind, 'guest');
});

test('guest recovery replaces the receipt and reads the same owner profile and garage', async (t) => {
  const { client } = await gateway(t, { authenticated: false, saved: [vehicle()] });
  await client.load();
  const created = await client.guest();
  await client.signOut();
  assert.equal(client.getSnapshot().profile, null);
  assert.deepEqual(client.getSnapshot().vehicles, []);
  const recovered = await client.guest(created.value.recoveryCode);
  assert.equal(recovered.ok, true);
  assert.notEqual(recovered.value.recoveryCode, created.value.recoveryCode);
  assert.notEqual(recovered.value.session.sessionId, created.value.session.sessionId);
  assert.equal(recovered.value.session.subject, created.value.session.subject);
  assert.equal(client.getSnapshot().profile.contact.displayName, contact.displayName);
  assert.equal(client.getSnapshot().vehicles[0].vehicleId, vehicle().vehicleId);
});

test('expired access is refreshed once, without silently creating a new guest', async (t) => {
  const { client, state, requests } = await gateway(t);
  await client.load();
  await client.saveProfile({ ...contact, displayName: 'آخر اسم' }, 1); // obtains a CSRF cookie
  state.session = null;
  state.refreshSession = identity();
  await client.load();
  assert.equal(client.getSnapshot().authStatus, 'authenticated');
  assert.equal(requests.filter((r) => r.path === '/api/v1/auth/refresh').length, 1);
  assert.equal(requests.filter((r) => r.path === '/api/v1/auth/guest-sessions').length, 0);
});

test('profile revision conflict reloads current owner data and rejects the stale editor again', async (t) => {
  const { client, state, requests } = await gateway(t);
  await client.load();
  state.profiles.set(
    identity().subject,
    profile(identity(), 2, { ...contact, displayName: 'تعديل آخر' }),
  );
  const stale = await client.saveProfile(contact, 1);
  assert.equal(stale.status, 412);
  assert.equal(client.getSnapshot().profile.revision, 2);
  const before = requests.length;
  assert.equal((await client.saveProfile(contact, 1)).status, 412);
  assert.equal(
    requests.length,
    before,
    'a still-open stale form cannot overwrite the refreshed revision',
  );
  assert.equal((await client.saveProfile(contact, 2)).ok, true);
  assert.equal(client.getSnapshot().profile.revision, 3);
});

test('bootstrap races show the existing canonical profile without claiming the requested input was saved', async (t) => {
  const { client, state } = await gateway(t, { hasProfile: false });
  await client.load();
  state.profiles.set(
    identity().subject,
    profile(identity(), 3, { ...contact, displayName: 'ملف أنشأه طلب آخر' }),
  );
  const result = await client.saveProfile(contact, null);
  assert.equal(result.status, 409);
  assert.equal(client.getSnapshot().profile.revision, 3);
  assert.equal(client.getSnapshot().notice, null);
});

test('garage writes use canonical IDs, preserve noneditable owner fields and survive a fresh client', async (t) => {
  const { client, makeClient, state, requests } = await gateway(t, { saved: [vehicle()] });
  await client.load();
  const updated = await client.saveVehicle(uuid(300), { ...editor, carName: 'اسمي الجديد' }, 1);
  assert.equal(updated.ok, true);
  assert.equal(updated.value.make, 'كيا');
  assert.equal(updated.value.model, 'ريو');
  assert.deepEqual(updated.value.plate, { text: 'AB 12', region: 'دمشق' });
  const update = requests.find((r) => r.method === 'PATCH');
  assert.equal(update.headers['if-match'], '"1"');
  assert.equal(Object.hasOwn(update.body, 'price'), false);
  const created = await client.saveVehicle(
    null,
    { ...editor, plate: '', carName: '', color: '' },
    null,
  );
  assert.equal(created.ok, true);
  assert.equal(created.value.plate, null);
  assert.equal(created.value.nickname, null);
  assert.equal(created.value.color, null);
  const reloaded = makeClient();
  await reloaded.load();
  assert.equal(reloaded.getSnapshot().vehicles.length, 2);
  assert.equal((await reloaded.archiveVehicle(uuid(300), 2)).ok, true);
  assert.equal(reloaded.getSnapshot().vehicles.length, 1);
  assert.equal(state.vehicles.get(identity().subject).length, 1);
  assert.equal((await reloaded.saveVehicle(uuid(999), editor, 1)).status, 404);
});

test('equal plates do not merge distinct owner vehicle records', async (t) => {
  const { client } = await gateway(t);
  await client.load();
  const first = await client.saveVehicle(null, editor, null);
  const second = await client.saveVehicle(null, editor, null);
  assert.equal(first.ok && second.ok, true);
  assert.notEqual(first.value.vehicleId, second.value.vehicleId);
  assert.equal(client.getSnapshot().vehicles.length, 2);
});

test('a lost committed vehicle reply preserves the exact key/body/revision until explicit replay', async (t) => {
  const { client, state, requests } = await gateway(t, { saved: [vehicle()] });
  await client.load();
  state.afterWrite = () => ({ destroy: true });
  const lost = await client.saveVehicle(uuid(300), editor, 1);
  assert.equal(lost.error.code, 'OUTCOME_UNKNOWN');
  assert.equal(client.getSnapshot().vehicles[0].revision, 1, 'no optimistic save is reported');
  assert.equal(client.getSnapshot().pending, 'vehicle-save');
  const before = requests.length;
  assert.equal((await client.saveVehicle(null, editor, null)).status, 409);
  assert.equal(requests.length, before);
  const replayed = await client.retryPending();
  assert.equal(replayed.ok, true);
  assert.equal(replayed.value.revision, 2);
  assert.equal(client.getSnapshot().pending, null);
  const writes = requests.filter((r) => r.method === 'PATCH');
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[0].body, writes[1].body);
  assert.equal(writes[0].headers['idempotency-key'], writes[1].headers['idempotency-key']);
  assert.equal(writes[0].headers['if-match'], writes[1].headers['if-match']);
  assert.equal(state.receipts.size, 1);
});

test('an unreadable successful create stays unknown and replays without a duplicate car', async (t) => {
  const { client, state } = await gateway(t);
  await client.load();
  state.afterWrite = (_entry, result) => ({ ...result, body: { ...result.body, inventedFee: 5 } });
  assert.equal((await client.saveVehicle(null, editor, null)).error.code, 'OUTCOME_UNKNOWN');
  assert.deepEqual(client.getSnapshot().vehicles, []);
  assert.equal((await client.retryPending()).ok, true);
  assert.equal(client.getSnapshot().vehicles.length, 1);
  assert.equal(state.vehicles.get(identity().subject).length, 1);
});

test('a well-formed response for another vehicle cannot replace the edited owner record', async (t) => {
  const { client, state } = await gateway(t, { saved: [vehicle()] });
  await client.load();
  state.afterWrite = (_entry, result) => ({
    ...result,
    body: { ...result.body, vehicleId: uuid(999) },
  });
  assert.equal((await client.saveVehicle(uuid(300), editor, 1)).error.code, 'OUTCOME_UNKNOWN');
  assert.equal(client.getSnapshot().vehicles[0].vehicleId, uuid(300));
  assert.equal(client.getSnapshot().vehicles[0].revision, 1);
  assert.equal((await client.retryPending()).ok, true);
});

test('a foreign principal profile is rejected on both owner reads and mutation receipts', async (t) => {
  const { client, state } = await gateway(t);
  state.profiles.set(identity().subject, profile(identity(2)));
  await client.load();
  assert.equal(client.getSnapshot().profileStatus, 'unavailable');
  assert.equal(client.getSnapshot().profile, null);
  state.profiles.set(identity().subject, profile());
  await client.load();
  state.afterWrite = (_entry, result) => ({
    ...result,
    body: { ...result.body, principal: profile(identity(2)).principal },
  });
  assert.equal((await client.saveProfile(contact, 1)).error.code, 'OUTCOME_UNKNOWN');
  assert.equal(client.getSnapshot().profile.principal.subjectId, identity().subject);
});

test('garage pagination rejects duplicates, archived records and repeated cursors', async (t) => {
  const { client, state } = await gateway(t);
  for (const body of [
    { items: [vehicle(), vehicle()], nextCursor: null, asOf: instant },
    { items: [vehicle(300, { archived: true })], nextCursor: null, asOf: instant },
    { items: [], nextCursor: 'repeated_cursor', asOf: instant },
  ]) {
    state.override = (entry) =>
      entry.path.startsWith('/api/v1/customer/vehicles?') ? { body } : null;
    await client.load();
    assert.equal(client.getSnapshot().vehiclesStatus, 'unavailable');
    assert.deepEqual(client.getSnapshot().vehicles, []);
  }
});

test('temporary session outages retain the original pending key but prohibit replay before revalidation', async (t) => {
  const { client, state, requests } = await gateway(t);
  await client.load();
  state.afterWrite = () => ({ destroy: true });
  await client.saveVehicle(null, editor, null);
  const original = requests.find(
    (r) => r.path === '/api/v1/customer/vehicles' && r.method === 'POST',
  );
  state.override = (entry) =>
    entry.path === '/api/v1/auth/session' ? error(503, 'DEPENDENCY_UNAVAILABLE') : null;
  await client.load();
  assert.equal(client.getSnapshot().authStatus, 'unavailable');
  assert.equal(client.getSnapshot().profile, null);
  assert.equal(client.getSnapshot().pending, 'vehicle-save');
  const before = requests.length;
  assert.equal((await client.retryPending()).status, 401);
  assert.equal(requests.length, before);
  state.override = null;
  await client.load();
  assert.equal((await client.retryPending()).ok, true);
  const replay = requests
    .filter((r) => r.path === '/api/v1/customer/vehicles' && r.method === 'POST')
    .at(-1);
  assert.equal(replay.headers['idempotency-key'], original.headers['idempotency-key']);
  assert.equal(client.getSnapshot().vehicles.length, 1);
});

test('a late write receipt cannot repopulate data after another principal is loaded', async (t) => {
  const { client, state } = await gateway(t);
  await client.load();
  const committed = deferred();
  const release = deferred();
  state.afterWrite = async (_entry, result) => {
    committed.resolve();
    await release.promise;
    return result;
  };
  const saving = client.saveVehicle(null, editor, null);
  await committed.promise;
  state.session = identity(2);
  state.profiles.set(identity(2).subject, profile(identity(2)));
  await client.load();
  release.resolve();
  assert.equal((await saving).status, 401);
  assert.equal(client.getSnapshot().session.subject, identity(2).subject);
  assert.deepEqual(client.getSnapshot().vehicles, []);
  assert.equal(client.getSnapshot().pending, null);
});

test('logout clears private state immediately and ignores a late committed response', async (t) => {
  const { client, state } = await gateway(t);
  await client.load();
  const committed = deferred();
  const release = deferred();
  state.afterWrite = async (_entry, result) => {
    committed.resolve();
    await release.promise;
    return result;
  };
  const saving = client.saveProfile({ ...contact, displayName: 'رد متأخر' }, 1);
  await committed.promise;
  const logout = client.signOut();
  assert.equal(client.getSnapshot().profile, null);
  assert.deepEqual(client.getSnapshot().vehicles, []);
  await logout;
  release.resolve();
  assert.equal((await saving).status, 401);
  assert.equal(client.getSnapshot().authStatus, 'anonymous');
  assert.equal(client.getSnapshot().profile, null);
});

test('an unconfirmed logout requires a session read before another guest can be created', async (t) => {
  const { client, state, requests } = await gateway(t);
  await client.load();
  state.override = (entry) => (entry.path === '/api/v1/auth/logout' ? { destroy: true } : null);
  assert.equal((await client.signOut()).error.code, 'OUTCOME_UNKNOWN');
  assert.equal(client.getSnapshot().authStatus, 'unavailable');
  const before = requests.length;
  assert.equal((await client.guest()).status, 409);
  assert.equal(requests.length, before);
});

test('an ambiguous guest operation reads session state and never invents or retries its recovery code', async (t) => {
  const { client, state, requests } = await gateway(t, { authenticated: false });
  await client.load();
  state.override = (entry) => {
    if (entry.path !== '/api/v1/auth/guest-sessions') return null;
    state.session = identity();
    return { destroy: true };
  };
  assert.equal((await client.guest()).error.code, 'OUTCOME_UNKNOWN');
  assert.equal(client.getSnapshot().authStatus, 'authenticated');
  assert.equal(client.getSnapshot().recovery, null);
  assert.equal(requests.filter((r) => r.path === '/api/v1/auth/guest-sessions').length, 1);
});

test('closed session shapes and CSRF failures cannot be treated as authenticated writes', async (t) => {
  assert.throws(() => parseCustomerIdentity({ ...identity(), accessToken: 'forbidden' }));
  assert.throws(() => parseCustomerIdentity({ ...identity(), roles: ['admin'] }));
  assert.throws(() => parseCustomerIdentity({ ...identity(), permissions: ['invented'] }));
  assert.equal(browserCsrf('wg_access=secret; wg_csrf=readable; wg_refresh=secret'), 'readable');
  const { client, state, requests } = await gateway(t, { authenticated: false });
  await client.load();
  state.override = (entry) =>
    entry.path === '/api/v1/auth/csrf' ? { body: { csrfToken: 'short' } } : null;
  assert.equal((await client.guest()).ok, false);
  assert.equal(requests.filter((r) => r.method === 'POST').length, 0);
  assert.equal(client.getSnapshot().authStatus, 'anonymous');
});
