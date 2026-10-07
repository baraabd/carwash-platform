import type { Point, Zone, ZoneDefinition, ZoneStatus } from '../domain';

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  uuid(): string;
}

export interface OutboxEvent {
  readonly eventId: string;
  readonly eventType: string;
  readonly exchange: string;
  readonly routingKey: string;
  readonly payload: string;
  readonly correlationId: string;
  readonly traceParent: string | null;
}

/** Who ran a zone data operation (an operator label, never personal data). */
export interface AuditEntry {
  readonly id: string;
  readonly actor: string;
  readonly action: string;
  readonly zoneId: string;
  readonly datasetRef: string;
  readonly correlationId: string;
  readonly at: Date;
}

export interface NewZone extends ZoneDefinition {
  readonly id: string;
  readonly now: Date;
}

export interface GeoTransaction {
  /** Locks the zone row (if any) for the rest of the transaction. */
  findZoneForUpdate(code: string): Promise<Zone | null>;
  /** Null when a concurrent import of the same code committed first. */
  insertZone(zone: NewZone): Promise<Zone | null>;
  updateZone(
    code: string,
    definition: ZoneDefinition,
    status: ZoneStatus,
    expectedRevision: number,
    now: Date,
  ): Promise<Zone | null>;
  appendOutbox(event: OutboxEvent): Promise<void>;
  appendAudit(entry: AuditEntry): Promise<void>;
}

export interface GeoStore {
  transaction<T>(work: (tx: GeoTransaction) => Promise<T>): Promise<T>;
  activeZones(): Promise<Zone[]>;
  /**
   * One consistent snapshot: whether any ACTIVE zone exists at all, and the
   * ACTIVE zones whose bounding box contains the point (edges inclusive).
   */
  coverageSnapshot(
    point: Point,
  ): Promise<{ readonly anyActive: boolean; readonly candidates: Zone[] }>;
}
