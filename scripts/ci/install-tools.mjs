import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { ROOT, readJson } from './policy.mjs';
const lock = readJson(path.join(ROOT, 'scripts/ci/tools.lock.json'));
const directory = process.env.CI_TOOLS_DIR;
assert.ok(directory && path.isAbsolute(directory), 'CI_TOOLS_DIR must be absolute');
mkdirSync(directory, { recursive: true });
const names = process.argv.slice(2);
assert.ok(names.length > 0, 'Specify tools explicitly');
for (const name of names) {
  const tool = lock.tools[name];
  assert.ok(tool, 'Unknown tool');
  assert.equal(new URL(tool.url).origin, 'https://github.com');
  assert.match(tool.sha256, /^[a-f0-9]{64}$/);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    const response = await fetch(tool.url, { signal: controller.signal });
    assert.equal(response.status, 200, 'Tool download failed');
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(
      createHash('sha256').update(bytes).digest('hex'),
      tool.sha256,
      'Archive checksum mismatch',
    );
    // The verified archive is streamed to tar; it is never written to disk.
    const binary = execFileSync('tar', ['-xOzf', '-', name], {
      input: bytes,
      maxBuffer: 256 * 1024 * 1024,
    });
    assert.equal(
      createHash('sha256').update(binary).digest('hex'),
      tool.binarySha256,
      'Binary checksum mismatch',
    );
    // Only a binary whose own pinned SHA-256 matched reaches the tools directory.
    writeFileSync(path.join(directory, name), binary, { flag: 'wx' });
    chmodSync(path.join(directory, name), 0o755);
    console.log(`${name} ${tool.version} checksum verified`);
  } finally {
    clearTimeout(timer);
  }
}
