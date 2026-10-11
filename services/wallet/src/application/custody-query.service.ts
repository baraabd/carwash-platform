import { moneyView, positionFromTotals, type CustodyPosition } from '../domain';
import {
  AccessDenied,
  type AccessAuthority,
  type Clock,
  type CustodyAccountView,
  type CustodyProjectionStore,
  type VerifiedPrincipal,
} from '../ports';
import { WalletApplicationError } from './errors';

/**
 * Same grants Billing uses for its authoritative custody reads (CR-B-08): a
 * collector sees their own position; Finance (`billing.read`) sees any holder.
 * Wallet-specific aliases are requested from Lane E in CONTRACT_REQUEST_E_WALLET.
 */
export const HOLDER_PERMISSION = 'billing.cash.collect';
export const FINANCE_READ_PERMISSION = 'billing.read';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface RequestContext {
  readonly credential: string | undefined;
  readonly correlationId: string;
}

export interface CustodyQueryDeps {
  readonly store: CustodyProjectionStore;
  readonly authority: AccessAuthority;
  readonly clock: Clock;
}

export class CustodyQueryService {
  constructor(private readonly deps: CustodyQueryDeps) {}

  /** The calling collector's own custody projection. Deny by default. */
  async myCustody(context: RequestContext) {
    const principal = await this.principal(context);
    if (principal.kind !== 'account' || !principal.permissions.includes(HOLDER_PERMISSION))
      throw new WalletApplicationError('AUTH_FORBIDDEN');
    return this.view(principal.subject);
  }

  /** Any holder's projection, for Finance only. */
  async holderCustody(context: RequestContext, subject: string) {
    const principal = await this.principal(context);
    if (!principal.permissions.includes(FINANCE_READ_PERMISSION))
      throw new WalletApplicationError('AUTH_FORBIDDEN');
    if (!UUID.test(subject)) throw new WalletApplicationError('REQUEST_INVALID');
    return this.view(subject.toLowerCase());
  }

  private async principal(context: RequestContext): Promise<VerifiedPrincipal> {
    try {
      return await this.deps.authority.verify(context.credential, context.correlationId);
    } catch (error: unknown) {
      if (error instanceof AccessDenied) throw new WalletApplicationError(error.reason);
      throw error;
    }
  }

  private async view(holder: string) {
    const accounts = await this.deps.store.accounts(holder);
    return {
      projection: 'wallet.technician-custody',
      // Billing's ledger is the authority; this is a derived, eventually
      // consistent read model. It never states that money was paid or settled
      // beyond what Billing's events reported.
      authoritative: false,
      authority: 'billing',
      holder,
      asOf: this.deps.clock.now().toISOString(),
      positions: accounts.map(positionView),
    };
  }
}

function positionView(account: CustodyAccountView) {
  const position: CustodyPosition = positionFromTotals(account.currency, account.totals);
  const m = (value: bigint) => moneyView(position.currency, value);
  return {
    currency: position.currency,
    collected: m(position.collected),
    reversed: m(position.reversed),
    held: m(position.held),
    inHandover: m(position.inHandover),
    receivedByTreasury: m(position.receivedByTreasury),
    settled: m(position.settled),
    outstanding: m(position.outstanding),
    shortage: m(position.shortage),
    overage: m(position.overage),
    complete: position.complete,
    source: {
      lastEventId: account.lastEventId,
      lastEventAt: account.lastEventAt.toISOString(),
      revision: account.revision,
      updatedAt: account.updatedAt.toISOString(),
    },
  };
}
