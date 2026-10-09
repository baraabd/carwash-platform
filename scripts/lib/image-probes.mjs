/** Shell-free probes: output alone can never turn a failed Docker exec green. */
export function identityBootEnvironment(service) {
  // Image harnesses boot with closed loopback dependencies: startup can be
  // tested, but authentication/storage/database calls cannot pass.
  if (service === 'configuration') return ['--env', 'IDENTITY_ORIGIN=http://127.0.0.1:9'];
  if (service === 'media')
    return [
      '--env',
      'IDENTITY_URL=http://127.0.0.1:9',
      '--env',
      'MEDIA_S3_ENDPOINT=http://127.0.0.1:9',
      '--env',
      'MEDIA_S3_REGION=us-east-1',
      '--env',
      'MEDIA_S3_BUCKET=washgo-media-test',
      '--env',
      'MEDIA_S3_ACCESS_KEY_ID=mediatestkey',
      '--env',
      'MEDIA_S3_SECRET_ACCESS_KEY=media-test-secret',
    ];
  return [];
}

export const BAKED_SECRET_PROBE =
  "const fs=require('node:fs');const names=fs.readdirSync('/app');" +
  "const found=names.filter(n=>n.startsWith('.env')||n==='.acceptance'||n==='.git');" +
  'process.stdout.write(JSON.stringify(found));if(found.length)process.exitCode=1;';
export function verifiedNonRoot(result) {
  const uid = result.stdout?.trim();
  return result.code === 0 && /^[1-9][0-9]*$/.test(uid ?? '') && Number.isSafeInteger(Number(uid));
}
export function verifiedNoBakedSecrets(result) {
  return result.code === 0 && result.stdout?.trim() === '[]';
}

/**
 * Parses "<status> <json>" from the in-container readiness probe. With the
 * database deliberately unreachable, readiness must be 503 with
 * dependenciesReady=false, and the code must match businessReady: an
 * implemented service says DEPENDENCY_DOWN, a foundation shell says
 * FOUNDATION_NOT_READY. A 200 is always a failure here.
 */
export function verifiedReadiness(raw) {
  const text = String(raw ?? '');
  const space = text.indexOf(' ');
  const status = space > 0 ? text.slice(0, space) : text;
  let body;
  try {
    body = JSON.parse(text.slice(space + 1));
  } catch {
    return { ok: false, detail: `unparseable readiness body: ${text.slice(0, 200)}` };
  }
  if (body === null || typeof body !== 'object' || typeof body.businessReady !== 'boolean') {
    return { ok: false, detail: `readiness body lacks businessReady: ${text.slice(0, 200)}` };
  }
  const expected = body.businessReady ? 'DEPENDENCY_DOWN' : 'FOUNDATION_NOT_READY';
  // An implemented service must probe its database, so it must report false here.
  // A shell may register no probe (null = not checked, empty list); never true.
  const dependencyHonest = body.businessReady
    ? body.dependenciesReady === false
    : body.dependenciesReady === false ||
      (body.dependenciesReady === null &&
        Array.isArray(body.dependencies) &&
        body.dependencies.length === 0);
  const ok = status === '503' && body.ready === false && dependencyHonest && body.code === expected;
  return ok
    ? {
        ok,
        detail: `code=${body.code} businessReady=${body.businessReady} dependenciesReady=${body.dependenciesReady}`,
      }
    : {
        ok,
        detail: `expected 503/${expected} with honest dependenciesReady, got: ${text.slice(0, 300)}`,
      };
}
