#!/usr/bin/env node
try {
  const { main } = await import('../dist/ownership/foundation-cli.mjs');
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(`Foundation checker unavailable. Run pnpm build:ownership first. ${error.message}`);
  process.exitCode = 2;
}
