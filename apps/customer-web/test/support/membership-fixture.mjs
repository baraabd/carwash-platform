import {
  parseCreatePurchaseRequestV1,
  parseRequestSubscriptionChangeV1,
} from '@carwash/contracts/subscription-v1';
import { parseCreateSubscriptionQuoteV1 } from '@carwash/contracts/pricing-v1';
import { ProductionMembership } from '../../src/data/productionMembership.ts';
import {
  id,
  instant,
  later,
  money,
  session as guestSession,
  obligation as bookingObligation,
  response,
  error,
} from './journey-fixture.mjs';

// Transport doubles exercise consumers and exact owner contracts; they are not provider acceptance.
const session = { ...guestSession, principalKind: 'account' };
const principal = { kind: 'account', subjectId: session.subject };
const plan = () => ({
  planId: id(90),
  version: 3,
  status: 'PUBLISHED',
  name: 'عناية شهرية',
  units: 4,
  validityDays: 30,
  price: money('500200'),
  packageIds: [id(20)],
  vehicleTypes: ['sedan'],
  publishedAt: instant,
  contentHash: 'a'.repeat(64),
});
const quote = () => ({
  quoteId: id(92),
  beneficiary: principal,
  status: 'USABLE',
  planId: id(90),
  planVersion: 3,
  planContentHash: 'a'.repeat(64),
  currency: 'SYP',
  total: money('490200'),
  issuedAt: instant,
  expiresAt: later,
});
const purchase = () => ({
  purchaseId: id(93),
  revision: 1,
  status: 'PENDING_PAYMENT',
  beneficiary: principal,
  planId: id(90),
  planVersion: 3,
  quoteId: id(92),
  total: money('490200'),
  paymentMethod: 'SHAM_CASH',
  obligationId: id(70),
  subscriptionId: null,
  createdAt: instant,
  updatedAt: instant,
});
const subscription = () => ({
  subscriptionId: id(94),
  revision: 7,
  status: 'ACTIVE',
  beneficiary: principal,
  planId: id(90),
  planVersion: 2,
  purchaseId: id(93),
  units: { total: 4, reserved: 1, consumed: 0, available: 3 },
  startsAt: instant,
  expiresAt: '2026-12-27T08:00:00.000Z',
  frozenAt: null,
  cancelledAt: null,
  updatedAt: instant,
});
const obligation = () => ({
  ...bookingObligation(),
  quoteId: id(92),
  amount: money('490200'),
  outstanding: money('490200'),
  activeIntent: { ...bookingObligation().activeIntent, amount: money('490200') },
});
const page = (items) => ({ items, nextCursor: null, asOf: instant });

function harness() {
  const requests = [],
    storage = new Map();
  let key = 0;
  const state = {
    now: Date.parse(instant),
    override: null,
    purchase: purchase(),
    subscription: subscription(),
    obligation: obligation(),
    byRequest: new Map(),
  };
  const options = {
    origin: 'https://customer.example',
    now: () => state.now,
    csrf: () => 'csrf-real-client-test',
    newKey: () => `member_request_${String(++key).padStart(10, '0')}`,
    recovery: {
      read: (subject) => storage.get(subject) ?? { pendingKey: null, purchaseId: null },
      write: (subject, value) => storage.set(subject, structuredClone(value)),
    },
    fetch: async (url, init) => {
      const request = {
        path: new URL(url).pathname,
        method: init.method,
        headers: init.headers,
        body: init.body ? JSON.parse(init.body) : null,
        credentials: init.credentials,
      };
      requests.push(request);
      const override = await state.override?.(request);
      if (override) return override;
      if (request.path.endsWith('/subscription-plans')) return response(page([plan()]));
      if (request.path.endsWith('/subscription-quotes')) {
        parseCreateSubscriptionQuoteV1(request.body);
        return response(quote(), 201);
      }
      if (request.path.endsWith('/subscription-purchases') && request.method === 'POST') {
        parseCreatePurchaseRequestV1(request.body);
        state.purchase = { ...state.purchase, paymentMethod: request.body.paymentMethod };
        state.byRequest.set(request.headers['idempotency-key'], structuredClone(state.purchase));
        return response(state.purchase, 201);
      }
      if (request.path.includes('/subscription-purchases/by-request/')) {
        const found = state.byRequest.get(request.path.split('/').at(-1));
        return found ? response(found) : error(404, 'NOT_FOUND');
      }
      if (request.path === `/api/v1/customer/subscription-purchases/${id(93)}`)
        return response(state.purchase);
      if (request.path.endsWith('/subscriptions')) return response(page([state.subscription]));
      if (request.path === `/api/v1/customer/subscriptions/${id(94)}/changes`) {
        parseRequestSubscriptionChangeV1(request.body);
        return response(
          {
            changeId: id(95),
            action: request.body.action,
            status: 'PENDING_REVIEW',
            effectiveAt: null,
            subscription: state.subscription,
          },
          202,
        );
      }
      if (request.path === `/api/v1/customer/payments/${id(70)}`) return response(state.obligation);
      if (request.path.endsWith('/transaction-reference')) {
        state.obligation = {
          ...state.obligation,
          revision: state.obligation.revision + 1,
          financialStatus: 'UNDER_REVIEW',
          activeIntent: { ...state.obligation.activeIntent, status: 'UNDER_REVIEW' },
          attempts: [
            {
              attemptId: id(72),
              intentId: id(71),
              method: 'SHAM_CASH',
              status: 'PENDING_REVIEW',
              reference: `…${request.body.providerReference.slice(-4)}`,
              claimed: money('490200'),
              submittedAt: instant,
              reconciledAt: null,
            },
          ],
        };
        return response(state.obligation, 201);
      }
      throw new Error(`Unexpected membership request ${request.method} ${request.path}`);
    },
  };
  const client = new ProductionMembership(options);
  client.bindSession(session);
  return { client, options, requests, state, storage };
}

export { session, principal, plan, quote, purchase, subscription, obligation, page, harness };
