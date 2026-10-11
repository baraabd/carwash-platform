import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CustodyQueryService } from '../../src/application';
import type { Clock, CustodyProjectionStore } from '../../src/ports';
import { IdentitySessionAuthority } from '../../src/infrastructure/identity/identity-session.authority';
import {
  CUSTODY_QUERY_SERVICE,
  WalletController,
} from '../../src/transport/http/wallet.controller';
import type { IdentityStub } from './identity-stub';

export interface HttpReply {
  status: number;
  body: Record<string, unknown>;
}

export interface WalletHttpHarness {
  get(path: string, token?: string): Promise<HttpReply>;
  close(): Promise<void>;
}

/** Real Nest transport + real query service + real Identity adapter over HTTP. */
export async function startWalletHttp(input: {
  store: CustodyProjectionStore;
  identity: IdentityStub;
  clock: Clock;
}): Promise<WalletHttpHarness> {
  const authority = new IdentitySessionAuthority({
    origin: new URL(input.identity.origin),
    timeoutMs: 2_000,
  });
  const moduleRef = await Test.createTestingModule({
    controllers: [WalletController],
    providers: [
      {
        provide: CUSTODY_QUERY_SERVICE,
        useValue: new CustodyQueryService({ store: input.store, authority, clock: input.clock }),
      },
    ],
  }).compile();
  const app: INestApplication = moduleRef.createNestApplication({ logger: false });
  await app.listen(0, '127.0.0.1');
  const url = await app.getUrl();
  return {
    async get(path, token) {
      const response = await fetch(`${url}/internal/v1/wallet${path}`, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
      return { status: response.status, body: (await response.json()) as Record<string, unknown> };
    },
    close: () => app.close(),
  };
}
