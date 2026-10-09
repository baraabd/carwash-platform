import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { VEHICLE_UPDATED_V1 } from '@carwash/event-contracts';
import {
  ApplicationError,
  decodeCursor,
  encodeCursor,
  parseLimit,
  VehicleApplication,
  type RequestContext,
} from '../../src/application';
import type { Owner, Vehicle } from '../../src/domain';
import { NoWorkloadIdentity } from '../../src/infrastructure/identity/no-workload-identity';
import type {
  AuditEntry,
  IdempotencyClaim,
  IdempotencyRequest,
  OutboxEvent,
  ServiceActor,
  VehicleCursor,
  VehicleStore,
  VehicleTransaction,
  WorkloadAuthenticator,
} from '../../src/ports';

/** In-memory ports: enough to exercise use-case rules; persistence is proven on PostgreSQL. */
class MemoryStore implements VehicleStore {
  readonly vehicles = new Map<string, Vehicle>();
  readonly outbox: OutboxEvent[] = [];
  readonly audit: AuditEntry[] = [];
  readonly keys = new Map<string, { fingerprint: string; status: number; body: unknown }>();

  transaction<T>(work: (tx: VehicleTransaction) => Promise<T>): Promise<T> {
    const owned = (owner: Owner, id: string) => {
      const vehicle = this.vehicles.get(id);
      return vehicle && vehicle.owner.kind === owner.kind && vehicle.owner.subject === owner.subject
        ? vehicle
        : null;
    };
    const tx: VehicleTransaction = {
      claimIdempotency: (request: IdempotencyRequest): Promise<IdempotencyClaim> => {
        const existing = this.keys.get(`${request.scope}|${request.key}`);
        if (!existing) {
          this.keys.set(`${request.scope}|${request.key}`, {
            fingerprint: request.fingerprint,
            status: 0,
            body: null,
          });
          return Promise.resolve({ kind: 'claimed' });
        }
        if (existing.fingerprint !== request.fingerprint) {
          return Promise.resolve({ kind: 'mismatch' });
        }
        return Promise.resolve({ kind: 'replay', status: existing.status, body: existing.body });
      },
      completeIdempotency: (scope, key, status, body) => {
        const record = this.keys.get(`${scope}|${key}`);
        if (record) Object.assign(record, { status, body });
        return Promise.resolve();
      },
      lockOwner: () => Promise.resolve(),
      countActiveVehicles: (owner) =>
        Promise.resolve(
          [...this.vehicles.values()].filter(
            (v) => v.owner.subject === owner.subject && v.owner.kind === owner.kind && !v.archived,
          ).length,
        ),
      insertVehicle: (vehicle) => {
        const { now, ...rest } = vehicle;
        const row: Vehicle = {
          ...rest,
          archived: false,
          revision: 1,
          createdAt: now,
          updatedAt: now,
          archivedAt: null,
        };
        this.vehicles.set(row.id, row);
        return Promise.resolve(row);
      },
      findOwnedVehicle: (owner, id) => Promise.resolve(owned(owner, id)),
      updateVehicle: (owner, id, input, archived, expectedRevision, now) => {
        const current = owned(owner, id);
        if (!current || current.revision !== expectedRevision) return Promise.resolve(null);
        const next: Vehicle = {
          ...current,
          ...input,
          archived,
          archivedAt: archived ? now : null,
          revision: current.revision + 1,
          updatedAt: now,
        };
        this.vehicles.set(id, next);
        return Promise.resolve(next);
      },
      appendOutbox: (event) => {
        this.outbox.push(event);
        return Promise.resolve();
      },
      appendAudit: (entry) => {
        this.audit.push(entry);
        return Promise.resolve();
      },
    };
    return work(tx);
  }

  listActiveVehicles(owner: Owner, after: VehicleCursor | null, limit: number) {
    const rows = [...this.vehicles.values()]
      .filter((v) => v.owner.subject === owner.subject && !v.archived)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1))
      .filter(
        (v) =>
          after === null ||
          v.createdAt > after.createdAt ||
          (v.createdAt.getTime() === after.createdAt.getTime() && v.id > after.id),
      )
      .slice(0, limit);
    return Promise.resolve(rows);
  }
}

