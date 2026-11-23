import assert from 'node:assert/strict';
import test from 'node:test';
import { tmpdir } from 'node:os';
import {
  assertIsolationObservations,
  parseArguments,
} from '../../../scripts/parallel/E/two-stack-acceptance.mjs';
import { describeEnvironment } from '../../../scripts/parallel/E/allocate-environment.mjs';

// These fixtures test rejection policy only. They are never runtime evidence.
function policyFixture() {
  const allocations = ['A', 'B'].map((lane, slot) =>
    describeEnvironment({ lane, slot, wave: 'W01', run: 'policy-fixture', stateRoot: tmpdir() }),
  );
  const markers = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
  const observations = allocations.map((allocation, index) => ({
    project: allocation.composeProject,
    containerId: `fixture-container-${index}`,
    volumeName: `fixture-volume-${index}`,
    serverIdentifier: `fixture-cluster-${index}`,
    hostIp: '127.0.0.1',
    postgresPort: allocation.ports.postgres,
    internalPort: 5432,
    database: 'cw_vehicle',
    role: 'cw_vehicle_app',
    markers: [markers[index]],
    crossCredentialCode: '28P01',
  }));
  return { allocations, markers, observations };
}

test('observation predicate rejects shared cluster/container/volume and contamination', () => {
  assert.doesNotThrow(() => assertIsolationObservations(policyFixture()));
  for (const key of ['containerId', 'volumeName', 'serverIdentifier']) {
    const fixture = policyFixture();
    fixture.observations[1][key] = fixture.observations[0][key];
    assert.throws(() => assertIsolationObservations(fixture), /Shared actual/);
  }
  const contaminated = policyFixture();
  contaminated.observations[0].markers.push(contaminated.markers[1]);
  assert.throws(() => assertIsolationObservations(contaminated), /marker visible/);
  const wrongAuthFailure = policyFixture();
  wrongAuthFailure.observations[0].crossCredentialCode = 'ECONNREFUSED';
  assert.throws(() => assertIsolationObservations(wrongAuthFailure), /Cross-stack credentials/);
});

test('two-stack arguments reject duplicate/overflow slots, traversal IDs and unsafe paths', () => {
  assert.deepEqual(parseArguments(['--slots', '0,1']).slots, [0, 1]);
  for (const slots of ['0,0', '0,256', '1e2,2', '0,-1'])
    assert.throws(() => parseArguments(['--slots', slots]));
  assert.throws(() => parseArguments(['--run', '../escape']), /INVALID_RUN/);
  assert.throws(() => parseArguments(['--state-root', '../relative']), /ABSOLUTE/);
  assert.throws(() => parseArguments(['--evidence-dir', 'relative']), /ABSOLUTE/);
  assert.throws(() => parseArguments(['--run', 'one', '--run', 'two']), /INVALID_ARGUMENTS/);
});
