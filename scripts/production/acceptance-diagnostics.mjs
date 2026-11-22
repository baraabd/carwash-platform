import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { redact } from '../acceptance/lib/exec.mjs';

const PNG_NAME = /^[a-z0-9-]+-(?:reference(?:-raw|-declared)?|candidate|diff)\.png$/;
const MAX_DIAGNOSTIC_BYTES = 20 * 1024 * 1024;
const CUSTOMER_DESIGN_PNGS = new Set([
  'guest-entry-390-candidate.png',
  'guest-recovery-390-candidate.png',
  'guest-receipt-390-candidate.png',
]);
const SOURCES = Object.freeze({
  'a-customer-browser': [
    [
      'customer-access-design',
      '.acceptance/production-A/customer-access-design',
      ['design-review.json'],
    ],
  ],
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

/** Only declared synthetic visual evidence; never a real customer auth context. */
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
    const pending = [];
    let customerDesignVerified = false;
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const isJson = jsonNames.includes(entry.name);
      // The operator summary folder may contain other browser outputs. Only its
      // one manifest is allowed; screenshots come from declared visual/a11y folders.
      const isPng =
        label === 'customer-access-design'
          ? CUSTOMER_DESIGN_PNGS.has(entry.name)
          : label !== 'operator-summary' && PNG_NAME.test(entry.name);
      if (!isJson && !isPng) continue;
      const source = path.join(directory, entry.name);
      // Pin the inode before checking its type and freshness. Never reopen a
      // checked pathname: it could be replaced with a private-file symlink.
      const file = await open(
        source,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      let bytes;
      try {
        const info = await file.stat();
        assert.ok(info.isFile(), 'Diagnostic must remain a regular file');
        if (info.mtimeMs < since) continue;
        assert.ok(info.size <= MAX_DIAGNOSTIC_BYTES, 'Unexpected oversized visual diagnostic');
        // Allocate at most the checked size plus one byte. Growth cannot turn
        // a small screenshot into an unbounded memory allocation.
        const buffer = Buffer.alloc(info.size + 1);
        let offset = 0;
        while (offset < buffer.length) {
          const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, offset);
          if (bytesRead === 0) break;
          offset += bytesRead;
        }
        const after = await file.stat();
        assert.ok(
          offset === info.size &&
            after.size === info.size &&
            after.mtimeMs === info.mtimeMs &&
            after.ctimeMs === info.ctimeMs,
          'Diagnostic changed while being retained',
        );
        bytes = buffer.subarray(0, offset);
      } finally {
        await file.close();
      }
      if (isPng)
        assert.equal(
          bytes.subarray(0, 8).toString('hex'),
          '89504e470d0a1a0a',
          'Invalid PNG diagnostic',
        );
      const value = isJson ? JSON.parse(bytes.toString()) : null;
      if (label === 'customer-access-design' && isJson) {
        assert.equal(value.status, 'UNAPPROVED_CUSTOMER_ACCESS_DESIGN');
        assert.equal(value.ownerJourneyEvidence, false);
        assert.equal(value.forwardedApiRequests, 0);
        assert.equal(value.containsRealCredentials, false);
        assert.equal(value.actualIdentityIssued, false);
        assert.equal(value.acceptedDesign, false);
        assert.deepEqual([...value.files].sort(), [...CUSTOMER_DESIGN_PNGS].sort());
        customerDesignVerified = true;
      }
      const safe = isJson ? Buffer.from(redact(JSON.stringify(value, null, 2)) + '\n') : bytes;
      const destination = path.join('diagnostics', label, entry.name);
      pending.push({ destination, safe });
    }
    if (label === 'customer-access-design' && pending.length > 0)
      assert.ok(customerDesignVerified, 'Synthetic customer design manifest is required');
    for (const { destination, safe } of pending) {
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
