import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { databaseSchemaFromUrl } from '@carwash/service-kit';
import { ApplicationError, GeoApplication, type OperationContext } from '../../application';
import { GeoDomainError } from '../../domain';
import { PrismaGeoStore } from '../../infrastructure/persistence/prisma-geo.store';
import { PrismaService, databaseUrlFromEnv } from '../../infrastructure/persistence/prisma.service';
import { randomIds, systemClock } from '../../infrastructure/system/system';

/**
 * Operator command for zone data (no HTTP write route exists yet).
 *
 *   node dist/transport/cli/zones.js import <zones.json> --actor <label>
 *   node dist/transport/cli/zones.js revise <zone.json> --revision <n> --actor <label>
 *   node dist/transport/cli/zones.js retire <code> --revision <n> --actor <label>
 *
 * A zones file is one zone definition or an array of them:
 *   {code, name, datasetRef, polygon: [[lng, lat], ...]}  (decimal strings)
 * `datasetRef` must name the APPROVED dataset the polygon came from. This
 * repository ships no zone data; nothing here may be fed invented geography.
 * Runs with the service RUNTIME identity (DATABASE_URL); prints one JSON line
 * per zone and exits non-zero if any operation was refused.
 */
function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function revisionOf(args: readonly string[]): number {
  const raw = option(args, 'revision') ?? '';
  if (!/^[1-9][0-9]{0,8}$/.test(raw)) throw new Error('USAGE: --revision <positive integer>');
  return Number(raw);
}

function refusal(error: unknown): string {
  if (error instanceof GeoDomainError || error instanceof ApplicationError) {
    return 'field' in error && error.field ? `${error.code}:${error.field}` : error.code;
  }
  return 'INTERNAL_ERROR';
}

async function main(argv: readonly string[]): Promise<number> {
  const [command, target, ...rest] = argv;
  const actor = option(rest, 'actor');
  if (!command || !target || !actor) {
    throw new Error(
      'USAGE: zones.js <import|revise|retire> <file|code> --actor <label> [--revision n]',
    );
  }
  const url = databaseUrlFromEnv();
  const prisma = new PrismaService(url);
  const app = new GeoApplication(
    new PrismaGeoStore(prisma.client, databaseSchemaFromUrl(url)),
    systemClock,
    randomIds,
  );
  const context: OperationContext = { actor, correlationId: randomUUID(), traceParent: null };
  let failures = 0;
  try {
    const run = async (
      label: string,
      operation: () => Promise<{ outcome: string; zone: { code: string; revision: number } }>,
    ) => {
      try {
        const result = await operation();
        console.log(
          JSON.stringify({
            target: label,
            outcome: result.outcome,
            code: result.zone.code,
            revision: result.zone.revision,
          }),
        );
      } catch (error) {
        failures += 1;
        console.log(JSON.stringify({ target: label, outcome: 'refused', code: refusal(error) }));
      }
    };
    if (command === 'retire') {
      const revision = revisionOf(rest);
      await run(target, () => app.retireZone(context, target, revision));
    } else {
      const parsed: unknown = JSON.parse(readFileSync(target, 'utf8'));
      const zones: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
      if (command === 'import') {
        for (const [index, zone] of zones.entries())
          await run(`#${index}`, () => app.importZone(context, zone));
      } else if (command === 'revise') {
        const revision = revisionOf(rest);
        if (zones.length !== 1) throw new Error('USAGE: revise takes exactly one zone');
        await run('#0', () => app.reviseZone(context, revision, zones[0]));
      } else {
        throw new Error(`UNKNOWN_COMMAND: ${command}`);
      }
    }
  } finally {
    await prisma.onModuleDestroy();
  }
  return failures === 0 ? 0 : 1;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(
      error instanceof Error && error.message.startsWith('USAGE')
        ? error.message
        : 'ZONES_COMMAND_FAILED',
    );
    process.exitCode = 2;
  },
);
