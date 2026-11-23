import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { serviceTokenDigest } from '@carwash/service-kit';
import { EntitlementService, SubscriptionService } from '../../src/application';
import type { Clock, SubscriptionRepository } from '../../src/ports';
import { IdentitySessionAuthority } from '../../src/infrastructure/identity/identity-session.authority';
import { ConfiguredServiceCallers } from '../../src/infrastructure/security/service-callers';
import { RandomIds, Sha256Hasher } from '../../src/infrastructure/system/system.adapters';
import {
  ENTITLEMENT_SERVICE,
  SUBSCRIPTION_SERVICE,
  SubscriptionController,
} from '../../src/transport/http/subscription.controller';
import { startIdentityStub, tokenFor, type IdentityStub } from './identity-stub';
import {
  ADMIN_SUBJECT,
  BOOKING_TOKEN,
  CUSTOMER_SUBJECT,
  DISPATCH_TOKEN,
  GUEST_SUBJECT,
  OTHER_CUSTOMER_SUBJECT,
  READER_SUBJECT,
  SECOND_ADMIN_SUBJECT,
} from './subscription-fixtures';

export const TOKENS = {
  admin: tokenFor('admin'),
  secondAdmin: tokenFor('second-admin'),
  customer: tokenFor('customer'),
  otherCustomer: tokenFor('other-customer'),
  guest: tokenFor('guest'),
  reader: tokenFor('reader'),
  unknown: tokenFor('unknown'),
};

/** Booking may reserve and settle; Dispatch is configured but only with the settle scope. */
export function serviceClientsConfig(): string {
  return JSON.stringify([
    {
      id: 'booking',
      tokenSha256: serviceTokenDigest(BOOKING_TOKEN),
      scopes: ['subscription.entitlement.reserve', 'subscription.entitlement.settle'],
    },
    {
      id: 'dispatch',
      tokenSha256: serviceTokenDigest(DISPATCH_TOKEN),
      scopes: ['subscription.entitlement.settle'],
    },
  ]);
}

export interface RequestOptions {
  readonly token?: string;
  readonly key?: string;
  readonly body?: unknown;
  readonly service?: { readonly client: string; readonly token: string };
}

export interface SubscriptionHttpHarness {
  readonly url: string;
  readonly identity: IdentityStub;
  request(
    method: 'GET' | 'POST',
    path: string,
    options?: RequestOptions,
  ): Promise<{ status: number; body: Record<string, unknown>; headers: Headers }>;
  close(): Promise<void>;
}

export const BOOKING = { client: 'booking', token: BOOKING_TOKEN };
export const DISPATCH = { client: 'dispatch', token: DISPATCH_TOKEN };

/**
 * Opt-in diagnosis for failing runs (SUBSCRIPTION_TEST_TRACE=1): logs the raw
 * message of any repository failure to stderr. Test-only; the service itself
 * never logs exception text.
 */
function traced(repository: SubscriptionRepository): SubscriptionRepository {
  if (process.env.SUBSCRIPTION_TEST_TRACE !== '1') return repository;
  return new Proxy(repository, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver);
      if (typeof value !== 'function') return value;
      return async (...args: unknown[]) => {
        try {
          return await (value as (...a: unknown[]) => Promise<unknown>).apply(target, args);
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          process.stderr.write(`[trace] ${String(property)}: ${message}\n`);
          throw error;
        }
      };
    },
  });
}

/**
 * Real Nest transport + real services + real Identity adapter over HTTP + real
 * service-credential adapter. Repository and clock are provided by the caller.
 */
export async function startSubscriptionHttp(input: {
  repository: SubscriptionRepository;
  clock: Clock;
}): Promise<SubscriptionHttpHarness> {
  const identity = await startIdentityStub({
    admin: { subject: ADMIN_SUBJECT, permissions: ['subscription.manage', 'bookings.create:self'] },
    'second-admin': { subject: SECOND_ADMIN_SUBJECT, permissions: ['subscription.manage'] },
    customer: {
      subject: CUSTOMER_SUBJECT,
      permissions: ['profile.read:self', 'bookings.create:self'],
    },
    'other-customer': { subject: OTHER_CUSTOMER_SUBJECT, permissions: ['bookings.create:self'] },
    guest: {
      subject: GUEST_SUBJECT,
      permissions: ['bookings.create:self'],
      principalKind: 'guest',
    },
    reader: { subject: READER_SUBJECT, permissions: ['billing.read'] },
  });
  // The production maximum: a loaded CI host must not turn a slow stub into a 503.
  const authority = new IdentitySessionAuthority({
    origin: new URL(identity.origin),
    timeoutMs: 10_000,
  });
  const common = {
    repository: traced(input.repository),
    authority,
    clock: input.clock,
    ids: new RandomIds(),
    hasher: new Sha256Hasher(),
  };
  const subscriptions = new SubscriptionService(common);
  const entitlements = new EntitlementService({
    ...common,
    callers: new ConfiguredServiceCallers(serviceClientsConfig()),
  });
  const moduleRef = await Test.createTestingModule({
    controllers: [SubscriptionController],
    providers: [
      { provide: SUBSCRIPTION_SERVICE, useValue: subscriptions },
      { provide: ENTITLEMENT_SERVICE, useValue: entitlements },
    ],
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
      if (options.service) {
        headers['x-service-client'] = options.service.client;
        headers['x-service-token'] = options.service.token;
      }
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
