import { createHash } from 'node:crypto';
import {
  assertBelowLimit,
  assertEditable,
  captureSnapshot,
  closedObject,
  parseResolveRequest,
  parseVehicleInput,
  sameVehicleInput,
  vehicleInputOf,
  type Owner,
  type Plate,
  type Vehicle,
  type VehicleSnapshot,
  type VehicleType,
} from '../domain';
import type {
  AuditActor,
  AuthorizedSession,
  Clock,
  IdGenerator,
  IdentityAuthorizer,
  SessionCredentials,
  VehicleCursor,
  VehicleStore,
  VehicleTransaction,
  WorkloadAuthenticator,
} from '../ports';
import { canonicalJson } from './canonical-json';
import { ApplicationError } from './errors';
import { vehicleUpdatedEvent, type EventContext, type VehicleChange } from './events';

/**
 * Identity has no vehicle-specific permission. Saved vehicles are part of the
 * principal's own profile data, so the self-profile permissions gate them. Guest
 * sessions carry the same two permissions (P01-E3).
 */
export const READ_PERMISSION = 'profile.read:self';
export const WRITE_PERMISSION = 'profile.write:self';
/** vehicle.v1 resolveVehicleSnapshot access scope. */
export const SNAPSHOT_SCOPE = 'vehicle.snapshot.resolve';
const CONTRACT_MAJOR = 'vehicle.v1';
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/;
/**
 * Replay retention for idempotency records. E1 leaves retention to each owner;
 * 24 hours covers client retry windows and is purged afterwards.
 */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;
const CURSOR = /^[A-Za-z0-9_-]{1,512}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface RequestContext {
  readonly credentials: SessionCredentials;
  readonly correlationId: string;
  readonly traceParent: string | null;
}

