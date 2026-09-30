import assert from 'node:assert/strict';
import { globSync, mkdirSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT, readJson, inventory, auditSummary, sarifFindings, assertTap } from './policy.mjs';
import { command, checked, git, tool, toolLock, stage } from './runtime.mjs';
const mode = process.argv[2];
assert.ok(['targeted', 'static', 'integration', 'security', 'codeql'].includes(mode));
const pnpm = (...args) => checked('pnpm', args);
const node = (...args) => checked(process.execPath, args);
const testCounts = {};
async function tapSuite(id, files) {
  assert.ok(files.length > 0, 'No discovered tests');
  const result = await command(process.execPath, ['--test', '--test-reporter=tap', ...files], {
    capture: true,
  });
  process.stdout.write(result.stdout);
  assert.equal(result.code, 0, `Test command failed: ${id}`);
  testCounts[id] = assertTap(result.stdout);
}
const temporary = mkdtempSync(path.join(tmpdir(), 'cw-f009-'));
try {
  await stage(mode, async (step) => {
    if (mode === 'targeted') {
      const targets = JSON.parse(process.env.AFFECTED_TARGETS ?? 'null');
      assert.ok(Array.isArray(targets));
      const scope = inventory();
      const allowed = new Set([...scope.targets, ...scope.apps].map((o) => o.packageName));
      assert.ok(targets.every((t) => allowed.has(t)) && new Set(targets).size === targets.length);
      await step('validated-impact-plan', () => Promise.resolve());
      if (targets.length) {
        await step('shared-prerequisites', () => pnpm('build:packages'));
        await step('service-local-generation', () => pnpm('generate'));
        for (const name of targets)
          await step(`build-${name.split('/')[1]}`, () => pnpm('--filter', name, 'run', 'build'));
      }
      return {
        affected: targets,
        note: 'Early path-aware feedback, never a replacement for full acceptance.',
      };
    }
    if (mode === 'static') {
      const base = process.env.BASE_SHA;
      assert.match(base ?? '', /^[a-f0-9]{40}$/);
      await step('workflow-syntax', () => checked(tool('actionlint'), []));
      await step('ci-adversarial-tests', () => tapSuite('ci', ['tests/ci/gates.test.mjs']));
      await step('f001-full-foundation', () =>
        node(
          'scripts/f001/acceptance.mjs',
          '--ci',
          '--base-ref',
          base,
          '--evidence-dir',
          path.join(temporary, 'f001'),
        ),
      );
      const f001 = readJson(path.join(temporary, 'f001/report.json'));
      assert.equal(f001.verdict, 'ACCEPTED');
      for (const name of [
        'build',
        'typecheck',
        'lint',
        'format:check',
        'check:gateway-contract',
        'check:boundaries',
        'check:design-reference',
      ])
        await step(name.replaceAll(':', '-'), () => pnpm(name));
      await step('unit-tests', () =>
        tapSuite('unit', [...globSync('tests/unit/*.test.mjs'), ...globSync('tests/*.test.mjs')]),
      );
      await step('gateway-tests', () => tapSuite('gateway', ['tests/gateway/unit.test.mjs']));
      await step('observability-tests', () =>
        tapSuite('observability', globSync('tests/observability/*.test.mjs')),
      );
      await step('nest-test-build', () => pnpm('build:tests'));
      const nestFiles = inventory()
        .targets.filter((t) => t.database)
        .flatMap((t) => {
          const files = globSync(`${t.path}/dist-tests/test/*.spec.js`);
          assert.ok(files.length > 0, `Missing Nest specs: ${t.id}`);
          return files;
        });
      await step('nest-tests', () => tapSuite('nest', nestFiles));
      await step('append-only-migrations', () =>
        node('scripts/check-migrations.mjs', '--base-ref', base),
      );
      return {
        f001: {
          verdict: f001.verdict,
          gates: f001.gates?.map((g) => ({ id: g.id, status: g.status })),
        },
        independentWorkspaces: true,
        tests: testCounts,
        workflowValidator: toolLock.tools.actionlint.version,
      };
    }
    if (mode === 'integration') {
      await step('generate', () => pnpm('generate'));
      await step('build', () => pnpm('build'));
      const before = new Set(readdirSync(path.join(ROOT, 'evidence/acceptance')));
      await step('real-postgres-rabbitmq-and-all-schema-drift', () => pnpm('acceptance:run'));
      const added = readdirSync(path.join(ROOT, 'evidence/acceptance')).filter(
        (n) => !before.has(n),
      );
      assert.equal(added.length, 1, 'Require evidence newly created by this invocation');
      const database = readJson(
        path.join(ROOT, 'evidence/acceptance', added[0], 'acceptance-report.json'),
      );
      assert.equal(database.accepted, true);
      assert.ok(database.phases.length > 0 && database.phases.every((p) => p.status === 'PASS'));
      const count = database.phases.find((p) => p.counts)?.counts;
      assert.ok(
        count &&
          count.tests > 0 &&
          count.tests === count.pass &&
          count.fail === 0 &&
          count.skip === 0,
      );
      await step('chromium-install', () =>
        pnpm('exec', 'playwright', 'install', '--with-deps', 'chromium'),
      );
      const gatewayDir = path.join(ROOT, 'evidence/gateway');
      mkdirSync(gatewayDir, { recursive: true });
      const earlier = new Set(readdirSync(gatewayDir));
      await step('real-identity-redis-browser-and-gateway', () => pnpm('acceptance:gateway'));
      const newGateways = readdirSync(gatewayDir).filter((n) => !earlier.has(n));
      assert.equal(newGateways.length, 1);
      const gateway = readJson(path.join(gatewayDir, newGateways[0], 'acceptance-report.json'));
      assert.equal(gateway.sourceSHA, git('rev-parse', 'HEAD'));
      assert.equal(gateway.accepted, true);
      assert.ok(gateway.phases.length > 0 && gateway.phases.every((p) => p.status === 'PASS'));
      assert.ok(gateway.tests.total > 0 && gateway.tests.passed === gateway.tests.total);
      assert.equal(gateway.tests.failed + gateway.tests.skipped + gateway.tests.todo, 0);
      return {
        databases: inventory()
          .targets.filter((t) => t.database)
          .map((t) => t.id),
        databaseTests: count,
        identityGatewayBrowserTests: gateway.tests,
        note: 'Only freshly produced counts are retained; no credentials, contexts, raw HTTP or infrastructure logs are uploaded.',
      };
    }
    if (mode === 'security') {
      const counts = {};
      const source = path.join(temporary, 'source');
      mkdirSync(source);
      const archive = path.join(temporary, 'source.tar');
      await checked('git', ['archive', '--format=tar', '--output', archive, 'HEAD']);
      await checked('tar', ['-xf', archive, '-C', source]);
      for (const [name, args] of [
        ['history', ['git', '--log-opts=--all', '.']],
        ['source', ['dir', source]],
      ]) {
        const output = path.join(temporary, `${name}.json`);
        await step(`gitleaks-${name}`, async () => {
          const result = await command(tool('gitleaks'), [
            ...args,
            '--redact=100',
            '--max-archive-depth=2',
            '--max-decode-depth=2',
            '--report-format=json',
            `--report-path=${output}`,
          ]);
          const report = readJson(output);
          assert.ok(Array.isArray(report));
          counts[name] = report.length;
          // Findings never leave the temporary directory, even if a scanner's
          // future JSON format adds non-redacted fields. Failures remain blocking.
          assert.equal(result.code, 0, 'Gitleaks findings or scanner failure');
          assert.equal(report.length, 0, 'Gitleaks findings');
        });
      }
      let audit;
      await step('dependency-audit', async () => {
        const result = await command('pnpm', ['audit', '--json'], { capture: true });
        audit = auditSummary(JSON.parse(result.stdout));
        // F001 already blocks at LOW. Do not weaken that inherited policy.
        assert.equal(result.code, 0, 'Dependency advisories or audit failure');
        assert.equal(
          Object.values(audit).reduce((a, b) => a + b, 0),
          0,
        );
      });
      await step('reproducible-frozen-lockfile', () => node('scripts/verify-frozen-install.mjs'));
      return {
        scanner: toolLock.tools.gitleaks.version,
        secrets: counts,
        audit,
        threshold: 'All pnpm advisories block, preserving F001; no allowlist introduced.',
      };
    }
    if (mode === 'codeql') {
      const directory = process.env.CODEQL_RESULTS;
      assert.ok(directory && path.isAbsolute(directory));
      const files = readdirSync(directory).filter((f) => f.endsWith('.sarif'));
      assert.ok(files.length > 0, 'Missing CodeQL SARIF');
      const findings = files.flatMap((file) => sarifFindings(readJson(path.join(directory, file))));
      assert.equal(
        process.env.CODEQL_VERSION,
        toolLock.actions['github/codeql-action'].cliVersion,
        'Unexpected CodeQL CLI version; linked bundle must match the pinned action',
      );
      const summary = {
        action: toolLock.actions['github/codeql-action'].sha,
        version: process.env.CODEQL_VERSION,
        analyses: files.length,
        findings: findings.length,
        blocking: findings.filter((f) => f.blocking).length,
        rules: [...new Set(findings.map((f) => f.ruleId))].sort(),
        locations: findings.map(({ ruleId, level, securitySeverity, locations }) => ({
          ruleId,
          level,
          securitySeverity,
          locations,
        })),
        threshold: 'Security severity >=7, or error level; no suppressed-result exception.',
      };
      // This summary cannot contain SARIF snippets, source contents or secrets.
      writeFileSync(
        path.join(process.env.CI_EVIDENCE_DIR, 'codeql-findings.json'),
        JSON.stringify(summary, null, 2) + '\n',
      );
      await step('sarif-security-threshold', () =>
        assert.equal(summary.blocking, 0, 'Blocking CodeQL findings'),
      );
      return summary;
    }
  });
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
