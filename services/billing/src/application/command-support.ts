import { CashRuleError, Money, MoneyError, PaymentRuleError } from '../domain';
import {
  AccessDenied,
  ConcurrentModification,
  ReceiptAlreadyExists,
  type AccessAuthority,
  type BillingRepository,
  type BillingUnitOfWork,
  type Clock,
  type Hasher,
  type IdempotencyReceipt,
  type PrincipalRef,
  type RecordedOutcome,
  type VerifiedPrincipal,
} from '../ports';
import { BillingApplicationError } from './billing-errors';
import { canonicalJson } from './canonical-json';

/**
 * The command protocol shared by every Billing application service:
 * Identity decision -> permission -> idempotency key -> fingerprint -> replay a
 * committed receipt or run ONE local ACID transaction that stores the receipt
 * together with the business change. Only committed successes become receipts.
 */
export const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_REVISION = 2_147_483_647;

export interface RequestContext {
  readonly credential: string | undefined;
  readonly correlationId: string;
}

export interface CommandResult {
  readonly status: number;
  readonly body: Readonly<Record<string, unknown>>;
  readonly replayed: boolean;
}

export interface Command {
  readonly principal: VerifiedPrincipal;
  readonly operation: string;
  readonly key: string;
  readonly fingerprint: string;
}

export function objectWithKeys(body: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body))
    throw new BillingApplicationError('REQUEST_INVALID');
  const input = body as Record<string, unknown>;
  if (Object.keys(input).sort().join(',') !== [...keys].sort().join(','))
    throw new BillingApplicationError('REQUEST_INVALID');
  return input;
}

export function uuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID.test(value))
    throw new BillingApplicationError('REQUEST_INVALID', { field });
  return value;
}

export function revision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value >= MAX_REVISION)
    throw new BillingApplicationError('REQUEST_INVALID', { field: 'expectedRevision' });
  return value;
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  const found = allowed.find((candidate) => candidate === value);
  if (!found) throw new BillingApplicationError('REQUEST_INVALID', { field });
  return found;
}

export function moneyInput(value: unknown, field: string): Money {
  try {
    return Money.parse(value);
  } catch (error: unknown) {
    if (!(error instanceof MoneyError)) throw error;
    if (error.code === 'CURRENCY_UNSUPPORTED')
      throw new BillingApplicationError('CURRENCY_UNSUPPORTED', { field });
    throw new BillingApplicationError('REQUEST_INVALID', { field });
  }
}

export function sameRef(a: PrincipalRef, b: PrincipalRef): boolean {
  return a.kind === b.kind && a.subjectId === b.subjectId;
}

export function refOf(principal: VerifiedPrincipal): PrincipalRef {
  return { kind: principal.kind, subjectId: principal.subject };
}

/** Runs a domain decision and converts its rule failure to a public code. */
export function decide<T>(work: () => T): T {
  try {
    return work();
  } catch (error: unknown) {
    if (error instanceof PaymentRuleError || error instanceof CashRuleError)
      throw new BillingApplicationError(error.code);
    throw error;
  }
}

/** A path id that is not a UUID cannot exist: answer as not found. */
export function target(id: string): string {
  if (!UUID.test(id)) throw new BillingApplicationError('NOT_FOUND');
  return id;
}

export class CommandSupport {
  constructor(
    private readonly deps: {
      readonly repository: BillingRepository;
      readonly authority: AccessAuthority;
      readonly clock: Clock;
      readonly hasher: Hasher;
    },
  ) {}

  async principal(context: RequestContext): Promise<VerifiedPrincipal> {
    try {
      return await this.deps.authority.verify(context.credential, context.correlationId);
    } catch (error: unknown) {
      if (error instanceof AccessDenied) throw new BillingApplicationError(error.reason);
      throw new BillingApplicationError('AUTH_UNAVAILABLE');
    }
  }

  async permitted(context: RequestContext, permission: string): Promise<VerifiedPrincipal> {
    const principal = await this.principal(context);
    if (!principal.permissions.includes(permission))
      throw new BillingApplicationError('AUTH_FORBIDDEN');
    return principal;
  }

  key(value: unknown): string {
    if (typeof value !== 'string' || !IDEMPOTENCY_KEY.test(value))
      throw new BillingApplicationError('IDEMPOTENCY_KEY_INVALID');
    return value;
  }

  command(
    principal: VerifiedPrincipal,
    operation: string,
    key: string,
    request: Record<string, unknown>,
  ): Command {
    const fingerprint = this.deps.hasher.sha256Hex(
      canonicalJson({ operation, actor: refOf(principal), request }),
    );
    return { principal, operation, key, fingerprint };
  }

  replay(receipt: IdempotencyReceipt, command: Command): CommandResult {
    if (receipt.requestFingerprint !== command.fingerprint)
      throw new BillingApplicationError('IDEMPOTENCY_CONFLICT');
    return { ...receipt.outcome, replayed: true };
  }

  /** A committed receipt for this actor/operation/key, replayed; else null. */
  async committed(command: Command): Promise<CommandResult | null> {
    const existing = await this.deps.repository.findReceipt(
      refOf(command.principal),
      command.operation,
      command.key,
    );
    return existing ? this.replay(existing, command) : null;
  }

  /**
   * Replay-or-execute. A concurrent request with the same key that commits first
   * makes our receipt insert fail; the winner's outcome is then replayed.
   */
  async execute(
    command: Command,
    work: (uow: BillingUnitOfWork, now: Date) => Promise<RecordedOutcome>,
  ): Promise<CommandResult> {
    const actor = refOf(command.principal);
    const existing = await this.committed(command);
    if (existing) return existing;
    try {
      return await this.deps.repository.transaction(async (uow) => {
        const raced = await uow.findReceipt(actor, command.operation, command.key);
        if (raced) return this.replay(raced, command);
        const now = this.deps.clock.now();
        const outcome = await work(uow, now);
        await uow.saveReceipt(
          {
            actor,
            operation: command.operation,
            idempotencyKey: command.key,
            requestFingerprint: command.fingerprint,
            outcome,
          },
          now,
        );
        return { ...outcome, replayed: false };
      });
    } catch (error: unknown) {
      // A same-key request may have committed while this one waited for a row
      // lock and then failed on the state it changed (revision, status, unique
      // key). The key's outcome is the committed one: replay it, never report
      // the loser's rejection for a command that actually succeeded.
      const winner = await this.deps.repository.findReceipt(actor, command.operation, command.key);
      if (winner) return this.replay(winner, command);
      if (error instanceof ConcurrentModification)
        throw new BillingApplicationError('REVISION_CONFLICT');
      if (error instanceof ReceiptAlreadyExists)
        throw new Error('RECEIPT_RACE_WITHOUT_WINNER', { cause: error });
      throw error;
    }
  }
}