/** vehicle.v1 VehicleV1. */
export interface VehicleView {
  readonly vehicleId: string;
  readonly revision: number;
  readonly type: VehicleType;
  readonly make: string | null;
  readonly model: string | null;
  readonly color: string | null;
  readonly nickname: string | null;
  readonly plate: Plate | null;
  readonly archived: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** vehicle.v1 Page of VehicleV1. */
export interface VehiclePage {
  readonly items: readonly VehicleView[];
  readonly nextCursor: string | null;
  readonly asOf: string;
}

/** vehicle.v1 VehicleSnapshotV1 (source 'saved'). */
export interface VehicleSnapshotView {
  readonly snapshotSchemaVersion: 1;
  readonly source: 'saved';
  readonly vehicleId: string;
  readonly vehicleRevision: number;
  readonly type: VehicleType;
  readonly make: string | null;
  readonly model: string | null;
  readonly color: string | null;
  readonly plate: Plate | null;
  readonly capturedAt: string;
}

export interface Outcome<T> {
  readonly status: number;
  readonly body: T;
  readonly replayed: boolean;
}

export interface PageQuery {
  readonly limit: string | undefined;
  readonly cursor: string | undefined;
}

export function vehicleView(vehicle: Vehicle): VehicleView {
  return {
    vehicleId: vehicle.id,
    revision: vehicle.revision,
    type: vehicle.type,
    make: vehicle.make,
    model: vehicle.model,
    color: vehicle.color,
    nickname: vehicle.nickname,
    plate: vehicle.plate,
    archived: vehicle.archived,
    createdAt: vehicle.createdAt.toISOString(),
    updatedAt: vehicle.updatedAt.toISOString(),
  };
}

export function snapshotView(snapshot: VehicleSnapshot): VehicleSnapshotView {
  return { ...snapshot, capturedAt: snapshot.capturedAt.toISOString() };
}

export function encodeCursor(vehicle: Vehicle): string {
  return Buffer.from(`${vehicle.createdAt.getTime()}.${vehicle.id}`, 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): VehicleCursor {
  if (!CURSOR.test(raw)) throw new ApplicationError('REQUEST_INVALID', null, 'query.cursor');
  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  const match = /^([0-9]{1,15})\.([0-9a-f-]{36})$/.exec(decoded);
  const createdAt = match?.[1] ? new Date(Number(match[1])) : null;
  const id = match?.[2];
  if (!createdAt || Number.isNaN(createdAt.getTime()) || !id || !UUID.test(id)) {
    throw new ApplicationError('REQUEST_INVALID', null, 'query.cursor');
  }
  return { createdAt, id };
}

/** Same rules as the contract's parsePageRequest. */
export function parseLimit(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_PAGE_LIMIT;
  const value = /^[0-9]{1,3}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_PAGE_LIMIT) {
    throw new ApplicationError('REQUEST_INVALID', null, 'query.limit');
  }
  return value;
}

function requireRevision(value: number | null): number {
  if (value === null) throw new ApplicationError('REVISION_REQUIRED');
  return value;
}

function requireKey(raw: string | null): string {
  if (raw === null) throw new ApplicationError('IDEMPOTENCY_KEY_REQUIRED');
  if (!IDEMPOTENCY_KEY.test(raw)) {
    throw new ApplicationError('REQUEST_INVALID', null, 'header.idempotency-key');
  }
  return raw;
}

/** Archive carries no business body: absent or an empty object only. */
function requireEmptyBody(raw: unknown): void {
  if (raw === undefined) return;
  closedObject(raw, [], '$');
}

function principalActor(session: AuthorizedSession): AuditActor {
  return { kind: 'principal', subject: session.principal.subject, sessionId: session.sessionId };
}

function actorKey(owner: Owner): string {
  return `${owner.kind}:${owner.subject}`;
}

/**
 * Vehicle use cases. Each write commits its idempotency record, state change,
 * outbox event and audit fact in one local transaction.
 */
export class VehicleApplication {
  constructor(
    private readonly store: VehicleStore,
    private readonly identity: IdentityAuthorizer,
    private readonly workloads: WorkloadAuthenticator,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  private async session(context: RequestContext, permission: string): Promise<AuthorizedSession> {
    const session = await this.identity.authorize(
      context.credentials,
      permission === READ_PERMISSION ? 'read' : 'write',
    );
    if (!session.permissions.includes(permission)) throw new ApplicationError('AUTH_FORBIDDEN');
    return session;
  }

  private async record(
    tx: VehicleTransaction,
    context: RequestContext,
    session: AuthorizedSession,
    vehicle: Vehicle,
    change: VehicleChange,
    now: Date,
  ): Promise<void> {
    const eventContext: EventContext = {
      eventId: this.ids.uuid(),
      occurredAt: now,
      correlationId: context.correlationId,
      traceParent: context.traceParent,
      actor: { kind: session.principal.kind, id: session.principal.subject },
    };
    await tx.appendOutbox(vehicleUpdatedEvent(eventContext, vehicle, change));
    await tx.appendAudit({
      id: this.ids.uuid(),
      actor: principalActor(session),
      action: `vehicle.${change.toLowerCase()}`,
      vehicleId: vehicle.id,
      correlationId: context.correlationId,
      at: now,
    });
  }

  /**
   * Scope = contract major + actor; the fingerprint covers the operation, the
   * target and the business body (with the expected revision), as E1 defines.
   */
  private async withIdempotency<T>(
    tx: VehicleTransaction,
    session: AuthorizedSession,
    key: string,
    operation: string,
    target: string | null,
    body: unknown,
    now: Date,
    work: () => Promise<Outcome<T>>,
  ): Promise<Outcome<T>> {
    const scope = `${CONTRACT_MAJOR}:${actorKey(session.principal)}`;
    const material = canonicalJson({
      v: 1,
      contract: CONTRACT_MAJOR,
      operation,
      actor: actorKey(session.principal),
      target,
      body,
    });
    const claim = await tx.claimIdempotency({
      scope,
      key,
      operation,
      fingerprint: createHash('sha256').update(material).digest('hex'),
      now,
      expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
    });
    if (claim.kind === 'mismatch') throw new ApplicationError('IDEMPOTENCY_CONFLICT');
    if (claim.kind === 'replay') {
      return { status: claim.status, body: claim.body as T, replayed: true };
    }
    const outcome = await work();
    await tx.completeIdempotency(scope, key, outcome.status, outcome.body);
    return outcome;
  }

  /** GET /mine: the principal's ACTIVE vehicles, oldest first, keyset paged. */
  async listVehicles(context: RequestContext, query: PageQuery): Promise<VehiclePage> {
    const session = await this.session(context, READ_PERMISSION);
    const limit = parseLimit(query.limit);
    const after = query.cursor === undefined ? null : decodeCursor(query.cursor);
    const asOf = this.clock.now();
    const rows = await this.store.listActiveVehicles(session.principal, after, limit + 1);
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return {
      items: items.map(vehicleView),
      nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
      asOf: asOf.toISOString(),
    };
  }

  async createVehicle(
    context: RequestContext,
    idempotencyKey: string | null,
    rawBody: unknown,
  ): Promise<Outcome<VehicleView>> {
    const session = await this.session(context, WRITE_PERMISSION);
    const key = requireKey(idempotencyKey);
    const input = parseVehicleInput(rawBody);
    return this.store.transaction(async (tx) => {
      const now = this.clock.now();
      return this.withIdempotency(
        tx,
        session,
        key,
        'vehicle.create',
        null,
        input,
        now,
        async () => {
          await tx.lockOwner(session.principal);
          assertBelowLimit(await tx.countActiveVehicles(session.principal));
          const vehicle = await tx.insertVehicle({
            ...input,
            id: this.ids.uuid(),
            owner: session.principal,
            now,
          });
          await this.record(tx, context, session, vehicle, 'CREATED', now);
          return { status: 201, body: vehicleView(vehicle), replayed: false };
        },
      );
    });
  }

  /** PATCH /mine/:vehicleId: full replacement of VehicleInputV1 under If-Match. */
  async updateVehicle(
    context: RequestContext,
    vehicleId: string,
    expectedRevision: number | null,
    idempotencyKey: string | null,
    rawBody: unknown,
  ): Promise<Outcome<VehicleView>> {
    const session = await this.session(context, WRITE_PERMISSION);
    const key = requireKey(idempotencyKey);
    const revision = requireRevision(expectedRevision);
    const input = parseVehicleInput(rawBody);
    return this.store.transaction(async (tx) => {
      const now = this.clock.now();
      return this.withIdempotency(
        tx,
        session,
        key,
        'vehicle.update',
        vehicleId,
        { expectedRevision: revision, input },
        now,
        async () => {
          // An edit never falls back to creating a vehicle (W08 threat register).
          const current = await tx.findOwnedVehicle(session.principal, vehicleId);
          if (!current) throw new ApplicationError('NOT_FOUND', 'VEHICLE_NOT_FOUND');
          assertEditable(current);
          if (current.revision !== revision) throw new ApplicationError('REVISION_CONFLICT');
          if (sameVehicleInput(vehicleInputOf(current), input)) {
            return { status: 200, body: vehicleView(current), replayed: false };
          }
          const updated = await tx.updateVehicle(
            session.principal,
            vehicleId,
            input,
            false,
            revision,
            now,
          );
          if (!updated) throw new ApplicationError('REVISION_CONFLICT');
          await this.record(tx, context, session, updated, 'UPDATED', now);
          return { status: 200, body: vehicleView(updated), replayed: false };
        },
      );
    });
  }

  /**
   * POST /mine/:vehicleId/archive. Archiving an already archived vehicle returns
   * it unchanged, whatever its revision, so a lost response is safe to repeat.
   */
  async archiveVehicle(
    context: RequestContext,
    vehicleId: string,
    expectedRevision: number | null,
    idempotencyKey: string | null,
    rawBody: unknown,
  ): Promise<Outcome<VehicleView>> {
    const session = await this.session(context, WRITE_PERMISSION);
    const key = requireKey(idempotencyKey);
    const revision = requireRevision(expectedRevision);
    requireEmptyBody(rawBody);
    return this.store.transaction(async (tx) => {
      const now = this.clock.now();
      return this.withIdempotency(
        tx,
        session,
        key,
        'vehicle.archive',
        vehicleId,
        { expectedRevision: revision },
        now,
        async () => {
          const current = await tx.findOwnedVehicle(session.principal, vehicleId);
          if (!current) throw new ApplicationError('NOT_FOUND', 'VEHICLE_NOT_FOUND');
          if (current.archived) return { status: 200, body: vehicleView(current), replayed: false };
          if (current.revision !== revision) throw new ApplicationError('REVISION_CONFLICT');
          const archived = await tx.updateVehicle(
            session.principal,
            vehicleId,
            vehicleInputOf(current),
            true,
            revision,
            now,
          );
          if (!archived) throw new ApplicationError('REVISION_CONFLICT');
          await this.record(tx, context, session, archived, 'ARCHIVED', now);
          return { status: 200, body: vehicleView(archived), replayed: false };
        },
      );
    });
  }

  /**
   * POST /vehicle-snapshots/resolve (service:vehicle.snapshot.resolve). The
   * caller names the owner it acts for and why; Vehicle checks the workload's
   * scope, the owner/object relation and the revision, and records the read.
   * A vehicle of another owner and a missing vehicle are both NOT_FOUND.
   */
  async resolveVehicleSnapshot(
    context: RequestContext,
    rawBody: unknown,
  ): Promise<VehicleSnapshotView> {
    const actor = await this.workloads.authenticate(context.credentials);
    if (!actor.scopes.includes(SNAPSHOT_SCOPE)) throw new ApplicationError('AUTH_FORBIDDEN');
    const request = parseResolveRequest(rawBody);
    return this.store.transaction(async (tx) => {
      const now = this.clock.now();
      const vehicle = await tx.findOwnedVehicle(request.owner, request.vehicleId);
      if (!vehicle) throw new ApplicationError('NOT_FOUND', 'VEHICLE_NOT_FOUND');
      if (request.expectedRevision !== null && vehicle.revision !== request.expectedRevision) {
        throw new ApplicationError('REVISION_CONFLICT');
      }
      const snapshot = captureSnapshot(vehicle, request.purpose, now);
      await tx.appendAudit({
        id: this.ids.uuid(),
        actor: { kind: 'service', service: actor.service, purpose: request.purpose },
        action: 'vehicle.snapshot-resolved',
        vehicleId: vehicle.id,
        correlationId: context.correlationId,
        at: now,
      });
      return snapshotView(snapshot);
    });
  }
}