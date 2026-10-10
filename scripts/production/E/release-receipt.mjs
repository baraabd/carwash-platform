// Release receipt producer (P08-E1). One uniform way for every lane to turn an
// executed gate into a carwash.release-receipt/v1 bound to the exact source.
//
//   node scripts/production/E/release-receipt.mjs candidate --ref refs/remotes/origin/main --out release/candidate.json
//   node scripts/production/E/release-receipt.mjs run --family E.design-lock --receipts release/receipts \
//     --evidence-dir release/evidence [--dependency postgres=REAL ...] -- node scripts/check-design-reference.mjs
//
// `run` refuses a dirty tracked tree, executes the command once, stores the
// combined output as evidence and records PASSED only for exit code 0. It never
// edits a receipt after the fact: a re-run writes a new file and the barrier
// rejects two receipts for one family until one is removed deliberately.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RECEIPT_SCHEMA, CANDIDATE_SCHEMA } from './release/barrier.mjs';
import { git, sha256Hex } from './release/io.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
// Deployment configuration the candidate digest is bound to.
export const CONFIG_PATHS = [
  'infra',
  'architecture/service-catalog.json',
  'architecture/release-barrier.json',
];

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

export function configDigest(cwd, sha) {
  const listing = git(cwd, 'ls-tree', '-r', '--full-tree', sha, '--', ...CONFIG_PATHS);
  if (listing === null) return null;
  return `sha256:${sha256Hex(listing)}`;
}

function exactSource() {
  const sha = git(root, 'rev-parse', 'HEAD');
  const tree = git(root, 'rev-parse', 'HEAD^{tree}');
  const dirty = git(root, 'status', '--porcelain', '--untracked-files=no');
  if (!sha || !tree) fail('not a git checkout');
  if (dirty)
    fail('tracked files are modified; receipts are only issued for an exact committed tree');
  return { sha, tree };
}

const [mode, ...rest] = process.argv.slice(2);
const opts = options(rest);
// --root exists for the producer's own tests (a disposable git repository).
const root = path.resolve(opts.get('--root') ?? repoRoot);

if (mode === 'candidate') {
  const { sha, tree } = exactSource();
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
    configDigest: configDigest(root, sha),
  };
  const out = opts.get('--out') ?? fail('--out is required');
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(candidate, null, 2) + '\n');
  process.stdout.write(`${out}\n`);
} else if (mode === 'run') {
  const family = opts.get('--family') ?? fail('--family is required');
  const receiptsDir = opts.get('--receipts') ?? fail('--receipts is required');
  const evidenceDir = opts.get('--evidence-dir') ?? fail('--evidence-dir is required');
  if (opts.command.length === 0) fail('pass the gate command after --');
  const { sha, tree } = exactSource();
  const dependencies = Object.fromEntries(
    opts.all('--dependency').map((pair) => {
      const at = pair.indexOf('=');
      if (at <= 0) fail(`--dependency ${pair} must be name=LABEL`);
      return [pair.slice(0, at), pair.slice(at + 1)];
    }),
  );
  const producedAt = new Date().toISOString();
  const stamp = producedAt.replace(/[:.]/g, '-');
  const started = Date.now();
  const result = spawnSync(opts.command[0], opts.command.slice(1), {
    cwd: root,
    encoding: 'utf8',
    shell: false,
  });
  const log = [
    `$ ${opts.command.join(' ')}`,
    `exit ${result.status ?? 'null'} signal ${result.signal ?? 'none'} in ${Date.now() - started}ms`,
    result.error ? `spawn error: ${result.error.message}` : '',
    '--- stdout ---',
    result.stdout ?? '',
    '--- stderr ---',
    result.stderr ?? '',
  ].join('\n');
  mkdirSync(evidenceDir, { recursive: true });
  mkdirSync(receiptsDir, { recursive: true });
  const logPath = path.join(evidenceDir, `${family}-${stamp}.log`);
  writeFileSync(logPath, log);
  const receiptPath = path.join(receiptsDir, `${family}.json`);
  if (existsSync(receiptPath))
    fail(`${receiptPath} exists; remove it deliberately before issuing a new one`);
  const receipt = {
    schema: RECEIPT_SCHEMA,
    family,
    status: result.status === 0 ? 'PASSED' : 'FAILED',
    rc: { sha, tree },
    producedAt,
    producer: {
      actor: opts.get('--actor') ?? git(root, 'config', 'user.name') ?? 'unknown',
      tool: 'release-receipt.mjs',
    },
    configDigest: configDigest(root, sha),
    command: opts.command.join(' '),
    ...(Object.keys(dependencies).length ? { dependencies } : {}),
    evidence: [
      {
        path: path.relative(root, logPath).replaceAll('\\', '/'),
        sha256: `sha256:${sha256Hex(log)}`,
      },
    ],
  };
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
  process.stdout.write(`${receipt.status} ${receiptPath}\n`);
  process.exit(result.status === 0 ? 0 : 2);
} else {
  fail('usage: release-receipt.mjs candidate|run ...');
}
