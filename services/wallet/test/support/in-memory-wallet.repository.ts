import type { Currency, SourceKind, SourceState } from '../../src/domain';
import type {
  CustodyAccount,
  CustodyMovement,
  InboxRecord,
  WalletRepository,
  WalletUnitOfWork,
} from '../../src/ports';
import { ZERO } from '../../src/domain';

/**
 * TEST DOUBLE for fast unit tests of the projector rules. Transactions are
 * serial and roll back on error. Concurrency, locking and constraints are
 * proven against real PostgreSQL in test/integration, not here.
 */
export class InMemoryWalletRepository implements WalletRepository {
  inbox = new Map<string, InboxRecord>();
  sources = new Map<string, SourceState>();
  accounts = new Map<string, CustodyAccount>();
  movements: CustodyMovement[] = [];

  async transaction<T>(work: (uow: WalletUnitOfWork) => Promise<T>): Promise<T> {
    const snapshot = {
      inbox: new Map(this.inbox),
      sources: new Map(this.sources),
      accounts: new Map(this.accounts),
      movements: [...this.movements],
    };
    const uow: WalletUnitOfWork = {
      claimEvent: (record) => {
        if (this.inbox.has(record.eventId)) return Promise.resolve(false);
        this.inbox.set(record.eventId, record);
        return Promise.resolve(true);
      },
      lockSource: (kind: SourceKind, id: string) =>
        Promise.resolve(this.sources.get(`${kind}:${id}`) ?? null),
      saveSource: (state: SourceState) => {
        this.sources.set(`${state.kind}:${state.aggregateId}`, state);
        return Promise.resolve();
      },
      lockAccount: (holder: string, currency: Currency, at: Date) => {
        const key = `${holder}:${currency}`;
        const account = this.accounts.get(key) ?? {
          holder,
          currency,
          balances: ZERO,
          version: 0,
          updatedAt: at,
        };
        this.accounts.set(key, account);
        return Promise.resolve(account);
      },
      updateAccount: (account) => {
        this.accounts.set(`${account.holder}:${account.currency}`, account);
        return Promise.resolve();
      },
      appendMovement: (movement) => {
        this.movements.push(movement);
        return Promise.resolve();
      },
    };
    try {
      return await work(uow);
    } catch (error: unknown) {
      Object.assign(this, snapshot);
      throw error;
    }
  }

  inboxRecord(eventId: string): Promise<InboxRecord | null> {
    return Promise.resolve(this.inbox.get(eventId) ?? null);
  }

  accountsOf(holder: string): Promise<CustodyAccount[]> {
    return Promise.resolve([...this.accounts.values()].filter((a) => a.holder === holder));
  }

  movementsOf(holder: string): Promise<CustodyMovement[]> {
    return Promise.resolve(this.movements.filter((m) => m.holder === holder));
  }
}
