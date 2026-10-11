import { positionOf, type Currency, type HandoverState, type ReceiptState } from '../../src/domain';
import type {
  AccountRef,
  CommittedInbox,
  CustodyAccountView,
  CustodyProjectionStore,
  CustodyUnitOfWork,
  InboxEntry,
  MovementRecord,
} from '../../src/ports';

interface Account {
  ref: AccountRef;
  view: CustodyAccountView | null;
  revision: number;
}

interface State {
  inbox: Map<string, InboxEntry>;
  conflicts: { eventId: string; payloadHash: string }[];
  receipts: Map<string, ReceiptState>;
  handovers: Map<string, HandoverState>;
  accounts: Map<string, Account>;
  movements: MovementRecord[];
}

const clone = (state: State): State => ({
  inbox: new Map(state.inbox),
  conflicts: [...state.conflicts],
  receipts: new Map(state.receipts),
  handovers: new Map(state.handovers),
  accounts: new Map([...state.accounts].map(([k, v]) => [k, { ...v }])),
  movements: [...state.movements],
});

/**
 * IN-MEMORY test double of the custody store: serialised transactions with
 * copy-on-write rollback, balances derived with the domain reference fold.
 * Proves application semantics only; the PostgreSQL adapter has its own
 * real-database specs.
 */
export class MemoryCustodyStore implements CustodyProjectionStore {
  state: State = {
    inbox: new Map(),
    conflicts: [],
    receipts: new Map(),
    handovers: new Map(),
    accounts: new Map(),
    movements: [],
  };
  private queue: Promise<unknown> = Promise.resolve();
  /** When set, the next transaction throws after its work (simulated crash). */
  failNextCommit = false;

  transaction<T>(work: (uow: CustodyUnitOfWork) => Promise<T>): Promise<T> {
    const run = async () => {
      const draft = clone(this.state);
      const result = await work(new MemoryUnitOfWork(draft));
      if (this.failNextCommit) {
        this.failNextCommit = false;
        throw new Error('SIMULATED_COMMIT_FAILURE');
      }
      this.state = draft;
      return result;
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  accounts(holder: string): Promise<CustodyAccountView[]> {
    return Promise.resolve(
      [...this.state.accounts.values()]
        .filter((a) => a.ref.holder === holder && a.view !== null)
        .map((a) => a.view as CustodyAccountView)
        .sort((a, b) => a.currency.localeCompare(b.currency)),
    );
  }
}

class MemoryUnitOfWork implements CustodyUnitOfWork {
  constructor(private readonly s: State) {}

  inbox(eventId: string): Promise<CommittedInbox | null> {
    const row = this.s.inbox.get(eventId);
    return Promise.resolve(row ? { payloadHash: row.payloadHash, outcome: row.outcome } : null);
  }
  claimInbox(entry: InboxEntry): Promise<boolean> {
    if (this.s.inbox.has(entry.eventId)) return Promise.resolve(false);
    this.s.inbox.set(entry.eventId, entry);
    return Promise.resolve(true);
  }
  recordInboxConflict(eventId: string, payloadHash: string): Promise<void> {
    this.s.conflicts.push({ eventId, payloadHash });
    return Promise.resolve();
  }
  async lockAggregate(): Promise<void> {}
  receipt(id: string): Promise<ReceiptState | null> {
    return Promise.resolve(this.s.receipts.get(id) ?? null);
  }
  saveReceipt(state: ReceiptState): Promise<void> {
    this.s.receipts.set(state.receiptId, state);
    return Promise.resolve();
  }
  handover(id: string): Promise<HandoverState | null> {
    return Promise.resolve(this.s.handovers.get(id) ?? null);
  }
  saveHandover(state: HandoverState): Promise<void> {
    this.s.handovers.set(state.handoverId, state);
    return Promise.resolve();
  }
  lockAccount(holder: string, currency: Currency, newId: string): Promise<AccountRef> {
    const key = `${holder}|${currency}`;
    const existing = this.s.accounts.get(key);
    if (existing) return Promise.resolve(existing.ref);
    const ref = { id: newId, holder, currency };
    this.s.accounts.set(key, { ref, view: null, revision: 0 });
    return Promise.resolve(ref);
  }
  refreshAccount(
    ref: AccountRef,
    last: { eventId: string; occurredAt: Date },
    now: Date,
  ): Promise<number> {
    const account = this.s.accounts.get(`${ref.holder}|${ref.currency}`);
    if (!account) throw new Error('MEMORY_ACCOUNT_MISSING');
    const p = positionOf(
      ref.holder,
      ref.currency,
      [...this.s.receipts.values()],
      [...this.s.handovers.values()],
    );
    account.revision += 1;
    const lastEventAt =
      account.view && account.view.lastEventAt > last.occurredAt
        ? account.view.lastEventAt
        : last.occurredAt;
    account.view = {
      currency: ref.currency,
      totals: {
        collected: p.collected,
        reversed: p.reversed,
        inHandover: p.inHandover,
        receivedByTreasury: p.receivedByTreasury,
        settled: p.settled,
        shortage: p.shortage,
        overage: p.overage,
      },
      revision: account.revision,
      lastEventId: last.eventId,
      lastEventAt,
      updatedAt: now,
    };
    return Promise.resolve(account.revision);
  }
  appendMovement(movement: MovementRecord): Promise<void> {
    if (
      this.s.movements.some(
        (m) => m.eventId === movement.eventId && m.account.id === movement.account.id,
      )
    )
      throw new Error('MEMORY_MOVEMENT_DUPLICATE');
    this.s.movements.push(movement);
    return Promise.resolve();
  }
}
