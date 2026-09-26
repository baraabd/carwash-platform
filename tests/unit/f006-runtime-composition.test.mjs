import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderServiceFiles } from '../../scripts/dev/service-template.mjs';

const adapter = 'src/transport/http/create-app.ts';

test('F006 runtime: the default renderer still exposes the F003 foundation factory', () => {
  assert.match(renderServiceFiles('identity').get(adapter), /NestFactory\.create\(AppModule/);
  assert.doesNotMatch(renderServiceFiles('identity').get(adapter), /identity-runtime/);
});

test('F006 runtime: explicit Identity capability changes only its composition adapter', async () => {
  const foundation = renderServiceFiles('identity');
  const auth = renderServiceFiles('identity', { httpRuntime: 'identity-security-v1' });
  assert.deepEqual([...auth.keys()], [...foundation.keys()]);
  const changed = [...auth].filter(([name, source]) => source !== foundation.get(name));
  assert.deepEqual(
    changed.map(([name]) => name),
    [adapter],
  );
  assert.match(auth.get(adapter), /createIdentityHttpApplication/);
  assert.equal(
    auth.get(adapter),
    await readFile(new URL('../../services/identity/' + adapter, import.meta.url), 'utf8'),
  );
});

for (const service of ['catalog', 'reporting', 'customer']) {
  test(`F006 runtime: ${service} cannot select Identity's credential-owning composition`, () => {
    assert.throws(
      () => renderServiceFiles(service, { httpRuntime: 'identity-security-v1' }),
      /INVALID_SERVICE_HTTP_RUNTIME/,
    );
  });
}

test('F006 runtime: unknown capability configurations fail closed', () => {
  assert.throws(
    () => renderServiceFiles('identity', { httpRuntime: 'made-up' }),
    /INVALID_SERVICE_HTTP_RUNTIME/,
  );
});
