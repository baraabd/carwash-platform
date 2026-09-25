import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const loadJSON = createRequire(path.join(root, 'package.json'));
const expected = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).devDependencies;
const errors = [];
const actual = { node: process.version };
if (Number(process.versions.node.split('.')[0]) !== 24) errors.push('Node 24.x is required.');
for (const name of [
  'typescript',
  '@types/node',
  'turbo',
  'eslint',
  '@eslint/js',
  'typescript-eslint',
  'prettier',
]) {
  try {
    actual[name] = loadJSON(`${name}/package.json`).version;
    if (actual[name] !== expected[name])
      errors.push(`${name}: expected ${expected[name]}, actual ${actual[name]}`);
  } catch (error) {
    errors.push(`${name}: ${error.message}`);
  }
}
console.log(JSON.stringify({ ok: !errors.length, actual, errors }, null, 2));
process.exitCode = errors.length ? 2 : 0;
