import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const root = new URL('../../', import.meta.url);
const legacyServices = [
  'identity',
  'customer',
  'catalog',
  'workforce',
  'booking',
  'billing',
  'media',
  'communications',
  'support',
  'reporting',
];
const runtimePaths = [...legacyServices.map((service) => `services/${service}`), 'apps/api-gateway'];

test('Multer security overrides remain exactly pinned to the reviewed patched release', () => {
  const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  assert.equal(manifest.pnpm.overrides.multer, '2.4.0');
  assert.equal(manifest.pnpm.overrides['@nestjs/platform-express>multer'], '2.4.0');
});

test('all Nest services and the gateway resolve patched Multer and load compatible adapters', () => {
  for (const owner of runtimePaths) {
    const ownerRequire = createRequire(new URL(`${owner}/package.json`, root));
    const adapterPath = ownerRequire.resolve('@nestjs/platform-express');
    const adapterRequire = createRequire(adapterPath);
    assert.equal(adapterRequire('multer/package.json').version, '2.4.0', owner);
    const { ExpressAdapter, FileInterceptor } = ownerRequire('@nestjs/platform-express');
    const adapter = new ExpressAdapter();
    assert.equal(typeof adapter.getInstance(), 'function', owner);
    assert.equal(typeof FileInterceptor('file', { limits: { fileSize: 1024, files: 1 } }), 'function');
    assert.equal(typeof adapterRequire('multer')({ limits: { fields: 2 } }).none(), 'function');
  }
});
