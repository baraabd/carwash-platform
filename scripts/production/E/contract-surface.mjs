// Contract surface lock. The lock records every published route, reason and
// event of the BUILT packages. Compatibility rule (enforced by
// tests/production/E/contract-compatibility.test.mjs):
//   - a locked route/event may never be removed or changed within its major;
//   - reasons and enum-like additions are additive only;
//   - any addition must be written into the lock deliberately (`--write`) and
//     reviewed by Lane E, so the surface never grows by accident.
// A breaking change ships as a new major id (e.g. customer.v2) beside the old one.
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const LOCK_PATH = path.join(root, 'architecture/contract-surface.lock.json');

export function currentSurface() {
  const require = createRequire(import.meta.url);
  const contracts = require(path.join(root, 'packages/contracts/dist/index.js'));
  const events = require(path.join(root, 'packages/event-contracts/dist/index.js'));
  return {
    schemaVersion: 1,
    http: Object.fromEntries(
      contracts.OWNER_CONTRACTS.map((c) => [
        c.id,
        {
          owner: c.owner,
          prefix: c.prefix,
          routes: Object.fromEntries(
            Object.entries(c.routes).map(([name, r]) => [
              name,
              {
                method: r.method,
                path: r.path,
                access: r.access,
                idempotent: r.idempotent === true,
                revisioned: r.revisioned === true,
                safe: r.safe === true,
                paged: r.paged === true,
              },
            ]),
          ),
          reasons: [...c.reasons],
        },
      ]),
    ),
    errorCodes: [...contracts.API_ERROR_CODES],
    currencies: contracts.CURRENCIES,
    events: Object.fromEntries(
      events.BUSINESS_EVENTS.map((e) => [
        e.eventType,
        { producer: e.producer, aggregateType: e.aggregateType, envelopeVersion: 2 },
      ]),
    ),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const surface = JSON.stringify(currentSurface(), null, 2) + '\n';
  if (process.argv.includes('--write')) {
    await writeFile(LOCK_PATH, surface);
    console.log('Contract surface lock written; Lane E must review the diff.');
  } else {
    const locked = await readFile(LOCK_PATH, 'utf8');
    if (locked !== surface) {
      console.error(
        'CONTRACT_SURFACE_CHANGED: run node --test tests/production/E/contract-compatibility.test.mjs',
      );
      process.exit(1);
    }
    console.log('Contract surface matches the lock.');
  }
}
