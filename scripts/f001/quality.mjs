import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
try {
  const mode = process.argv[2];
  if (process.argv.length !== 3 || !['lint', 'format-check', 'format-write'].includes(mode))
    throw new Error('Usage: node scripts/f001/quality.mjs lint|format-check|format-write');
  const owned = JSON.parse(readFileSync(path.join(root, 'architecture/f001-owned-files.json'), 'utf8'));
  if (!Array.isArray(owned) || !owned.length) throw new Error('F001 owned-file list is missing.');
  const protectedPath = (file) =>
    /^(?:design\/|docs\/design\/|docs\/sources\/)|(?:^|\/)prototype\//.test(file);
  if (
    owned.some(
      (file) =>
        typeof file !== 'string' || file.includes('..') || path.isAbsolute(file) || protectedPath(file),
    )
  )
    throw new Error('Unsafe path in the quality scope.');
  if (mode === 'lint') {
    const { ESLint } = await import('eslint');
    const eslint = new ESLint({ cwd: root, overrideConfigFile: path.join(root, 'eslint.f001.config.mjs') });
    const results = await eslint.lintFiles(owned.filter((file) => /\.(?:mjs|mts|ts)$/.test(file)));
    console.log(await (await eslint.loadFormatter('stylish')).format(results));
    process.exitCode = results.some((result) => result.errorCount > 0 || result.warningCount > 0) ? 1 : 0;
  } else {
    const prettier = await import('prettier');
    const configFile = path.join(root, '.prettierrc.f001.json');
    let failures = 0;
    for (const relative of owned) {
      const file = path.join(root, relative);
      const info = await prettier.getFileInfo(file);
      if (!info.inferredParser) continue; // .gitignore/.npmrc are not formatter source languages.
      const options = { ...(await prettier.resolveConfig(file, { config: configFile })), filepath: file };
      const before = readFileSync(file, 'utf8');
      if (mode === 'format-write') writeFileSync(file, await prettier.format(before, options));
      else if (!(await prettier.check(before, options))) {
        console.error(`Formatting required: ${relative}`);
        failures++;
      }
    }
    process.exitCode = failures ? 1 : 0;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
