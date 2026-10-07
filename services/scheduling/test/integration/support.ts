import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { SchedulingService } from '../../src/application';
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
  readonly service: SchedulingService;
}

/** One "replica" = its own connection pool, like a separate process would have. */
export function replica(clock: Clock): Replica {
  const prisma = new PrismaService(laneContext().databases.scheduling!.appUrl);
  const store = new PrismaSchedulingStore(prisma);
  return { prisma, store, service: new SchedulingService(store, store, clock, uuidGenerator) };
}

export const OPS: Actor = {
  kind: 'USER',
  subject: '5c1d9a7e-1111-4a2b-8c3d-000000000001',
  permissions: ['operations.dispatch'],
};
export const BOOKING: Actor = {
  kind: 'SERVICE',
  clientId: 'booking',
  scopes: ['scheduling.holds.write'],
};
export const OTHER_SERVICE: Actor = {
  kind: 'SERVICE',
  clientId: 'dispatch',
  scopes: ['scheduling.holds.write'],
};

export function meta(actor: Actor): RequestMeta {
  return { actor, correlationId: randomUUID() };
}

export function key(): string {
  return `it-${randomUUID()}`;
}

export async function defineWindow(
  service: SchedulingService,
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
