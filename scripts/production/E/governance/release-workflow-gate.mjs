import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** A skipped/cancelled selected path cannot satisfy the release-artifact gate. */
export function requireReleaseWorkflow({ eventName, ref, rehearse, publish }) {
  assert.ok(['pull_request', 'push', 'workflow_dispatch'].includes(eventName), 'Unknown event');
  assert.ok(typeof ref === 'string' && ref.startsWith('refs/'), 'Missing source ref');
  const publication = eventName !== 'pull_request' && ref === 'refs/heads/main';
  const selected = publication ? publish : rehearse;
  const excluded = publication ? rehearse : publish;
  assert.equal(selected, 'success', 'The selected release-artifact path did not succeed');
  assert.equal(excluded, 'skipped', 'An unauthorized artifact publication path was executed');
  return { accepted: true, mode: publication ? 'publication' : 'rehearsal' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = requireReleaseWorkflow({
      eventName: process.env.GITHUB_EVENT_NAME,
      ref: process.env.GITHUB_REF,
      rehearse: process.env.REHEARSAL_RESULT,
      publish: process.env.PUBLISH_RESULT,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
