import type { AccessPrincipal, AccountStatus, IdentityRole } from '@carwash/contracts';

export interface Account {
  readonly id: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly status: AccountStatus;
  readonly roles: readonly IdentityRole[];
  readonly authVersion: number;
}
export type ChallengePurpose = 'REGISTER' | 'LOGIN' | 'DECOY';
export interface Challenge {
  readonly id: string;
  readonly email: string;
  readonly accountId: string | null;
  readonly purpose: ChallengePurpose;
  readonly passwordHash: string | null;
  readonly digest: string;
  readonly generation: number;
  readonly attempts: number;
  readonly expiresAt: Date;
  readonly resendAt: Date;
  readonly state: 'DELIVERING' | 'READY' | 'USED' | 'INVALID';
}
export interface Session {
  readonly id: string;
  readonly accountId: string;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
}
export interface RefreshRecord {
  readonly digest: string;
  readonly sessionId: string;
  readonly usedAt: Date | null;
  readonly expiresAt: Date;
}
export interface AuditRecord {
  readonly id: string;
  readonly action: string;
  readonly outcome: 'SUCCESS' | 'DENIED' | 'FAILED';
  readonly actorId: string | null;
  readonly subjectId: string | null;
  readonly requestId: string;
  readonly occurredAt: Date;
}
export interface IdentityTransaction {
  lockEmail(email: string): Promise<void>;
  account(id: string, lock?: boolean): Promise<Account | null>;
  accountByEmail(email: string): Promise<Account | null>;
  createAccount(account: Account): Promise<void>;
  updateAccount(
    id: string,
    patch: Partial<Pick<Account, 'passwordHash' | 'roles' | 'status' | 'authVersion'>>,
  ): Promise<void>;
  challenge(id: string, lock?: boolean): Promise<Challenge | null>;
  createChallenge(challenge: Challenge): Promise<void>;
  updateChallenge(
    id: string,
    patch: Partial<Omit<Challenge, 'id' | 'email' | 'accountId' | 'purpose' | 'passwordHash'>>,
  ): Promise<void>;
  session(id: string, lock?: boolean): Promise<Session | null>;
  createSession(session: Session): Promise<void>;
  revokeSession(id: string, now: Date): Promise<void>;
  revokeAll(accountId: string, now: Date): Promise<void>;
  refresh(digest: string, lock?: boolean): Promise<RefreshRecord | null>;
  createRefresh(record: RefreshRecord): Promise<void>;
  consumeRefresh(digest: string, now: Date): Promise<void>;
  audit(record: AuditRecord): Promise<void>;
}
export interface IdentityStore {
  transaction<T>(work: (tx: IdentityTransaction) => Promise<T>): Promise<T>;
  accountByEmail(email: string): Promise<Account | null>;
  session(id: string): Promise<Session | null>;
  refresh(digest: string): Promise<RefreshRecord | null>;
  ping(): Promise<void>;
  close(): Promise<void>;
}
export interface Passwords {
  hash(value: string): Promise<string>;
  verify(hash: string, value: string): Promise<boolean>;
  needsRehash(hash: string): boolean;
  readonly dummyHash: string;
}
export interface Secrets {
  id(): string;
  opaque(): string;
  otp(): string;
  digest(value: string): string;
  otpDigest(challengeId: string, generation: number, code: string): string;
  equal(left: string, right: string): boolean;
}
export interface Clock {
  now(): number;
}
export interface OtpDelivery {
  deliver(input: {
    readonly challengeId: string;
    readonly generation: number;
    readonly recipient: string;
    readonly code: string;
    readonly expiresAt: Date;
  }): Promise<void>;
}
export interface AbuseBudget {
  take(
    scope: string,
    subject: string,
    limit: number,
    windowMs: number,
  ): Promise<{ readonly allowed: boolean }>;
}
export interface AccessSigner {
  sign(principal: AccessPrincipal): Promise<string>;
}
