import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  BillingService,
  CashCustodyService,
  ProviderPaymentsService,
  RefundService,
} from '../../src/application';
import type {
  BillingRepository,
  Clock,
  PaymentProviderRegistry,
  WorkAuthority,
} from '../../src/ports';
import { productionProviderRegistry } from '../../src/infrastructure/providers/merchant-providers';
import { IdentitySessionAuthority } from '../../src/infrastructure/identity/identity-session.authority';
import { PricingQuoteReader } from '../../src/infrastructure/pricing/pricing-quote.reader';
import { RandomIds, Sha256Hasher } from '../../src/infrastructure/system/system.adapters';
import { UnpublishedWorkAuthority } from '../../src/infrastructure/work/unpublished-work.authority';
import { BILLING_SERVICE, BillingController } from '../../src/transport/http/billing.controller';
import {
  CASH_CUSTODY_SERVICE,
  CustodyController,
} from '../../src/transport/http/custody.controller';
import {
  PROVIDER_PAYMENTS_SERVICE,
  ProviderController,
  REFUND_SERVICE,
} from '../../src/transport/http/provider.controller';
import { tokenFor, type PricingStub, type Stub } from './upstream-stubs';

export const SUBJECTS = {
  customer: '6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f',
  guest: '7a2b3c4d-5e6f-4a7b-9c8d-1e2f3a4b5c6d',
  otherCustomer: '8b3c4d5e-6f7a-4b8c-ad9e-2f3a4b5c6d7e',
  finance: '9c4d5e6f-7a8b-4c9d-be0f-3a4b5c6d7e8f',
  reconciler: 'ad5e6f7a-8b9c-4dae-8f1a-4b5c6d7e8f9a',
  technician: 'be6f7a8b-9c0d-4ebf-9a2b-5c6d7e8f9a0b',
  otherTechnician: 'cf7a8b9c-0d1e-4fc0-8b3c-6d7e8f9a0b1c',
  treasury: 'd08b9c0d-1e2f-4ad1-9c4d-7e8f9a0b1c2d',
  corrector: 'e19c0d1e-2f3a-4be2-8d5e-8f9a0b1c2d3e',
  approver: 'f2ad1e2f-3a4b-4cf3-9e6f-9a0b1c2d3e4f',
  refunder: '03be2f3a-4b5c-4d04-8f7a-0b1c2d3e4f5a',
  refundApprover: '14cf3a4b-5c6d-4e15-9a8b-1c2d3e4f5a6b',
} as const;

export const TOKENS = {
  customer: tokenFor('customer'),
  guest: tokenFor('guest'),
  otherCustomer: tokenFor('other-customer'),
  finance: tokenFor('finance'),
  reconciler: tokenFor('reconciler'),
  /** Holds billing.reconcile AND owns obligations: separation-of-duty check. */
  selfReconciler: tokenFor('self-reconciler'),
  technician: tokenFor('technician'),
  otherTechnician: tokenFor('other-technician'),
  /** Holds the collect grant but is a guest session: never a cash holder. */
  guestCollector: tokenFor('guest-collector'),
  treasury: tokenFor('treasury'),
  /** Treasury receiver who also holds billing.reconcile (separation-of-duty check). */
  treasuryReconciler: tokenFor('treasury-reconciler'),
  corrector: tokenFor('corrector'),
  /** A technician who also holds the correction grant (cannot reverse own receipt). */
  selfCorrector: tokenFor('self-corrector'),
  /** A second reconciler: approves statement credits recorded by `reconciler`. */
  approver: tokenFor('approver'),
  refunder: tokenFor('refunder'),
  refundApprover: tokenFor('refund-approver'),
  /** Holds billing.refund AND owns obligations: cannot refund their own payment. */
  selfRefunder: tokenFor('self-refunder'),
  /** A guest session holding the refund grant: money decisions need an account. */
  guestRefunder: tokenFor('guest-refunder'),
  unknown: tokenFor('unknown'),
};

