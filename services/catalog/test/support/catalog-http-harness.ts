import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { createLogger } from '@carwash/service-kit';
import { CatalogService } from '../../src/application';
import type { CatalogRepository, Clock } from '../../src/ports';
import { IdentitySessionAuthority } from '../../src/infrastructure/identity/identity-session.authority';
import { RandomIds, Sha256Hasher } from '../../src/infrastructure/system/system.adapters';
import { CATALOG_SERVICE, CatalogController } from '../../src/transport/http/catalog.controller';
import { installCatalogHttp } from '../../src/transport/http/install';
import { startIdentityStub, tokenFor, type IdentityStub } from './identity-stub';
import { ADMIN_SUBJECT, CUSTOMER_SUBJECT, OTHER_ADMIN_SUBJECT } from './catalog-fixtures';

export interface HttpResult {
  status: number;
  body: Record<string, unknown>;
  headers: Headers;
}

export interface CatalogHttpHarness {
  readonly app: NestExpressApplication;
  readonly url: string;
  readonly identity: IdentityStub;
  request(
    method: 'GET' | 'POST',
    path: string,
    options?: {
      token?: string;
      key?: string;
      body?: unknown;
      rawBody?: string;
      correlationId?: string;
      traceparent?: string;
    },
  ): Promise<HttpResult>;
  close(): Promise<void>;
}

export const TOKENS = {
  admin: tokenFor('admin'),
  otherAdmin: tokenFor('other-admin'),
  customer: tokenFor('customer'),
  unknown: tokenFor('unknown'),
};

/**
 * Boots the REAL Nest HTTP transport (same edge as production: ids, body
 * limit, error envelope), the real CatalogService and the real Identity
 * adapter over HTTP. Only the repository and the Identity server are
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
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    logger: false,
    bodyParser: false,
  });
  installCatalogHttp(app, createLogger({ service: 'catalog' }));
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
      if (options.traceparent) headers.traceparent = options.traceparent;
      const payload =
        options.rawBody ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined);
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
    },
  };
}

export function errorOf(result: HttpResult): {
  code: string;
  reason: string | null;
  issues: { field: string; code: string }[];
} {
  return result.body.error as {
    code: string;
    reason: string | null;
    issues: { field: string; code: string }[];
  };
}
