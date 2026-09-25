import { realpathSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import ts from 'typescript';
import { checkRepository } from './checker.mjs';
export function main(args: readonly string[]): number {
  let json = args.includes('--json');
  try {
    const { values } = parseArgs({
      args: [...args],
      allowPositionals: false,
      strict: true,
      options: {
        root: { type: 'string', default: process.cwd() },
        ci: { type: 'boolean', default: false },
        json: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
      },
    });
    json = values.json;
    if (values.help) {
      console.log(
        'node scripts/check-ownership.mjs [--root DIRECTORY] [--ci] [--json]\nStatic source ownership only. --ci requires Node 24.x / TypeScript 5.9.3.',
      );
      return 0;
    }
    if (values.ci && (Number(process.versions.node.split('.')[0]) !== 24 || ts.version !== '5.9.3')) {
      throw new Error(
        `TOOLCHAIN_MISMATCH: expected Node 24.x / TypeScript 5.9.3; actual ${process.version} / ${ts.version}.`,
      );
    }
    const result = checkRepository(realpathSync(path.resolve(values.root)));
    if (json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(
        `${result.ok ? 'PASS' : 'FAIL'}: ${result.workspaces} workspaces, ${result.sourceFiles} source files, ${result.references} references.`,
      );
      for (const issue of result.diagnostics)
        console.log(`${issue.file}:${issue.line ?? 1}:${issue.column ?? 1} [${issue.rule}] ${issue.message}`);
      console.log(
        'Static source ownership only; not proof of runtime DB/broker isolation or complete F001 acceptance.',
      );
    }
    return result.ok ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown ownership checker error.';
    if (json)
      console.log(JSON.stringify({ ok: false, scope: 'static-source-ownership-only', error: message }));
    else console.error(message);
    return 2;
  }
}
