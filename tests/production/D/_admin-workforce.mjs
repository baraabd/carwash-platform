/** Real Workforce fixture commands shared by Admin HTTP and browser acceptance. */
/* global AbortSignal -- Node 24 web API */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { bearer } from './_identity.mjs';

export async function workforceCommand(
  origin,
  principal,
  route,
  { method = 'GET', body, key } = {},
) {
  const response = await fetch(`${origin}/internal/v1/workforce${route}`, {
    method,
    headers: {
      authorization: bearer(principal),
      'x-correlation-id': randomUUID(),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(key ? { 'idempotency-key': key } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10_000),
  });
  return { status: response.status, body: await response.json() };
}

export async function pendingWorkforceCase({ origin, operations, technician, zoneId }) {
  const created = await workforceCommand(origin, operations, '/operators', {
    method: 'POST',
    body: {
      identitySubject: technician.subject,
      displayName: 'Admin acceptance technician',
      homeZoneId: zoneId,
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const submitted = await workforceCommand(origin, technician, '/me/verification-cases', {
    method: 'POST',
    key: randomUUID(),
    body: { evidenceRefs: [randomUUID()] },
  });
  assert.equal(submitted.status, 201, JSON.stringify(submitted.body));
  return { operatorId: created.body.operatorId, caseId: submitted.body.caseId };
}

/** Workforce, not Dispatch or a test stub, decides eligibility for this resource. */
export async function eligibleWorkforceResource({
  origin,
  operations,
  reviewer,
  technician,
  zoneId,
  startsAt,
  endsAt,
}) {
  const record = await pendingWorkforceCase({ origin, operations, technician, zoneId });
  const reviewed = await workforceCommand(origin, reviewer, `/${record.caseId}/review`, {
    method: 'POST',
    body: {
      decision: 'APPROVE',
      validUntil: new Date(Date.now() + 300 * 86_400_000).toISOString(),
    },
  });
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed.body));
  assert.equal(reviewed.body.status, 'APPROVED');
  const skill = await workforceCommand(
    origin,
    operations,
    `/operators/${record.operatorId}/skills`,
    {
      method: 'POST',
      body: { skillCode: 'exterior-wash' },
    },
  );
  assert.equal(skill.status, 201, JSON.stringify(skill.body));
  const area = await workforceCommand(
    origin,
    operations,
    `/operators/${record.operatorId}/service-area`,
    {
      method: 'PUT',
      body: { expectedRevision: 0, zoneIds: [zoneId] },
    },
  );
  assert.equal(area.status, 200, JSON.stringify(area.body));
  const shift = await workforceCommand(
    origin,
    technician,
    `/operators/${record.operatorId}/shifts`,
    {
      method: 'POST',
      key: randomUUID(),
      body: { zoneId, startsAt, endsAt },
    },
  );
  assert.equal(shift.status, 201, JSON.stringify(shift.body));
  return record.operatorId;
}
