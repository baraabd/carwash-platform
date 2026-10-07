import { createHash } from 'node:crypto';
import {
  applyVehicleChanges,
  parseVehicleDetails,
  sameVehicleDetails,
  VehicleDomainError,
  type Vehicle,
  type VehicleType,
} from '../domain';
import type {
  AuthorizedSession,
  Clock,
  IdGenerator,
  IdentityAuthorizer,
  SessionCredentials,
  VehicleStore,
  VehicleTransaction,
} from '../ports';
import { ApplicationError } from './errors';
import { vehicleUpdatedEvent, type EventContext, type VehicleChange } from './events';

/**
 * Identity V1 has no vehicle-specific permission. Saved vehicles are part of
 * the customer's own profile data, so the existing self-profile permissions
 * gate them; a narrower permission is a Lane E/Identity request.
 */
export const READ_PERMISSION = 'profile.read:self';
export const WRITE_PERMISSION = 'profile.write:self';
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/;
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export interface VehiclePolicy {
  /**
   * Technical abuse ceiling on ACTIVE vehicles per owner. The prototype's 30 is
   * a demo cap, not an approved product limit.
   */
  readonly maxActiveVehicles: number;
}

export interface RequestContext {
  readonly credentials: SessionCredentials;
  readonly correlationId: string;
  readonly traceParent: string | null;
}

export interface VehicleView {
  readonly vehicleId: string;
  readonly type: VehicleType;
  readonly displayName: string | null;
  readonly plate: string | null;
  readonly color: string | null;
  readonly status: 'ACTIVE' | 'ARCHIVED';
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt: string | null;
}

export interface Outcome<T> {
  readonly status: number;
  readonly body: T;
  readonly replayed: boolean;
}

export function vehicleView(vehicle: Vehicle): VehicleView {
  return {
    vehicleId: vehicle.id,
    type: vehicle.type,
    displayName: vehicle.displayName,
    plate: vehicle.plate,
    color: vehicle.color,
    status: vehicle.status,
    revision: vehicle.revision,
    createdAt: vehicle.createdAt.toISOString(),
    updatedAt: vehicle.updatedAt.toISOString(),
    archivedAt: vehicle.archivedAt ? vehicle.archivedAt.toISOString() : null,
  };
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new VehicleDomainError('INVALID_INPUT');
  }
  return value as Record<string, unknown>;
}

function requireRevision(value: number | null): number {
  if (value === null) throw new ApplicationError('REVISION_REQUIRED');
  return value;
}

/**
 * Vehicle use cases. Each write commits its idempotency record, state change,
 * outbox event and audit fact in one local transaction.
 */
export class VehicleApplication {
  constructor(
    private readonly store: VehicleStore,
    private readonly identity: IdentityAuthorizer,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly policy: VehiclePolicy,
  ) {
    if (!Number.isSafeInteger(policy.maxActiveVehicles) || policy.maxActiveVehicles < 1) {
      throw new Error('INVALID_VEHICLE_POLICY');
    }
  }

  private async session(context: RequestContext, permission: string): Promise<AuthorizedSession> {
    const session = await this.identity.authorize(
      context.credentials,
      permission === READ_PERMISSION ? 'read' : 'write',
    );
    if (!session.permissions.includes(permission)) throw new ApplicationError('AUTH_FORBIDDEN');
    return session;
  }

  private eventContext(context: RequestContext, now: Date): EventContext {
    return {
      eventId: this.ids.uuid(),
      occurredAt: now,
      correlationId: context.correlationId,
      traceParent: context.traceParent,
    };
  }

  private async record(
    tx: VehicleTransaction,
    context: RequestContext,
    session: AuthorizedSession,
    vehicle: Vehicle,
    change: VehicleChange,
    now: Date,
  ): Promise<void> {
    await tx.appendOutbox(vehicleUpdatedEvent(this.eventContext(context, now), vehicle, change));
    await tx.appendAudit({
      id: this.ids.uuid(),
      actorSubject: session.principal.subject,
      actorSessionId: session.sessionId,
      action: `vehicle.${change}`,
      vehicleId: vehicle.id,
      correlationId: context.correlationId,
      at: now,
    });
  }

  private async withIdempotency<T>(
    tx: VehicleTransaction,
    session: AuthorizedSession,
    key: string | null,
    operation: string,
    input: unknown,
    now: Date,
    work: () => Promise<Outcome<T>>,
  ): Promise<Outcome<T>> {
    if (key === null) return work();
    if (!IDEMPOTENCY_KEY.test(key)) throw new ApplicationError('IDEMPOTENCY_KEY_INVALID');
    const scope = `${session.principal.kind}:${session.principal.subject}`;
    const claim = await tx.claimIdempotency({
      scope,
      key,
      operation,
      fingerprint: createHash('sha256')
        .update(JSON.stringify([operation, input]))
        .digest('hex'),
      now,
      expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
    });
    if (claim.kind === 'mismatch') throw new ApplicationError('IDEMPOTENCY_KEY_REUSED');
    if (claim.kind === 'replay') {
      return { status: claim.status, body: claim.body as T, replayed: true };
    }
    const outcome = await work();
    await tx.completeIdempotency(scope, key, outcome.status, outcome.body);
    return outcome;
  }

