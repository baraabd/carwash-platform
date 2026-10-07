import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkforceService } from '../src/application/workforce.service';
import { WorkforceError } from '../src/domain';
import type { Actor, WorkforceReadModel, WorkforceUnitOfWork } from '../src/ports';

const subject = '11111111-1111-4111-8111-111111111111';
const operatorId = '22222222-2222-4222-8222-222222222222';
const zoneId = '33333333-3333-4333-8333-333333333333';
const transactionReached = new Error('TEST_TRANSACTION_REACHED');

function authorizationHarness() {
  let transactions = 0;
  const unexpectedRead = async (): Promise<never> => {
    throw new Error('TEST_UNEXPECTED_READ');
  };
  const read: WorkforceReadModel = {
    findOperator: unexpectedRead,
    findOperatorBySubject: unexpectedRead,
    listSkills: unexpectedRead,
    findVerificationCase: unexpectedRead,
    listShifts: unexpectedRead,
    eligibleOperators: unexpectedRead,
  };
  const uow: WorkforceUnitOfWork = {
    async run() {
      transactions += 1;
      throw transactionReached;
    },
  };
  const service = new WorkforceService(
    uow,
    read,
    { now: () => new Date('2026-10-07T10:00:00.000Z') },
    { next: () => subject },
  );
  return { service, transactions: () => transactions };
}

for (const operation of ['create', 'cancel'] as const) {
  async function invoke(service: WorkforceService, actor: Actor) {
    const meta = { actor, correlationId: subject };
    if (operation === 'cancel') return service.cancelShift(meta, operatorId);
    return service.createShift(
      meta,
      operatorId,
      {
        zoneId,
        startsAt: new Date('2026-10-07T11:00:00.000Z'),
        endsAt: new Date('2026-10-07T19:00:00.000Z'),
      },
      'shift-key-0001',
    );
  }

  test(`workforce authorization: read-only services cannot ${operation} shifts`, async () => {
    const harness = authorizationHarness();
    await assert.rejects(
      () =>
        invoke(harness.service, {
          kind: 'SERVICE',
          clientId: 'dispatch',
          scopes: ['workforce.operator.read', 'workforce.eligibility.read'],
        }),
      (error: unknown) => error instanceof WorkforceError && error.code === 'FORBIDDEN',
    );
    assert.equal(harness.transactions(), 0);
  });

  test(`workforce authorization: users without permission cannot ${operation} shifts`, async () => {
    const harness = authorizationHarness();
    await assert.rejects(
      () => invoke(harness.service, { kind: 'USER', subject, permissions: [] }),
      (error: unknown) => error instanceof WorkforceError && error.code === 'FORBIDDEN',
    );
    assert.equal(harness.transactions(), 0);
  });

  test(`workforce authorization: permitted users reach the ${operation} ownership transaction`, async () => {
    const harness = authorizationHarness();
    await assert.rejects(
      () =>
        invoke(harness.service, {
          kind: 'USER',
          subject,
          permissions: ['work.read:assigned'],
        }),
      (error: unknown) => error === transactionReached,
    );
    assert.equal(harness.transactions(), 1);
  });
}