const owner: Owner = { kind: 'guest', subject: randomUUID() };
const sessionId = randomUUID();
let tick = Date.parse('2026-10-08T08:00:00.000Z');
const clock = { now: () => new Date((tick += 1000)) };
const ids = { uuid: () => randomUUID() };
const identity = {
  authorize: () =>
    Promise.resolve({
      principal: owner,
      sessionId,
      permissions: ['profile.read:self', 'profile.write:self'],
    }),
};
const context: RequestContext = {
  credentials: { authorization: 'Bearer test', correlationId: randomUUID() },
  correlationId: randomUUID(),
  traceParent: null,
};
const input = { type: 'sedan', make: null, model: null, color: null, nickname: null, plate: null };

function application(store: MemoryStore, workloads: WorkloadAuthenticator) {
  return new VehicleApplication(store, identity, workloads, clock, ids);
}

function refused(code: string, reason: string | null = null) {
  return (error: unknown) =>
    error instanceof ApplicationError && error.code === code && error.reason === reason;
}

const booking = (scopes: readonly string[]): WorkloadAuthenticator => ({
  authenticate: (): Promise<ServiceActor> => Promise.resolve({ service: 'booking', scopes }),
});

test('mutations require an idempotency key and refuse a malformed one', async () => {
  const app = application(new MemoryStore(), new NoWorkloadIdentity());
  await assert.rejects(
    app.createVehicle(context, null, input),
    refused('IDEMPOTENCY_KEY_REQUIRED'),
  );
  await assert.rejects(app.createVehicle(context, 'short', input), refused('REQUEST_INVALID'));
  await assert.rejects(
    app.archiveVehicle(context, randomUUID(), 1, null, undefined),
    refused('IDEMPOTENCY_KEY_REQUIRED'),
  );
});

test('events are envelope v2 vehicle.vehicle-updated.v1 with a guest actor and no PII', async () => {
  const store = new MemoryStore();
  const app = application(store, new NoWorkloadIdentity());
  const created = await app.createVehicle(context, 'k'.repeat(20), {
    ...input,
    plate: { text: '123', region: null },
    nickname: 'family',
  });
  assert.equal(created.status, 201);
  const [row] = store.outbox;
  assert.ok(row);
  const event = VEHICLE_UPDATED_V1.parse(JSON.parse(row.payload));
  assert.deepEqual(event.actor, { kind: 'guest', id: owner.subject });
  assert.deepEqual(event.aggregate, { type: 'vehicle', id: created.body.vehicleId, version: 1 });
  assert.deepEqual(event.data, { change: 'CREATED' });
  assert.equal(row.exchange, 'vehicle.events');
  assert.ok(!row.payload.includes('family') && !row.payload.includes('"123"'));
});

test('a reused key with a different body is IDEMPOTENCY_CONFLICT; the same body replays', async () => {
  const app = application(new MemoryStore(), new NoWorkloadIdentity());
  const key = 'r'.repeat(20);
  const first = await app.createVehicle(context, key, input);
  const replay = await app.createVehicle(context, key, { ...input });
  assert.equal(replay.replayed, true);
  assert.equal(replay.body, first.body);
  await assert.rejects(
    app.createVehicle(context, key, { ...input, type: 'suv' }),
    refused('IDEMPOTENCY_CONFLICT'),
  );
});

