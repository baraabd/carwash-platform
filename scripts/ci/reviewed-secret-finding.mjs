import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

export const HISTORICAL_ASSESSMENT_PATH = 'docs/security/gitleaks-public-event-assessment.json';
const REVIEWED = Object.freeze({
  commit: '8c956a61c4a93a5772e6cb94967f4ac1cedee7a8',
  file: 'tests/unit/messaging.test.mjs',
  ruleId: 'generic-api-key',
  line: 136,
  contextLine: 139,
  contractFile: 'packages/event-contracts/src/billing-v1.ts',
  exportName: 'BILLING_CASH_COLLECTED_V1',
  declarationLine: 147,
  eventLine: 148,
  packageExportFile: 'packages/event-contracts/src/index.ts',
  packageExportLine: 7,
});
const FINGERPRINT = `${REVIEWED.commit}:${REVIEWED.file}:${REVIEWED.ruleId}:${REVIEWED.line}`;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function closed(value, names) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), 'Invalid assessment');
  assert.deepEqual(Object.keys(value).sort(), [...names].sort(), 'Unexpected assessment fields');
}

function git(repository, args) {
  try {
    return execFileSync('git', args, {
      cwd: repository,
      timeout: 10000,
      maxBuffer: 4 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    // Neither a raw Git error nor source bytes belong in security job output.
    throw new Error('Reviewed historical finding requires intact committed Git evidence');
  }
}

function blob(repository, commit, file) {
  assert.match(commit, /^[a-f0-9]{40}$/);
  assert.ok(
    /^[A-Za-z0-9_./-]+$/.test(file) && !file.split('/').some((p) => !p || p === '.' || p === '..'),
  );
  const entry = git(repository, ['ls-tree', '-z', commit, '--', file]).toString('utf8');
  assert.match(entry, /^100644 blob [a-f0-9]{40}\t/, 'Assessment proof must be a regular Git blob');
  assert.equal(entry.split('\t')[1], `${file}\0`, 'Assessment proof path changed');
  return git(repository, ['cat-file', 'blob', `${commit}:${file}`]);
}

function hashed(bytes, expected, label) {
  assert.match(expected, /^[a-f0-9]{64}$/, 'Assessment requires a SHA-256 digest');
  assert.equal(sha256(bytes), expected, `${label} changed; review the finding again`);
}

function line(bytes, number) {
  assert.ok(Number.isSafeInteger(number) && number > 0, 'Invalid assessment line');
  let start = 0;
  for (let current = 1; current < number; current++) {
    const end = bytes.indexOf(10, start);
    assert.ok(end >= 0, 'Assessment line is missing');
    start = end + 1;
  }
  const end = bytes.indexOf(10, start);
  assert.ok(
    start < bytes.length && end >= start,
    'Assessment requires the exact LF-terminated line',
  );
  return bytes.subarray(start, end + 1);
}

/** Only this independently reviewed historical occurrence can produce an ignore. */
export function verifyReviewedSecretFinding(repository, sourceSha, assessment) {
  assert.ok(path.isAbsolute(repository), 'Repository must be absolute');
  assert.match(sourceSha, /^[a-f0-9]{40}$/);
  closed(assessment, [
    'schemaVersion',
    'classification',
    'fingerprint',
    'commit',
    'file',
    'ruleId',
    'line',
    'blobSha256',
    'lineSha256',
    'literalSha256',
    'context',
    'contract',
  ]);
  assert.equal(assessment.schemaVersion, 1);
  assert.equal(assessment.classification, 'published-event-name');
  assert.equal(assessment.fingerprint, FINGERPRINT, 'No other historical finding is reviewed');
  for (const name of ['commit', 'file', 'ruleId', 'line'])
    assert.equal(assessment[name], REVIEWED[name]);
  assert.equal(
    `${assessment.commit}:${assessment.file}:${assessment.ruleId}:${assessment.line}`,
    FINGERPRINT,
  );
  assert.equal(git(repository, ['cat-file', '-t', sourceSha]).toString('utf8').trim(), 'commit');
  git(repository, ['merge-base', '--is-ancestor', assessment.commit, sourceSha]);

  const source = blob(repository, assessment.commit, assessment.file);
  hashed(source, assessment.blobSha256, 'Historical source blob');
  const sourceLine = line(source, assessment.line);
  hashed(sourceLine, assessment.lineSha256, 'Historical finding line');
  const match = /^ {4}routingKey: '([a-z]+\.[a-z-]+\.v[1-9][0-9]*)',\n$/.exec(
    sourceLine.toString('utf8'),
  );
  assert.ok(match, 'Finding must be the reviewed public event routing field');
  const literal = match[1];
  hashed(Buffer.from(literal, 'utf8'), assessment.literalSha256, 'Historical event literal');

  closed(assessment.context, ['line', 'lineSha256']);
  assert.equal(assessment.context.line, REVIEWED.contextLine);
  const contextLine = line(source, assessment.context.line);
  hashed(contextLine, assessment.context.lineSha256, 'Historical event context');
  assert.equal(contextLine.toString('utf8'), `    eventType: '${literal}',\n`);

  const proof = assessment.contract;
  closed(proof, [
    'commit',
    'file',
    'blobSha256',
    'exportName',
    'declarationLine',
    'declarationLineSha256',
    'eventLine',
    'eventLineSha256',
    'packageExportFile',
    'packageExportBlobSha256',
    'packageExportLine',
    'packageExportLineSha256',
  ]);
  assert.equal(proof.commit, assessment.commit);
  assert.equal(proof.file, REVIEWED.contractFile);
  for (const name of [
    'exportName',
    'declarationLine',
    'eventLine',
    'packageExportFile',
    'packageExportLine',
  ])
    assert.equal(proof[name], REVIEWED[name]);
  const contract = blob(repository, proof.commit, proof.file);
  hashed(contract, proof.blobSha256, 'Published contract blob');
  const declaration = line(contract, proof.declarationLine);
  hashed(declaration, proof.declarationLineSha256, 'Published export declaration');
  assert.equal(declaration.toString('utf8'), `export const ${proof.exportName} = spec({\n`);
  const event = line(contract, proof.eventLine);
  hashed(event, proof.eventLineSha256, 'Published event field');
  assert.equal(event.toString('utf8'), `  eventType: '${literal}',\n`);
  const index = blob(repository, proof.commit, proof.packageExportFile);
  hashed(index, proof.packageExportBlobSha256, 'Public package export blob');
  const exported = line(index, proof.packageExportLine);
  hashed(exported, proof.packageExportLineSha256, 'Public package export line');
  assert.equal(exported.toString('utf8'), "export * from './billing-v1';\n");
  return {
    fingerprint: FINGERPRINT,
    classification: assessment.classification,
    literalSha256: assessment.literalSha256,
  };
}

/** The assessment itself comes from the exact scanned commit, never mutable disk. */
export function prepareReviewedSecretIgnores(repository, sourceSha, directory) {
  assert.ok(path.isAbsolute(directory), 'Ignore directory must be absolute');
  const bytes = blob(repository, sourceSha, HISTORICAL_ASSESSMENT_PATH);
  const assessment = JSON.parse(bytes.toString('utf8'));
  const verified = verifyReviewedSecretFinding(repository, sourceSha, assessment);
  const history = path.join(directory, 'reviewed-history.gitleaksignore');
  const source = path.join(directory, 'empty-source.gitleaksignore');
  // The only ignored item is the complete historical fingerprint. Current
  // source and archives get an explicitly empty ignore file, not repo defaults.
  writeFileSync(history, `${verified.fingerprint}\n`, { flag: 'wx', mode: 0o600 });
  writeFileSync(source, '', { flag: 'wx', mode: 0o600 });
  return { history, source, assessment: { ...verified, assessmentSha256: sha256(bytes) } };
}
