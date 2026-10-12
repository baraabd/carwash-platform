import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FinanceQueryService } from '../../src/application';
import type { Clock, FinanceReadModel } from '../../src/ports';
import { IdentitySessionAuthority } from '../../src/infrastructure/identity/identity-session.authority';
import {
  FINANCE_QUERY_SERVICE,
  FinanceController,
} from '../../src/transport/http/finance.controller';
import type { HttpReply } from './billing-http-harness';
import type { Stub } from './upstream-stubs';

export interface FinanceHttpHarness {
  get(path: string, token?: string): Promise<HttpReply>;
  close(): Promise<void>;
}

/**
 * Real Nest transport + real FinanceQueryService + real Identity adapter over
 * HTTP for the admin finance reads. The read model and clock come from the
 * caller (Prisma on real PostgreSQL, or an in-memory double).
 */
export async function startFinanceHttp(input: {
  readModel: FinanceReadModel;
  clock: Clock;
  identity: Stub;
}): Promise<FinanceHttpHarness> {
  const service = new FinanceQueryService({
    readModel: input.readModel,
    authority: new IdentitySessionAuthority({
      origin: new URL(input.identity.origin),
      timeoutMs: 1_000,
    }),
    clock: input.clock,
  });
  const moduleRef = await Test.createTestingModule({
    controllers: [FinanceController],
    providers: [{ provide: FINANCE_QUERY_SERVICE, useValue: service }],
  }).compile();
  const app: INestApplication = moduleRef.createNestApplication({ logger: false });
  await app.listen(0, '127.0.0.1');
  const url = await app.getUrl();
  return {
    async get(path, token) {
      const headers: Record<string, string> = { accept: 'application/json' };
      if (token) headers.authorization = `Bearer ${token}`;
      const response = await fetch(`${url}/internal/v1/billing${path}`, { headers });
      const text = await response.text();
      return {
        status: response.status,
        body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
        headers: response.headers,
      };
    },
    close: () => app.close(),
  };
}
