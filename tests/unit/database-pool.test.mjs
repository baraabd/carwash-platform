import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { ROOT, serviceKit } from './_load.mjs';

test('PostgreSQL pools preserve DSN settings and force UTC after inherited startup options', () => {
  const input = new URL(
    'postgresql://runtime:encoded%40password@127.0.0.1:5432/cw_owner?schema=app&sslmode=require',
  );
  input.searchParams.append('options', '-c statement_timeout=5000 -c timezone=Asia/Damascus');
  input.searchParams.append('options', '-c search_path=app -c timezone=Europe/Berlin');
  const output = new URL(serviceKit.databasePoolConfig(input.toString()).connectionString);
  for (const key of ['protocol', 'hostname', 'port', 'username', 'password', 'pathname'])
    assert.equal(output[key], input[key]);
  assert.equal(output.searchParams.get('schema'), 'app');
  assert.equal(output.searchParams.get('sslmode'), 'require');
  assert.deepEqual(output.searchParams.getAll('options'), [
    '-c statement_timeout=5000 -c timezone=Asia/Damascus -c search_path=app -c timezone=Europe/Berlin -c timezone=UTC',
  ]);
});

test('PostgreSQL pools establish UTC without optional DSN settings and reject invalid DSNs', () => {
  const output = new URL(
    serviceKit.databasePoolConfig('postgres://u:p@localhost/owner').connectionString,
  );
  assert.equal(output.searchParams.get('options'), '-c timezone=UTC');
  assert.throws(() => serviceKit.databasePoolConfig('not a database URL'));
});

test('every owner and worker PrismaPg adapter applies the shared session-timezone invariant', () => {
  const adapters = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'generated') continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.name.endsWith('.ts')) {
        const source = readFileSync(file, 'utf8');
        if (source.includes('new PrismaPg(')) {
          adapters.push(file);
          assert.match(source, /databasePoolConfig\(/, path.relative(ROOT, file));
        }
      }
    }
  }
  for (const service of readdirSync(path.join(ROOT, 'services')))
    visit(path.join(ROOT, 'services', service, 'src'));
  assert.ok(adapters.length >= 19, 'Every database owner has an adapter under verification');
});
