import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { serviceTokenDigest } from '@carwash/service-kit';
import { Money } from '../src/domain';
import type { BillingRepository, BillingUnitOfWork, ObligationRecord } from '../src/ports';
import { SubscriptionFundingService } from '../src/application/subscription-funding.service';
import { ServiceClientCallerAuthority } from '../src/infrastructure/security/service-callers';
import {
  SUBSCRIPTION_FUNDING_SERVICE,
  SubscriptionFundingController,
} from '../src/transport/http/subscription-funding.controller';

const token = 'test-subscription-funding-token-1234567890';
const caller = new ServiceClientCallerAuthority(
  JSON.stringify([
    {
      id: 'subscription',
      tokenSha256: serviceTokenDigest(token),
      scopes: ['billing.subscription-funding.read'],
    },
    {
      id: 'booking',
      tokenSha256: serviceTokenDigest(token + '-booking'),
      scopes: ['billing.obligation.write'],
    },
  ]),
);
const context = {
  clientId: 'subscription',
  token,
  bearerPresent: false,
  correlationId: randomUUID(),
};
const amount = Money.of('SYP', 600000n);

function fixture() {
  const obligation: ObligationRecord = {
    id: randomUUID(),
    owner: { kind: 'account', subjectId: randomUUID() },
    quoteId: randomUUID(),
    amount,
    verified: amount,
    status: 'SETTLED',
    revision: 4,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const state = {
    obligation,
    credit: { id: randomUUID(), status: 'ALLOCATED', obligationId: obligation.id, amount },
    refund: Money.zero('SYP'),
    booking: false,
    absent: false,
    accesses: 0,
  };
  // Boundary fixture only. Durable allocation and refund locking are separately
  // exercised with the real Prisma repository in the PostgreSQL acceptance suite.
  const repository = {
    providers: {
      allocatedCreditForObligation: () => {
        state.accesses++;
        return Promise.resolve(state.absent ? null : state.credit);
      },
    },
    transaction: async <T>(work: (uow: BillingUnitOfWork) => Promise<T>) =>
      work({
        lockObligation: () => Promise.resolve(state.obligation),
        providers: {
          lockCredit: () => Promise.resolve(state.credit),
          reservedForRefund: () => Promise.resolve(state.refund),
        },
        bookings: {
          forObligation: () => Promise.resolve(state.booking ? { bookingId: randomUUID() } : null),
        },
      } as unknown as BillingUnitOfWork),
  } as unknown as BillingRepository;
  return {
    state,
    service: new SubscriptionFundingService({ repository, callers: caller }),
    body: { obligationId: obligation.id, beneficiary: obligation.owner, amount: amount.toWire() },
  };
}

test('subscription funding proves exact, settled, unrefunded, account-owned non-booking credit', async () => {
  const h = fixture();
  const proof = await h.service.verify(context, h.body);
  assert.deepEqual(proof, {
    verified: true,
    obligationId: h.body.obligationId,
    revision: 4,
    beneficiary: h.body.beneficiary,
    amount: amount.toWire(),
    quoteId: h.state.obligation.quoteId,
  });
  for (const mutate of [
    () => {
      h.state.booking = true;
    },
    () => {
      h.state.refund = Money.of('SYP', 1n);
    },
    () => {
      h.state.credit.amount = Money.of('SYP', 600001n);
    },
    () => {
      h.state.credit.status = 'CONFIRMED_UNALLOCATED';
    },
    () => {
      h.state.obligation = {
        ...h.state.obligation,
        owner: { ...h.state.obligation.owner, subjectId: randomUUID() },
      };
    },
    () => {
      h.state.obligation = { ...h.state.obligation, status: 'OPEN' };
    },
    () => {
      h.state.obligation = { ...h.state.obligation, verified: Money.zero('SYP') };
    },
    () => {
      h.state.absent = true;
    },
  ]) {
    const baseline = fixture();
    Object.assign(h.state, baseline.state);
    Object.assign(h.body, baseline.body);
    mutate();
    assert.deepEqual(await h.service.verify(context, h.body), {
      verified: false,
      reason: 'PAYMENT_NOT_VERIFIED',
    });
  }
});

test('funding rejects bearer/session mixing and wrong workload scope before touching persistence', async () => {
  const h = fixture();
  for (const auth of [
    { ...context, bearerPresent: true },
    { ...context, clientId: 'booking', token: token + '-booking' },
    { ...context, token: 'wrong' },
  ]) {
    await assert.rejects(h.service.verify(auth, h.body));
  }
  assert.equal(h.state.accesses, 0);
  await assert.rejects(
    h.service.verify(context, { ...h.body, amount: { ...h.body.amount, scale: 0 } }),
  );
  await assert.rejects(
    h.service.verify(context, { ...h.body, beneficiary: { ...h.body.beneficiary, kind: 'guest' } }),
  );
  assert.equal(h.state.accesses, 0);
});

test('funding transport returns the contracted HTTP 200 and never accepts a user credential', async () => {
  const h = fixture();
  const module = await Test.createTestingModule({
    controllers: [SubscriptionFundingController],
    providers: [{ provide: SUBSCRIPTION_FUNDING_SERVICE, useValue: h.service }],
  }).compile();
  const app = module.createNestApplication({ logger: false });
  await app.listen(0, '127.0.0.1');
  try {
    const url = `${await app.getUrl()}/internal/v1/billing/subscription-funding/verify`;
    const headers = {
      'content-type': 'application/json',
      'x-service-client': context.clientId,
      'x-service-token': token,
    };
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(h.body) });
    assert.equal(response.status, 200);
    assert.equal(((await response.json()) as { verified: boolean }).verified, true);
    const mixed = await fetch(url, {
      method: 'POST',
      headers: { ...headers, authorization: `Bearer ${token}` },
      body: JSON.stringify(h.body),
    });
    assert.equal(mixed.status, 403);
  } finally {
    await app.close();
  }
});
