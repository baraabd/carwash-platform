import { realpathSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import ts from 'typescript';
import { checkFoundation } from './foundation.mjs';
export function main(args: readonly string[]): number {
  try {
    const { values } = parseArgs({
      args: [...args],
      allowPositionals: false,
      strict: true,
      options: {
        root: { type: 'string', default: process.cwd() },
        pnpm: { type: 'boolean', default: false },
        ci: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
      },
    });
    if (values.help) {
      console.log(
        'node scripts/check-foundation.mjs [--root DIRECTORY] [--pnpm] [--ci]\n--pnpm compares the catalog to an actual pnpm list, not a synthetic discovery.',
      );
      return 0;
    }
    if (values.ci && (Number(process.versions.node.split('.')[0]) !== 24 || ts.version !== '5.9.3'))
      throw new Error('TOOLCHAIN_MISMATCH: expected Node 24.x and TypeScript 5.9.3.');
    const result = checkFoundation(realpathSync(path.resolve(values.root)), values.pnpm || values.ci);
    console.log(JSON.stringify(result, null, 2));
    return result.ok ? 0 : 1;
  } catch (error) {
    console.log(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : 'Foundation checker error',
      }),
    );
    return 2;
  }
}
