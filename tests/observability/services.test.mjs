import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:net';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { readFile } from 'node:fs/promises';
import { selectFoundationShellServices } from '../../scripts/dev/service-template.mjs';
const catalog = JSON.parse(
  await readFile(new URL('../../architecture/service-catalog.json', import.meta.url), 'utf8'),
);
const owners = [...selectFoundationShellServices(catalog), 'api-gateway'];
async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
for (const service of owners) {
  test(
    `${service}: real process, private metrics, correlation, readiness and SIGTERM`,
    { timeout: 25000 },
    async () => {
      const port = await freePort();
      const token = randomBytes(32).toString('hex');
      const secret = randomBytes(24).toString('hex');
      const entry =
        service === 'api-gateway'
          ? 'apps/api-gateway/dist/main.js'
          : `services/${service}/dist/main.js`;
      const child = spawn(process.execPath, [entry], {
        cwd: new URL('../../', import.meta.url),
        env: {
          ...process.env,
          HOST: '127.0.0.1',
          PORT: String(port),
          NODE_ENV: 'test',
          LOG_LEVEL: 'info',
          IDENTITY_AUTH_ENABLED: 'false',
          // Explicit unreachable authority: liveness must not need Identity,
          // while configuration requests still fail closed.
          IDENTITY_ORIGIN: 'http://127.0.0.1:9',
          DATABASE_URL: `postgresql://cw_app:${secret}@127.0.0.1:9/cw_${service}?schema=app`,
          OBSERVABILITY_METRICS_TOKEN: token,
          OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: '',
          GATEWAY_UPSTREAMS: JSON.stringify({ identity: 'http://127.0.0.1:9' }),
          IDENTITY_ISSUER: 'https://identity.washgo.invalid',
          IDENTITY_AUDIENCE: 'washgo-web',
          GATEWAY_ALLOWED_ORIGINS: 'https://customer.washgo.invalid',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout.on('data', (chunk) => {
        output += String(chunk);
      });
      child.stderr.on('data', (chunk) => {
        output += String(chunk);
      });
      const exit = new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code, signal) => resolve({ code, signal }));
      });
      const url = `http://127.0.0.1:${port}`;
      try {
        let live;
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline) {
          try {
            live = await fetch(`${url}/health/live`, {
              signal: globalThis.AbortSignal.timeout(1000),
            });
            if (live.ok) break;
          } catch {
            /* The child has not bound its port yet. */
          }
          if (child.exitCode !== null) break;
          await delay(25);
        }
        assert.equal(live?.status, 200, `${service} did not start: ${output}`);
        if (service === 'configuration') {
          const unavailable = await fetch(
            `${url}/internal/v1/configuration/values/booking/hold-ttl?environment=production`,
            { headers: { authorization: `Bearer ${token}` } },
          );
          assert.equal(unavailable.status, 503, 'unreachable Identity must fail closed');
          assert.equal((await unavailable.json()).error.code, 'AUTH_UNAVAILABLE');
        }
        assert.equal((await fetch(`${url}/metrics`)).status, 404);
        const correlation = randomUUID();
        const ready = await fetch(`${url}/health/ready`, {
          headers: { 'x-correlation-id': correlation, cookie: 'private-sentinel-cookie' },
        });
        assert.equal(
          ready.status,
          503,
          'dependency availability must not promote an unimplemented business API',
        );
        assert.equal(ready.headers.get('x-correlation-id'), correlation);
        assert.match(ready.headers.get('traceparent'), /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/);
        const response = await fetch(`${url}/metrics`, {
          headers: { authorization: `Bearer ${token}` },
        });
        assert.equal(response.status, 200);
        const metrics = await response.text();
        assert.match(metrics, /cw_http_requests_total/);
        assert.match(metrics, /cw_service_ready\{[^\n]+\} 0/);
        assert.ok(
          !metrics.includes(secret) && !metrics.includes(token) && !metrics.includes(correlation),
        );
        child.kill('SIGTERM');
        const stopped = await Promise.race([
          exit,
          delay(6000, undefined, { ref: false }).then(() => null),
        ]);
        assert.ok(stopped, 'graceful shutdown exceeded its budget');
        assert.equal(stopped.code, 0, JSON.stringify(stopped));
        assert.ok(
          !output.includes(secret) &&
            !output.includes(token) &&
            !output.includes('private-sentinel-cookie'),
        );
        for (const line of output.split('\n').filter(Boolean))
          assert.doesNotThrow(() => JSON.parse(line), 'all runtime logs must be structured JSON');
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL');
          await exit;
        }
      }
    },
  );
}
