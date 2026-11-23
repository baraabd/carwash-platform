import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  BookingChangeService,
  DispatchService,
  EligibilityChangeHandler,
  HoldChangeHandler,
  TaskService,
  parseEligibilityChanged,
  parseHoldChanged,
} from '../../src/application';
import {
  DispatchError,
  type CapacityResource,
  type Eligibility,
  type JobWindow,
} from '../../src/domain';
import {
  PrismaInboxStore,
  type InboxOutcome,
} from '../../src/infrastructure/messaging/prisma-inbox.store';
import { PrismaService } from '../../src/infrastructure/persistence/prisma.service';
import { PrismaDispatchStore } from '../../src/infrastructure/persistence/prisma-dispatch.store';
import { uuidGenerator } from '../../src/infrastructure/runtime/system';
import type {
  Actor,
  Clock,
  EvidenceObject,
  EvidenceObjects,
  RequestMeta,
  WorkforceCapacity,
} from '../../src/ports';

/**
 * Real-infrastructure test support. Requires the lane-C stack:
 *   node scripts/production/C/stack.mjs up
 * The context is found through CW_PROD_C_CONTEXT or the stack's pointer file.
 * Connections use the RUNTIME role (DML only), never the migration role.
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
      ) as { contextFile: string }
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

/**
 * DOUBLE of Workforce's published listCapacityResources, narrowed to one
 * resource (port WorkforceCapacity). Default: every resource is ELIGIBLE with
 * a shift covering the job in its zone. The real provider/consumer pairing is
 * proven in tests/production/C (contract parity) and the P03-C merge candidate.
 */
export class WorkforceDouble implements WorkforceCapacity {
  private readonly state = new Map<
    string,
    { eligibility: Eligibility | 'UNLISTED'; revision: number }
  >();
  unavailable = false;
  calls = 0;

  set(resourceId: string, eligibility: Eligibility | 'UNLISTED', revision: number): void {
    this.state.set(resourceId, { eligibility, revision });
  }

  findResource(job: JobWindow, resourceId: string): Promise<CapacityResource | null> {
    return Promise.resolve().then(() => this.lookup(job, resourceId));
  }

  private lookup(job: JobWindow, resourceId: string): CapacityResource | null {
    this.calls += 1;
    if (this.unavailable) {
      throw new DispatchError('ELIGIBILITY_UNAVAILABLE', 'Workforce eligibility is unavailable.');
    }
    const entry = this.state.get(resourceId) ?? { eligibility: 'ELIGIBLE' as const, revision: 1 };
    if (entry.eligibility === 'UNLISTED') return null;
    return {
      resourceId,
      revision: 1,
      eligibility: entry.eligibility,
      eligibilityRevision: entry.revision,
      zoneIds: [job.zoneId],
      shifts: [
        {
          startsAt: new Date(job.startsAt.getTime() - 3_600_000),
          endsAt: new Date(job.endsAt.getTime() + 3_600_000),
        },
      ],
    };
  }
}

/** DOUBLE of the requested media.v1 object read/claim (port EvidenceObjects). */
export class MediaDouble implements EvidenceObjects {
  readonly objects = new Map<string, EvidenceObject>();
  readonly claims = new Map<string, Set<string>>();
  unavailable = false;

  add(ownerSubjectId: string, overrides: Partial<EvidenceObject> = {}): string {
    const objectId = randomUUID();
    this.objects.set(objectId, {
      objectId,
      status: 'AVAILABLE',
      purpose: 'WORK_EVIDENCE',
      contentType: 'image/jpeg',
      ownerSubjectId,
      ...overrides,
    });
    return objectId;
  }

  inspect(objectId: string): Promise<EvidenceObject | null> {
    return Promise.resolve().then(() => {
      if (this.unavailable) throw new DispatchError('EVIDENCE_UNAVAILABLE', 'Media unavailable.');
      return this.objects.get(objectId) ?? null;
    });
  }

  claim(objectId: string, claimRef: string): Promise<void> {
    return Promise.resolve().then(() => {
      if (this.unavailable) throw new DispatchError('EVIDENCE_UNAVAILABLE', 'Media unavailable.');
      const set = this.claims.get(objectId) ?? new Set<string>();
      set.add(claimRef);
      this.claims.set(objectId, set);
    });
  }
}

export const workforce = new WorkforceDouble();
export const media = new MediaDouble();

export interface Replica {
  readonly prisma: PrismaService;
  readonly store: PrismaDispatchStore;
  readonly service: DispatchService;
  readonly tasks: TaskService;
  readonly changes: BookingChangeService;
  readonly inbox: PrismaInboxStore;
  readonly handler: HoldChangeHandler;
  readonly eligibility: EligibilityChangeHandler;
}

/** One "replica" = its own connection pool, like a separate process would have. */
export function replica(clock: Clock): Replica {
  const prisma = new PrismaService(laneContext().databases.dispatch!.appUrl);
  const store = new PrismaDispatchStore(prisma);
  return {
    prisma,
    store,
    service: new DispatchService(store, store, clock, uuidGenerator, workforce),
    tasks: new TaskService(store, store, clock, uuidGenerator, media),
    changes: new BookingChangeService(store, store, clock, uuidGenerator),
    inbox: new PrismaInboxStore(store),
    handler: new HoldChangeHandler(clock, uuidGenerator),
    eligibility: new EligibilityChangeHandler(clock, uuidGenerator),
  };
}

