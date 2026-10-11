import { randomUUID } from 'node:crypto';
import { ChangeProcessManager, ChangeService } from '../../src/application';
import type {
  CapacityReleaseResult,
  ConfirmResult,
  DispatchCancelResult,
  PrincipalRef,
  RebindResult,
  ReplaceResult,
  RevertResult,
  SettlementResult,
  SlotSnapshot,
} from '../../src/domain';
import { PrismaChangeStore } from '../../src/infrastructure/persistence/prisma-change.store';
import { uuidGenerator } from '../../src/infrastructure/runtime/system';
import type {
  BillingCancellation,
  CommitmentChanges,
  DispatchChanges,
  Observer,
} from '../../src/ports';
import { HOUR, holdWire } from '../support/fixtures';
import { silent, type Harness, type Owners } from './support';

/**
 * In-process doubles of the P04-C3 owner PORTS with the semantics the
 * requested contracts define (P04-C-interfaces.md): Dispatch's work-progress
 * gate and change-id replay, Scheduling's commitment replace/release replayed
 * by booking, Billing's settlement. They are declared as doubles in the
 * evidence; the real providers are proven in their own child PRs and together
 * in the P04-C merge candidate.
 *
 * Fault scripting per call:
 *   'LOSE'  apply the effect, then answer UNKNOWN (response lost after commit),
 *   'FAIL'  answer UNKNOWN without applying (request lost before the owner),
 *   or a function returning a forced answer.
 */
export type Fault<T> = 'LOSE' | 'FAIL' | (() => T);

async function faulted<T>(script: Fault<T>[], apply: () => T, unknown: T): Promise<T> {
  await Promise.resolve();
  const fault = script.shift();
  if (fault === 'FAIL') return unknown;
  if (fault === 'LOSE') {
    apply();
    return unknown;
  }
  if (typeof fault === 'function') return fault();
  return apply();
}

type Work = 'NOT_STARTED' | 'STARTED' | 'COMPLETED';

interface Job {
  status: 'OPEN' | 'CANCELLED' | 'TOMBSTONE';
  work: Work;
  holdId: string | null;
  pending: string | null;
  original: string | null;
}

/** Dispatch §C2 semantics: gate, tombstone, rebind/confirm/revert, replay by change id. */
export class FakeDispatchChanges implements DispatchChanges {
  readonly jobs = new Map<string, Job>();
  readonly changes = new Map<string, string>();
  readonly cancelScript: Fault<DispatchCancelResult>[] = [];
  readonly rebindScript: Fault<RebindResult>[] = [];
  readonly confirmScript: Fault<ConfirmResult>[] = [];
  readonly revertScript: Fault<RevertResult>[] = [];
  /** Bookings whose job Dispatch has not opened yet. */
  readonly notOpened = new Set<string>();
  effects = { cancelled: 0, rebound: 0, confirmed: 0, reverted: 0 };

  private job(bookingId: string): Job {
    let job = this.jobs.get(bookingId);
    if (!job) {
      job = { status: 'OPEN', work: 'NOT_STARTED', holdId: null, pending: null, original: null };
      this.jobs.set(bookingId, job);
    }
    return job;
  }

  setWork(bookingId: string, work: Work): void {
    this.job(bookingId).work = work;
  }

  cancel(bookingId: string, changeId: string): Promise<DispatchCancelResult> {
    return faulted<DispatchCancelResult>(
      this.cancelScript,
      () => {
        const job = this.job(bookingId);
        if (job.status === 'CANCELLED' || job.status === 'TOMBSTONE') {
          return { kind: job.status === 'CANCELLED' ? 'CANCELLED' : 'NOT_OPENED' };
        }
        if (job.work === 'STARTED') return { kind: 'REFUSED', reason: 'WORK_STARTED' };
        if (job.work === 'COMPLETED') return { kind: 'REFUSED', reason: 'WORK_COMPLETED' };
        const tomb = this.notOpened.has(bookingId);
        job.status = tomb ? 'TOMBSTONE' : 'CANCELLED';
        job.pending = null;
        this.changes.set(changeId, 'CANCELLATION');
        this.effects.cancelled += 1;
        return { kind: tomb ? 'NOT_OPENED' : 'CANCELLED' };
      },
      { kind: 'UNKNOWN', error: 'TIMEOUT' },
    );
  }

