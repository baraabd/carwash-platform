import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(
  new URL('../../.github/workflows/f009-foundation.yml', import.meta.url),
  'utf8',
);
const codeqlConfig = readFileSync(
  new URL('../../.github/codeql/f009-codeql-config.yml', import.meta.url),
  'utf8',
);
const imageRunner = readFileSync(new URL('../../scripts/ci/image.mjs', import.meta.url), 'utf8');
const policy = readFileSync(new URL('../../scripts/ci/policy.mjs', import.meta.url), 'utf8');
const identityAcceptance = readFileSync(
  new URL('../../scripts/acceptance-identity.mjs', import.meta.url),
  'utf8',
);
const vex = JSON.parse(
  readFileSync(
    new URL('../../security/vex/CVE-2026-97399.openvex.json', import.meta.url),
    'utf8',
  ),
);

test('F009 CodeQL excludes only the two immutable customer HTML authorities', () => {
  assert.match(workflow, /config-file: \.\/\.github\/codeql\/f009-codeql-config\.yml/);
  const ignored = [...codeqlConfig.matchAll(/^ {2}- (.+)$/gm)].map((match) => match[1]);
  assert.deepEqual(ignored, [
    'design/reference/approved/washgo-payments-interactive.html',
    'apps/customer-web/prototype/index.html',
  ]);
  assert.ok(ignored.every((path) => !path.includes('*')));
  assert.doesNotMatch(codeqlConfig, /services\/|packages\/|scripts\/|tests\//);
});

test('F009 VEX is single-CVE, package-and-architecture scoped and justified', () => {
  assert.equal(vex.statements.length, 1);
  const [statement] = vex.statements;
  assert.equal(statement.vulnerability.name, 'CVE-2026-97399');
  assert.deepEqual(statement.products, [{ '@id': 'pkg:deb/debian/libc6?arch=amd64' }]);
  assert.equal(statement.status, 'not_affected');
  assert.equal(statement.justification, 'vulnerable_code_not_present');
  assert.match(statement.impact_statement, /Power8/);
  assert.match(statement.impact_statement, /amd64/);
});

test('F009 keeps UNKNOWN blocking and verifies amd64 before applying the reviewed VEX', () => {
  assert.match(policy, /\['HIGH', 'CRITICAL', 'UNKNOWN'\]\.includes\(v\.Severity\)/);
  assert.doesNotMatch(imageRunner, /ignore-unfixed|\.trivyignore/);
  const architectureGuard = imageRunner.indexOf("assert.equal(\n          architecture,\n          'amd64'");
  const vexUse = imageRunner.indexOf("'--vex'");
  assert.ok(architectureGuard >= 0, 'Missing amd64 applicability guard');
  assert.ok(vexUse > architectureGuard, 'VEX must not be applied before architecture verification');
  assert.match(imageRunner, /Unreviewed HIGH\/CRITICAL\/UNKNOWN vulnerability must remain blocking/);
});

test('F009 Redis ACL acceptance distinguishes a generated machine credential from user passwords', () => {
  assert.match(identityAcceptance, /redisAclSecret: randomBytes\(32\)\.toString\('base64url'\)/);
  assert.match(
    identityAcceptance,
    /createHash\('sha256'\)\.update\(credentials\.redisAclSecret\)\.digest\('hex'\)/,
  );
  assert.doesNotMatch(identityAcceptance, /passwords\.redis/);
});
