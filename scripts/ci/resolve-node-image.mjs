import { readFileSync } from 'node:fs';
import { pullPinnedOfficialImage } from '../lib/image-references.mjs';
import { command } from './runtime.mjs';

const version = readFileSync(new URL('../../.nvmrc', import.meta.url), 'utf8').trim();
const reference = await pullPinnedOfficialImage(`node:${version}-bookworm-slim`, (args, options) =>
  command('docker', args, options),
);
// stdout is consumed as one Docker build argument; diagnostics stay on stderr.
process.stdout.write(`${reference}\n`);