  rebind(bookingId: string, changeId: string, slot: SlotSnapshot): Promise<RebindResult> {
    return faulted<RebindResult>(
      this.rebindScript,
      () => {
        const job = this.job(bookingId);
        if (this.changes.get(changeId) === 'REVERTED')
          return { kind: 'UNKNOWN', error: 'CHANGE_REVERTED' };
        if (this.changes.has(changeId)) return { kind: 'REBOUND' };
        if (this.notOpened.has(bookingId)) return { kind: 'NOT_READY' };
        if (job.status !== 'OPEN') return { kind: 'REFUSED', reason: 'BOOKING_CANCELLED' };
        if (job.work === 'STARTED') return { kind: 'REFUSED', reason: 'WORK_STARTED' };
        if (job.work === 'COMPLETED') return { kind: 'REFUSED', reason: 'WORK_COMPLETED' };
        job.original = job.holdId;
        job.holdId = slot.holdId;
        job.pending = changeId;
        this.changes.set(changeId, 'REBOUND');
        this.effects.rebound += 1;
        return { kind: 'REBOUND' };
      },
      { kind: 'UNKNOWN', error: 'TIMEOUT' },
    );
  }

  confirm(bookingId: string, changeId: string): Promise<ConfirmResult> {
    return faulted<ConfirmResult>(
      this.confirmScript,
      () => {
        const state = this.changes.get(changeId);
        if (state === 'CONFIRMED') return { kind: 'CONFIRMED' };
        if (state !== 'REBOUND') return { kind: 'UNKNOWN', error: 'HTTP_409' };
        this.job(bookingId).pending = null;
        this.changes.set(changeId, 'CONFIRMED');
        this.effects.confirmed += 1;
        return { kind: 'CONFIRMED' };
      },
      { kind: 'UNKNOWN', error: 'TIMEOUT' },
    );
  }

  revert(bookingId: string, changeId: string): Promise<RevertResult> {
    return faulted<RevertResult>(
      this.revertScript,
      () => {
        const state = this.changes.get(changeId);
        if (state === 'CONFIRMED') return { kind: 'UNKNOWN', error: 'HTTP_409' };
        if (state === 'REBOUND') {
          const job = this.job(bookingId);
          job.holdId = job.original;
          job.pending = null;
          this.effects.reverted += 1;
        }
        this.changes.set(changeId, 'REVERTED');
        return { kind: 'REVERTED' };
      },
      { kind: 'UNKNOWN', error: 'TIMEOUT' },
    );
  }
}

/** Scheduling §C1 semantics over the shared FakeScheduling holds. */
export class FakeCommitments implements CommitmentChanges {
  readonly releaseScript: Fault<CapacityReleaseResult>[] = [];
  readonly replaceScript: Fault<ReplaceResult>[] = [];
  effects = { released: 0, replaced: 0 };
  private readonly releasedFor = new Map<string, string>();

  constructor(private readonly o: Owners) {}

  release(bookingId: string, holdId: string): Promise<CapacityReleaseResult> {
    return faulted<CapacityReleaseResult>(
      this.releaseScript,
      () => {
        const hold = this.o.scheduling.holds.get(holdId);
        if (!hold) return { kind: 'NOT_COMMITTED' };
        if (hold.wire.state === 'RELEASED' && this.releasedFor.get(holdId) === bookingId) {
          return { kind: 'RELEASED' };
        }
        if (hold.wire.state !== 'COMMITTED' || hold.wire.bookingId !== bookingId) {
          return { kind: 'NOT_COMMITTED' };
        }
        this.releasedFor.set(holdId, bookingId);
        hold.wire = {
          ...hold.wire,
          state: 'RELEASED',
          bookingId: null,
          revision: hold.wire.revision + 1,
        };
        this.effects.released += 1;
        return { kind: 'RELEASED' };
      },
      { kind: 'UNKNOWN', error: 'TIMEOUT' },
    );
  }

