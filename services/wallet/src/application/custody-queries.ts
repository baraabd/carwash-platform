import { BUCKETS, type Buckets } from '../domain';
import {
  AccessDenied,
  type AccessAuthority,
  type CustodyAccount,
  type CustodyMovement,
  type VerifiedPrincipal,
  type WalletRepository,
} from '../ports';

/**
 * Finance staff read any holder's custody with the EXISTING Identity grant
 * `billing.read` (custody is a view of Billing postings). A dedicated
 * `wallet.read` is requested from Lane E (CR-B-12.1); until then nothing else
 * grants access. Technicians read only their own custody with
 * `work.read:assigned`. There is no customer wallet (owner decision B-08).
 */
export const STAFF_READ_PERMISSION = 'billing.read';
export const HOLDER_READ_PERMISSION = 'work.read:assigned';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type WalletErrorCode = 'AUTH_REQUIRED' | 'AUTH_FORBIDDEN' | 'AUTH_UNAVAILABLE' | 'NOT_FOUND';

const STATUS: Readonly<Record<WalletErrorCode, number>> = {
  AUTH_REQUIRED: 401,
  AUTH_FORBIDDEN: 403,
  NOT_FOUND: 404,
  AUTH_UNAVAILABLE: 503,
};

export const WALLET_MESSAGES: Readonly<Record<WalletErrorCode, string>> = {
  AUTH_REQUIRED: 'Authentication is required.',
  AUTH_FORBIDDEN: 'The operation is not allowed.',
  AUTH_UNAVAILABLE: 'Authorization is temporarily unavailable.',
  NOT_FOUND: 'The requested resource was not found.',
};

export class WalletApplicationError extends Error {
  readonly status: number;
  constructor(readonly code: WalletErrorCode) {
    super(code);
    this.name = 'WalletApplicationError';
    this.status = STATUS[code];
  }
}

export interface RequestContext {
  readonly credential: string | undefined;
  readonly correlationId: string;
}

function money(
  currency: string,
  minor: bigint,
): { currency: string; amountMinor: string; scale: number } {
  return { currency, amountMinor: minor.toString(), scale: 2 };
}

function bucketsView(currency: string, buckets: Buckets): Record<string, unknown> {
  return Object.fromEntries(BUCKETS.map((bucket) => [bucket, money(currency, buckets[bucket])]));
}

function accountView(account: CustodyAccount): Record<string, unknown> {
  return {
    holder: account.holder,
    currency: account.currency,
    balances: bucketsView(account.currency, account.balances),
    version: account.version,
    updatedAt: account.updatedAt.toISOString(),
  };
}

function movementView(movement: CustodyMovement): Record<string, unknown> {
  return {
    movementId: movement.id,
    kind: movement.kind,
    currency: movement.currency,
    delta: Object.fromEntries(BUCKETS.map((b) => [b, movement.delta[b].toString()])),
    source: {
      eventId: movement.eventId,
      eventType: movement.eventType,
      kind: movement.sourceKind,
      id: movement.sourceId,
      version: movement.sourceVersion,
    },
    occurredAt: movement.occurredAt.toISOString(),
    recordedAt: movement.recordedAt.toISOString(),
  };
}

export class CustodyQueries {
  constructor(
    private readonly deps: {
      readonly repository: WalletRepository;
      readonly authority: AccessAuthority;
    },
  ) {}

  private async principal(context: RequestContext, permission: string): Promise<VerifiedPrincipal> {
    let principal: VerifiedPrincipal;
    try {
      principal = await this.deps.authority.verify(context.credential, context.correlationId);
    } catch (error: unknown) {
      if (error instanceof AccessDenied) throw new WalletApplicationError(error.reason);
      throw new WalletApplicationError('AUTH_UNAVAILABLE');
    }
    if (!principal.permissions.includes(permission))
      throw new WalletApplicationError('AUTH_FORBIDDEN');
    return principal;
  }

  private holder(value: string): string {
    if (!UUID.test(value)) throw new WalletApplicationError('NOT_FOUND');
    return value.toLowerCase();
  }

  private async custody(holder: string, allowEmpty: boolean): Promise<Record<string, unknown>> {
    const accounts = await this.deps.repository.accountsOf(holder);
    if (accounts.length === 0 && !allowEmpty) throw new WalletApplicationError('NOT_FOUND');
    return { holder, accounts: accounts.map(accountView) };
  }

  private async movements(holder: string, allowEmpty: boolean): Promise<Record<string, unknown>> {
    const movements = await this.deps.repository.movementsOf(holder, 200);
    if (movements.length === 0 && !allowEmpty) throw new WalletApplicationError('NOT_FOUND');
    return { holder, movements: movements.map(movementView) };
  }

  async staffCustody(context: RequestContext, holder: string): Promise<Record<string, unknown>> {
    await this.principal(context, STAFF_READ_PERMISSION);
    return this.custody(this.holder(holder), false);
  }

  async staffMovements(context: RequestContext, holder: string): Promise<Record<string, unknown>> {
    await this.principal(context, STAFF_READ_PERMISSION);
    return this.movements(this.holder(holder), false);
  }

  /** A technician's own custody; an empty result is the honest answer, not a 404. */
  async myCustody(context: RequestContext): Promise<Record<string, unknown>> {
    const principal = await this.principal(context, HOLDER_READ_PERMISSION);
    return this.custody(principal.subject, true);
  }

  async myMovements(context: RequestContext): Promise<Record<string, unknown>> {
    const principal = await this.principal(context, HOLDER_READ_PERMISSION);
    return this.movements(principal.subject, true);
  }
}
