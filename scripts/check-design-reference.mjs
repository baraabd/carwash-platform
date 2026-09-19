import { readFileSync, lstatSync } from 'node:fs';
import { resolve, dirname, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const MANIFEST = 'docs/design/reference-manifest.json';
const digest = b => createHash('sha256').update(b).digest('hex');

/** Resolve only regular, non-symlink repository files. */
export function safeFile(root, name) {
  if (typeof name !== 'string' || !name || name.includes('\\') || isAbsolute(name) ||
      name.split('/').some(s => !s || s === '.' || s === '..' || s === '.git')) {
    throw new Error(`Unsafe reference path: ${name}`);
  }
  const base = resolve(root), target = resolve(base, name), rel = relative(base, target);
  if (!rel || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('Reference escapes root');
  let current = base;
  for (const part of rel.split(sep)) {
    current = resolve(current, part);
    if (lstatSync(current).isSymbolicLink()) throw new Error(`Symlinks are not reference files: ${name}`);
  }
  if (!lstatSync(target).isFile()) throw new Error(`Reference is not a file: ${name}`);
  return target;
}

/** Hash preservation only; NOT a visual parity test of future React code. */
export function verifyReference(root, baseRef = null) {
  const errors = []; let count = 0;
  try {
    const m = JSON.parse(readFileSync(safeFile(root, MANIFEST), 'utf8'));
    if (m.schemaVersion !== 1 || !Array.isArray(m.artifacts) || !m.artifacts.length ||
        !Array.isArray(m.frozenPolicyPaths)) throw new Error('Invalid reference manifest');
    const paths = new Set();
    for (const item of m.artifacts) {
      if (paths.has(item.path)) { errors.push(`Duplicate path: ${item.path}`); continue; }
      paths.add(item.path);
      try {
        if (!/^[a-f0-9]{64}$/.test(item.sha256) || !Number.isSafeInteger(item.bytes) || item.bytes < 1)
          throw new Error(`Invalid hash or size for ${item.path}`);
        const bytes = readFileSync(safeFile(root, item.path));
        if (bytes.length !== item.bytes || digest(bytes) !== item.sha256)
          errors.push(`FROZEN FILE CHANGED: ${item.path}`);
        else count++;
      } catch (e) { errors.push(String(e.message)); }
    }
    if (baseRef !== null) {
      if (!/^[a-f0-9]{40}$/i.test(baseRef)) throw new Error('base-ref must be a full 40-character commit SHA');
      const baseFile = path => execFileSync('git', ['-C', resolve(root), 'show', `${baseRef}:${path}`],
        { maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
      const baseManifestBytes = baseFile(MANIFEST);
      const baseManifest = JSON.parse(baseManifestBytes.toString('utf8'));
      if (baseManifest.schemaVersion !== 1 || !Array.isArray(baseManifest.artifacts) ||
          !Array.isArray(baseManifest.frozenPolicyPaths)) throw new Error('Invalid trusted base manifest');
      const protectedPaths = new Set([MANIFEST, ...baseManifest.artifacts.map(x => x.path),
        ...baseManifest.frozenPolicyPaths]);
      for (const path of protectedPaths) {
        try {
          const actual = readFileSync(safeFile(root, path));
          if (!actual.equals(baseFile(path))) errors.push(`APPROVED BASELINE/GUARD MODIFIED: ${path}`);
        } catch (e) { errors.push(`Cannot verify protected base file ${path}: ${e.message}`); }
      }
    }
  } catch (e) { errors.push(String(e.message)); }
  return { ok: errors.length === 0, verifiedArtifacts: count, baseCompared: baseRef !== null, errors };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), baseRef = null;
  try {
    for (let i = 2; i < process.argv.length; i++) {
      const key = process.argv[i], value = process.argv[++i];
      if (!value) throw new Error(`Missing value: ${key}`);
      if (key === '--root') root = resolve(value);
      else if (key === '--base-ref') baseRef = value;
      else throw new Error(`Unknown option: ${key}`);
    }
    const result = verifyReference(root, baseRef);
    console.log(JSON.stringify(result, null, 2));
    console.log('Scope: exact reference preservation. Not production readiness or React visual parity.');
    process.exitCode = result.ok ? 0 : 1;
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
