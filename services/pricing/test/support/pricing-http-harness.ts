import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppExceptionFilter, serviceTokenDigest } from '@carwash/service-kit';
import { PricingService } from '../../src/application';
import type { Clock, PolicyProvider, PricingRepository } from '../../src/ports';
import { IdentitySessionAuthority } from '../../src/infrastructure/identity/identity-session.authority';
import { CatalogV1HttpReader } from '../../src/infrastructure/catalog/catalog-v1-http.reader';
import {
  ServiceClientAuthority,
  pricingServiceClientsFromEnv,
} from '../../src/infrastructure/service/service-client.authority';
import { RandomIds, Sha256Hasher } from '../../src/infrastructure/system/system.adapters';
import { PRICING_SERVICE, PricingController } from '../../src/transport/http/pricing.controller';
import { startCatalogStub, type CatalogStub } from './catalog-stub';
import { startIdentityStub, tokenFor, type IdentityStub } from './identity-stub';
import {
  ADMIN_SUBJECT,
  CUSTOMER_SUBJECT,
  GUEST_SUBJECT,
  OTHER_CUSTOMER_SUBJECT,
} from './pricing-fixtures';

export const TOKENS = {
  admin: tokenFor('admin'),
  legacyAdmin: tokenFor('legacy-admin'),
  customer: tokenFor('customer'),
  otherCustomer: tokenFor('other-customer'),
  guest: tokenFor('guest'),
  noBooking: tokenFor('no-booking'),
  unknown: tokenFor('unknown'),
};

/** TEST-ONLY workload credentials; the service holds only their digests. */
export const SERVICE = {
  booking: { clientId: 'booking', token: 'booking-test-token-0123456789abcdef0123' },
  reporting: { clientId: 'reporting', token: 'reporting-test-token-0123456789abcdef01' },
};

export interface PricingHttpHarness {
  readonly url: string;
  readonly identity: IdentityStub;
  readonly catalog: CatalogStub;
  request(
    method: 'GET' | 'POST',
    path: string,
    options?: {
      token?: string;
      key?: string;
      body?: unknown;
      raw?: string;
      service?: { clientId: string; token: string };
      headers?: Record<string, string>;
    },
  ): Promise<{ status: number; body: Record<string, unknown>; headers: Headers }>;
  close(): Promise<void>;
}

/**
 * Real Nest transport + real PricingService + real Identity, Catalog and
 * service-client adapters over local HTTP stubs. Repository, policy and clock
 * are provided by the caller.
 */
export async function startPricingHttp(input: {
  repository: PricingRepository;
  policy: PolicyProvider;
  clock: Clock;
  catalog?: CatalogStub;
}): Promise<PricingHttpHarness> {
  const identity = await startIdentityStub({
    admin: { subject: ADMIN_SUBJECT, permissions: ['pricing.prices.publish'] },
    // Identity currently issues `pricing.publish`; pricing.v1 requires `pricing.prices.publish`.
    'legacy-admin': { subject: ADMIN_SUBJECT, permissions: ['pricing.publish'] },
    customer: {
      subject: CUSTOMER_SUBJECT,
      permissions: ['profile.read:self', 'bookings.create:self'],
    },
    'other-customer': { subject: OTHER_CUSTOMER_SUBJECT, permissions: ['bookings.create:self'] },
    guest: { subject: GUEST_SUBJECT, kind: 'guest', permissions: ['bookings.create:self'] },
    'no-booking': { subject: OTHER_CUSTOMER_SUBJECT, permissions: ['profile.read:self'] },
  });
  const catalog = input.catalog ?? (await startCatalogStub());
  const clients = pricingServiceClientsFromEnv({
    PRICING_SERVICE_CLIENTS: JSON.stringify([
      {
        id: SERVICE.booking.clientId,
        tokenSha256: serviceTokenDigest(SERVICE.booking.token),
        scopes: ['pricing.quote.validate'],
      },
    ]),
  });
  const service = new PricingService({
    repository: input.repository,
    authority: new IdentitySessionAuthority({ origin: new URL(identity.origin), timeoutMs: 5_000 }),
    services: new ServiceClientAuthority(clients),
    catalog: new CatalogV1HttpReader({ origin: new URL(catalog.origin), timeoutMs: 500 }),
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
  // As bootstrapService does: pre-routing refusals (body parser) use the shared filter.
  app.useGlobalFilters(new AppExceptionFilter());
  await app.listen(0, '127.0.0.1');
  const url = await app.getUrl();
  return {
    url,
    identity,
    catalog,
    async request(method, path, options = {}) {
      const headers: Record<string, string> = { accept: 'application/json', ...options.headers };
      if (options.token) headers.authorization = `Bearer ${options.token}`;
      if (options.key) headers['idempotency-key'] = options.key;
      if (options.service) {
        headers['x-service-client'] = options.service.clientId;
        headers['x-service-token'] = options.service.token;
      }
      const payload =
        options.raw ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined);
      if (payload !== undefined) headers['content-type'] = 'application/json';
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
      await identity.close();
      if (!input.catalog) await catalog.close();
    },
  };
}