export const OPS: Actor = {
  kind: 'USER',
  subject: '5c1d9a7e-1111-4a2b-8c3d-000000000001',
  permissions: ['operations.dispatch'],
};

export function technician(subject: string = randomUUID()): Extract<Actor, { kind: 'USER' }> {
  return { kind: 'USER', subject, permissions: ['work.read:assigned', 'work.execute:assigned'] };
}

/** Booking's service credential for the P04-C2 change commands. */
export const BOOKING: Actor = {
  kind: 'SERVICE',
  clientId: 'booking',
  scopes: ['dispatch.assignment.read', 'dispatch.booking.change'],
};

export function meta(actor: Actor): RequestMeta {
  return { actor, correlationId: randomUUID() };
}

export function key(): string {
  return `it-${randomUUID()}`;
}

export interface HoldSpec {
  readonly holdId: string;
  readonly zoneId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly bookingId: string;
}

export function holdSpec(clock: Clock, startOffsetMs = 2 * 3_600_000): HoldSpec {
  const startsAt = new Date(clock.now().getTime() + startOffsetMs);
  return {
    holdId: randomUUID(),
    zoneId: randomUUID(),
    startsAt,
    endsAt: new Date(startsAt.getTime() + 3_600_000),
    bookingId: randomUUID(),
  };
}

/** A `scheduling.hold-changed.v1` envelope exactly as the published contract defines it. */
export function holdChangedEvent(
  hold: HoldSpec,
  version: number,
  state: 'HELD' | 'COMMITTED' | 'RELEASED' | 'EXPIRED',
  eventId: string = randomUUID(),
): Record<string, unknown> {
  return {
    eventId,
    eventType: 'scheduling.hold-changed.v1',
    envelopeVersion: 2,
    producer: 'scheduling',
    occurredAt: new Date().toISOString(),
    correlationId: randomUUID(),
    causationId: null,
    traceparent: null,
    aggregate: { type: 'hold', id: hold.holdId, version },
    actor: { kind: 'service', id: 'booking' },
    data: {
      state,
      zoneId: hold.zoneId,
      startsAt: hold.startsAt.toISOString(),
      endsAt: hold.endsAt.toISOString(),
      bookingId: state === 'COMMITTED' ? hold.bookingId : null,
    },
  };
}

/** What the shared InboxConsumer does per message: parse, applyOnce, effect in the same tx. */
export async function deliver(
  target: Replica,
  raw: Record<string, unknown>,
  body: string = JSON.stringify(raw),
): Promise<{ outcome: InboxOutcome; effect: string | null }> {
  const message = parseHoldChanged(JSON.parse(body));
  let effect: string | null = null;
  const outcome = await target.inbox.applyOnce(
    {
      eventId: message.eventId,
      eventType: message.eventType,
      payloadHash: createHash('sha256').update(body, 'utf8').digest('hex'),
      correlationId: message.correlationId,
    },
    async (tx) => {
      effect = await target.handler.apply(tx, message);
      return effect;
    },
  );
  return { outcome, effect };
}

/** Commits a hold for a new booking and returns the opened assignment id. */
export async function openJob(target: Replica, clock: Clock, startOffsetMs?: number) {
  const hold = holdSpec(clock, startOffsetMs);
  const result = await deliver(target, holdChangedEvent(hold, 2, 'COMMITTED'));
  if (result.effect !== 'OPENED') throw new Error(`job not opened: ${result.effect}`);
  const assignment = await target.store.findAssignmentByBooking(hold.bookingId);
  if (!assignment) throw new Error('assignment missing');
  return { hold, assignment };
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

/** A workforce.eligibility-changed.v1 envelope exactly as the published contract defines it. */
export function eligibilityEvent(
  resourceId: string,
  revision: number,
  eligibility: Eligibility,
  eventId: string = randomUUID(),
): Record<string, unknown> {
  return {
    eventId,
    eventType: 'workforce.eligibility-changed.v1',
    envelopeVersion: 2,
    producer: 'workforce',
    occurredAt: new Date().toISOString(),
    correlationId: randomUUID(),
    causationId: null,
    traceparent: null,
    aggregate: { type: 'capacity-resource', id: resourceId, version: revision },
    actor: { kind: 'system', id: null },
    data: { eligibility },
  };
}

export async function deliverEligibility(
  target: Replica,
  raw: Record<string, unknown>,
): Promise<{ outcome: InboxOutcome; effect: string | null }> {
  const body = JSON.stringify(raw);
  const message = parseEligibilityChanged(JSON.parse(body));
  let effect: string | null = null;
  const outcome = await target.inbox.applyOnce(
    {
      eventId: message.eventId,
      eventType: message.eventType,
      payloadHash: createHash('sha256').update(body, 'utf8').digest('hex'),
      correlationId: message.correlationId,
    },
    async (tx) => {
      effect = await target.eligibility.apply(tx, message);
      return effect;
    },
  );
  return { outcome, effect };
}
