import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const files = ['tests/ownership', 'tests/foundation'].flatMap((directory) =>
  readdirSync(path.join(root, directory))
    .filter((file) => file.endsWith('.test.mjs'))
    .sort()
    .map((file) => path.join(directory, file)),
);
if (!files.length) throw new Error('No F001 tests discovered. Empty acceptance is forbidden.');
const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...files], {
  cwd: root,
  stdio: 'inherit',
});
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 2;
