import type { Owner, Vehicle, VehicleDetails, VehicleStatus } from '../../domain';
import { parseVehicleType } from '../../domain';
import type {
  AuditEntry,
  IdempotencyClaim,
  IdempotencyRequest,
  NewVehicle,
  OutboxEvent,
  VehicleStore,
  VehicleTransaction,
} from '../../ports';
import type { PrismaClient, Vehicle as VehicleRow } from '../../generated/prisma/client';
import type {
  InputJsonValue,
  TransactionClient,
} from '../../generated/prisma/internal/prismaNamespace';

const TRANSACTION_OPTIONS = { maxWait: 2_000, timeout: 10_000 } as const;

function toVehicle(row: VehicleRow): Vehicle {
  if (row.ownerKind !== 'account' && row.ownerKind !== 'guest')
    throw new Error('CORRUPT_OWNER_KIND');
  if (row.status !== 'ACTIVE' && row.status !== 'ARCHIVED')
    throw new Error('CORRUPT_VEHICLE_STATUS');
  return {
    id: row.id,
    owner: { kind: row.ownerKind, subject: row.ownerSubject },
    type: parseVehicleType(row.vehicleType),
    displayName: row.displayName,
    plate: row.plate,
    color: row.color,
    status: row.status,
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt,
  };
}

const ownedBy = (owner: Owner) => ({ ownerKind: owner.kind, ownerSubject: owner.subject });

class PrismaVehicleTransaction implements VehicleTransaction {
  constructor(private readonly tx: TransactionClient) {}

  async claimIdempotency(request: IdempotencyRequest): Promise<IdempotencyClaim> {
    // Serialize expiry/reclamation as well as the initial INSERT. Otherwise two
    // retries at the TTL boundary could both treat an expired key as new work.
    await this.tx
      .$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(['vehicle-idempotency', request.scope, request.key])}, 0))`;
    // Retention uses SKIP LOCKED: pin an existing replay through this transaction
    // even if its expiry passes while the response is being read.
    await this.tx.$queryRaw`
      SELECT 1 FROM "app"."idempotency_record"
      WHERE scope = ${request.scope} AND key = ${request.key} FOR UPDATE`;
    await this.tx.idempotencyRecord.deleteMany({
      where: { scope: request.scope, key: request.key, expiresAt: { lte: request.now } },
    });
    // INSERT ... ON CONFLICT DO NOTHING. A concurrent duplicate blocks on the
    // primary key until the first transaction ends, then sees its committed row.
    const inserted = await this.tx.idempotencyRecord.createMany({
      data: [
        {
          scope: request.scope,
          key: request.key,
          operation: request.operation,
          fingerprint: request.fingerprint,
          createdAt: request.now,
          expiresAt: request.expiresAt,
        },
      ],
      skipDuplicates: true,
    });
    if (inserted.count === 1) return { kind: 'claimed' };
    const existing = await this.tx.idempotencyRecord.findUnique({
      where: { scope_key: { scope: request.scope, key: request.key } },
    });
    if (!existing || existing.responseStatus === null)
      throw new Error('IDEMPOTENCY_RECORD_INCOMPLETE');
    if (existing.operation !== request.operation || existing.fingerprint !== request.fingerprint) {
      return { kind: 'mismatch' };
    }
    return { kind: 'replay', status: existing.responseStatus, body: existing.responseBody };
  }

  async completeIdempotency(
    scope: string,
    key: string,
    status: number,
    body: unknown,
  ): Promise<void> {
    await this.tx.idempotencyRecord.update({
      where: { scope_key: { scope, key } },
      data: { responseStatus: status, responseBody: body as InputJsonValue },
    });
  }

  async lockOwner(owner: Owner): Promise<void> {
    // Transaction-scoped advisory lock keyed by the owner; released on commit/rollback.
    await this.tx
      .$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`vehicle-owner:${owner.kind}:${owner.subject}`}, 0))`;
  }

  countActiveVehicles(owner: Owner): Promise<number> {
    return this.tx.vehicle.count({ where: { ...ownedBy(owner), status: 'ACTIVE' } });
  }

  async insertVehicle(vehicle: NewVehicle): Promise<Vehicle> {
    const row = await this.tx.vehicle.create({
      data: {
        id: vehicle.id,
        ...ownedBy(vehicle.owner),
        vehicleType: vehicle.type,
        displayName: vehicle.displayName,
        plate: vehicle.plate,
        color: vehicle.color,
        status: 'ACTIVE',
        revision: 1,
        createdAt: vehicle.now,
        updatedAt: vehicle.now,
      },
    });
    return toVehicle(row);
  }

  async findOwnedVehicle(owner: Owner, vehicleId: string): Promise<Vehicle | null> {
    const row = await this.tx.vehicle.findFirst({ where: { id: vehicleId, ...ownedBy(owner) } });
    return row ? toVehicle(row) : null;
  }

  async updateVehicle(
    owner: Owner,
    vehicleId: string,
    details: VehicleDetails,
    status: VehicleStatus,
    expectedRevision: number,
    now: Date,
  ): Promise<Vehicle | null> {
    const updated = await this.tx.vehicle.updateMany({
      where: { id: vehicleId, ...ownedBy(owner), revision: expectedRevision },
      data: {
        vehicleType: details.type,
        displayName: details.displayName,
        plate: details.plate,
        color: details.color,
        status,
        archivedAt: status === 'ARCHIVED' ? now : null,
        revision: expectedRevision + 1,
        updatedAt: now,
      },
    });
    if (updated.count !== 1) return null;
    return this.findOwnedVehicle(owner, vehicleId);
  }

  async appendOutbox(event: OutboxEvent): Promise<void> {
    await this.tx.outboxMessage.create({
      data: {
        id: event.eventId,
        eventId: event.eventId,
        eventType: event.eventType,
        exchange: event.exchange,
        routingKey: event.routingKey,
        payload: event.payload,
        correlationId: event.correlationId,
        traceParent: event.traceParent,
      },
    });
  }

  async appendAudit(entry: AuditEntry): Promise<void> {
    await this.tx.auditEntry.create({ data: { ...entry } });
  }
}

/** Vehicle's own PostgreSQL adapter; nothing outside this service reads these tables. */
export class PrismaVehicleStore implements VehicleStore {
  constructor(private readonly client: PrismaClient) {}

  transaction<T>(work: (tx: VehicleTransaction) => Promise<T>): Promise<T> {
    return this.client.$transaction(
      (tx) => work(new PrismaVehicleTransaction(tx)),
      TRANSACTION_OPTIONS,
    );
  }

  async listOwnedVehicles(owner: Owner, includeArchived: boolean): Promise<Vehicle[]> {
    const rows = await this.client.vehicle.findMany({
      where: includeArchived ? ownedBy(owner) : { ...ownedBy(owner), status: 'ACTIVE' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toVehicle);
  }

  async findOwnedVehicle(owner: Owner, vehicleId: string): Promise<Vehicle | null> {
    const row = await this.client.vehicle.findFirst({
      where: { id: vehicleId, ...ownedBy(owner) },
    });
    return row ? toVehicle(row) : null;
  }
}
