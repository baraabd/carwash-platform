import {
  InitialAdministratorFault,
  initialAdministratorCommand,
  initialAdministratorFingerprint,
} from '../domain/initial-administrator';
import type { InitialAdministratorStore } from '../ports/initial-administrator.ports';

export interface InitialAdministratorResult {
  readonly status: 'CREATED' | 'REPLAYED';
  readonly accountId: string;
  readonly requestId: string;
  readonly authVersion: number;
  readonly grantedAt: string;
}

/** One administrative provisioning operation, never a public authentication endpoint. */
export class InitialAdministratorService {
  constructor(
    private readonly store: InitialAdministratorStore,
    private readonly clock: { now(): Date },
    private readonly ids: { next(): string },
    private readonly hash: (canonical: string) => string,
  ) {}

  async execute(
    input: Parameters<typeof initialAdministratorCommand>[0],
  ): Promise<InitialAdministratorResult> {
    const command = initialAdministratorCommand(input);
    const requestHash = this.hash(initialAdministratorFingerprint(command));
    return this.store.transaction(async (tx) => {
      await tx.lockBootstrap();
      const receipt = await tx.bootstrapReceipt();
      if (receipt) {
        if (receipt.requestId !== command.requestId || receipt.accountId !== command.accountId)
          throw new InitialAdministratorFault('BOOTSTRAP_ALREADY_USED');
        if (receipt.requestHash !== requestHash)
          throw new InitialAdministratorFault('BOOTSTRAP_REQUEST_CONFLICT');
        const current = await tx.account(receipt.accountId, true);
        if (
          !current ||
          current.kind !== 'account' ||
          current.status !== 'ACTIVE' ||
          current.email !== command.expectedEmail ||
          !current.roles.includes('super-admin') ||
          current.authVersion !== receipt.grantedAuthVersion
        )
          throw new InitialAdministratorFault('BOOTSTRAP_GRANT_CHANGED');
        return {
          status: 'REPLAYED',
          accountId: receipt.accountId,
          requestId: receipt.requestId,
          authVersion: receipt.grantedAuthVersion,
          grantedAt: receipt.grantedAt.toISOString(),
        };
      }
      if (await tx.anyAdministrator())
        throw new InitialAdministratorFault('BOOTSTRAP_ADMIN_EXISTS');
      const account = await tx.account(command.accountId, true);
      if (
        !account ||
        account.kind !== 'account' ||
        account.status !== 'ACTIVE' ||
        account.email !== command.expectedEmail ||
        !account.passwordHash
      )
        throw new InitialAdministratorFault('BOOTSTRAP_TARGET_INVALID');
      const verification = await tx.verifiedLogin(account.id, command.expectedEmail);
      if (!verification) throw new InitialAdministratorFault('BOOTSTRAP_VERIFICATION_REQUIRED');
      const now = this.clock.now();
      const authVersion = account.authVersion + 1;
      const auditId = this.ids.next();
      await tx.updateAccount(account.id, { roles: [...account.roles, 'super-admin'], authVersion });
      await tx.revokeAll(account.id, now);
      await tx.audit({
        id: auditId,
        action: 'initial-administrator.granted',
        outcome: 'SUCCESS',
        // No human authenticated actor is invented for a maintenance CLI operation.
        actorId: null,
        subjectId: account.id,
        requestId: command.requestId,
        occurredAt: now,
      });
      await tx.recordBootstrap({
        ...verification,
        accountId: account.id,
        requestId: command.requestId,
        requestHash,
        reason: command.reason,
        grantedAuthVersion: authVersion,
        grantedAt: now,
        auditId,
      });
      return {
        status: 'CREATED',
        accountId: account.id,
        requestId: command.requestId,
        authVersion,
        grantedAt: now.toISOString(),
      };
    });
  }
}
