import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { inventory, readJson, trivyFindings, runtimeEnvironment } from './policy.mjs';
import { checked, command, tool, toolLock, stage } from './runtime.mjs';
const id = process.argv[2];
const target = inventory().targets.find((t) => t.id === id);
assert.ok(target, 'Target must be an actual catalog-owned runtime');
const run = randomUUID().slice(0, 8);
const tag = `cw-f009-${id}:${run}`;
const name = `cw-f009-${id}-${run}`;
const temporary = mkdtempSync(path.join(tmpdir(), 'cw-f009-image-'));
const docker = (...args) =>
  checked('docker', args, { timeoutMs: 1800000, capture: !['build', 'pull'].includes(args[0]) });
let created = false;
try {
  await stage(`image-${id}`, async (step) => {
    const info = { target: id };
    try {
      const nodeImage = (readFileSync(`${target.path}/Dockerfile`, 'utf8').match(
        /^ARG NODE_IMAGE=(.+)$/m,
      ) ?? [])[1];
      assert.ok(nodeImage, 'Missing pinned image');
      const digests = await step('resolve-pinned-base', async () => {
        await docker('pull', nodeImage);
        return JSON.parse(
          await docker('image', 'inspect', '--format', '{{json .RepoDigests}}', nodeImage),
        );
      });
      assert.ok(digests.length > 0 && /@sha256:[a-f0-9]{64}$/.test(digests[0]));
      info.baseImage = digests[0];
      const runtimeImage = (readFileSync(`${target.path}/Dockerfile`, 'utf8').match(
        /^ARG RUNTIME_IMAGE=(.+)$/m,
      ) ?? [])[1];
      assert.equal(
        runtimeImage,
        toolLock.runtime.image,
        'Runtime image must match the reviewed digest',
      );
      await step('pull-immutable-runtime', () => docker('pull', runtimeImage));
      info.runtimeImage = runtimeImage;
      await step('independent-docker-build', () =>
        docker(
          'build',
          '--build-arg',
          `NODE_IMAGE=${digests[0]}`,
          '--build-arg',
          `RUNTIME_IMAGE=${runtimeImage}`,
          '-f',
          `${target.path}/Dockerfile`,
          '-t',
          tag,
          '.',
        ),
      );
      info.imageId = await docker('image', 'inspect', '--format', '{{.Id}}', tag);
      await step('non-root', async () =>
        assert.equal(await docker('run', '--rm', tag, 'node', '-p', 'process.getuid()'), '1000'),
      );
      await step('pinned-node-runtime', async () =>
        assert.equal(await docker('run', '--rm', tag, 'node', '--version'), process.version),
      );
      await step('no-shell-or-build-toolchain', async () => {
        const script =
          "const fs=require('node:fs');if(['/bin/sh','/bin/bash','/usr/bin/apt','/usr/local/bin/npm','/usr/local/bin/corepack'].some(p=>fs.existsSync(p)))process.exit(1)";
        await docker('run', '--rm', tag, 'node', '-e', script);
      });
      const env = runtimeEnvironment(target);
      await step('isolated-container-start', async () => {
        created = true;
        await docker('run', '-d', '--name', name, '--network', 'none', ...env, tag);
      });
      const status = async (route) => {
        const script = `fetch('http://127.0.0.1:${target.port}${route}',{signal:AbortSignal.timeout(3000)}).then(r=>console.log(r.status)).catch(()=>process.exit(2))`;
        return command('docker', ['exec', name, 'node', '-e', script], {
          capture: true,
          timeoutMs: 10000,
        });
      };
      await step('liveness', async () => {
        for (let i = 0; i < 30; i++) {
          const result = await status('/health/live');
          if (result.code === 0 && result.stdout.trim() === '200') return;
          await delay(1000);
        }
        throw new Error('Liveness did not become healthy');
      });
      await step('readiness-fail-closed', async () => {
        const result = await status('/health/ready');
        assert.equal(result.code, 0);
        assert.equal(result.stdout.trim(), '503');
      });
      await step('no-baked-secrets', async () => {
        const script =
          "const fs=require('node:fs');const paths=fs.readdirSync('/app');if(paths.some(p=>p.startsWith('.env')||p==='.acceptance'||p==='.git'))process.exit(1)";
        await docker('exec', name, 'node', '-e', script);
      });
      await step('graceful-shutdown', async () => {
        await docker('stop', '-t', '15', name);
        assert.equal(await docker('inspect', '--format', '{{.State.ExitCode}}', name), '0');
      });
      await step('trivy-container-security', async () => {
        const output = path.join(temporary, 'trivy.json');
        const result = await command(
          tool('trivy'),
          [
            'image',
            '--scanners',
            'vuln,secret',
            '--format',
            'json',
            '--output',
            output,
            '--exit-code',
            '1',
            '--severity',
            'HIGH,CRITICAL,UNKNOWN',
            '--timeout',
            '10m',
            tag,
          ],
          { timeoutMs: 720000 },
        );
        const report = readJson(output);
        const findings = trivyFindings(report);
        const secrets = report.Results.reduce((sum, r) => sum + (r.Secrets?.length ?? 0), 0);
        const summary = {
          imageId: info.imageId,
          version: toolLock.tools.trivy.version,
          findings,
          secretCount: secrets,
        };
        writeFileSync(
          path.join(process.env.CI_EVIDENCE_DIR, `scan-${id}.json`),
          JSON.stringify(summary, null, 2) + '\n',
        );
        assert.equal(result.code, 0, 'Trivy findings or scan failure');
        assert.equal(secrets, 0);
        assert.ok(findings.every((f) => !f.blocking));
        info.scanner = toolLock.tools.trivy.version;
      });
      await step('cyclonedx-sbom', async () => {
        const output = path.join(temporary, 'sbom.json');
        await checked(
          tool('trivy'),
          ['image', '--format', 'cyclonedx', '--output', output, '--timeout', '10m', tag],
          { timeoutMs: 720000 },
        );
        const sbom = readJson(output);
        assert.equal(sbom.bomFormat, 'CycloneDX');
        assert.ok(sbom.components?.length > 0);
        // Preserve valid package inventory without runtime/config/source fields.
        const safe = {
          bomFormat: sbom.bomFormat,
          specVersion: sbom.specVersion,
          version: sbom.version,
          serialNumber: sbom.serialNumber,
          metadata: {
            component: Object.fromEntries(
              ['type', 'bom-ref', 'group', 'name', 'version', 'purl', 'hashes', 'licenses']
                .filter((k) => sbom.metadata.component[k] !== undefined)
                .map((k) => [k, sbom.metadata.component[k]]),
            ),
          },
          components: sbom.components.map((c) =>
            Object.fromEntries(
              ['type', 'bom-ref', 'group', 'name', 'version', 'purl', 'hashes', 'licenses']
                .filter((k) => c[k] !== undefined)
                .map((k) => [k, c[k]]),
            ),
          ),
          dependencies: sbom.dependencies ?? [],
        };
        writeFileSync(
          path.join(process.env.CI_EVIDENCE_DIR, `sbom-${id}.json`),
          JSON.stringify(safe, null, 2) + '\n',
        );
        info.sbomComponents = safe.components.length;
      });
    } finally {
      await step('scoped-cleanup', async () => {
        if (created) await docker('rm', '-f', name);
        const exists = await command('docker', ['image', 'inspect', tag], { capture: true });
        if (exists.code === 0) await docker('image', 'rm', tag);
      });
    }
    return info;
  });
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
