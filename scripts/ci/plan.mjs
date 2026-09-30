import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { inventory, affectedTargets } from './policy.mjs';
import { git, stage } from './runtime.mjs';
await stage('plan', async (step) => {
  const scope = await step('validate-runtime-inventory', () => inventory());
  let base = process.env.BASE_SHA;
  if (!/^[a-f0-9]{40}$/.test(base ?? '') || /^0+$/.test(base)) base = git('rev-parse', 'HEAD^');
  git('cat-file', '-e', `${base}^{commit}`);
  const files = git('diff', '--name-only', base, 'HEAD').split('\n').filter(Boolean);
  const affected = affectedTargets(files, [...scope.targets, ...scope.apps]);
  const targets = [...scope.targets].sort(
    (a, b) =>
      Number(affected.some((s) => s.id === b.id)) - Number(affected.some((s) => s.id === a.id)) ||
      a.id.localeCompare(b.id),
  );
  const output = {
    matrix: { include: targets },
    affected: affected.map((s) => s.packageName),
    base,
    plannedServices: scope.plannedServices,
    note: 'Affected owners get early feedback; every runtime image and every mandatory acceptance job still runs.',
  };
  assert.ok(targets.length > 0);
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `matrix=${JSON.stringify(output.matrix)}\naffected=${JSON.stringify(output.affected)}\nbase=${base}\n`,
    );
  return output;
});
