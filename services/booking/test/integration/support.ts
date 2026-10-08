import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { BookingProcessManager, BookingService } from '../../src/application';
import {
  money,
  type Money,
  type ObligationResult,
  type PrincipalRef,
  type VoidResult,
} from '../../src/domain';
import {
  parseAddressSnapshot,
  parseHold,
  parseQuote,
  parseVehicleSnapshot,
} from '../../src/infrastructure/owners/contract-acl';
import { PrismaService } from '../../src/infrastructure/persistence/prisma.service';
import { PrismaBookingStore } from '../../src/infrastructure/persistence/prisma-booking.store';
import { uuidGenerator } from '../../src/infrastructure/runtime/system';
import {
  UserCredential,
  type Actor,
  type AddressSnapshots,
  type BillingObligations,
  type Clock,
  type HoldCommit,
  type HoldCommitter,
  type HoldReader,
  type HoldView,
  type Observer,
  type QuoteRead,
  type QuoteReader,
  type QuoteValidation,
  type QuoteValidator,
  type ReadResult,
  type RequestMeta,
  type VehicleSnapshots,
} from '../../src/ports';
import { addressWire, HOUR, holdWire, quoteWire, vehicleWire } from '../support/fixtures';

/**
 * Real-infrastructure support. Requires the lane-C stack:
 *   node scripts/production/C/stack.mjs up
 * Connections use the RUNTIME role (DML only), never the migration role.
 *
 * Owner services are in-process doubles of the PORTS with the semantics their
 * published contracts define (idempotent commit by booking, void tombstone,
 * quote validation). They are declared as doubles in the evidence; the HTTP
 * adapters are tested separately against real HTTP servers.
 */
export interface LaneContext {
  readonly databases: Record<string, { appUrl: string; migrateUrl: string }>;
  readonly brokerUrl: string;
  readonly containers: Record<string, string>;
}

const ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');

export function laneContext(): LaneContext {
  const file =
    process.env.CW_PROD_C_CONTEXT ??
    (
      JSON.parse(
        readFileSync(path.join(ROOT, '.acceptance', 'production-C', 'current.json'), 'utf8'),
      ) as {
        contextFile: string;
      }
    ).contextFile;
  return JSON.parse(readFileSync(file, 'utf8')) as LaneContext;
}

