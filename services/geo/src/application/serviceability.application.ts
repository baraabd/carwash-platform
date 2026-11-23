import {
  DECISION_TTL_MAX_MS,
  DECISION_TTL_MIN_MS,
  GeoDomainError,
  decide,
  evaluateServiceability,
  parseDecisionId,
  parseRevisionNumber,
  parseWirePoint,
  validateDecision,
  wirePoint,
  type Decision,
  type IndeterminateReason,
  type Point,
  type Serviceability,
  type ValidationReason,
} from '../domain';
import type {
  Clock,
  GeoStore,
  IdGenerator,
  IdentityAuthorizer,
  ServiceActor,
  SessionCredentials,
} from '../ports';
import { ApplicationError } from './errors';

/**
 * A principal checks serviceability while booking for itself, so the session
 * must hold the guest/account booking permission. Staff tools need their own
 * reviewed permission; none is assumed here.
 */
export const SERVICEABILITY_PERMISSION = 'bookings.create:self';
/** geo.v1 validateDecision access scope. */
export const VALIDATE_SCOPE = 'geo.serviceability.validate';
export const RESOLVE_PURPOSES = ['booking-quote', 'booking-create', 'booking-display'] as const;
export type ResolvePurpose = (typeof RESOLVE_PURPOSES)[number];

/**
 * Retention for stored decisions after they expire. A decision holds a precise
 * point; it is kept only long enough for a late validation to answer
 * DECISION_EXPIRED instead of DECISION_NOT_FOUND, then purged.
 */
export const DECISION_RETENTION_AFTER_EXPIRY_MS = 24 * 60 * 60 * 1000;

export interface ServiceabilityPolicy {
  readonly decisionTtlMs: number;
}

/** geo.v1 ServiceabilityDecisionV1. */
export interface DecisionView {
  readonly decisionId: string;
  readonly decision: 'SERVICEABLE' | 'OUTSIDE_ZONE' | 'INDETERMINATE';
  readonly zoneId: string | null;
  readonly zoneRevision: number | null;
  readonly datasetRevision: number;
  readonly point: { readonly latitude: string; readonly longitude: string };
  readonly checkedAt: string;
  readonly expiresAt: string;
  readonly reason: IndeterminateReason | null;
}

/** geo.v1 ValidateDecisionResultV1. */
export interface ValidationView {
  readonly decisionId: string;
  readonly valid: boolean;
  readonly reason: ValidationReason | null;
  readonly zoneId: string | null;
  readonly zoneRevision: number | null;
}

export function decisionView(decision: Decision): DecisionView {
  return {
    decisionId: decision.id,
    decision: decision.outcome,
    zoneId: decision.zone?.zoneId ?? null,
    zoneRevision: decision.zone?.revision ?? null,
    datasetRevision: decision.datasetRevision,
    point: wirePoint(decision.point),
    checkedAt: decision.checkedAt.toISOString(),
    expiresAt: decision.expiresAt.toISOString(),
    reason: decision.reason,
  };
}

function closedBody(raw: unknown, keys: readonly string[]): Record<string, unknown> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new GeoDomainError('EXPECTED_OBJECT', '$');
  }
  const value = raw as Record<string, unknown>;
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) throw new GeoDomainError('MISSING_FIELD', `$.${key}`);
  }
  const extra = Object.keys(value).find((key) => !keys.includes(key));
  if (extra !== undefined) throw new GeoDomainError('UNEXPECTED_FIELD', `$.${extra}`);
  return value;
}

function parsePurpose(raw: unknown): ResolvePurpose {
  const found = RESOLVE_PURPOSES.find((purpose) => purpose === raw);
  if (!found) throw new GeoDomainError('INVALID_ENUM', '$.purpose');
  return found;
}

export function validatePolicy(policy: ServiceabilityPolicy): ServiceabilityPolicy {
  if (
    !Number.isSafeInteger(policy.decisionTtlMs) ||
    policy.decisionTtlMs < DECISION_TTL_MIN_MS ||
    policy.decisionTtlMs > DECISION_TTL_MAX_MS
  ) {
    throw new Error('INVALID_DECISION_TTL');
  }
  return policy;
}

/**
 * geo.v1 serviceability use cases.
 *
 * checkServiceability: a principal asks about one point. The answer is
 * recorded (append-only, short-lived) and returned. No approved dataset, an
 * edge or an overlap is INDETERMINATE; a database outage is an error, never a
 * decision, and never SERVICEABLE.
 *
 * validateDecision: a workload with the validate scope asks whether a stored
 * decision still holds for the same point now.
 */
export class ServiceabilityApplication {
  private readonly policy: ServiceabilityPolicy;

  constructor(
    private readonly store: GeoStore,
    private readonly identity: IdentityAuthorizer,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    policy: ServiceabilityPolicy,
  ) {
    this.policy = validatePolicy(policy);
  }

  private async evaluate(point: Point): Promise<{ s: Serviceability; datasetRevision: number }> {
    const snapshot = await this.store.coverageSnapshot(point);
    return {
      s: evaluateServiceability(snapshot.anyActive, snapshot.candidates, point),
      datasetRevision: snapshot.datasetRevision,
    };
  }

  async checkServiceability(
    credentials: SessionCredentials,
    rawBody: unknown,
  ): Promise<DecisionView> {
    const session = await this.identity.authorize(credentials);
    if (!session.permissions.includes(SERVICEABILITY_PERMISSION)) {
      throw new ApplicationError('AUTH_FORBIDDEN');
    }
    const body = closedBody(rawBody, ['point']);
    const point = parseWirePoint(body.point, '$.point');
    const { s, datasetRevision } = await this.evaluate(point);
    const decision = decide({
      id: this.ids.uuid(),
      serviceability: s,
      datasetRevision,
      point,
      checkedAt: this.clock.now(),
      ttlMs: this.policy.decisionTtlMs,
    });
    await this.store.recordDecision(decision);
    return decisionView(decision);
  }

  async validate(actor: ServiceActor, rawBody: unknown): Promise<ValidationView> {
    if (!actor.scopes.includes(VALIDATE_SCOPE)) throw new ApplicationError('AUTH_FORBIDDEN');
    const body = closedBody(rawBody, ['decisionId', 'expectedZoneRevision', 'point', 'purpose']);
    const request = {
      decisionId: parseDecisionId(body.decisionId, '$.decisionId'),
      expectedZoneRevision: parseRevisionNumber(
        body.expectedZoneRevision,
        '$.expectedZoneRevision',
      ),
      point: parseWirePoint(body.point, '$.point'),
    };
    parsePurpose(body.purpose);
    const decision = await this.store.findDecision(request.decisionId);
    const { s } = await this.evaluate(request.point);
    const result = validateDecision(decision, request, this.clock.now(), s);
    return {
      decisionId: request.decisionId,
      valid: result.valid,
      reason: result.reason,
      zoneId: result.zone?.zoneId ?? null,
      zoneRevision: result.zone?.revision ?? null,
    };
  }

  /** Retention job: removes decisions past expiry + retention, in bounded batches. */
  async purgeExpiredDecisions(batchSize = 1000): Promise<number> {
    if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 10_000) {
      throw new Error('INVALID_BATCH_SIZE');
    }
    const before = new Date(this.clock.now().getTime() - DECISION_RETENTION_AFTER_EXPIRY_MS);
    let total = 0;
    for (;;) {
      const removed = await this.store.purgeDecisions(before, batchSize);
      total += removed;
      if (removed < batchSize) return total;
    }
  }
}
