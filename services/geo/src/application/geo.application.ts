import {
  GeoDomainError,
  parseZoneCode,
  parseZoneDefinition,
  sameZoneDefinition,
  type Zone,
} from '../domain';
import type { Clock, GeoStore, GeoTransaction, IdGenerator } from '../ports';
import { ApplicationError } from './errors';
import { zoneUpdatedEvent, type ZoneChange } from './events';

/** Operator view of a zone change. Polygons are never part of any HTTP response. */
export interface ZoneView {
  readonly zoneId: string;
  readonly code: string;
  readonly status: 'ACTIVE' | 'RETIRED';
  readonly revision: number;
}

/** geo.v1 ServiceZoneV1: public, non-personalized, no geometry. */
export interface ServiceZoneView {
  readonly zoneId: string;
  readonly revision: number;
  readonly name: { readonly ar: string; readonly en: string | null };
  readonly status: 'ACTIVE' | 'SUSPENDED';
}

export interface OperationContext {
  /** Operator label for audit, e.g. "ops.zone-import". Never personal data. */
  readonly actor: string;
  readonly correlationId: string;
  readonly traceParent: string | null;
}

export interface ZoneOutcome {
  readonly outcome: 'created' | 'unchanged' | 'revised' | 'retired';
  readonly zone: ZoneView;
}

const ACTOR = /^[a-z0-9][a-z0-9:._-]{2,59}$/;

export function zoneView(zone: Zone): ZoneView {
  return {
    zoneId: zone.id,
    code: zone.code,
    status: zone.status,
    revision: zone.revision,
  };
}

/**
 * Only ACTIVE zones are listed. geo.v1 also allows SUSPENDED; Geo has no
 * suspension state yet (retired zones are simply not listed).
 */
export function serviceZoneView(zone: Zone): ServiceZoneView {
  return {
    zoneId: zone.id,
    revision: zone.revision,
    name: { ar: zone.name, en: zone.nameEn },
    status: 'ACTIVE',
  };
}

/**
 * Zone use cases. Zone data operations are operator commands; no public write
 * API exists until an Identity permission for zone management is published
 * (see the provider document). Serviceability lives in ServiceabilityApplication.
 */
export class GeoApplication {
  constructor(
    private readonly store: GeoStore,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async listActiveZones(): Promise<ServiceZoneView[]> {
    return (await this.store.activeZones()).map(serviceZoneView);
  }

  private async record(
    tx: GeoTransaction,
    context: OperationContext,
    zone: Zone,
    change: ZoneChange,
    now: Date,
  ): Promise<void> {
    await tx.advanceDatasetRevision(now);
    await tx.appendOutbox(
      zoneUpdatedEvent(
        {
          eventId: this.ids.uuid(),
          occurredAt: now,
          correlationId: context.correlationId,
          traceParent: context.traceParent,
        },
        zone,
        change,
      ),
    );
    await tx.appendAudit({
      id: this.ids.uuid(),
      actor: context.actor,
      action: `zone.${change}`,
      zoneId: zone.id,
      datasetRef: zone.datasetRef,
      correlationId: context.correlationId,
      at: now,
    });
  }

  private checkActor(context: OperationContext): void {
    if (!ACTOR.test(context.actor)) throw new GeoDomainError('INVALID_INPUT', 'actor');
  }

  /**
   * Imports a zone from an approved dataset. Re-importing the identical
   * definition is a no-op (safe retry). A different definition under an existing
   * code is refused; changes go through `reviseZone` with an expected revision.
   */
  async importZone(context: OperationContext, raw: unknown): Promise<ZoneOutcome> {
    this.checkActor(context);
    const definition = parseZoneDefinition(raw);
    return this.store.transaction(async (tx) => {
      const now = this.clock.now();
      const existing = await tx.findZoneForUpdate(definition.code);
      if (existing) {
        if (existing.status === 'ACTIVE' && sameZoneDefinition(existing, definition)) {
          return { outcome: 'unchanged', zone: zoneView(existing) };
        }
        throw new GeoDomainError('ZONE_CODE_CONFLICT', 'code');
      }
      const created = await tx.insertZone({ ...definition, id: this.ids.uuid(), now });
      if (!created) {
        // A concurrent import of the same code committed first.
        const winner = await tx.findZoneForUpdate(definition.code);
        if (winner && winner.status === 'ACTIVE' && sameZoneDefinition(winner, definition)) {
          return { outcome: 'unchanged', zone: zoneView(winner) };
        }
        throw new GeoDomainError('ZONE_CODE_CONFLICT', 'code');
      }
      await this.record(tx, context, created, 'created', now);
      return { outcome: 'created', zone: zoneView(created) };
    });
  }

  async reviseZone(
    context: OperationContext,
    expectedRevision: number,
    raw: unknown,
  ): Promise<ZoneOutcome> {
    this.checkActor(context);
    const definition = parseZoneDefinition(raw);
    return this.store.transaction(async (tx) => {
      const now = this.clock.now();
      const current = await tx.findZoneForUpdate(definition.code);
      if (!current) throw new ApplicationError('ZONE_NOT_FOUND');
      if (current.status === 'RETIRED') throw new GeoDomainError('ZONE_RETIRED');
      if (current.revision !== expectedRevision) throw new ApplicationError('REVISION_CONFLICT');
      if (sameZoneDefinition(current, definition)) {
        return { outcome: 'unchanged', zone: zoneView(current) };
      }
      const revised = await tx.updateZone(
        definition.code,
        definition,
        'ACTIVE',
        expectedRevision,
        now,
      );
      if (!revised) throw new ApplicationError('REVISION_CONFLICT');
      await this.record(tx, context, revised, 'revised', now);
      return { outcome: 'revised', zone: zoneView(revised) };
    });
  }

  /** Retiring a retired zone returns it unchanged (safe retry). */
  async retireZone(
    context: OperationContext,
    rawCode: unknown,
    expectedRevision: number,
  ): Promise<ZoneOutcome> {
    this.checkActor(context);
    const code = parseZoneCode(rawCode);
    return this.store.transaction(async (tx) => {
      const now = this.clock.now();
      const current = await tx.findZoneForUpdate(code);
      if (!current) throw new ApplicationError('ZONE_NOT_FOUND');
      if (current.status === 'RETIRED') return { outcome: 'unchanged', zone: zoneView(current) };
      if (current.revision !== expectedRevision) throw new ApplicationError('REVISION_CONFLICT');
      const retired = await tx.updateZone(code, current, 'RETIRED', expectedRevision, now);
      if (!retired) throw new ApplicationError('REVISION_CONFLICT');
      await this.record(tx, context, retired, 'retired', now);
      return { outcome: 'retired', zone: zoneView(retired) };
    });
  }
}
