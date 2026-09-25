/**
 * Loads the COMPILED packages, not the TypeScript sources.
 *
 * The services ship the compiled CommonJS output, so testing that output is
 * testing what actually runs. A test that imported the .ts sources could pass
 * while the emitted JavaScript was broken.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const require = createRequire(path.join(ROOT, 'package.json'));

export const serviceKit = require(path.join(ROOT, 'packages/service-kit/dist/index.js'));
export const messaging = require(path.join(ROOT, 'packages/platform-messaging/dist/index.js'));
export const contracts = require(path.join(ROOT, 'packages/event-contracts/dist/index.js'));
