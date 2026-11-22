import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

function sourceSpecs(directory, prefix = '') {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  return entries.flatMap((entry) => {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) return sourceSpecs(path.join(directory, entry.name), relative);
    if (!entry.name.endsWith('.spec.ts')) return [];
    assert.ok(entry.isFile(), `Spec source must be a regular file: ${relative}`);
    return [relative];
  });
}

/**
 * Discover from source, then require each compiled artifact. This includes nested
 * domain/unit suites, never substitutes stale dist files for missing source, and
 * keeps real-infrastructure suites out of offline jobs.
 */
export function discoverServiceSpecs(serviceDirectory, { kind = 'offline' } = {}) {
  assert.ok(['offline', 'integration'].includes(kind), `Unknown test family: ${kind}`);
  const selected = sourceSpecs(path.join(serviceDirectory, 'test'))
    .filter((file) => file.split(path.sep).includes('integration') === (kind === 'integration'))
    .sort();
  assert.ok(selected.length > 0, `Missing ${kind} spec sources: ${serviceDirectory}`);
  return selected.map((file) => {
    const compiled = path.join(
      serviceDirectory,
      'dist-tests',
      'test',
      file.replace(/\.ts$/, '.js'),
    );
    let artifact;
    try {
      artifact = statSync(compiled);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      throw new Error(`Missing compiled spec: ${compiled}`, { cause: error });
    }
    assert.ok(
      artifact.isFile() && artifact.size > 0,
      `Empty or invalid compiled spec: ${compiled}`,
    );
    return compiled;
  });
}
