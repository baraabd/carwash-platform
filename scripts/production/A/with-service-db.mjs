#!/usr/bin/env node
/**
 * Runs one command with DATABASE_URL set to a Lane A service's database on the
 * disposable acceptance stack named by CW_CONTEXT_FILE.
 *
 *   node scripts/production/A/with-service-db.mjs <customer|vehicle|geo|identity> <app|migrate> -- <cmd...>
 *
 * The connection string travels only in the child environment; it is never
 * printed or written to a file.
 */
import { spawn } from 'node:child_process';
import { appDsn, migrationDsn, readContextFile } from '../../acceptance/lib/context.mjs';

const [service, role, separator, command, ...args] = process.argv.slice(2);
if (
  !['customer', 'vehicle', 'geo', 'identity'].includes(service ?? '') ||
  !['app', 'migrate'].includes(role ?? '') ||
  separator !== '--' ||
  !command
) {
  console.error(
    'usage: with-service-db.mjs <customer|vehicle|geo|identity> <app|migrate> -- <cmd...>',
  );
  process.exit(2);
}
const context = await readContextFile();
const url = role === 'app' ? appDsn(context, service) : migrationDsn(context, service);
const child = spawn(command, args, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, DATABASE_URL: url },
});
child.on('close', (code) => process.exit(code ?? 1));
