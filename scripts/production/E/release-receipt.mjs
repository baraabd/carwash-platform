// Release receipt producer (P08-E1). One uniform way for every lane to turn an
// executed gate into a carwash.release-receipt/v1 bound to the exact source.
//
//   node scripts/production/E/release-receipt.mjs candidate --ref refs/remotes/origin/main --out release/candidate.json
//   node scripts/production/E/release-receipt.mjs run --family E.design-lock --receipts release/receipts \
//     --evidence-dir release/evidence [--dependency postgres=REAL ...] -- node scripts/check-design-reference.mjs
//
// `run` requires clean committed source before and after the command, stores
// the combined output and records PASSED only for exit code 0 with no drift. It never
// edits a receipt after the fact: a re-run writes a new file and the barrier
// rejects two receipts for one family until one is removed deliberately.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RECEIPT_SCHEMA, CANDIDATE_SCHEMA } from './release/barrier.mjs';
import { git, gitIo, sha256Hex } from './release/io.mjs';
import { manifestDigest, validateManifest } from './release/manifest.mjs';
import { configDigest } from './release/configuration.mjs';
import {
  assertExactSource,
  assertReportDestination,
  assertSameSource,
} from './release/source-provenance.mjs';

export { CONFIG_PATHS, configDigest } from './release/configuration.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function fail(message) {
  process.stderr.write(`release-receipt: ${message}\n`);
  process.exit(1);
}

function options(argv) {
  const separator = argv.indexOf('--');
  const head = separator >= 0 ? argv.slice(0, separator) : argv;
  const values = new Map();
  for (let i = 0; i < head.length; i += 1)
    if (head[i].startsWith('--')) {
      values.set(head[i], [...(values.get(head[i]) ?? []), head[i + 1]]);
      i += 1;
    }
  return {
    get: (k) => values.get(k)?.at(-1),
    all: (k) => values.get(k) ?? [],
    command: separator >= 0 ? argv.slice(separator + 1) : [],
  };
}