  async listVehicles(context: RequestContext, includeArchived: boolean): Promise<VehicleView[]> {
    const session = await this.session(context, READ_PERMISSION);
    return (await this.store.listOwnedVehicles(session.principal, includeArchived)).map(
      vehicleView,
    );
  }

  /** A missing vehicle and another owner's vehicle are indistinguishable (404). */
  async getVehicle(context: RequestContext, vehicleId: string): Promise<VehicleView> {
    const session = await this.session(context, READ_PERMISSION);
    const vehicle = await this.store.findOwnedVehicle(session.principal, vehicleId);
    if (!vehicle) throw new ApplicationError('VEHICLE_NOT_FOUND');
    return vehicleView(vehicle);
  }

  async createVehicle(
    context: RequestContext,
    idempotencyKey: string | null,
    rawBody: unknown,
  ): Promise<Outcome<VehicleView>> {
    const session = await this.session(context, WRITE_PERMISSION);
    if (idempotencyKey === null) throw new ApplicationError('IDEMPOTENCY_KEY_REQUIRED');
    const body = asRecord(rawBody);
    const details = parseVehicleDetails(body);
    return this.store.transaction(async (tx) => {
      const now = this.clock.now();
      return this.withIdempotency(
        tx,
        session,
        idempotencyKey,
        'vehicle.create',
        body,
        now,
        async () => {
          await tx.lockOwner(session.principal);
          if ((await tx.countActiveVehicles(session.principal)) >= this.policy.maxActiveVehicles) {
            throw new VehicleDomainError('VEHICLE_LIMIT_REACHED');
          }
          const vehicle = await tx.insertVehicle({
            ...details,
            id: this.ids.uuid(),
            owner: session.principal,
            now,
          });
          await this.record(tx, context, session, vehicle, 'created', now);
          return { status: 201, body: vehicleView(vehicle), replayed: false };
        },
      );
    });
  }

  async updateVehicle(
    context: RequestContext,
    vehicleId: string,
    expectedRevision: number | null,
    idempotencyKey: string | null,
    rawBody: unknown,
  ): Promise<Outcome<VehicleView>> {
    const session = await this.session(context, WRITE_PERMISSION);
    const body = asRecord(rawBody);
    const revision = requireRevision(expectedRevision);
    return this.store.transaction(async (tx) => {
      const now = this.clock.now();
      return this.withIdempotency(
        tx,
        session,
        idempotencyKey,
        'vehicle.update',
        [vehicleId, revision, body],
        now,
        async () => {
          // An edit never falls back to creating a vehicle (W08 threat register).
          const current = await tx.findOwnedVehicle(session.principal, vehicleId);
          if (!current) throw new ApplicationError('VEHICLE_NOT_FOUND');
          if (current.revision !== revision) throw new ApplicationError('REVISION_CONFLICT');
          const details = applyVehicleChanges(current, body);
          if (sameVehicleDetails(current, details)) {
            return { status: 200, body: vehicleView(current), replayed: false };
          }
          const updated = await tx.updateVehicle(
            session.principal,
            vehicleId,
            details,
            'ACTIVE',
            revision,
            now,
          );
          if (!updated) throw new ApplicationError('REVISION_CONFLICT');
          await this.record(tx, context, session, updated, 'updated', now);
          return { status: 200, body: vehicleView(updated), replayed: false };
        },
      );
    });
  }

  /** Archiving an archived vehicle returns it unchanged (safe retry). */
  async archiveVehicle(
    context: RequestContext,
    vehicleId: string,
    expectedRevision: number | null,
  ): Promise<Outcome<VehicleView>> {
    const session = await this.session(context, WRITE_PERMISSION);
    const revision = requireRevision(expectedRevision);
    return this.store.transaction(async (tx) => {
      const now = this.clock.now();
      const current = await tx.findOwnedVehicle(session.principal, vehicleId);
      if (!current) throw new ApplicationError('VEHICLE_NOT_FOUND');
      if (current.status === 'ARCHIVED')
        return { status: 200, body: vehicleView(current), replayed: true };
      if (current.revision !== revision) throw new ApplicationError('REVISION_CONFLICT');
      const archived = await tx.updateVehicle(
        session.principal,
        vehicleId,
        current,
        'ARCHIVED',
        revision,
        now,
      );
      if (!archived) throw new ApplicationError('REVISION_CONFLICT');
      await this.record(tx, context, session, archived, 'archived', now);
      return { status: 200, body: vehicleView(archived), replayed: false };
    });
  }
}