  replace(input: {
    readonly bookingId: string;
    readonly fromHoldId: string;
    readonly toHoldId: string;
    readonly toExpectedRevision: number;
  }): Promise<ReplaceResult> {
    return faulted<ReplaceResult>(
      this.replaceScript,
      () => {
        const from = this.o.scheduling.holds.get(input.fromHoldId);
        const to = this.o.scheduling.holds.get(input.toHoldId);
        if (!from || !to) return { kind: 'REFUSED', reason: 'HOLD_UNAVAILABLE' };
        const slotOf = (w: typeof to.wire): SlotSnapshot => ({
          holdId: w.holdId,
          zoneId: w.zoneId,
          startsAt: new Date(w.startsAt),
          endsAt: new Date(w.endsAt),
        });
        if (to.wire.state === 'COMMITTED' && to.wire.bookingId === input.bookingId) {
          return { kind: 'REPLACED', slot: slotOf(to.wire) };
        }
        if (from.wire.state !== 'COMMITTED' || from.wire.bookingId !== input.bookingId) {
          return { kind: 'REFUSED', reason: 'HOLD_UNAVAILABLE' };
        }
        if (to.wire.state !== 'HELD') return { kind: 'REFUSED', reason: 'HOLD_NOT_ACTIVE' };
        if (Date.parse(to.wire.expiresAt) <= this.o.clock.now().getTime()) {
          to.wire = { ...to.wire, state: 'EXPIRED', revision: to.wire.revision + 1 };
          return { kind: 'REFUSED', reason: 'HOLD_EXPIRED' };
        }
        if (to.wire.revision !== input.toExpectedRevision) {
          return { kind: 'REFUSED', reason: 'HOLD_NOT_ACTIVE' };
        }
        from.wire = {
          ...from.wire,
          state: 'RELEASED',
          bookingId: null,
          revision: from.wire.revision + 1,
        };
        to.wire = {
          ...to.wire,
          state: 'COMMITTED',
          bookingId: input.bookingId,
          revision: to.wire.revision + 1,
        };
        this.effects.replaced += 1;
        return { kind: 'REPLACED', slot: slotOf(to.wire) };
      },
      { kind: 'UNKNOWN', error: 'TIMEOUT' },
    );
  }
}

/** Billing settlement (requested from Lane B): VOIDED unless a payment was reported. */
export class FakeBillingCancellation implements BillingCancellation {
  readonly script: Fault<SettlementResult>[] = [];
  /** Bookings with a reported or verified payment: Billing must open a refund case. */
  readonly paid = new Set<string>();
  /** false = the route does not exist yet (the real situation until Lane B ships it). */
  available = true;
  readonly settled = new Map<string, SettlementResult>();
  calls = 0;

  settle(bookingId: string): Promise<SettlementResult> {
    this.calls += 1;
    if (!this.available) return Promise.resolve({ kind: 'UNKNOWN', error: 'HTTP_404' });
    return faulted<SettlementResult>(
      this.script,
      () => {
        const known = this.settled.get(bookingId);
        if (known) return known;
        const result: SettlementResult = {
          kind: 'SETTLED',
          settlement: this.paid.has(bookingId) ? 'REFUND_PENDING' : 'VOIDED',
        };
        this.settled.set(bookingId, result);
        return result;
      },
      { kind: 'UNKNOWN', error: 'TIMEOUT' },
    );
  }
}

export interface ChangeOwners {
  readonly dispatch: FakeDispatchChanges;
  readonly commitments: FakeCommitments;
  readonly billing: FakeBillingCancellation;
}

export function changeOwners(o: Owners): ChangeOwners {
  return {
    dispatch: new FakeDispatchChanges(),
    commitments: new FakeCommitments(o),
    billing: new FakeBillingCancellation(),
  };
}

export interface ChangeHarness {
  readonly store: PrismaChangeStore;
  readonly manager: ChangeProcessManager;
  readonly service: ChangeService;
}

export function changeReplica(
  h: Harness,
  o: Owners,
  c: ChangeOwners,
  options: {
    instanceId?: string;
    leaseMs?: number;
    inlineBudgetMs?: number;
    observer?: Observer;
  } = {},
): ChangeHarness {
  const leaseMs = options.leaseMs ?? 30_000;
  const store = new PrismaChangeStore(h.prisma, { leaseMs });
  const observer = options.observer ?? silent;
  const manager = new ChangeProcessManager({
    changes: store,
    bookings: h.store,
    dispatch: c.dispatch,
    commitments: c.commitments,
    billing: c.billing,
    clock: o.clock,
    ids: uuidGenerator,
    random: { next: () => 0 },
    observer,
    leaseMs,
    traceparent: () => null,
  });
  const service = new ChangeService({
    bookings: h.store,
    changes: store,
    holds: o.scheduling,
    manager,
    clock: o.clock,
    ids: uuidGenerator,
    observer,
    instanceId: options.instanceId ?? `change-${randomUUID().slice(0, 8)}`,
    inlineBudgetMs: options.inlineBudgetMs ?? 5_000,
  });
  return { store, manager, service };
}

/** A new HELD hold for the same principal, zone and duration, `hoursAhead` from now. */
export function newHold(o: Owners, who: PrincipalRef, zoneId: string, hoursAhead = 6) {
  const now = o.clock.now();
  const wire = holdWire({
    beneficiary: who,
    zoneId,
    startsAt: new Date(now.getTime() + hoursAhead * HOUR),
    now,
  });
  o.scheduling.holds.set(wire.holdId, { wire });
  return wire;
}
