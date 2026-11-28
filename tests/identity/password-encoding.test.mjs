import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../services/identity/package.json', import.meta.url));
const { ArgonPasswords } = require('./dist/infrastructure/security/passwords.js');

test('Identity emits standard PHC order and safely upgrades historical parameter ordering', async () => {
  const passwords = await ArgonPasswords.create();
  const encoded = await passwords.hash('Compatibility-check-2026!');
  assert.match(encoded, /^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
  assert.equal(await passwords.verify(encoded, 'Compatibility-check-2026!'), true);
  assert.equal(await passwords.verify(encoded, 'incorrect-password'), false);
  assert.equal(passwords.needsRehash(encoded), false);
  const legacy = encoded.replace('m=65536,t=3,p=1', 'm=65536,p=1,t=3');
  assert.equal(await passwords.verify(legacy, 'Compatibility-check-2026!'), true);
  assert.equal(passwords.needsRehash(legacy), true);
  for (const params of [
    'm=65536,t=3,p=1,p=1',
    'm=999999999,t=3,p=1',
    'm=65536,t=7,p=1',
    'm=65536,t=3,p=5',
  ])
    assert.equal(
      await passwords.verify(
        encoded.replace('m=65536,t=3,p=1', params),
        'Compatibility-check-2026!',
      ),
      false,
    );
});
