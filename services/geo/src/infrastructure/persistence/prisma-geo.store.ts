import type {
  Decision,
  DecisionOutcome,
  IndeterminateDetail,
  IndeterminateReason,
  Point,
  Zone,
  ZoneDefinition,
  ZoneStatus,
} from '../../domain';
import {
  fixedDecimal,
  microToDecimal,
  parseWirePoint,
  ringFromStored,
  ringToJson,
} from '../../domain';
import {
  StoreUnavailableError,
  type AuditEntry,
  type CoverageSnapshot,
  type GeoStore,
  type GeoTransaction,
  type NewZone,
  type OutboxEvent,
} from '../../ports';
import type {
  PrismaClient,
  ServiceabilityDecision,
  ServiceZone,
} from '../../generated/prisma/client';
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
    nameEn: row.nameEn,
    datasetRef: row.datasetRef,
    ring: ringFromStored(row.ring),
    status: row.status,
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    retiredAt: row.retiredAt,
  };
}

const OUTCOMES: readonly DecisionOutcome[] = ['SERVICEABLE', 'OUTSIDE_ZONE', 'INDETERMINATE'];
const REASONS: readonly IndeterminateReason[] = ['GEO_DATASET_UNAVAILABLE', 'LOCATION_UNRESOLVED'];
const DETAILS: readonly IndeterminateDetail[] = [
  'NO_APPROVED_ZONES',
  'ON_ZONE_BOUNDARY',
  'OVERLAPPING_ZONES',
];

function oneOrNull<T extends string>(value: string | null, allowed: readonly T[]): T | null {
  if (value === null) return null;
  const found = allowed.find((candidate) => candidate === value);
  if (found === undefined) throw new Error('CORRUPT_DECISION');
  return found;
}

/** Stored rows are re-validated on read; a corrupt row is an error, never a decision. */
function toDecision(row: ServiceabilityDecision): Decision {
  const outcome = oneOrNull(row.decision, OUTCOMES);
  if (outcome === null) throw new Error('CORRUPT_DECISION');
  const zone =
    row.zoneId !== null && row.zoneRevision !== null
      ? { zoneId: row.zoneId, revision: row.zoneRevision }
      : null;
  return {
    id: row.id,
    outcome,
    zone,
    reason: oneOrNull(row.reason, REASONS),
    detail: oneOrNull(row.detail, DETAILS),
    datasetRevision: row.datasetRevision,
    point: parseWirePoint(
      { latitude: row.latitude.toFixed(6), longitude: row.longitude.toFixed(6) },
      'stored',
    ),
    checkedAt: row.checkedAt,
    expiresAt: row.expiresAt,
  };
}

/**
 * Connection-level failures (PostgreSQL down or unreachable, pool exhausted,
 * transaction start timeout) become StoreUnavailableError, so the transport
 * answers 503 DEPENDENCY_UNAVAILABLE. Everything else propagates unchanged.
 */
const PRISMA_UNAVAILABLE = new Set(['P1001', 'P1002', 'P1008', 'P1017', 'P2024', 'P2028']);
const PG_UNAVAILABLE = new Set(['57P01', '57P02', '57P03', '08000', '08001', '08003', '08006']);
const NET_UNAVAILABLE = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE']);

function unavailable(error: unknown, depth = 0): boolean {
  if (error === null || typeof error !== 'object' || depth > 4) return false;
  const e = error as { name?: unknown; code?: unknown; cause?: unknown };
  if (e.name === 'PrismaClientInitializationError') return true;
  if (
    typeof e.code === 'string' &&
    (PRISMA_UNAVAILABLE.has(e.code) || PG_UNAVAILABLE.has(e.code) || NET_UNAVAILABLE.has(e.code))
  ) {
    return true;
  }
  return unavailable(e.cause, depth + 1);
}

async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (unavailable(error)) throw new StoreUnavailableError();
    throw error;
  }
}

function zoneColumns(definition: ZoneDefinition) {
  const { bounds } = definition.ring;
  return {
    name: definition.name,
    nameEn: definition.nameEn,
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

  async advanceDatasetRevision(now: Date): Promise<number> {
    const rows = await this.tx.$queryRawUnsafe<{ revision: number }[]>(
      `UPDATE "${this.schema}"."geo_dataset_state" SET revision = revision + 1, updated_at = $1 WHERE id = 1 RETURNING revision`,
      now,
    );
    const revision = rows[0]?.revision;
    if (revision === undefined) throw new Error('GEO_DATASET_STATE_MISSING');
    return revision;
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
    const rows = await guarded(() =>
      this.client.serviceZone.findMany({
        where: { status: 'ACTIVE' },
        orderBy: [{ code: 'asc' }],
      }),
    );
    return rows.map(toZone);
  }

  /** All three reads come from one REPEATABLE READ snapshot. */
  coverageSnapshot(point: Point): Promise<CoverageSnapshot> {
    const lat = new Decimal(point.latitude);
    const lng = new Decimal(point.longitude);
    return guarded(() =>
      this.client.$transaction(
        async (tx) => {
          const state = await tx.geoDatasetState.findUnique({ where: { id: 1 } });
          if (!state) throw new Error('GEO_DATASET_STATE_MISSING');
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
          return {
            anyActive: any !== null,
            candidates: rows.map(toZone),
            datasetRevision: state.revision,
          };
        },
        { ...TRANSACTION_OPTIONS, isolationLevel: TransactionIsolationLevel.RepeatableRead },
      ),
    );
  }

  async recordDecision(decision: Decision): Promise<void> {
    await guarded(() =>
      this.client.serviceabilityDecision.create({
        data: {
          id: decision.id,
          decision: decision.outcome,
          reason: decision.reason,
          detail: decision.detail,
          zoneId: decision.zone?.zoneId ?? null,
          zoneRevision: decision.zone?.revision ?? null,
          datasetRevision: decision.datasetRevision,
          latitude: new Decimal(fixedDecimal(decision.point.lat)),
          longitude: new Decimal(fixedDecimal(decision.point.lng)),
          checkedAt: decision.checkedAt,
          expiresAt: decision.expiresAt,
        },
      }),
    );
  }

  async findDecision(id: string): Promise<Decision | null> {
    const row = await guarded(() =>
      this.client.serviceabilityDecision.findUnique({ where: { id } }),
    );
    return row ? toDecision(row) : null;
  }

  purgeDecisions(before: Date, limit: number): Promise<number> {
    return guarded(() =>
      this.client.$executeRawUnsafe(
        `DELETE FROM "${this.schema}"."serviceability_decision"
           WHERE id IN (SELECT id FROM "${this.schema}"."serviceability_decision"
                         WHERE expires_at < $1 ORDER BY expires_at LIMIT $2)`,
        before,
        limit,
      ),
    );
  }
}