test('pages: limit rules match parsePageRequest; cursors are opaque and validated', async () => {
  assert.equal(parseLimit(undefined), 20);
  assert.equal(parseLimit('100'), 100);
  for (const bad of ['0', '101', '1.5', '-1', 'abc', '0010']) {
    assert.throws(() => parseLimit(bad), refused('REQUEST_INVALID'), bad);
  }
  assert.throws(() => decodeCursor('not base64!'), refused('REQUEST_INVALID'));
  assert.throws(() => decodeCursor('aGVsbG8'), refused('REQUEST_INVALID'));
  const store = new MemoryStore();
  const app = application(store, new NoWorkloadIdentity());
  for (let i = 0; i < 5; i += 1) await app.createVehicle(context, `page-key-${i}-xxxxxxxxx`, input);
  const first = await app.listVehicles(context, { limit: '2', cursor: undefined });
  assert.equal(first.items.length, 2);
  assert.ok(first.nextCursor);
  const second = await app.listVehicles(context, { limit: '2', cursor: first.nextCursor });
  const third = await app.listVehicles(context, { limit: '2', cursor: second.nextCursor ?? '' });
  assert.equal(third.items.length, 1);
  assert.equal(third.nextCursor, null);
  const all = [...first.items, ...second.items, ...third.items].map((v) => v.vehicleId);
  assert.equal(new Set(all).size, 5);
  const last = store.vehicles.get(all[4] ?? '');
  assert.ok(last);
  assert.deepEqual(decodeCursor(encodeCursor(last)), { createdAt: last.createdAt, id: last.id });
});

test('snapshot route is deny-by-default without workload identity', async () => {
  const app = application(new MemoryStore(), new NoWorkloadIdentity());
  const body = {
    owner: { kind: 'guest', subjectId: owner.subject },
    vehicleId: randomUUID(),
    expectedRevision: null,
    purpose: 'booking-create',
  };
  await assert.rejects(app.resolveVehicleSnapshot(context, body), refused('AUTH_FORBIDDEN'));
  await assert.rejects(
    app.resolveVehicleSnapshot({ ...context, credentials: { correlationId: 'x' } }, body),
    refused('AUTH_REQUIRED'),
  );
});

test('snapshot: scope, owner, revision and archive rules; the read is audited with purpose', async () => {
  const store = new MemoryStore();
  const owned = await application(store, new NoWorkloadIdentity()).createVehicle(
    context,
    's'.repeat(20),
    { ...input, plate: { text: '١٢٣', region: null } },
  );
  const vehicleId = owned.body.vehicleId;
  const request = {
    owner: { kind: 'guest', subjectId: owner.subject },
    vehicleId,
    expectedRevision: 1,
    purpose: 'booking-quote',
  };
  await assert.rejects(
    application(store, booking(['other.scope'])).resolveVehicleSnapshot(context, request),
    refused('AUTH_FORBIDDEN'),
  );
  const app = application(store, booking(['vehicle.snapshot.resolve']));
  const snapshot = await app.resolveVehicleSnapshot(context, request);
  assert.equal(snapshot.source, 'saved');
  assert.equal(snapshot.vehicleRevision, 1);
  assert.deepEqual(snapshot.plate, { text: '١٢٣', region: null });
  const audit = store.audit.at(-1);
  assert.deepEqual(audit?.actor, { kind: 'service', service: 'booking', purpose: 'booking-quote' });
  assert.equal(audit?.action, 'vehicle.snapshot-resolved');
  // Another principal kind with the same subject value does not own it.
  await assert.rejects(
    app.resolveVehicleSnapshot(context, {
      ...request,
      owner: { kind: 'account', subjectId: owner.subject },
    }),
    refused('NOT_FOUND', 'VEHICLE_NOT_FOUND'),
  );
  await assert.rejects(
    app.resolveVehicleSnapshot(context, { ...request, expectedRevision: 2 }),
    refused('REVISION_CONFLICT'),
  );
  await application(store, new NoWorkloadIdentity()).archiveVehicle(
    context,
    vehicleId,
    1,
    'a'.repeat(20),
    undefined,
  );
  await assert.rejects(
    app.resolveVehicleSnapshot(context, { ...request, expectedRevision: null }),
    (error: unknown) => error instanceof Error && error.name === 'VehicleRuleError',
  );
  const display = await app.resolveVehicleSnapshot(context, {
    ...request,
    expectedRevision: 2,
    purpose: 'booking-display',
  });
  assert.equal(display.vehicleRevision, 2);
});
