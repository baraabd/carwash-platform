import type { Point, Zone, ZoneDefinition, ZoneStatus } from '../../domain';
import { microToDecimal, ringFromStored, ringToJson } from '../../domain';
import type { AuditEntry, GeoStore, GeoTransaction, NewZone, OutboxEvent } from '../../ports';
import type { PrismaClient, ServiceZone } from '../../generated/prisma/client';
import {
  Decimal,
  TransactionIsolationLevel,
  type TransactionClient,
} from '../../generated/prisma/internal/prismaNamespace';

const SCHEMA = /^[a-z_][a-z0-9_]{0,62}$/;
const TRANSACTION_OPTIONS = { maxWait: 2_000, timeout: 10_000 } as const;

function toZone(row: ServiceZone): Zone {
  if (row.status !== 'ACTIVE' && row.status !== 'RETIRED') throw new Error('CORRUPT_ZONE_STATUS');
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    datasetRef: row.datasetRef,
    ring: ringFromStored(row.ring),
    status: row.status,
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    retiredAt: row.retiredAt,
  };
}

function zoneColumns(definition: ZoneDefinition) {
  const { bounds } = definition.ring;
  return {
    name: definition.name,
    datasetRef: definition.datasetRef,
    ring: ringToJson(definition.ring),
    minLat: new Decimal(microToDecimal(bounds.minLat)),
    maxLat: new Decimal(microToDecimal(bounds.maxLat)),
    minLng: new Decimal(microToDecimal(bounds.minLng)),
    maxLng: new Decimal(microToDecimal(bounds.maxLng)),
  };
}

class PrismaGeoTransaction implements GeoTransaction {
  constructor(
    private readonly tx: TransactionClient,
    private readonly schema: string,
  ) {}

  async findZoneForUpdate(code: string): Promise<Zone | null> {
    const locked = await this.tx.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM "${this.schema}"."service_zone" WHERE code = $1 FOR UPDATE`,
      code,
    );
    const id = locked[0]?.id;
    if (id === undefined) return null;
    const row = await this.tx.serviceZone.findUnique({ where: { id } });
    return row ? toZone(row) : null;
  }

  async insertZone(zone: NewZone): Promise<Zone | null> {
    const inserted = await this.tx.serviceZone.createMany({
      data: [
        {
          id: zone.id,
          code: zone.code,
          ...zoneColumns(zone),
          status: 'ACTIVE',
          revision: 1,
          createdAt: zone.now,
          updatedAt: zone.now,
        },
      ],
      skipDuplicates: true,
    });
    if (inserted.count !== 1) return null;
    const row = await this.tx.serviceZone.findUnique({ where: { id: zone.id } });
    return row ? toZone(row) : null;
  }

  async updateZone(
    code: string,
    definition: ZoneDefinition,
    status: ZoneStatus,
    expectedRevision: number,
    now: Date,
  ): Promise<Zone | null> {
    const updated = await this.tx.serviceZone.updateMany({
      where: { code, revision: expectedRevision },
      data: {
        ...zoneColumns(definition),
        status,
        retiredAt: status === 'RETIRED' ? now : null,
        revision: expectedRevision + 1,
        updatedAt: now,
      },
    });
    if (updated.count !== 1) return null;
    const row = await this.tx.serviceZone.findUnique({ where: { code } });
    return row ? toZone(row) : null;
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

/** Geo's own PostgreSQL adapter; nothing outside this service reads these tables. */
export class PrismaGeoStore implements GeoStore {
  private readonly schema: string;

  constructor(
    private readonly client: PrismaClient,
    schema: string,
  ) {
    if (!SCHEMA.test(schema)) throw new Error('INVALID_DATABASE_SCHEMA');
    this.schema = schema;
  }

  transaction<T>(work: (tx: GeoTransaction) => Promise<T>): Promise<T> {
    return this.client.$transaction(
      (tx) => work(new PrismaGeoTransaction(tx, this.schema)),
      TRANSACTION_OPTIONS,
    );
  }

  async activeZones(): Promise<Zone[]> {
    const rows = await this.client.serviceZone.findMany({
      where: { status: 'ACTIVE' },
      orderBy: [{ code: 'asc' }],
    });
    return rows.map(toZone);
  }

  /** Both reads come from one REPEATABLE READ snapshot. */
  coverageSnapshot(point: Point): Promise<{ anyActive: boolean; candidates: Zone[] }> {
    const lat = new Decimal(point.latitude);
    const lng = new Decimal(point.longitude);
    return this.client.$transaction(
      async (tx) => {
        const any = await tx.serviceZone.findFirst({
          where: { status: 'ACTIVE' },
          select: { id: true },
        });
        const rows = await tx.serviceZone.findMany({
          where: {
            status: 'ACTIVE',
            minLat: { lte: lat },
            maxLat: { gte: lat },
            minLng: { lte: lng },
            maxLng: { gte: lng },
          },
        });
        return { anyActive: any !== null, candidates: rows.map(toZone) };
      },
      { ...TRANSACTION_OPTIONS, isolationLevel: TransactionIsolationLevel.RepeatableRead },
    );
  }
}
