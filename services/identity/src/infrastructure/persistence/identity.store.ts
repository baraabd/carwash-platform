import { PrismaPg } from '@prisma/adapter-pg';
import { databaseSchemaFromUrl } from '@carwash/service-kit';
import { isIdentityRole } from '@carwash/contracts';
import {
  PrismaClient,
  type Prisma,
  type IdentityAccount,
  type IdentityChallenge,
} from '../../generated/prisma/client';
import type {
  Account,
  AuditRecord,
  Challenge,
  IdentityStore,
  IdentityTransaction,
  RefreshRecord,
  Session,
} from '../../ports/identity.ports';

function accountModel(row: IdentityAccount | null): Account | null {
  if (!row) return null;
  if ((row.status !== 'ACTIVE' && row.status !== 'SUSPENDED') || !row.roles.every(isIdentityRole))
    throw new Error('INVALID_STORED_ACCOUNT');
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.passwordHash,
    status: row.status,
    roles: row.roles,
    authVersion: row.authVersion,
  };
}
function challengeModel(row: IdentityChallenge | null): Challenge | null {
  if (!row) return null;
  if (row.purpose !== 'REGISTER' && row.purpose !== 'LOGIN' && row.purpose !== 'DECOY')
    throw new Error('INVALID_STORED_CHALLENGE');
  if (
    row.state !== 'DELIVERING' &&
    row.state !== 'READY' &&
    row.state !== 'USED' &&
    row.state !== 'INVALID'
  )
    throw new Error('INVALID_STORED_CHALLENGE');
  return { ...row, purpose: row.purpose, state: row.state };
}
class Transaction implements IdentityTransaction {
  constructor(private readonly tx: Prisma.TransactionClient) {}
  async lockEmail(email: string): Promise<void> {
    await this.tx
      .$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${email}, 0))`;
  }
  async account(id: string, lock = false): Promise<Account | null> {
    if (lock)
      await this.tx
        .$queryRaw`SELECT id FROM app.identity_account WHERE id = ${id}::uuid FOR UPDATE`;
    return accountModel(await this.tx.identityAccount.findUnique({ where: { id } }));
  }
  async accountByEmail(email: string): Promise<Account | null> {
    return accountModel(await this.tx.identityAccount.findUnique({ where: { email } }));
  }
  async createAccount(account: Account): Promise<void> {
    await this.tx.identityAccount.create({ data: { ...account, roles: [...account.roles] } });
  }
  async updateAccount(
    id: string,
    patch: Partial<Pick<Account, 'passwordHash' | 'roles' | 'status' | 'authVersion'>>,
  ): Promise<void> {
    const { roles, ...scalars } = patch;
    await this.tx.identityAccount.update({
      where: { id },
      data: { ...scalars, ...(roles ? { roles: [...roles] } : {}) },
    });
  }
  async challenge(id: string, lock = false): Promise<Challenge | null> {
    if (lock)
      await this.tx
        .$queryRaw`SELECT id FROM app.identity_challenge WHERE id = ${id}::uuid FOR UPDATE`;
    return challengeModel(await this.tx.identityChallenge.findUnique({ where: { id } }));
  }
  async createChallenge(challenge: Challenge): Promise<void> {
    await this.tx.identityChallenge.create({ data: challenge });
  }
  async updateChallenge(
    id: string,
    patch: Partial<Omit<Challenge, 'id' | 'email' | 'accountId' | 'purpose' | 'passwordHash'>>,
  ): Promise<void> {
    await this.tx.identityChallenge.update({ where: { id }, data: patch });
  }
  async session(id: string, lock = false): Promise<Session | null> {
    if (lock)
      await this.tx
        .$queryRaw`SELECT id FROM app.identity_session WHERE id = ${id}::uuid FOR UPDATE`;
    return this.tx.identitySession.findUnique({ where: { id } });
  }
  async createSession(session: Session): Promise<void> {
    await this.tx.identitySession.create({ data: session });
  }
  async revokeSession(id: string, now: Date): Promise<void> {
    await this.tx.identitySession.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: now },
    });
  }
  async revokeAll(accountId: string, now: Date): Promise<void> {
    await this.tx.identitySession.updateMany({
      where: { accountId, revokedAt: null },
      data: { revokedAt: now },
    });
  }
  async refresh(digest: string, lock = false): Promise<RefreshRecord | null> {
    if (lock)
      await this.tx
        .$queryRaw`SELECT digest FROM app.identity_refresh WHERE digest = ${digest} FOR UPDATE`;
    return this.tx.identityRefresh.findUnique({ where: { digest } });
  }
  async createRefresh(record: RefreshRecord): Promise<void> {
    await this.tx.identityRefresh.create({ data: record });
  }
  async consumeRefresh(digest: string, now: Date): Promise<void> {
    await this.tx.identityRefresh.update({ where: { digest }, data: { usedAt: now } });
  }
  async audit(record: AuditRecord): Promise<void> {
    await this.tx.identityAudit.create({ data: record });
  }
}
export class PrismaIdentityStore implements IdentityStore {
  readonly client: PrismaClient;
  constructor(url: string) {
    if (databaseSchemaFromUrl(url) !== 'app') throw new Error('IDENTITY_APP_SCHEMA_REQUIRED');
    this.client = new PrismaClient({
      adapter: new PrismaPg(
        { connectionString: url, max: 10, connectionTimeoutMillis: 3_000 },
        { schema: 'app' },
      ),
    });
  }
  transaction<T>(work: (tx: IdentityTransaction) => Promise<T>): Promise<T> {
    // Explicit row locks serialize challenge/session transitions. Side effects never run inside this callback.
    return this.client.$transaction((tx) => work(new Transaction(tx)), {
      maxWait: 3_000,
      timeout: 5_000,
      isolationLevel: 'ReadCommitted',
    });
  }
  async accountByEmail(email: string): Promise<Account | null> {
    return accountModel(await this.client.identityAccount.findUnique({ where: { email } }));
  }
  session(id: string): Promise<Session | null> {
    return this.client.identitySession.findUnique({ where: { id } });
  }
  refresh(digest: string): Promise<RefreshRecord | null> {
    return this.client.identityRefresh.findUnique({ where: { digest } });
  }
  async ping(): Promise<void> {
    await this.client.$queryRaw`SELECT 1`;
  }
  close(): Promise<void> {
    return this.client.$disconnect();
  }
}
