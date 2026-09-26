import type {
  AccessPrincipal,
  AccountStatus,
  ChallengeReceipt,
  IdentityPermission,
  IdentitySessionView,
} from '@carwash/contracts';
import {
  AUTH_POLICY as P,
  AuthFault,
  normalizeEmail,
  passwordInput,
  permissionsFor,
  rolesInput,
  uuidInput,
} from '../domain/auth-policy';
import type {
  AbuseBudget,
  Account,
  AccessSigner,
  Challenge,
  Clock,
  IdentityStore,
  IdentityTransaction,
  OtpDelivery,
  Passwords,
  Secrets,
  Session,
} from '../ports/identity.ports';

export interface AuthContext {
  readonly ip: string;
  readonly requestId: string;
}
export interface SessionTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: Date;
  readonly session: IdentitySessionView;
}
export interface AuthDependencies {
  readonly store: IdentityStore;
  readonly passwords: Passwords;
  readonly secrets: Secrets;
  readonly budget: AbuseBudget;
  readonly delivery: OtpDelivery;
  readonly signer: AccessSigner;
  readonly clock: Clock;
}
/** Business policies depend only on ports. No Nest, Redis, Prisma or HTTP in this layer. */
export class IdentityAuthService {
  constructor(private readonly d: AuthDependencies) {}
  private now(): Date {
    return new Date(this.d.clock.now());
  }
  private async budget(
    scope: string,
    subject: string,
    limit: number,
    windowMs: number,
  ): Promise<void> {
    try {
      if (!(await this.d.budget.take(scope, subject, limit, windowMs)).allowed)
        throw new AuthFault('AUTH_RATE_LIMITED');
    } catch (error) {
      if (error instanceof AuthFault) throw error;
      throw new AuthFault('AUTH_UNAVAILABLE');
    }
  }
  private async audit(
    tx: IdentityTransaction,
    action: string,
    outcome: 'SUCCESS' | 'DENIED' | 'FAILED',
    context: AuthContext,
    subjectId: string | null = null,
    actorId: string | null = null,
  ): Promise<void> {
    await tx.audit({
      id: this.d.secrets.id(),
      action,
      outcome,
      subjectId,
      actorId,
      requestId: context.requestId,
      occurredAt: this.now(),
    });
  }
  private receipt(challenge: Challenge): ChallengeReceipt {
    return {
      challengeId: challenge.id,
      expiresIn: Math.max(
        0,
        Math.ceil((challenge.expiresAt.getTime() - this.d.clock.now()) / 1_000),
      ),
      resendAfter: Math.max(
        0,
        Math.ceil((challenge.resendAt.getTime() - this.d.clock.now()) / 1_000),
      ),
    };
  }
  private async deliver(challenge: Challenge, code: string, context: AuthContext): Promise<void> {
    let delivered = true;
    try {
      if (challenge.purpose !== 'DECOY')
        await this.d.delivery.deliver({
          challengeId: challenge.id,
          generation: challenge.generation,
          recipient: challenge.email,
          code,
          expiresAt: challenge.expiresAt,
        });
    } catch {
      delivered = false;
    }
    // The response only acknowledges a challenge request, never asserts email/SMS delivery.
    // A provider failure invalidates this generation. Resend issues a fresh code; no plaintext OTP is retried from storage.
    await this.d.store.transaction(async (tx) => {
      const current = await tx.challenge(challenge.id, true);
      if (!current || current.generation !== challenge.generation || current.state !== 'DELIVERING')
        return;
      await tx.updateChallenge(current.id, { state: delivered ? 'READY' : 'INVALID' });
      await this.audit(
        tx,
        'challenge.delivery',
        delivered ? 'SUCCESS' : 'FAILED',
        context,
        current.accountId,
      );
    });
  }
  async issue(
    kind: 'REGISTER' | 'LOGIN',
    emailInput: unknown,
    passwordRaw: unknown,
    context: AuthContext,
  ): Promise<ChallengeReceipt> {
    const email = normalizeEmail(emailInput);
    const password = passwordInput(passwordRaw);
    await this.budget('issue-ip', context.ip, P.issueIpLimit, P.issueWindowMs);
    await this.budget('issue-account', email, P.issueAccountLimit, P.issueWindowMs);
    const account = await this.d.store.accountByEmail(email);
    let passwordHash: string | null = null;
    let eligible: boolean;
    if (kind === 'REGISTER') {
      passwordHash = await this.d.passwords.hash(password);
      eligible = account === null;
    } else {
      const verified = await this.d.passwords.verify(
        account?.passwordHash ?? this.d.passwords.dummyHash,
        password,
      );
      eligible = verified && account?.status === 'ACTIVE';
      if (eligible && account && this.d.passwords.needsRehash(account.passwordHash)) {
        const hash = await this.d.passwords.hash(password);
        await this.d.store.transaction(async (tx) => {
          const current = await tx.account(account.id, true);
          if (current?.passwordHash === account.passwordHash)
            await tx.updateAccount(account.id, { passwordHash: hash });
        });
      }
    }
    const id = this.d.secrets.id();
    const code = this.d.secrets.otp();
    const now = this.d.clock.now();
    const challenge: Challenge = {
      id,
      email,
      accountId: eligible ? (account?.id ?? null) : null,
      purpose: eligible ? kind : 'DECOY',
      passwordHash: eligible ? passwordHash : null,
      digest: this.d.secrets.otpDigest(id, 1, code),
      generation: 1,
      attempts: 0,
      expiresAt: new Date(now + P.challengeTtlMs),
      resendAt: new Date(now + P.resendMs),
      state: 'DELIVERING',
    };
    await this.d.store.transaction(async (tx) => {
      await tx.createChallenge(challenge);
      await this.audit(
        tx,
        kind === 'REGISTER' ? 'registration.requested' : 'login.requested',
        'SUCCESS',
        context,
      );
    });
    await this.deliver(challenge, code, context);
    return this.receipt(challenge);
  }
  async resend(challengeId: unknown, context: AuthContext): Promise<ChallengeReceipt> {
    const id = uuidInput(challengeId);
    await this.budget('resend-ip', context.ip, P.issueIpLimit, P.issueWindowMs);
    let code = this.d.secrets.otp();
    const challenge = await this.d.store.transaction(async (tx) => {
      const old = await tx.challenge(id, true);
      const now = this.d.clock.now();
      if (
        !old ||
        old.expiresAt.getTime() <= now ||
        old.resendAt.getTime() > now ||
        old.state === 'USED' ||
        old.attempts >= P.challengeAttempts
      )
        throw new AuthFault('AUTH_CHALLENGE_INVALID');
      // A resend must not accidentally issue the same numeric code. Compare against the
      // existing fingerprint; the previous plaintext is neither stored nor recovered.
      for (
        let attempt = 0;
        attempt < 5 &&
        this.d.secrets.equal(old.digest, this.d.secrets.otpDigest(id, old.generation, code));
        attempt += 1
      ) {
        code = this.d.secrets.otp();
      }
      if (this.d.secrets.equal(old.digest, this.d.secrets.otpDigest(id, old.generation, code)))
        throw new AuthFault('AUTH_UNAVAILABLE');
      const next: Challenge = {
        ...old,
        generation: old.generation + 1,
        digest: this.d.secrets.otpDigest(id, old.generation + 1, code),
        resendAt: new Date(now + P.resendMs),
        state: 'DELIVERING',
      };
      await tx.updateChallenge(id, {
        generation: next.generation,
        digest: next.digest,
        resendAt: next.resendAt,
        state: next.state,
      });
      await this.audit(tx, 'challenge.resent', 'SUCCESS', context, old.accountId);
      return next;
    });
    await this.deliver(challenge, code, context);
    return this.receipt(challenge);
  }
  private view(account: Account, session: Session): IdentitySessionView {
    return {
      subject: account.id,
      sessionId: session.id,
      authVersion: account.authVersion,
      roles: account.roles,
      permissions: permissionsFor(account.roles),
    };
  }
  private async tokens(
    account: Account,
    session: Session,
    refreshToken: string,
  ): Promise<SessionTokens> {
    return {
      accessToken: await this.d.signer.sign({
        subject: account.id,
        sessionId: session.id,
        authVersion: account.authVersion,
      }),
      refreshToken,
      expiresAt: session.expiresAt,
      session: this.view(account, session),
    };
  }
  async verifyChallenge(
    idInput: unknown,
    code: unknown,
    context: AuthContext,
  ): Promise<SessionTokens> {
    const id = uuidInput(idInput);
    if (typeof code !== 'string' || !/^\d{6}$/.test(code))
      throw new AuthFault('AUTH_CHALLENGE_INVALID');
    await this.budget('verify-ip', context.ip, P.verifyIpLimit, P.verifyWindowMs);
    const refreshToken = this.d.secrets.opaque();
    const outcome = await this.d.store.transaction(async (tx) => {
      const challenge = await tx.challenge(id, true);
      const now = this.now();
      if (
        !challenge ||
        challenge.state !== 'READY' ||
        challenge.expiresAt <= now ||
        challenge.attempts >= P.challengeAttempts
      )
        return null;
      const valid =
        this.d.secrets.equal(
          challenge.digest,
          this.d.secrets.otpDigest(id, challenge.generation, code),
        ) && challenge.purpose !== 'DECOY';
      if (!valid) {
        const attempts = challenge.attempts + 1;
        await tx.updateChallenge(id, {
          attempts,
          state: attempts >= P.challengeAttempts ? 'INVALID' : 'READY',
        });
        await this.audit(tx, 'challenge.rejected', 'DENIED', context, challenge.accountId);
        return null; // Do not throw inside the transaction: failed attempts MUST commit.
      }
      let account: Account | null;
      if (challenge.purpose === 'REGISTER') {
        await tx.lockEmail(challenge.email);
        const exists = await tx.accountByEmail(challenge.email);
        if (exists || !challenge.passwordHash) {
          await tx.updateChallenge(id, { state: 'INVALID' });
          return null;
        }
        account = {
          id: this.d.secrets.id(),
          email: challenge.email,
          passwordHash: challenge.passwordHash,
          status: 'ACTIVE',
          roles: ['customer'],
          authVersion: 1,
        };
        await tx.createAccount(account);
      } else {
        account = challenge.accountId ? await tx.account(challenge.accountId, true) : null;
        if (!account || account.status !== 'ACTIVE') {
          await tx.updateChallenge(id, { state: 'INVALID' });
          return null;
        }
      }
      const session: Session = {
        id: this.d.secrets.id(),
        accountId: account.id,
        expiresAt: new Date(now.getTime() + P.sessionTtlMs),
        revokedAt: null,
      };
      await tx.createSession(session);
      await tx.createRefresh({
        digest: this.d.secrets.digest(refreshToken),
        sessionId: session.id,
        usedAt: null,
        expiresAt: session.expiresAt,
      });
      await tx.updateChallenge(id, { state: 'USED' });
      await this.audit(tx, 'login.succeeded', 'SUCCESS', context, account.id, account.id);
      return { account, session };
    });
    if (!outcome) throw new AuthFault('AUTH_CHALLENGE_INVALID');
    return this.tokens(outcome.account, outcome.session, refreshToken);
  }
  async refresh(raw: unknown, context: AuthContext): Promise<SessionTokens> {
    if (typeof raw !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(raw))
      throw new AuthFault('AUTH_REQUIRED');
    await this.budget('refresh-ip', context.ip, 60, 60_000);
    const digest = this.d.secrets.digest(raw);
    const previous = await this.d.store.refresh(digest);
    const sessionHint = previous ? await this.d.store.session(previous.sessionId) : null;
    if (!sessionHint) throw new AuthFault('AUTH_REQUIRED');
    const replacement = this.d.secrets.opaque();
    const result = await this.d.store.transaction(async (tx) => {
      // Consistent lock order across rotation/status/logout: account, session, refresh.
      const account = await tx.account(sessionHint.accountId, true);
      const session = await tx.session(sessionHint.id, true);
      const token = await tx.refresh(digest, true);
      const now = this.now();
      if (!account || !session || !token || token.sessionId !== session.id) return null;
      if (token.usedAt !== null) {
        await tx.revokeSession(session.id, now);
        await this.audit(tx, 'refresh.replay', 'DENIED', context, account.id);
        return null; // The revocation survives the rejected response.
      }
      if (
        account.status !== 'ACTIVE' ||
        session.revokedAt ||
        session.expiresAt <= now ||
        token.expiresAt <= now
      )
        return null;
      await tx.consumeRefresh(digest, now);
      await tx.createRefresh({
        digest: this.d.secrets.digest(replacement),
        sessionId: session.id,
        usedAt: null,
        expiresAt: session.expiresAt,
      });
      await this.audit(tx, 'session.rotated', 'SUCCESS', context, account.id, account.id);
      return { account, session };
    });
    if (!result) throw new AuthFault('AUTH_REQUIRED');
    return this.tokens(result.account, result.session, replacement);
  }
  async authorize(
    principal: AccessPrincipal,
    permission?: IdentityPermission,
  ): Promise<IdentitySessionView> {
    return this.d.store.transaction(async (tx) => {
      const account = await tx.account(principal.subject);
      const session = await tx.session(principal.sessionId);
      if (
        !account ||
        !session ||
        session.accountId !== account.id ||
        account.status !== 'ACTIVE' ||
        session.revokedAt ||
        session.expiresAt <= this.now() ||
        principal.authVersion !== account.authVersion
      )
        throw new AuthFault('AUTH_REQUIRED');
      const view = this.view(account, session);
      if (permission && !view.permissions.includes(permission))
        throw new AuthFault('AUTH_FORBIDDEN');
      return view;
    });
  }
  async logout(raw: unknown, context: AuthContext): Promise<void> {
    if (typeof raw !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(raw)) return;
    const token = await this.d.store.refresh(this.d.secrets.digest(raw));
    if (!token) return;
    const hint = await this.d.store.session(token.sessionId);
    if (!hint) return;
    await this.d.store.transaction(async (tx) => {
      await tx.account(hint.accountId, true);
      await tx.revokeSession(hint.id, this.now());
      await this.audit(
        tx,
        'session.logged-out',
        'SUCCESS',
        context,
        hint.accountId,
        hint.accountId,
      );
    });
  }
  async logoutAll(principal: AccessPrincipal, context: AuthContext): Promise<void> {
    await this.authorize(principal);
    await this.d.store.transaction(async (tx) => {
      await tx.account(principal.subject, true);
      await tx.revokeAll(principal.subject, this.now());
      await this.audit(
        tx,
        'sessions.logged-out-all',
        'SUCCESS',
        context,
        principal.subject,
        principal.subject,
      );
    });
  }
  async changeAccount(
    principal: AccessPrincipal,
    targetInput: unknown,
    change: { status: AccountStatus } | { roles: unknown },
    context: AuthContext,
  ): Promise<void> {
    const permission = 'status' in change ? 'identity.accounts.suspend' : 'identity.roles.assign';
    await this.authorize(principal, permission);
    const target = uuidInput(targetInput);
    // Self-escalation/self-suspension is not an administrative bootstrap mechanism.
    if (target === principal.subject) throw new AuthFault('AUTH_FORBIDDEN');
    const patch = 'roles' in change ? { roles: rolesInput(change.roles) } : change;
    await this.d.store.transaction(async (tx) => {
      // Recheck the actor inside the write transaction; a stale preflight cannot authorize the write.
      const actor = await tx.account(principal.subject, true);
      const actorSession = await tx.session(principal.sessionId);
      if (
        !actor ||
        actor.status !== 'ACTIVE' ||
        actor.authVersion !== principal.authVersion ||
        !actorSession ||
        actorSession.accountId !== actor.id ||
        actorSession.revokedAt ||
        actorSession.expiresAt <= this.now() ||
        !permissionsFor(actor.roles).includes(permission)
      )
        throw new AuthFault('AUTH_FORBIDDEN');
      const account = await tx.account(target, true);
      if (!account) throw new AuthFault('AUTH_INVALID_REQUEST');
      await tx.updateAccount(target, { ...patch, authVersion: account.authVersion + 1 });
      await tx.revokeAll(target, this.now());
      await this.audit(
        tx,
        'roles' in change ? 'account.roles-changed' : 'account.status-changed',
        'SUCCESS',
        context,
        target,
        principal.subject,
      );
    });
  }
}
