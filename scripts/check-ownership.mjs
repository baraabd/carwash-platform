#!/usr/bin/env node
// This additive gate does not replace scripts/check-boundaries.mjs or the design guard.
try {
  const { main } = await import('../dist/ownership/cli.mjs');
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error('Ownership checker could not load. Run pnpm build:ownership first.');
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}
