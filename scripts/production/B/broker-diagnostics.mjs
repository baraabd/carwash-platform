import assert from 'node:assert/strict';

const STATE_TEMPLATE =
  '{"id":{{json .Id}},"owner":{{json (index .Config.Labels "carwash.business-acceptance.run")}},"state":{{json .State}}}';

/** Inspect only a named, owned acceptance container; never read Config.Env. */
export async function ownedBrokerContainer(docker, name, owner) {
  assert.match(name, /^cw-p05b-(wallet|reporting)-(pg|mq)-[a-f0-9]{12}$/);
  assert.equal(typeof owner, 'string');
  assert.ok(owner.length > 0);
  const result = await docker(['inspect', '--format', STATE_TEMPLATE, name]);
  if (result.code !== 0 || result.signal || result.outcome !== 'exited')
    throw new Error(`Cannot inspect owned acceptance container ${name}`);
  const value = JSON.parse(result.stdout);
  assert.match(value.id, /^[a-f0-9]{64}$/);
  assert.equal(value.owner, owner, 'Acceptance container ownership mismatch');
  assert.equal(typeof value.state?.Status, 'string');
  return {
    id: value.id,
    name,
    state: {
      status: value.state.Status,
      running: value.state.Running === true,
      restarting: value.state.Restarting === true,
      oomKilled: value.state.OOMKilled === true,
      dead: value.state.Dead === true,
      exitCode: value.state.ExitCode,
      error: value.state.Error,
      startedAt: value.state.StartedAt,
      finishedAt: value.state.FinishedAt,
    },
  };
}

export function assertBrokerContainerNotExited(container) {
  if (!['exited', 'dead'].includes(container.state.status)) return;
  const error = new Error(
    `Acceptance container ${container.name} exited before readiness ` +
      `(exit=${container.state.exitCode}, oom=${container.state.oomKilled})`,
  );
  error.code = 'ACCEPTANCE_CONTAINER_EXITED';
  throw error;
}

/** Bounded, redacted startup evidence captured before this run removes its containers. */
export async function brokerContainerDiagnostics(docker, name, owner, redact) {
  const container = await ownedBrokerContainer(docker, name, owner);
  // Pin the inspected container id so a reused name cannot redirect the log read.
  const result = await docker(['logs', '--tail', '120', container.id]);
  const heading = redact(
    `Owned acceptance container ${name}\n${JSON.stringify(container.state)}`,
  ).slice(0, 2000);
  const logs = redact(`${result.stdout}\n${result.stderr}`).slice(-13999);
  return `${heading}\n${logs}`;
}
