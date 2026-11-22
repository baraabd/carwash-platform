import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { redact } from '../acceptance/lib/exec.mjs';

const PNG_NAME = /^[a-z0-9-]+-(?:reference(?:-raw|-declared)?|candidate|diff)\.png$/;
const SOURCES = Object.freeze({
  'c-operator-fixtures': [
    ['operator-summary', '.acceptance/production-C/operator-web', ['acceptance.json']],
    ['operator-visual', '.acceptance/production-C/operator-web/visual', ['visual-summary.json']],
    ['operator-a11y', '.acceptance/production-C/operator-web/a11y', ['axe-summary.json']],
  ],
  'd-admin-browser': [
    ['admin-operations', 'docs/production/D/evidence/p02-d2', ['browser-report.json']],
    ['admin-finance', 'docs/production/D/evidence/p03-d3', ['browser-report.json']],
  ],
});

/** Only declared synthetic operator/admin visual evidence; never customer auth. */
export async function retainBrowserDiagnostics(root, suite, output, startedAt) {
  const since = Date.parse(startedAt);
  assert.ok(Number.isFinite(since));
  const retained = [];
  for (const [label, relative, jsonNames] of SOURCES[suite] ?? []) {
    const directory = path.join(root, relative);
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const isJson = jsonNames.includes(entry.name);
      // The operator summary folder may contain other browser outputs. Only its
      // one manifest is allowed; screenshots come from declared visual/a11y folders.
      const isPng = label !== 'operator-summary' && PNG_NAME.test(entry.name);
      if (!isJson && !isPng) continue;
      const source = path.join(directory, entry.name);
      const info = await lstat(source);
      assert.ok(info.isFile(), 'Diagnostic must remain a regular file');
      if (info.mtimeMs < since) continue;
      assert.ok(info.size <= 20 * 1024 * 1024, 'Unexpected oversized visual diagnostic');
      const bytes = await readFile(source);
      if (isPng)
        assert.equal(
          bytes.subarray(0, 8).toString('hex'),
          '89504e470d0a1a0a',
          'Invalid PNG diagnostic',
        );
      const safe = isJson
        ? Buffer.from(redact(JSON.stringify(JSON.parse(bytes.toString()), null, 2)) + '\n')
        : bytes;
      const destination = path.join('diagnostics', label, entry.name);
      await mkdir(path.join(output, 'diagnostics', label), { recursive: true });
      await writeFile(path.join(output, destination), safe);
      retained.push({
        file: destination,
        bytes: safe.length,
        sha256: createHash('sha256').update(safe).digest('hex'),
      });
    }
  }
  return retained;
}
