import type { Prisma } from '../../generated/prisma/client';
import type {
  InitialAdministratorReceipt,
  InitialAdministratorStore,
  InitialAdministratorTransaction,
  InitialAdministratorVerification,
} from '../../ports/initial-administrator.ports';
import { type PrismaIdentityStore, Transaction } from './identity.store';

class BootstrapTransaction extends Transaction implements InitialAdministratorTransaction {
  constructor(tx: Prisma.TransactionClient) {
    super(tx);
  }
  async lockBootstrap(): Promise<void> {
    await this.tx
      .$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended('identity.initial-administrator.v1', 0))`;
    // The singleton lock orders CLI replicas. This table lock also orders any
    // concurrent regular role/account mutation, including a pre-existing admin.
    await this.tx.$executeRaw`LOCK TABLE app.identity_account IN EXCLUSIVE MODE`;
  }
  async bootstrapReceipt(): Promise<InitialAdministratorReceipt | null> {
    return this.tx.identityInitialAdministrator.findUnique({ where: { singleton: 1 } });
  }
  async anyAdministrator(): Promise<boolean> {
    return (await this.tx.identityAccount.count({ where: { roles: { has: 'super-admin' } } })) > 0;
  }
  async verifiedLogin(
    accountId: string,
    email: string,
  ): Promise<InitialAdministratorVerification | null> {
    // login.succeeded is written only after a genuine OTP check by IdentityAuthService,
    // atomically with USED challenge, account/session and refresh records.
    const audit = await this.tx.identityAudit.findFirst({
      where: {
        action: 'login.succeeded',
        outcome: 'SUCCESS',
        actorId: accountId,
        subjectId: accountId,
      },
      orderBy: [{ occurredAt: 'desc' }, { id: 'asc' }],
    });
    if (!audit) return null;
    const challenge = await this.tx.identityChallenge.findFirst({
      where: {
        email,
        state: 'USED',
        OR: [
          { purpose: 'LOGIN', accountId },
          { purpose: 'REGISTER', accountId: null },
        ],
      },
      orderBy: [{ expiresAt: 'desc' }, { id: 'asc' }],
    });
    return challenge ? { challengeId: challenge.id, loginAuditId: audit.id } : null;
  }
  async recordBootstrap(receipt: InitialAdministratorReceipt): Promise<void> {
    await this.tx.identityInitialAdministrator.create({ data: { singleton: 1, ...receipt } });
  }
}

export class PrismaInitialAdministratorStore implements InitialAdministratorStore {
  constructor(private readonly identity: PrismaIdentityStore) {}
  transaction<T>(work: (tx: InitialAdministratorTransaction) => Promise<T>): Promise<T> {
    return this.identity.client.$transaction((tx) => work(new BootstrapTransaction(tx)), {
      maxWait: 10_000,
      timeout: 10_000,
      isolationLevel: 'ReadCommitted',
    });
  }
}
