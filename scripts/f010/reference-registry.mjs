import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const F010_MANIFEST = 'docs/design/f010-reference-manifest.json';
const LEGACY_MANIFEST = 'docs/design/reference-manifest.json';
export const APP_IDS = Object.freeze(['customer', 'technician', 'admin']);

const APPROVED = Object.freeze({
  customer: Object.freeze({
    canonicalHtml: 'design/reference/approved/washgo-payments-interactive.html',
    bytes: 263462,
    sha256: '04a7c74fe7209efc7bfb31d56e27f8d22e65932c412ea20cba8a1820d54f0549',
  }),
  technician: Object.freeze({
    canonicalHtml: 'design/reference/approved/washgo-technician-interactive.html',
    bytes: 122636,
    sha256: 'd330aa743c6a38f842b1b9c75b69b5ce62e40d453c49334437fe369b46455efc',
  }),
  admin: Object.freeze({
    canonicalHtml: 'design/reference/approved/washgo-admin-prototype.html',
    bytes: 40310,
    sha256: 'b13353195e914a7572ad033040d2a5112973e3eeabf2a584aa23282cd1ca8273',
  }),
});

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function safeFile(root, name) {
  if (
    typeof name !== 'string' ||
    !name ||
    name.includes('\\') ||
    isAbsolute(name) ||
    name.split('/').some((part) => !part || part === '.' || part === '..' || part === '.git')
  ) {
    throw new Error(`UNSAFE_REFERENCE_PATH:${String(name)}`);
  }
  const base = resolve(root);
  const target = resolve(base, name);
  const rel = relative(base, target);
  if (!rel || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error('REFERENCE_ESCAPES_ROOT');
  }
  let current = base;
  for (const part of rel.split(sep)) {
    current = resolve(current, part);
    if (lstatSync(current).isSymbolicLink()) throw new Error(`REFERENCE_SYMLINK:${name}`);
  }
  if (!lstatSync(target).isFile()) throw new Error(`REFERENCE_NOT_FILE:${name}`);
  return target;
}

export function loadRegistry(root = ROOT) {
  return JSON.parse(readFileSync(safeFile(root, F010_MANIFEST), 'utf8'));
}

export function validateRegistry(manifest) {
  if (!manifest || manifest.schemaVersion !== 1 || manifest.referenceSet !== 'washgo-three-apps-v1') {
    throw new Error('INVALID_F010_MANIFEST');
  }
  if (!manifest.references || !manifest.rendering) throw new Error('INVALID_F010_MANIFEST');
  const ids = Object.keys(manifest.references).sort();
  if (JSON.stringify(ids) !== JSON.stringify([...APP_IDS].sort())) {
    throw new Error('F010_REFERENCE_SET_MUST_BE_EXACT');
  }
  const paths = new Set();
  for (const id of APP_IDS) {
    const item = manifest.references[id];
    const expected = APPROVED[id];
    if (
      !item ||
      item.canonicalHtml !== expected.canonicalHtml ||
      item.bytes !== expected.bytes ||
      item.sha256 !== expected.sha256 ||
      !/^[a-f0-9]{64}$/.test(item.sha256) ||
      item.language !== 'ar' ||
      item.direction !== 'rtl'
    ) {
      throw new Error(`F010_REFERENCE_REGISTRATION_MISMATCH:${id}`);
    }
    if (paths.has(item.canonicalHtml)) throw new Error('DUPLICATE_F010_REFERENCE_PATH');
    paths.add(item.canonicalHtml);
  }
  const widths = manifest.rendering.viewports;
  if (
    JSON.stringify(widths) !== JSON.stringify([320, 390, 430, 768, 1024, 1440]) ||
    manifest.rendering.deviceScaleFactor !== 1 ||
    manifest.rendering.reducedMotion !== 'reduce' ||
    !Number.isSafeInteger(manifest.rendering.height) ||
    manifest.rendering.height < 600
  ) {
    throw new Error('INVALID_F010_RENDERING_CONTRACT');
  }
  return manifest;
}

