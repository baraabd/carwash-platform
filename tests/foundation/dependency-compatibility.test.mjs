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

test('the Multer security override is exact and limited to the Nest adapter', () => {
  const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  assert.equal(manifest.pnpm.overrides['@nestjs/platform-express>multer'], '2.3.0');
});

test('all existing Nest shells resolve patched Multer and load compatible adapters', () => {
  for (const service of legacyServices) {
    const serviceRequire = createRequire(new URL(`services/${service}/package.json`, root));
    const adapterPath = serviceRequire.resolve('@nestjs/platform-express');
    const adapterRequire = createRequire(adapterPath);
    assert.equal(adapterRequire('multer/package.json').version, '2.3.0', service);
    const { ExpressAdapter, FileInterceptor } = serviceRequire('@nestjs/platform-express');
    const adapter = new ExpressAdapter();
    assert.equal(typeof adapter.getInstance(), 'function', service);
    assert.equal(typeof FileInterceptor('file', { limits: { fileSize: 1024, files: 1 } }), 'function');
    assert.equal(typeof adapterRequire('multer')({ limits: { fields: 2 } }).none(), 'function');
  }
});
