import type { Owner, Plate, Vehicle, VehicleInput } from '../../domain';
import { parseVehicleType } from '../../domain';
import type {
  AuditEntry,
  IdempotencyClaim,
  IdempotencyRequest,
  NewVehicle,
  OutboxEvent,
  VehicleCursor,
  VehicleStore,
  VehicleTransaction,
} from '../../ports';
import type { PrismaClient, Vehicle as VehicleRow } from '../../generated/prisma/client';
import type {
  InputJsonValue,
  TransactionClient,
} from '../../generated/prisma/internal/prismaNamespace';

const TRANSACTION_OPTIONS = { maxWait: 2_000, timeout: 10_000 } as const;

function toPlate(row: VehicleRow): Plate | null {
  if (row.plate === null) {
    if (row.plateRegion !== null) throw new Error('CORRUPT_PLATE_REGION');
    return null;
  }
  return { text: row.plate, region: row.plateRegion };
}

/**
 * Rows are mapped as stored. A P01 row outside the vehicle.v1 bounds (a
 * lowercase or longer plate, a longer name) is not silently rewritten here; the
 * pre-deployment data-conformance query in the provider document must report
 * zero such rows before this release serves traffic.
 */
function toVehicle(row: VehicleRow): Vehicle {
  if (row.ownerKind !== 'account' && row.ownerKind !== 'guest')
    throw new Error('CORRUPT_OWNER_KIND');
  if (row.status !== 'ACTIVE' && row.status !== 'ARCHIVED')
    throw new Error('CORRUPT_VEHICLE_STATUS');
  return {
    id: row.id,
    owner: { kind: row.ownerKind, subject: row.ownerSubject },
    type: parseVehicleType(row.vehicleType),
    make: row.make,
    model: row.model,
    color: row.color,
    nickname: row.nickname,
    plate: toPlate(row),
    archived: row.status === 'ARCHIVED',
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt,
  };
}

const ownedBy = (owner: Owner) => ({ ownerKind: owner.kind, ownerSubject: owner.subject });

const columns = (input: VehicleInput) => ({
  vehicleType: input.type,
  make: input.make,
  model: input.model,
  color: input.color,
  nickname: input.nickname,
  plate: input.plate?.text ?? null,
  plateRegion: input.plate?.region ?? null,
});

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
        ...columns(vehicle),
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
    input: VehicleInput,
    archived: boolean,
    expectedRevision: number,
    now: Date,
  ): Promise<Vehicle | null> {
    const updated = await this.tx.vehicle.updateMany({
      where: { id: vehicleId, ...ownedBy(owner), revision: expectedRevision },
      data: {
        ...columns(input),
        status: archived ? 'ARCHIVED' : 'ACTIVE',
        archivedAt: archived ? now : null,
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
    const actor =
      entry.actor.kind === 'principal'
        ? {
            actorKind: 'principal',
            actorSubject: entry.actor.subject,
            actorSessionId: entry.actor.sessionId,
          }
        : { actorKind: 'service', actorService: entry.actor.service, purpose: entry.actor.purpose };
    await this.tx.auditEntry.create({
      data: {
        id: entry.id,
        ...actor,
        action: entry.action,
        vehicleId: entry.vehicleId,
        correlationId: entry.correlationId,
        at: entry.at,
      },
    });
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

  async listActiveVehicles(
    owner: Owner,
    after: VehicleCursor | null,
    limit: number,
  ): Promise<Vehicle[]> {
    const rows = await this.client.vehicle.findMany({
      where: {
        ...ownedBy(owner),
        status: 'ACTIVE',
        ...(after === null
          ? {}
          : {
              OR: [
                { createdAt: { gt: after.createdAt } },
                { createdAt: after.createdAt, id: { gt: after.id } },
              ],
            }),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });
    return rows.map(toVehicle);
  }
}