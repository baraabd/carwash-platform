import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  assertPostgresClientHealthy,
  observePostgresClient,
  startAcknowledgedWrites,
} from '../../../scripts/production/E/recovery/postgres-writer.mjs';
import { privilegeHardeningSql } from '../../../scripts/acceptance/lib/migrations.mjs';

// Fault-injected client lifecycle tests; real PostgreSQL recovery remains a CI gate.
function clientFixture(query = async () => {}) {
  const client = observePostgresClient(new EventEmitter());
  client.query = query;
  return client;
}

test('the injected PostgreSQL disconnect preserves the last acknowledged write', async () => {
  const disconnected = Promise.withResolvers();
  const client = clientFixture();
  let writer;
  writer = startAcknowledgedWrites(client, {
    now: () => 123,
    pause: async () => {
      writer.beginDisaster();
      client.emit('error', new Error('Connection terminated unexpectedly'));
      disconnected.resolve();
    },
  });
  await disconnected.promise;
  await writer.stop();
  assert.deepEqual(writer.acknowledgements, [{ seq: 1, at: 123 }]);
  assert.throws(() => assertPostgresClientHealthy(client), /terminated unexpectedly/);
});

test('an unexpected pre-disaster connection failure cannot become recovery acceptance', async () => {
  const disconnected = Promise.withResolvers();
  const client = clientFixture();
  const writer = startAcknowledgedWrites(client, {
    pause: async () => {
      client.emit('error', new Error('Connection terminated unexpectedly'));
      disconnected.resolve();
    },
  });
  await disconnected.promise;
  assert.throws(() => writer.beginDisaster(), /terminated unexpectedly/);
  await assert.rejects(writer.stop(), /terminated unexpectedly/);
});

test('SQL failures are never excused as an injected connection failure or acknowledged', async () => {
  const failed = Promise.withResolvers();
  let queries = 0;
  const client = clientFixture(async () => {
    queries += 1;
    if (queries === 2) {
      failed.resolve();
      throw Object.assign(new Error('duplicate key value'), { code: '23505' });
    }
  });
  let writer;
  writer = startAcknowledgedWrites(client, {
    pause: async () => writer.beginDisaster(),
  });
  await failed.promise;
  await assert.rejects(writer.stop(), /duplicate key/);
  assert.equal(writer.acknowledgements.length, 1);
});

test('a connection error after writer cleanup remains observed rather than crashing Node', async () => {
  const client = clientFixture();
  const writer = startAcknowledgedWrites(client);
  await writer.stop();
  assert.doesNotThrow(() => client.emit('error', new Error('Connection terminated unexpectedly')));
  assert.throws(() => assertPostgresClientHealthy(client), /terminated unexpectedly/);
});

test('recovery applies the canonical owner policy after migrations and probes restored grants', () => {
  for (const owner of ['identity', 'workforce', 'configuration']) {
    const sql = privilegeHardeningSql(owner);
    assert.match(
      sql,
      new RegExp(`REVOKE ALL ON TABLE app\\._prisma_migrations FROM "cw_${owner}_app"`),
    );
    assert.match(sql, /config_revision.*config_review.*config_audit/);
    assert.match(sql, /MIGRATION_TABLE_MISSING/);
  }
  assert.throws(() => privilegeHardeningSql('workforce; DROP ROLE other'), /INVALID_SERVICE_OWNER/);
  const drill = readFileSync(
    new URL('../../../scripts/production/E/recovery/drill.mjs', import.meta.url),
    'utf8',
  );
  assert.match(drill, /cwd: path\.join\(ROOT, 'services', owner\)/);
  assert.match(drill, /policy\.query\(privilegeHardeningSql\(owner\)\)/);
  assert.match(drill, /allOwnersRuntimePoliciesPreserved/);
});
