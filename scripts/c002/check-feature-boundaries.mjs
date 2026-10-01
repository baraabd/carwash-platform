import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const EXPECTED_FEATURES = ['account', 'booking', 'garage', 'home', 'orders', 'payment', 'tracking'];

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    if (entry.isFile() && /\.[cm]?[jt]sx?$/.test(entry.name)) return [target];
    return [];
  });
}

function importedSpecifiers(source) {
  const imports = [];
  const pattern = /(?:from\s+|import\s*)['"]([^'"]+)['"]/g;
  let match;
  while ((match = pattern.exec(source)) !== null) imports.push(match[1]);
  return imports;
}

export function checkFeatureBoundaries(root = REPO_ROOT) {
  const featureRoot = resolve(root, 'apps/customer-web/src/features');
  const srcRoot = resolve(root, 'apps/customer-web/src');
  const present = readdirSync(featureRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const errors = [];
  for (const feature of EXPECTED_FEATURES) {
    if (!present.includes(feature)) errors.push(`MISSING_FEATURE_FOLDER:${feature}`);
  }
  for (const file of sourceFiles(featureRoot)) {
    const rel = relative(featureRoot, file);
    const sourceFeature = rel.split(sep)[0];
    for (const specifier of importedSpecifiers(readFileSync(file, 'utf8'))) {
      if (!specifier.startsWith('.')) continue;
      const target = resolve(dirname(file), specifier);
      const targetFromFeatures = relative(featureRoot, target);
      if (!targetFromFeatures.startsWith('..') && !targetFromFeatures.startsWith(sep)) {
        const targetFeature = targetFromFeatures.split(sep)[0];
        if (targetFeature !== sourceFeature) {
          errors.push(`CROSS_FEATURE_IMPORT:${relative(root, file)}->${specifier}`);
        }
      }
      const targetFromSrc = relative(srcRoot, target);
      if (!targetFromSrc.startsWith('..') && targetFromSrc.split(sep)[0] === 'app') {
        errors.push(`FEATURE_IMPORTS_APP_LAYER:${relative(root, file)}->${specifier}`);
      }
    }
  }

  return { ok: errors.length === 0, features: present, errors };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv[2] ? resolve(process.argv[2]) : REPO_ROOT;
  const result = checkFeatureBoundaries(root);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}
