import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const own = createRequire(path.join(root, 'apps/api-gateway/package.json'));
const { gatewayOpenApi } = own('./dist/index.js');
const expected = JSON.stringify(gatewayOpenApi(), null, 2) + '\n';
const target = path.join(root, 'docs/contracts/gateway.openapi.json');
if (process.argv.includes('--write')) {
  await writeFile(target, expected);
  console.log('Gateway routing discovery authored; review the diff before committing.');
} else {
  const actual = await readFile(target, 'utf8');
  if (actual !== expected)
    throw new Error('GATEWAY_OPENAPI_DRIFT: run gateway-openapi.mjs --write and review');
  console.log('Gateway OpenAPI matches the public routing contract.');
}
