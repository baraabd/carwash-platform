import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CustodyQueries } from '../../src/application';
import type { WalletRepository } from '../../src/ports';
import { IdentitySessionAuthority } from '../../src/infrastructure/identity/identity-session.authority';
import { CUSTODY_QUERIES, WalletController } from '../../src/transport/http/wallet.controller';
import { startIdentityStub, tokenFor, type IdentityStub } from './identity-stub';
import { FINANCE_SUBJECT, HOLDER, OTHER_HOLDER } from './billing-events';

export const CUSTOMER_SUBJECT = '1f2a3b4c-5d6e-4f1a-8b2c-3d4e5f6a7b8c';

export const TOKENS = {
  finance: tokenFor('finance'),
  technician: tokenFor('technician'),
  otherTechnician: tokenFor('other-technician'),
  customer: tokenFor('customer'),
  unknown: tokenFor('unknown'),
};

export interface WalletHttpHarness {
  readonly identity: IdentityStub;
  get(path: string, token?: string): Promise<{ status: number; body: Record<string, unknown> }>;
  close(): Promise<void>;
}

/** Real Nest transport + real queries + real Identity adapter over a local HTTP stub. */
export async function startWalletHttp(repository: WalletRepository): Promise<WalletHttpHarness> {
  const identity = await startIdentityStub({
    finance: { subject: FINANCE_SUBJECT, permissions: ['billing.read'] },
    technician: { subject: HOLDER, permissions: ['work.read:assigned', 'work.execute:assigned'] },
    'other-technician': { subject: OTHER_HOLDER, permissions: ['work.read:assigned'] },
    customer: {
      subject: CUSTOMER_SUBJECT,
      permissions: ['bookings.create:self', 'profile.read:self'],
    },
  });
  const queries = new CustodyQueries({
    repository,
    authority: new IdentitySessionAuthority({ origin: new URL(identity.origin), timeoutMs: 1_000 }),
  });
  const moduleRef = await Test.createTestingModule({
    controllers: [WalletController],
    providers: [{ provide: CUSTODY_QUERIES, useValue: queries }],
  }).compile();
  const app: INestApplication = moduleRef.createNestApplication({ logger: false });
  await app.listen(0, '127.0.0.1');
  const url = await app.getUrl();
  return {
    identity,
    async get(path, token) {
      const response = await fetch(`${url}/internal/v1/wallet${path}`, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
      const text = await response.text();
      return {
        status: response.status,
        body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
      };
    },
    async close() {
      await app.close();
      await identity.close();
    },
  };
}