function gitShow(root, baseRef, path) {
  return execFileSync('git', ['-C', resolve(root), 'show', `${baseRef}:${path}`], {
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function verifyRegisteredReferences({
  root = ROOT,
  baseRef = null,
  allowRegistration = false,
} = {}) {
  const errors = [];
  let manifest;
  let verifiedReferences = 0;
  let baseCompared = false;
  let initialRegistration = false;

  try {
    manifest = validateRegistry(loadRegistry(root));
    for (const id of APP_IDS) {
      const item = manifest.references[id];
      const bytes = readFileSync(safeFile(root, item.canonicalHtml));
      if (bytes.length !== item.bytes || digest(bytes) !== item.sha256) {
        errors.push(`F010_REFERENCE_CHANGED:${id}`);
      } else {
        verifiedReferences += 1;
      }
      const head = bytes.subarray(0, Math.min(bytes.length, 512)).toString('utf8');
      if (!/<html[^>]+lang=["']ar["'][^>]+dir=["']rtl["']/i.test(head)) {
        errors.push(`F010_REFERENCE_LANG_DIR_MISMATCH:${id}`);
      }
    }

    const legacy = JSON.parse(readFileSync(safeFile(root, LEGACY_MANIFEST), 'utf8'));
    const legacyCustomer = legacy.artifacts?.find(
      (item) => item.path === APPROVED.customer.canonicalHtml,
    );
    if (
      !legacyCustomer ||
      legacyCustomer.bytes !== APPROVED.customer.bytes ||
      legacyCustomer.sha256 !== APPROVED.customer.sha256
    ) {
      errors.push('F010_CUSTOMER_DOES_NOT_MATCH_LEGACY_FROZEN_BASELINE');
    }

    if (baseRef !== null) {
      if (!/^[a-f0-9]{40}$/i.test(baseRef)) throw new Error('INVALID_BASE_REF');
      try {
        const trustedManifest = gitShow(root, baseRef, F010_MANIFEST);
        baseCompared = true;
        const currentManifest = readFileSync(safeFile(root, F010_MANIFEST));
        if (!currentManifest.equals(trustedManifest)) {
          errors.push('F010_MANIFEST_CHANGED_FROM_TRUSTED_BASE');
        }
        const trusted = validateRegistry(JSON.parse(trustedManifest.toString('utf8')));
        for (const id of APP_IDS) {
          const path = trusted.references[id].canonicalHtml;
          const current = readFileSync(safeFile(root, path));
          if (!current.equals(gitShow(root, baseRef, path))) {
            errors.push(`F010_TRUSTED_REFERENCE_CHANGED:${id}`);
          }
        }
      } catch (error) {
        const message = String(error?.message ?? error);
        const missingAtBase =
          /does not exist in|exists on disk, but not in|path .* does not exist/i.test(message);
        if (!allowRegistration || !missingAtBase) throw error;
        initialRegistration = true;
      }
    } else if (allowRegistration) {
      initialRegistration = true;
    }
  } catch (error) {
    errors.push(String(error?.message ?? error));
  }

  return {
    ok: errors.length === 0,
    verifiedReferences,
    baseCompared,
    initialRegistration,
    referenceSet: manifest?.referenceSet ?? null,
    errors,
  };
}

function parseCli(argv) {
  const options = { root: ROOT, baseRef: null, allowRegistration: false, evidence: null };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--allow-registration') options.allowRegistration = true;
    else if (token === '--root') options.root = resolve(argv[++index] ?? '');
    else if (token === '--base-ref') options.baseRef = argv[++index] ?? null;
    else if (token === '--evidence') options.evidence = resolve(argv[++index] ?? '');
    else throw new Error(`UNKNOWN_F010_ARGUMENT:${token}`);
  }
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseCli(process.argv.slice(2));
    const result = verifyRegisteredReferences(options);
    if (options.evidence) {
      mkdirSync(dirname(options.evidence), { recursive: true });
      writeFileSync(options.evidence, JSON.stringify(result, null, 2) + '\n');
    }
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    console.error(String(error?.message ?? error));
    process.exitCode = 1;
  }
}
