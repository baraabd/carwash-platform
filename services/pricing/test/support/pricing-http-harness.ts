import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PricingService } from '../../src/application';
import type { Clock, PolicyProvider, PricingRepository } from '../../src/ports';
import { IdentitySessionAuthority } from '../../src/infrastructure/identity/identity-session.authority';
import { RandomIds, Sha256Hasher } from '../../src/infrastructure/system/system.adapters';
import { PRICING_SERVICE, PricingController } from '../../src/transport/http/pricing.controller';
import { startIdentityStub, tokenFor, type IdentityStub } from './identity-stub';
import {
  ADMIN_SUBJECT,
  CUSTOMER_SUBJECT,
  type FakeCatalogReader,
  OTHER_CUSTOMER_SUBJECT,
} from './pricing-fixtures';

export const TOKENS = {
  admin: tokenFor('admin'),
  customer: tokenFor('customer'),
  otherCustomer: tokenFor('other-customer'),
  unknown: tokenFor('unknown'),
};

export interface PricingHttpHarness {
  readonly url: string;
  readonly identity: IdentityStub;
  request(
    method: 'GET' | 'POST',
    path: string,
    options?: { token?: string; key?: string; body?: unknown },
  ): Promise<{ status: number; body: Record<string, unknown>; headers: Headers }>;
  close(): Promise<void>;
}

/**
 * Real Nest transport + real PricingService + real Identity adapter over HTTP.
 * Repository, catalog reader, policy and clock are provided by the caller.
 */
export async function startPricingHttp(input: {
  repository: PricingRepository;
  catalog: FakeCatalogReader;
  policy: PolicyProvider;
  clock: Clock;
}): Promise<PricingHttpHarness> {
  const identity = await startIdentityStub({
    admin: { subject: ADMIN_SUBJECT, permissions: ['pricing.publish'] },
    customer: {
      subject: CUSTOMER_SUBJECT,
      permissions: ['profile.read:self', 'bookings.create:self'],
    },
    'other-customer': { subject: OTHER_CUSTOMER_SUBJECT, permissions: ['bookings.create:self'] },
  });
  const service = new PricingService({
    repository: input.repository,
    authority: new IdentitySessionAuthority({ origin: new URL(identity.origin), timeoutMs: 1_000 }),
    catalog: input.catalog,
    policy: input.policy,
    clock: input.clock,
    ids: new RandomIds(),
    hasher: new Sha256Hasher(),
  });
  const moduleRef = await Test.createTestingModule({
    controllers: [PricingController],
    providers: [{ provide: PRICING_SERVICE, useValue: service }],
  }).compile();
  const app: INestApplication = moduleRef.createNestApplication({ logger: false });
  await app.listen(0, '127.0.0.1');
  const url = await app.getUrl();
  return {
    url,
    identity,
    async request(method, path, options = {}) {
      const headers: Record<string, string> = { accept: 'application/json' };
      if (options.token) headers.authorization = `Bearer ${options.token}`;
      if (options.key) headers['idempotency-key'] = options.key;
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
      await identity.close();
    },
  };
}
