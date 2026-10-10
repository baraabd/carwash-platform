import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { CapacityService, CommitmentsService, HoldsV1Service } from '../../src/application';
import { PrismaService } from '../../src/infrastructure/persistence/prisma.service';
import { PrismaSchedulingStore } from '../../src/infrastructure/persistence/prisma-scheduling.store';
import { uuidGenerator } from '../../src/infrastructure/runtime/system';
import type { Actor, Clock, RequestMeta } from '../../src/ports';

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

export interface Replica {
  readonly prisma: PrismaService;
  readonly store: PrismaSchedulingStore;
  readonly holds: HoldsV1Service;
  readonly capacity: CapacityService;
  readonly commitments: CommitmentsService;
}

/** One "replica" = its own connection pool, like a separate process would have. */
export function replica(clock: Clock): Replica {
  const prisma = new PrismaService(laneContext().databases.scheduling!.appUrl);
  const store = new PrismaSchedulingStore(prisma);
  return {
    prisma,
    store,
    holds: new HoldsV1Service(store, store, clock, uuidGenerator),
    capacity: new CapacityService(store, store, clock, uuidGenerator),
    commitments: new CommitmentsService(store, store, clock, uuidGenerator),
  };
}

export const OPS: Actor = {
  kind: 'USER',
  principalKind: 'account',
  subject: '5c1d9a7e-1111-4a2b-8c3d-000000000001',
  permissions: ['operations.dispatch'],
};
export const BOOKING: Actor = {
  kind: 'SERVICE',
  clientId: 'booking',
  scopes: ['scheduling.hold.commit', 'scheduling.commitment.change'],
};
export const NO_SCOPE: Actor = { kind: 'SERVICE', clientId: 'dispatch', scopes: [] };

/** A fresh guest or account principal (Identity subject UUID, lower case). */
export function principal(kind: 'account' | 'guest' = 'guest'): Extract<Actor, { kind: 'USER' }> {
  return {
    kind: 'USER',
    principalKind: kind,
    subject: randomUUID(),
    permissions: ['bookings.create:self'],
  };
}

export function meta(actor: Actor): RequestMeta {
  return { actor, correlationId: randomUUID() };
}

export function key(): string {
  return `it-${randomUUID()}`;
}

export async function defineWindow(
  service: CapacityService,
  clock: Clock,
  capacity: number,
  zoneId: string = randomUUID(),
  startOffsetMs = 2 * 3_600_000,
) {
  const startsAt = new Date(clock.now().getTime() + startOffsetMs);
  const endsAt = new Date(startsAt.getTime() + 3_600_000);
  return (await service.defineWindow(meta(OPS), { zoneId, startsAt, endsAt, capacity })).value;
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

/** A scheduling.v1 hold request for one principal, starting inside a window. */
export function holdRequestFor(
  who: Extract<Actor, { kind: 'USER' }>,
  window: { readonly zoneId: string; readonly startsAt: Date },
  durationMinutes = 30,
  offsetMinutes = 0,
) {
  return {
    beneficiary: { kind: who.principalKind, subjectId: who.subject },
    zoneId: window.zoneId,
    startsAt: new Date(window.startsAt.getTime() + offsetMinutes * 60_000),
    durationMinutes,
    quoteRef: { quoteId: randomUUID(), revision: 1 },
  };
}

/** Body of a stored v1 hold response. */
export function holdOf(response: { readonly body: unknown }): {
  readonly holdId: string;
  readonly revision: number;
  readonly state: string;
  readonly bookingId: string | null;
} {
  return response.body as {
    holdId: string;
    revision: number;
    state: string;
    bookingId: string | null;
  };
}
