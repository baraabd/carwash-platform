import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { BillingService } from '../../src/application';
import type { BillingRepository, Clock } from '../../src/ports';
import { IdentitySessionAuthority } from '../../src/infrastructure/identity/identity-session.authority';
import { PricingQuoteReader } from '../../src/infrastructure/pricing/pricing-quote.reader';
import { RandomIds, Sha256Hasher } from '../../src/infrastructure/system/system.adapters';
import { BILLING_SERVICE, BillingController } from '../../src/transport/http/billing.controller';
import { tokenFor, type PricingStub, type Stub } from './upstream-stubs';

export const SUBJECTS = {
  customer: '6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f',
  guest: '7a2b3c4d-5e6f-4a7b-9c8d-1e2f3a4b5c6d',
  otherCustomer: '8b3c4d5e-6f7a-4b8c-ad9e-2f3a4b5c6d7e',
  finance: '9c4d5e6f-7a8b-4c9d-be0f-3a4b5c6d7e8f',
  reconciler: 'ad5e6f7a-8b9c-4dae-8f1a-4b5c6d7e8f9a',
} as const;

export const TOKENS = {
  customer: tokenFor('customer'),
  guest: tokenFor('guest'),
  otherCustomer: tokenFor('other-customer'),
  finance: tokenFor('finance'),
  reconciler: tokenFor('reconciler'),
  /** Holds billing.reconcile AND owns obligations: separation-of-duty check. */
  selfReconciler: tokenFor('self-reconciler'),
  unknown: tokenFor('unknown'),
};

const CUSTOMER = ['profile.read:self', 'bookings.read:self', 'bookings.create:self'];

export const SESSIONS = {
  customer: { subject: SUBJECTS.customer, kind: 'account', permissions: CUSTOMER },
  guest: {
    subject: SUBJECTS.guest,
    kind: 'guest',
    permissions: ['bookings.read:self', 'bookings.create:self'],
  },
  'other-customer': { subject: SUBJECTS.otherCustomer, kind: 'account', permissions: CUSTOMER },
  finance: { subject: SUBJECTS.finance, kind: 'account', permissions: ['billing.read'] },
  reconciler: {
    subject: SUBJECTS.reconciler,
    kind: 'account',
    permissions: ['billing.read', 'billing.reconcile'],
  },
  'self-reconciler': {
    subject: SUBJECTS.customer,
    kind: 'account',
    permissions: [...CUSTOMER, 'billing.reconcile'],
  },
} as const;

export class FixedClock implements Clock {
  constructor(private current: Date) {}
  now(): Date {
    return new Date(this.current.getTime());
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export interface HttpReply {
  status: number;
  body: Record<string, unknown>;
  headers: Headers;
}

export interface BillingHttpHarness {
  readonly url: string;
  request(
    method: 'GET' | 'POST',
    path: string,
    options?: { token?: string; key?: string; body?: unknown; correlationId?: string },
  ): Promise<HttpReply>;
  close(): Promise<void>;
}

/**
 * Real Nest transport + real BillingService + real Identity/Pricing adapters
 * over HTTP. The repository and clock are provided by the caller; the upstream
 * stubs are shared between replicas.
 */
export async function startBillingHttp(input: {
  repository: BillingRepository;
  clock: Clock;
  identity: Stub;
  pricing: PricingStub;
}): Promise<BillingHttpHarness> {
  const service = new BillingService({
    repository: input.repository,
    authority: new IdentitySessionAuthority({
      origin: new URL(input.identity.origin),
      timeoutMs: 1_000,
    }),
    quotes: new PricingQuoteReader({ origin: new URL(input.pricing.origin), timeoutMs: 1_000 }),
    clock: input.clock,
    ids: new RandomIds(),
    hasher: new Sha256Hasher(),
  });
  const moduleRef = await Test.createTestingModule({
    controllers: [BillingController],
    providers: [{ provide: BILLING_SERVICE, useValue: service }],
  }).compile();
  const app: INestApplication = moduleRef.createNestApplication({ logger: false });
  await app.listen(0, '127.0.0.1');
  const url = await app.getUrl();
  return {
    url,
    async request(method, path, options = {}) {
      const headers: Record<string, string> = { accept: 'application/json' };
      if (options.token) headers.authorization = `Bearer ${options.token}`;
      if (options.key) headers['idempotency-key'] = options.key;
      if (options.correlationId) headers['x-correlation-id'] = options.correlationId;
      if (options.body !== undefined) headers['content-type'] = 'application/json';
      const response = await fetch(url + path, {
        method,
        headers,
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      });
      const text = await response.text();
      return {
        status: response.status,
        body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
        headers: response.headers,
      };
    },
    async close() {
      await app.close();
    },
  };
}