export class TestClock implements Clock {
  constructor(private current: Date = new Date()) {}
  now(): Date {
    return new Date(this.current.getTime());
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export const silent: Observer = { record: () => undefined };

/** Outcome scripting: a queue of forced outcomes consumed before the default behaviour. */
type Script<T> = (() => Promise<T> | T)[];

export class FakePricing implements QuoteReader, QuoteValidator {
  readonly quotes = new Map<string, ReturnType<typeof quoteWire>>();
  readonly validateScript: Script<QuoteValidation> = [];
  validations = 0;

  constructor(private readonly clock: Clock) {}

  issue(beneficiary: PrincipalRef, zoneId: string | null = null) {
    const wire = quoteWire({ beneficiary, now: this.clock.now(), zoneId });
    this.quotes.set(wire.quoteId, wire);
    return wire;
  }

  read(quoteId: string): Promise<ReadResult<QuoteRead>> {
    const wire = this.quotes.get(quoteId);
    return Promise.resolve(
      wire
        ? { kind: 'OK', value: parseQuote(wire) }
        : { kind: 'NOT_USABLE', reason: 'QUOTE_NOT_FOUND' },
    );
  }

  async validate(input: {
    readonly quoteId: string;
    readonly revision: number;
  }): Promise<QuoteValidation> {
    this.validations += 1;
    const forced = this.validateScript.shift();
    if (forced) return forced();
    const wire = this.quotes.get(input.quoteId);
    if (!wire) return { kind: 'INVALID', reason: 'QUOTE_INVALID' };
    if (Date.parse(wire.expiresAt) <= this.clock.now().getTime())
      return { kind: 'INVALID', reason: 'QUOTE_EXPIRED' };
    return { kind: 'VALID', total: money('SYP', BigInt(wire.total.amountMinor)) };
  }
}

interface FakeHold {
  wire: ReturnType<typeof holdWire>;
}

/** scheduling.v1 hold semantics: commit once per hold, replay-safe by bookingId, expiry by clock. */
export class FakeScheduling implements HoldReader, HoldCommitter {
  readonly holds = new Map<string, FakeHold>();
  readonly commitScript: Script<HoldCommit> = [];
  /** Distinct state changes (HELD -> COMMITTED); replays do not count. */
  commitsApplied = 0;
  commitCalls = 0;
  /** Delay applied to every commit call, to widen race windows. */
  commitDelayMs = 0;

  constructor(private readonly clock: Clock) {}

  hold(beneficiary: PrincipalRef, zoneId: string = randomUUID()) {
    const now = this.clock.now();
    const wire = holdWire({
      beneficiary,
      zoneId,
      startsAt: new Date(now.getTime() + 3 * HOUR),
      now,
    });
    this.holds.set(wire.holdId, { wire });
    return wire;
  }

  read(holdId: string): Promise<ReadResult<HoldView>> {
    const hold = this.holds.get(holdId);
    return Promise.resolve(
      hold
        ? { kind: 'OK', value: parseHold(hold.wire) }
        : { kind: 'NOT_USABLE', reason: 'HOLD_NOT_FOUND' },
    );
  }

  /** The real effect, independent of what the caller is told. */
  apply(input: { holdId: string; expectedRevision: number; bookingId: string }): HoldCommit {
    const hold = this.holds.get(input.holdId);
    if (!hold) return { kind: 'REFUSED', reason: 'HOLD_UNAVAILABLE' };
    const w = hold.wire;
    const slot = {
      holdId: w.holdId,
      zoneId: w.zoneId,
      startsAt: new Date(w.startsAt),
      endsAt: new Date(w.endsAt),
    };
    if (w.state === 'COMMITTED') {
      return w.bookingId === input.bookingId
        ? { kind: 'COMMITTED', slot }
        : { kind: 'REFUSED', reason: 'HOLD_UNAVAILABLE' };
    }
    if (w.state !== 'HELD') return { kind: 'REFUSED', reason: 'HOLD_UNAVAILABLE' };
    if (Date.parse(w.expiresAt) <= this.clock.now().getTime()) {
      hold.wire = { ...w, state: 'EXPIRED', revision: w.revision + 1 };
      return { kind: 'REFUSED', reason: 'HOLD_EXPIRED' };
    }
    if (w.revision !== input.expectedRevision)
      return { kind: 'REFUSED', reason: 'HOLD_UNAVAILABLE' };
    hold.wire = { ...w, state: 'COMMITTED', revision: w.revision + 1, bookingId: input.bookingId };
    this.commitsApplied += 1;
    return { kind: 'COMMITTED', slot };
  }

  async commit(input: {
    holdId: string;
    expectedRevision: number;
    bookingId: string;
  }): Promise<HoldCommit> {
    this.commitCalls += 1;
    if (this.commitDelayMs > 0)
      await new Promise((resolve) => setTimeout(resolve, this.commitDelayMs));
    const forced = this.commitScript.shift();
    if (forced) return forced();
    return this.apply(input);
  }
}

/** Requested billing.v1 semantics: one obligation per booking, void leaves a tombstone. */
export class FakeBilling implements BillingObligations {
  readonly obligations = new Map<string, { id: string; amount: Money; state: 'OPEN' | 'VOIDED' }>();
  readonly tombstones = new Set<string>();
  readonly createScript: Script<ObligationResult> = [];
  readonly voidScript: Script<VoidResult> = [];
  createCalls = 0;

  apply(bookingId: string, amount: Money): ObligationResult {
    if (this.tombstones.has(bookingId)) return { kind: 'REJECTED' };
    const existing = this.obligations.get(bookingId);
    if (existing) return { kind: 'CREATED', obligationId: existing.id };
    const id = `obl_${randomUUID().replace(/-/g, '')}`;
    this.obligations.set(bookingId, { id, amount, state: 'OPEN' });
    return { kind: 'CREATED', obligationId: id };
  }

  async create(request: { bookingId: string; amount: Money }): Promise<ObligationResult> {
    this.createCalls += 1;
    const forced = this.createScript.shift();
    if (forced) return forced();
    return this.apply(request.bookingId, request.amount);
  }

  async voidForBooking(bookingId: string): Promise<VoidResult> {
    const forced = this.voidScript.shift();
    if (forced) return forced();
    this.tombstones.add(bookingId);
    const existing = this.obligations.get(bookingId);
    if (existing) existing.state = 'VOIDED';
    return { kind: 'VOIDED' };
  }
}

export class FakeSnapshots {
  constructor(private readonly clock: Clock) {}
  readonly vehicles: VehicleSnapshots = {
    resolve: (request) =>
      Promise.resolve({
        kind: 'OK',
        value: parseVehicleSnapshot(
          vehicleWire(request.id, request.expectedRevision, this.clock.now()),
        ),
      }),
  };
  readonly addresses: AddressSnapshots = {
    resolve: (request) =>
      Promise.resolve({
        kind: 'OK',
        value: parseAddressSnapshot(
          addressWire(request.id, request.expectedRevision, this.clock.now()),
        ),
      }),
  };
}

export interface Harness {
  readonly prisma: PrismaService;
  readonly store: PrismaBookingStore;
  readonly saga: BookingProcessManager;
  readonly service: BookingService;
}

export interface Owners {
  readonly clock: TestClock;
  readonly pricing: FakePricing;
  readonly scheduling: FakeScheduling;
  readonly billing: FakeBilling;
  readonly snapshots: FakeSnapshots;
}

export function owners(clock = new TestClock()): Owners {
  return {
    clock,
    pricing: new FakePricing(clock),
    scheduling: new FakeScheduling(clock),
    billing: new FakeBilling(),
    snapshots: new FakeSnapshots(clock),
  };
}

/** One "replica" = its own pool and instance id, like a separate process. */
export function replica(
  o: Owners,
  options: { instanceId?: string; leaseMs?: number; inlineBudgetMs?: number } = {},
): Harness {
  const prisma = new PrismaService(laneContext().databases.booking!.appUrl);
  const leaseMs = options.leaseMs ?? 30_000;
  const store = new PrismaBookingStore(prisma, { sagaLeaseMs: leaseMs });
  const saga = new BookingProcessManager({
    store,
    quotes: o.pricing,
    billing: o.billing,
    holds: o.scheduling,
    clock: o.clock,
    ids: uuidGenerator,
    random: { next: () => 0.5 },
    observer: silent,
    leaseMs,
    traceparent: () => null,
  });
  const service = new BookingService({
    store,
    quotes: o.pricing,
    holds: o.scheduling,
    vehicles: o.snapshots.vehicles,
    addresses: o.snapshots.addresses,
    saga,
    clock: o.clock,
    ids: uuidGenerator,
    observer: silent,
    instanceId: options.instanceId ?? `test-${randomUUID().slice(0, 8)}`,
    inlineBudgetMs: options.inlineBudgetMs ?? 5_000,
    claimLeaseMs: 30_000,
  });
  return { prisma, store, saga, service };
}

export function customer(kind: 'account' | 'guest' = 'account'): {
  principal: PrincipalRef;
  meta: () => RequestMeta;
} {
  const subject = randomUUID();
  const actor: Actor = {
    kind: 'USER',
    principalKind: kind,
    subject,
    permissions: ['bookings.create:self', 'bookings.read:self'],
  };
  return {
    principal: { kind, subjectId: subject },
    meta: () => ({
      actor,
      correlationId: randomUUID(),
      credential: new UserCredential('Bearer test-token-0000000000'),
    }),
  };
}

/** A complete, valid create body for this principal, with fresh owner records. */
export function bookingBody(
  o: Owners,
  who: PrincipalRef,
  overrides: { holdId?: string; quoteId?: string } = {},
) {
  const zoneId = randomUUID();
  const quote = overrides.quoteId
    ? o.pricing.quotes.get(overrides.quoteId)!
    : o.pricing.issue(who, zoneId);
  const hold = overrides.holdId
    ? o.scheduling.holds.get(overrides.holdId)!.wire
    : o.scheduling.hold(who, quote.zoneId ?? zoneId);
  return {
    quote: { quoteId: quote.quoteId, revision: quote.revision },
    hold: { holdId: hold.holdId, revision: hold.revision },
    vehicle: { source: 'saved', vehicleId: randomUUID(), revision: 2 },
    address: { addressId: randomUUID(), revision: 1 },
    contact: { name: 'سارة أحمد', phone: '0912345678', notes: null },
    paymentMethod: 'CASH_ON_COMPLETION',
  };
}

export function key(): string {
  return `it-${randomUUID()}`;
}

export async function errorCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : (error as Error).name;
  }
  return 'OK';
}

export async function count(h: Harness, sql: string, ...params: unknown[]): Promise<number> {
  const [row] = await h.prisma.client.$queryRawUnsafe<{ n: bigint }[]>(sql, ...params);
  return Number(row?.n ?? 0);
}
