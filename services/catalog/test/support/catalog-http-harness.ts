import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CatalogService } from '../../src/application';
import type { CatalogRepository, Clock } from '../../src/ports';
import { IdentitySessionAuthority } from '../../src/infrastructure/identity/identity-session.authority';
import { RandomIds, Sha256Hasher } from '../../src/infrastructure/system/system.adapters';
import { CATALOG_SERVICE, CatalogController } from '../../src/transport/http/catalog.controller';
import { startIdentityStub, tokenFor, type IdentityStub } from './identity-stub';
import { ADMIN_SUBJECT, CUSTOMER_SUBJECT, OTHER_ADMIN_SUBJECT } from './catalog-fixtures';

export interface CatalogHttpHarness {
  readonly app: INestApplication;
  readonly url: string;
  readonly identity: IdentityStub;
  request(
    method: 'GET' | 'POST',
    path: string,
    options?: { token?: string; key?: string; body?: unknown; correlationId?: string },
  ): Promise<{ status: number; body: Record<string, unknown>; headers: Headers }>;
  close(): Promise<void>;
}

export const TOKENS = {
  admin: tokenFor('admin'),
  otherAdmin: tokenFor('other-admin'),
  customer: tokenFor('customer'),
  unknown: tokenFor('unknown'),
};

/**
 * Boots the REAL Nest HTTP transport, the real CatalogService and the real
 * Identity adapter over HTTP. Only the repository and the Identity server are
 * substituted by the caller (in-memory or real PostgreSQL / local stub).
 */
export async function startCatalogHttp(input: {
  repository: CatalogRepository;
  clock: Clock;
  identityTimeoutMs?: number;
  identityConfigured?: boolean;
}): Promise<CatalogHttpHarness> {
  const identity = await startIdentityStub({
    admin: { subject: ADMIN_SUBJECT, permissions: ['profile.read:self', 'catalog.publish'] },
    'other-admin': { subject: OTHER_ADMIN_SUBJECT, permissions: ['catalog.publish'] },
    customer: {
      subject: CUSTOMER_SUBJECT,
      permissions: ['profile.read:self', 'bookings.create:self'],
    },
  });
  const service = new CatalogService({
    repository: input.repository,
    authority: new IdentitySessionAuthority({
      origin: input.identityConfigured === false ? null : new URL(identity.origin),
      timeoutMs: input.identityTimeoutMs ?? 1_000,
    }),
    clock: input.clock,
    ids: new RandomIds(),
    hasher: new Sha256Hasher(),
  });
  const moduleRef = await Test.createTestingModule({
    controllers: [CatalogController],
    providers: [{ provide: CATALOG_SERVICE, useValue: service }],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.listen(0, '127.0.0.1');
  const url = await app.getUrl();
  return {
    app,
    url,
    identity,
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
      await identity.close();
    },
  };
}
