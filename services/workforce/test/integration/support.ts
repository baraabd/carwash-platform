import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { WORKFORCE_ELIGIBILITY_CHANGED_V1 } from '@carwash/event-contracts';
import { WorkforceService } from '../../src/application';
import { PrismaService } from '../../src/infrastructure/persistence/prisma.service';
import { PrismaWorkforceStore } from '../../src/infrastructure/persistence/prisma-workforce.store';
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

export function workforceAppUrl(): string {
  const db = laneContext().databases.workforce;
  if (!db) throw new Error('lane context has no workforce database');
  return db.appUrl;
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
  readonly store: PrismaWorkforceStore;
  readonly service: WorkforceService;
}

/** One "replica" = its own connection pool, like a separate process would have. */
export function replica(clock: Clock): Replica {
  const prisma = new PrismaService(workforceAppUrl());
  const store = new PrismaWorkforceStore(prisma);
  return { prisma, store, service: new WorkforceService(store, store, clock, uuidGenerator) };
}

export const OPS: Actor = {
  kind: 'USER',
  subject: randomUUID(),
  permissions: ['operations.dispatch'],
};
export const REVIEWER: Actor = {
  kind: 'USER',
  subject: randomUUID(),
  permissions: ['verification.review'],
};
export const CAPACITY_READER: Actor = {
  kind: 'SERVICE',
  clientId: 'scheduling',
  scopes: ['workforce.capacity.read'],
};

export function technician(subject: string): Extract<Actor, { kind: 'USER' }> {
  return { kind: 'USER', subject, permissions: ['work.read:assigned', 'work.execute:assigned'] };
}

export function meta(actor: Actor): RequestMeta {
  return { actor, correlationId: randomUUID() };
}

export function key(): string {
  return `it-${randomUUID()}`;
}

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

export interface ShiftSpec {
  readonly zoneId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

export interface Seeded {
  readonly operatorId: string;
  readonly subject: string;
}

/**
 * Creates an operator exactly through the application (no direct SQL):
 * profile, optional approved verification, skills and shifts.
 */
export async function seedOperator(
  r: Replica,
  clock: Clock,
  options: {
    readonly subject?: string;
    readonly shifts?: readonly ShiftSpec[];
    readonly verified?: boolean;
    readonly verifiedForMs?: number;
    readonly skills?: readonly string[];
  } = {},
): Promise<Seeded> {
  const subject = options.subject ?? randomUUID();
  const operator = await r.service.createOperator(meta(OPS), {
    identitySubject: subject,
    displayName: 'Integration Operator',
    homeZoneId: randomUUID(),
  });
  if (options.verified ?? true) {
    await verify(r, clock, subject, options.verifiedForMs ?? 365 * DAY);
  }
  for (const skill of options.skills ?? ['exterior-wash']) {
    await r.service.grantSkill(meta(OPS), operator.id, skill);
  }
  for (const shift of options.shifts ?? []) {
    await r.service.createShift(meta(technician(subject)), operator.id, shift, key());
  }
  return { operatorId: operator.id, subject };
}

export async function verify(
  r: Replica,
  clock: Clock,
  subject: string,
  validForMs = 365 * DAY,
): Promise<void> {
  const submitted = await r.service.submitVerification(
    meta(technician(subject)),
    [randomUUID()],
    key(),
  );
  await r.service.reviewVerification(meta(REVIEWER), submitted.id, {
    decision: 'APPROVE',
    validUntil: new Date(clock.now().getTime() + validForMs),
  });
}

export function shift(zoneId: string, startsAt: Date, hours: number): ShiftSpec {
  return { zoneId, startsAt, endsAt: new Date(startsAt.getTime() + hours * HOUR) };
}

/** Every published eligibility event of one resource, parsed by the PUBLISHED parser. */
export async function eligibilityEvents(r: Replica, operatorId: string) {
  const rows = await r.prisma.client.$queryRawUnsafe<
    Array<{ payload: string; event_type: string; exchange: string; routing_key: string }>
  >(
    `SELECT payload, event_type, exchange, routing_key FROM app.outbox_message
      WHERE event_type = 'workforce.eligibility-changed.v1'
        AND (payload::jsonb -> 'aggregate' ->> 'id') = $1
      ORDER BY (payload::jsonb -> 'aggregate' ->> 'version')::int`,
    operatorId,
  );
  return rows.map((row) => ({
    row,
    event: WORKFORCE_ELIGIBILITY_CHANGED_V1.parse(JSON.parse(row.payload)),
  }));
}

export async function sqlState(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'OK';
  } catch (error) {
    if (typeof error !== 'object' || error === null) return String(error);
    const meta: unknown = Reflect.get(error, 'meta');
    const adapter: unknown =
      typeof meta === 'object' && meta !== null ? Reflect.get(meta, 'driverAdapterError') : null;
    const cause: unknown =
      typeof adapter === 'object' && adapter !== null ? Reflect.get(adapter, 'cause') : null;
    if (typeof cause === 'object' && cause !== null) {
      const code: unknown = Reflect.get(cause, 'code') ?? Reflect.get(cause, 'originalCode');
      if (typeof code === 'string') return code;
    }
    const code: unknown = Reflect.get(error, 'code');
    return typeof code === 'string' ? code : 'UNKNOWN';
  }
}

export async function errorCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'OK';
  } catch (error) {
    if (typeof error === 'object' && error !== null) {
      const code: unknown = Reflect.get(error, 'code');
      if (typeof code === 'string') return code;
    }
    return error instanceof Error ? error.name : String(error);
  }
}