function exactSource() {
  try {
    return assertExactSource(root);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

function reportDestination(file) {
  try {
    return assertReportDestination(root, file);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

function artifactManifest(file, source) {
  const relative = path.relative(root, path.resolve(root, file)).replaceAll('\\', '/');
  if (!relative || relative.startsWith('../') || path.isAbsolute(relative))
    throw new Error('artifact manifest must be a file inside the repository');
  const io = gitIo(root);
  const evidence = io.readEvidence(relative);
  if (!evidence) throw new Error('artifact manifest must be a readable regular evidence file');
  const manifest = JSON.parse(evidence.content);
  const context = io.sourceContext(source.sha);
  if (!context) throw new Error('committed artifact source inventory is incomplete');
  const problems = validateManifest(manifest, context.targets);
  if (problems.length) throw new Error(`artifact manifest is invalid: ${JSON.stringify(problems)}`);
  for (const [name, value] of Object.entries(context.source))
    if (manifest.source[name] !== value)
      throw new Error(`artifact manifest source.${name} differs from the committed source`);
  for (const [name, reference] of Object.entries(context.baseImages))
    if (manifest.baseImages[name] !== reference)
      throw new Error(`artifact manifest base image ${name} differs from the committed tool lock`);
  const { manifestDigest: recorded, ...body } = manifest;
  if (recorded !== manifestDigest(body))
    throw new Error('artifact manifest digest does not match its content');
  return { path: relative, sha256: evidence.sha256 };
}

const [mode, ...rest] = process.argv.slice(2);
const opts = options(rest);
// --root exists for the producer's own tests (a disposable git repository).
const root = path.resolve(opts.get('--root') ?? repoRoot);

if (mode === 'candidate') {
  const { sha, tree } = exactSource();
  const configuration = configDigest(root, sha);
  if (!configuration) fail('the committed deployment configuration is incomplete');
  const refs = Object.fromEntries(
    opts.all('--ref').map((ref) => {
      const resolved = git(root, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`);
      if (!resolved) fail(`ref ${ref} does not resolve`);
      return [ref, resolved];
    }),
  );
  if (Object.keys(refs).length === 0) fail('pin at least one --ref');
  const candidate = {
    schema: CANDIDATE_SCHEMA,
    sha,
    tree,
    refs,
    configDigest: configuration,
  };
  const out = reportDestination(opts.get('--out') ?? fail('--out is required'));
  mkdirSync(path.dirname(out), { recursive: true });
  try {
    writeFileSync(out, JSON.stringify(candidate, null, 2) + '\n', { flag: 'wx' });
    assertSameSource(root, { sha, tree });
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  process.stdout.write(`${out}\n`);
} else if (mode === 'run') {
  const family = opts.get('--family') ?? fail('--family is required');
  const receiptsDir = path.resolve(root, opts.get('--receipts') ?? fail('--receipts is required'));
  const evidenceDir = path.resolve(
    root,
    opts.get('--evidence-dir') ?? fail('--evidence-dir is required'),
  );
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]+$/.test(family))
    fail('--family must be a release family identifier');
  if (opts.command.length === 0) fail('pass the gate command after --');
  const { sha, tree } = exactSource();
  const configuration = configDigest(root, sha);
  if (!configuration) fail('the committed deployment configuration is incomplete');
  const manifestPath = opts.get('--artifact-manifest');
  if (family === 'E.artifacts-published' && !manifestPath)
    fail('E.artifacts-published requires --artifact-manifest');
  if (manifestPath && family !== 'E.artifacts-published')
    fail('--artifact-manifest is only valid for E.artifacts-published');
  let artifactEvidence;
  if (manifestPath)
    try {
      artifactEvidence = artifactManifest(manifestPath, { sha, tree });
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
  const dependencies = Object.fromEntries(
    opts.all('--dependency').map((pair) => {
      const at = pair.indexOf('=');
      if (at <= 0) fail(`--dependency ${pair} must be name=LABEL`);
      return [pair.slice(0, at), pair.slice(at + 1)];
    }),
  );
  const producedAt = new Date().toISOString();
  const stamp = producedAt.replace(/[:.]/g, '-');
  const logPath = reportDestination(path.join(evidenceDir, `${family}-${stamp}.log`));
  const receiptPath = reportDestination(path.join(receiptsDir, `${family}.json`));
  const started = Date.now();
  const result = spawnSync(opts.command[0], opts.command.slice(1), {
    cwd: root,
    encoding: 'utf8',
    shell: false,
  });
  const provenanceFailures = [];
  try {
    assertSameSource(root, { sha, tree });
  } catch (error) {
    provenanceFailures.push(
      `source provenance: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (artifactEvidence)
    try {
      const after = artifactManifest(manifestPath, { sha, tree });
      if (after.sha256 !== artifactEvidence.sha256)
        throw new Error('manifest changed during verification');
    } catch (error) {
      provenanceFailures.push(
        `artifact provenance: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  const passed = result.status === 0 && provenanceFailures.length === 0;
  const log = [
    `$ ${opts.command.join(' ')}`,
    `exit ${result.status ?? 'null'} signal ${result.signal ?? 'none'} in ${Date.now() - started}ms`,
    result.error ? `spawn error: ${result.error.message}` : '',
    ...provenanceFailures,
    '--- stdout ---',
    result.stdout ?? '',
    '--- stderr ---',
    result.stderr ?? '',
  ].join('\n');
  // The gate may have replaced a directory with a symlink, including under
  // ignored .acceptance paths. Revalidate after execution, before any output.
  reportDestination(logPath);
  reportDestination(receiptPath);
  mkdirSync(evidenceDir, { recursive: true });
  mkdirSync(receiptsDir, { recursive: true });
  reportDestination(logPath);
  writeFileSync(logPath, log, { flag: 'wx' });
  const receipt = {
    schema: RECEIPT_SCHEMA,
    family,
    status: passed ? 'PASSED' : 'FAILED',
    rc: { sha, tree },
    producedAt,
    producer: {
      actor: opts.get('--actor') ?? git(root, 'config', 'user.name') ?? 'unknown',
      tool: 'release-receipt.mjs',
    },
    configDigest: configuration,
    ...(provenanceFailures.length ? { problems: provenanceFailures } : {}),
    ...(artifactEvidence ? { details: { manifestPath: artifactEvidence.path } } : {}),
    command: opts.command.join(' '),
    ...(Object.keys(dependencies).length ? { dependencies } : {}),
    evidence: [
      {
        path: path.relative(root, logPath).replaceAll('\\', '/'),
        sha256: `sha256:${sha256Hex(log)}`,
      },
      ...(artifactEvidence ? [artifactEvidence] : []),
    ],
  };
  try {
    reportDestination(receiptPath);
    // Creation and non-existence are one filesystem operation. Another
    // producer or a pre-existing symlink must never be overwritten.
    writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  } catch (error) {
    if (error.code === 'EEXIST')
      fail(`${receiptPath} exists; remove it deliberately before issuing a new one`);
    throw error;
  }
  process.stdout.write(`${receipt.status} ${receiptPath}\n`);
  process.exit(passed ? 0 : 2);
} else {
  fail('usage: release-receipt.mjs candidate|run ...');
}
