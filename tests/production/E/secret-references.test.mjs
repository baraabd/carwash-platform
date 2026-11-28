import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isSecretReference,
  parseRailwaySecretReference,
} from '../../../scripts/production/E/release/secret-references.mjs';
import { findSecretMaterial } from '../../../scripts/production/E/release/barrier.mjs';

const projectId = '00000000-0000-4000-8000-000000000001';
const environmentId = '00000000-0000-4000-8000-000000000002';
const serviceId = '00000000-0000-4000-8000-000000000003';
const volumeId = '00000000-0000-4000-8000-000000000004';
const scope =
  'railway://project/' + projectId + '/environment/' + environmentId + '/service/' + serviceId;
const variable = scope + '/variable/IDENTITY_OTP_PEPPER';
const file = scope + '/volume/' + volumeId + '/file/secrets/identity/private-key.pem';

test('Railway references bind variables and volume-relative files to their complete resource scope', () => {
  assert.deepEqual(parseRailwaySecretReference(variable), {
    kind: 'variable',
    projectId,
    environmentId,
    serviceId,
    variableName: 'IDENTITY_OTP_PEPPER',
  });
  assert.deepEqual(parseRailwaySecretReference(file), {
    kind: 'volume-file',
    projectId,
    environmentId,
    serviceId,
    volumeId,
    filePath: 'secrets/identity/private-key.pem',
  });
  assert.equal(isSecretReference(variable), true);
  assert.equal(isSecretReference(file), true);
});

test('Railway locators reject URL features, literals, encodings and path normalization tricks', () => {
  const malformed = [
    variable + '?value=literal',
    variable + '#fragment',
    variable + '=literal',
    variable + '/extra',
    variable + '/',
    variable + '\n',
    variable + '\u0000',
    ' ' + variable,
    variable.replace('railway://', 'railway://user:literal@'),
    variable.replace('railway://project/', 'railway://project:443/'),
    variable.replace('IDENTITY_OTP_PEPPER', '${{SERVICE.SECRET}}'),
    variable.replace('IDENTITY_OTP_PEPPER', 'postgres://user:literal@host/db'),
    variable.replace('IDENTITY_OTP_PEPPER', 'IDENTITY%5FOTP_PEPPER'),
    file.replace('/file/secrets/', '/file/../'),
    file.replace('/file/secrets/', '/file/./'),
    file.replace('/file/secrets/', '/file//'),
    file.replace('/file/secrets/', '/file/%2e%2e/'),
    file.replace('/file/secrets/', '/file/secrets%2f/'),
    file.replace('/file/secrets/', '/file/%252e%252e/'),
    file.replace('/file/secrets/', '/file/secrets\\'),
    file.replace('private-key.pem', '../private-key.pem'),
    file.replace('private-key.pem', 'private-key.pem/'),
    file.replace('private-key.pem', 'private-key.pem?token=literal'),
    file.replace('private-key.pem', 'a'.repeat(129)),
    file.replace('private-key.pem', Array(11).fill('a'.repeat(100)).join('/')),
  ];
  for (const reference of malformed) {
    assert.equal(parseRailwaySecretReference(reference), null, reference);
    assert.equal(isSecretReference(reference), false, reference);
  }
});

test('Railway references require canonical resource IDs and bounded variable names', () => {
  for (const reference of [
    null,
    undefined,
    42,
    {},
    'railway://service/identity/variable/SECRET',
    variable.replace(projectId, 'project-name'),
    variable.replace(environmentId, '<environment-id>'),
    variable.replace(serviceId, '00000000-0000-0000-0000-000000000000'),
    variable.replace('railway://', 'RAILWAY://'),
    variable.replace('000000000001', '00000000000A'),
    variable.replace('IDENTITY_OTP_PEPPER', ''),
    variable.replace('IDENTITY_OTP_PEPPER', '1SECRET'),
    variable.replace('IDENTITY_OTP_PEPPER', 'SECRET-NAME'),
    variable.replace('IDENTITY_OTP_PEPPER', 'secret name'),
    variable.replace('IDENTITY_OTP_PEPPER', 'secret_name'),
    variable.replace('IDENTITY_OTP_PEPPER', 'S'.repeat(256)),
    file.replace(volumeId, 'volume-name'),
    file.replace('/file/', '/directory/'),
    file.replace('private-key.pem', '..'),
    file.replace('private-key.pem', '.hidden'),
    'railway://' + 'a'.repeat(2048),
  ])
    assert.equal(isSecretReference(reference), false);
});

test('existing secret stores remain accepted while environment references and literal values fail', () => {
  for (const store of ['vault', 'aws-sm', 'gcp-sm', 'azure-kv', 'k8s-secret']) {
    const reference = store + '://carwash/production/identity-db';
    assert.equal(isSecretReference(reference), true);
    assert.deepEqual(findSecretMaterial({ token: reference }), []);
  }
  for (const reference of [
    'env://IDENTITY_SECRET',
    'literal-value',
    'https://railway.com/project/x',
  ]) {
    assert.equal(isSecretReference(reference), false);
    assert.deepEqual(findSecretMaterial({ token: reference }), ['$.token']);
  }
  assert.deepEqual(findSecretMaterial({ token: variable, private_key: file }), []);
  assert.deepEqual(findSecretMaterial({ token: variable + '?value=literal' }), ['$.token']);
});