const COLLECTOR = ['work.read:assigned', 'work.execute:assigned', 'billing.cash.collect'];

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
  technician: { subject: SUBJECTS.technician, kind: 'account', permissions: COLLECTOR },
  'other-technician': {
    subject: SUBJECTS.otherTechnician,
    kind: 'account',
    permissions: COLLECTOR,
  },
  'guest-collector': { subject: SUBJECTS.guest, kind: 'guest', permissions: COLLECTOR },
  treasury: {
    subject: SUBJECTS.treasury,
    kind: 'account',
    permissions: ['billing.read', 'billing.treasury.receive'],
  },
  'treasury-reconciler': {
    subject: SUBJECTS.treasury,
    kind: 'account',
    permissions: ['billing.read', 'billing.treasury.receive', 'billing.reconcile'],
  },
  corrector: {
    subject: SUBJECTS.corrector,
    kind: 'account',
    permissions: ['billing.read', 'billing.cash.correct'],
  },
  'self-corrector': {
    subject: SUBJECTS.technician,
    kind: 'account',
    permissions: [...COLLECTOR, 'billing.cash.correct'],
  },
  approver: {
    subject: SUBJECTS.approver,
    kind: 'account',
    permissions: ['billing.read', 'billing.reconcile'],
  },
  refunder: {
    subject: SUBJECTS.refunder,
    kind: 'account',
    permissions: ['billing.read', 'billing.refund'],
  },
  'refund-approver': {
    subject: SUBJECTS.refundApprover,
    kind: 'account',
    permissions: ['billing.read', 'billing.refund'],
  },
  'self-refunder': {
    subject: SUBJECTS.customer,
    kind: 'account',
    permissions: [...CUSTOMER, 'billing.read', 'billing.refund'],
  },
  'guest-refunder': {
    subject: SUBJECTS.guest,
    kind: 'guest',
    permissions: ['billing.read', 'billing.refund'],
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
    options?: {
      token?: string;
      key?: string;
      body?: unknown;
      correlationId?: string;
      /** Sent byte-for-byte instead of a JSON-serialised body (provider notifications). */
      raw?: string;
      headers?: Record<string, string>;
    },
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
  /** Work-owner double; defaults to the fail-closed production adapter. */
  work?: WorkAuthority;
  /** Provider registry; defaults to the production (documentation-pending) adapters. */
  providers?: PaymentProviderRegistry;
}): Promise<BillingHttpHarness> {
  const authority = new IdentitySessionAuthority({
    origin: new URL(input.identity.origin),
    timeoutMs: 1_000,
  });
  const custody = new CashCustodyService({
    repository: input.repository,
    authority,
    work: input.work ?? new UnpublishedWorkAuthority(),
    clock: input.clock,
    ids: new RandomIds(),
    hasher: new Sha256Hasher(),
  });
  const service = new BillingService({
    repository: input.repository,
    authority,
    quotes: new PricingQuoteReader({ origin: new URL(input.pricing.origin), timeoutMs: 1_000 }),
    clock: input.clock,
    ids: new RandomIds(),
    hasher: new Sha256Hasher(),
  });
  const providers = input.providers ?? productionProviderRegistry({});
  const payments = new ProviderPaymentsService({
    repository: input.repository,
    authority,
    providers,
    clock: input.clock,
    ids: new RandomIds(),
    hasher: new Sha256Hasher(),
  });
  const refunds = new RefundService({
    repository: input.repository,
    authority,
    providers,
    clock: input.clock,
    ids: new RandomIds(),
    hasher: new Sha256Hasher(),
  });
  const moduleRef = await Test.createTestingModule({
    controllers: [BillingController, CustodyController, ProviderController],
    providers: [
      { provide: BILLING_SERVICE, useValue: service },
      { provide: CASH_CUSTODY_SERVICE, useValue: custody },
      { provide: PROVIDER_PAYMENTS_SERVICE, useValue: payments },
      { provide: REFUND_SERVICE, useValue: refunds },
    ],
  }).compile();
  // Same transport options as createHttpApplication (raw notification bytes).
  const app: INestApplication = moduleRef.createNestApplication({ logger: false, rawBody: true });
  await app.listen(0, '127.0.0.1');
  const url = await app.getUrl();
  return {
    url,
    async request(method, path, options = {}) {
      const headers: Record<string, string> = { accept: 'application/json' };
      if (options.token) headers.authorization = `Bearer ${options.token}`;
      if (options.key) headers['idempotency-key'] = options.key;
      if (options.correlationId) headers['x-correlation-id'] = options.correlationId;
      if (options.body !== undefined || options.raw !== undefined)
        headers['content-type'] = 'application/json';
      Object.assign(headers, options.headers ?? {});
      const payload =
        options.raw !== undefined
          ? options.raw
          : options.body !== undefined
            ? JSON.stringify(options.body)
            : undefined;
      const response = await fetch(url + path, {
        method,
        headers,
        ...(payload !== undefined ? { body: payload } : {}),
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
