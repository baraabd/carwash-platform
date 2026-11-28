import type { IdentityTransaction } from './identity.ports';

export interface InitialAdministratorVerification {
  readonly challengeId: string;
  readonly loginAuditId: string;
}
export interface InitialAdministratorReceipt extends InitialAdministratorVerification {
  readonly accountId: string;
  readonly requestId: string;
  readonly requestHash: string;
  readonly reason: string;
  readonly grantedAuthVersion: number;
  readonly grantedAt: Date;
  readonly auditId: string;
}
export interface InitialAdministratorTransaction extends Pick<
  IdentityTransaction,
  'account' | 'updateAccount' | 'revokeAll' | 'audit'
> {
  /** Serializes every bootstrap and prevents account writes during its initial-admin check. */
  lockBootstrap(): Promise<void>;
  bootstrapReceipt(): Promise<InitialAdministratorReceipt | null>;
  anyAdministrator(): Promise<boolean>;
  verifiedLogin(accountId: string, email: string): Promise<InitialAdministratorVerification | null>;
  recordBootstrap(receipt: InitialAdministratorReceipt): Promise<void>;
}
export interface InitialAdministratorStore {
  transaction<T>(work: (tx: InitialAdministratorTransaction) => Promise<T>): Promise<T>;
}
