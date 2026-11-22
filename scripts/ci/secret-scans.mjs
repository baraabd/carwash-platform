import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

// gitleaks 8.30.1's archives 0.1.2 uses strings.Contains for these
// extensions. In particular, *.browser.mjs is incorrectly decoded as Brotli.
// Keep actual terminal archive suffixes, but encode misleading periods in a
// temporary byte-identical scan tree. Real archives still receive depth-2
// traversal, and any scanner warning/read error remains a blocking failure.
const ARCHIVE_EXTENSIONS = Object.freeze([
  '.7z',
  '.br',
  '.bz2',
  '.gz',
  '.lz',
  '.lz4',
  '.mz',
  '.rar',
  '.sz',
  '.tar',
  '.xz',
  '.zip',
  '.zst',
  '.zz',
]);
const ARCHIVE_SUFFIXES = Object.freeze(
  [
    ...ARCHIVE_EXTENSIONS.filter((extension) => extension !== '.tar').map(
      (extension) => `.tar${extension}`,
    ),
    ...ARCHIVE_EXTENSIONS,
  ].sort((a, b) => b.length - a.length),
);

export function secretScanBasename(name) {
  assert.equal(path.basename(name), name);
  assert.ok(name !== '.' && name !== '..' && name.length > 0);
  const escaped = name.replaceAll('%', '%25');
  const lower = escaped.toLowerCase();
  const suffix = ARCHIVE_SUFFIXES.find((extension) => lower.endsWith(extension)) ?? '';
  const prefix = suffix ? escaped.slice(0, -suffix.length) : escaped;
  if (!ARCHIVE_EXTENSIONS.some((extension) => prefix.toLowerCase().includes(extension)))
    return escaped;
  return prefix.replaceAll('.', '%2E') + (suffix ? escaped.slice(-suffix.length) : '');
}

/** Copy exact immutable source bytes; never edit tracked files or an archive. */
export function prepareSecretSource(sourceDirectory, scanDirectory) {
  assert.ok(path.isAbsolute(sourceDirectory) && path.isAbsolute(scanDirectory));
  assert.ok(
    scanDirectory !== sourceDirectory && !scanDirectory.startsWith(sourceDirectory + path.sep),
    'Scan tree must be outside the immutable source snapshot',
  );
  mkdirSync(scanDirectory, { recursive: false });
  const files = [];
  function visit(relative = '', scanned = '') {
    for (const entry of readdirSync(path.join(sourceDirectory, relative), {
      withFileTypes: true,
    }).sort((a, b) => a.name.localeCompare(b.name))) {
      const sourceRelative = path.join(relative, entry.name);
      const scanRelative = path.join(scanned, secretScanBasename(entry.name));
      const from = path.join(sourceDirectory, sourceRelative);
      const to = path.join(scanDirectory, scanRelative);
      if (entry.isDirectory()) {
        mkdirSync(to);
        visit(sourceRelative, scanRelative);
        continue;
      }
      assert.ok(entry.isFile(), 'Source scan refuses symlinks and special files');
      // Check and read the same opened inode. A pathname check followed by a
      // separate read could follow a symlink substituted between those calls.
      // NONBLOCK also prevents a substituted FIFO from hanging the scanner.
      const descriptor = openSync(
        from,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      let bytes;
      try {
        const before = fstatSync(descriptor);
        assert.ok(before.isFile(), 'Source scan requires a regular file');
        bytes = readFileSync(descriptor);
        const after = fstatSync(descriptor);
        assert.ok(
          before.size === after.size &&
            before.mtimeMs === after.mtimeMs &&
            before.ctimeMs === after.ctimeMs &&
            bytes.length === before.size,
          'Source snapshot changed during the secret scan',
        );
      } finally {
        closeSync(descriptor);
      }
      writeFileSync(to, bytes, { flag: 'wx', mode: 0o600 });
      const hash = createHash('sha256').update(bytes).digest('hex');
      assert.equal(createHash('sha256').update(readFileSync(to)).digest('hex'), hash);
      files.push({
        path: sourceRelative,
        scannedPath: scanRelative,
        bytes: bytes.length,
        sha256: hash,
      });
    }
  }
  visit();
  assert.ok(files.length > 0, 'Empty immutable source snapshot');
  return {
    schemaVersion: 1,
    files,
    renamed: files.filter((file) => file.path !== file.scannedPath).length,
    totalBytes: files.reduce((total, file) => total + file.bytes, 0),
  };
}

/** Upstream sometimes exits zero after a read error; do not accept that result. */
export function assertCompleteSecretScan(result, report) {
  assert.equal(result.code, 0, 'Gitleaks findings or scanner failure');
  assert.ok(Array.isArray(report), 'Gitleaks report must be an array');
  assert.equal(report.length, 0, 'Gitleaks findings');
  const diagnostics = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.replace(
    // Scanner console colour bytes are stripped before evaluating severity.
    // eslint-disable-next-line no-control-regex
    /\u001b\[[\d;]*m/g,
    '',
  );
  assert.doesNotMatch(
    diagnostics,
    /\b(?:ERR|FTL|PNC|WRN)\b|could not read|failed scan|skipping (?:file|directory|archive)/i,
    'Incomplete secret scan: scanner warnings/read errors are blocking',
  );
  const counts = [...diagnostics.matchAll(/scanned ~(\d+) bytes/g)].map((match) =>
    Number(match[1]),
  );
  assert.ok(
    counts.length > 0 && counts.some((count) => count > 0),
    'Missing nonempty scan evidence',
  );
  return { findings: report.length, scannedBytes: counts.reduce((sum, count) => sum + count, 0) };
}

export function secretScans(sourceSha, sourceDirectory, ignores) {
  assert.match(sourceSha, /^[a-f0-9]{40}$/);
  assert.ok(path.isAbsolute(sourceDirectory), 'Source archive directory must be absolute');
  if (ignores) {
    assert.ok(path.isAbsolute(ignores.history) && path.isAbsolute(ignores.source));
    assert.notEqual(ignores.history, ignores.source, 'History review cannot apply to source scans');
  }
  const flags = (name) => [
    '--ignore-gitleaks-allow',
    ...(ignores ? [`--gitleaks-ignore-path=${ignores[name]}`] : []),
  ];
  return [
    // Scan every ancestor, including each merge parent. Unrelated fetched refs
    // must not change the security verdict for this immutable source commit.
    ['history', ['git', `--log-opts=--full-history -m ${sourceSha}`, '.', ...flags('history')]],
    ['source', ['dir', sourceDirectory, ...flags('source')]],
  ];
}
