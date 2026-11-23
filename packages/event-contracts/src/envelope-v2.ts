import { asAggregateVersion, asCanonicalUtc, asObject, asUuid, exactKeys } from './envelope';

/**
 * Envelope v2 for business events (V1 stays valid for the two existing events).
 *
 * Added over V1: causation, W3C trace parent, aggregate identity and a PII-free
 * actor reference so consumers can propagate trace/audit context. The `producer`
 * field is a declaration only; broker ACLs establish who published.
 *
 * `data` is owned by each event module and must be closed (exactKeys) and free of
 * personal data beyond opaque IDs unless that event's contract explicitly says so.
 */
export const EVENT_PRODUCERS = [
  'customer',
  'vehicle',
  'geo',
  'catalog',
  'pricing',
  'billing',
  'wallet',
  'subscription',
  'media',
  'workforce',
  'scheduling',
  'booking',
  'dispatch',
  'communications',
  'reviews',
  'support',
  'reporting',
  'configuration',
  'identity',
] as const;
export type EventProducer = (typeof EVENT_PRODUCERS)[number];

/**
 * Same kinds as the HTTP PrincipalRef plus `service` (a workload identity) and
 * `system` (scheduled/automatic). Staff roles live in Identity, not in events;
 * full audit facts stay in each owner's audit table.
 */
export const ACTOR_KINDS = ['account', 'guest', 'service', 'system'] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

export interface EventActor {
  readonly kind: ActorKind;
  /**
   * account/guest: Identity subject UUID. service: the calling service name.
   * system: null. Never a phone, email or name.
   */
  readonly id: string | null;
}

export interface EventEnvelopeV2<TType extends string, TProducer extends EventProducer, TData> {
  readonly eventId: string;
  readonly eventType: TType;
  readonly envelopeVersion: 2;
  readonly producer: TProducer;
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly traceparent: string | null;
  readonly aggregate: { readonly type: string; readonly id: string; readonly version: number };
  readonly actor: EventActor;
  readonly data: TData;
}

const KEYS = [
  'eventId',
  'eventType',
  'envelopeVersion',
  'producer',
  'occurredAt',
  'correlationId',
  'causationId',
  'traceparent',
  'aggregate',
  'actor',
  'data',
] as const;
const TRACEPARENT = /^00-(?!0{32})[0-9a-f]{32}-(?!0{16})[0-9a-f]{16}-[0-9a-f]{2}$/;
const AGGREGATE_TYPE = /^[a-z][a-z-]{1,40}$/;

export function parseEnvelopeV2<TType extends string, TProducer extends EventProducer, TData>(
  value: unknown,
  expected: {
    readonly eventType: TType;
    readonly producer: TProducer;
    readonly aggregateType: string;
  },
  parseData: (data: unknown) => TData,
): EventEnvelopeV2<TType, TProducer, TData> {
  const v = asObject(value);
  exactKeys(v, KEYS);
  if (
    v.eventType !== expected.eventType ||
    v.envelopeVersion !== 2 ||
    v.producer !== expected.producer
  ) {
    throw new Error('UNSUPPORTED_EVENT');
  }
  const aggregate = asObject(v.aggregate);
  exactKeys(aggregate, ['type', 'id', 'version']);
  if (
    aggregate.type !== expected.aggregateType ||
    typeof aggregate.type !== 'string' ||
    !AGGREGATE_TYPE.test(aggregate.type)
  ) {
    throw new Error('UNSUPPORTED_AGGREGATE');
  }
  const actor = asObject(v.actor);
  exactKeys(actor, ['kind', 'id']);
  if (typeof actor.kind !== 'string' || !(ACTOR_KINDS as readonly string[]).includes(actor.kind)) {
    throw new Error('INVALID_ACTOR');
  }
  const kind = actor.kind as ActorKind;
  const actorId = parseActorId(kind, actor.id);
  if (
    v.traceparent !== null &&
    (typeof v.traceparent !== 'string' || !TRACEPARENT.test(v.traceparent))
  ) {
    throw new Error('INVALID_TRACEPARENT');
  }
  return {
    eventId: asUuid(v.eventId),
    eventType: expected.eventType,
    envelopeVersion: 2,
    producer: expected.producer,
    occurredAt: asCanonicalUtc(v.occurredAt),
    correlationId: asUuid(v.correlationId),
    causationId: v.causationId === null ? null : asUuid(v.causationId),
    traceparent: v.traceparent,
    aggregate: {
      type: expected.aggregateType,
      id: asUuid(aggregate.id),
      version: asAggregateVersion(aggregate.version),
    },
    actor: { kind, id: actorId },
    data: parseData(v.data),
  };
}

function parseActorId(kind: ActorKind, id: unknown): string | null {
  if (kind === 'system') {
    if (id !== null) throw new Error('INVALID_ACTOR');
    return null;
  }
  if (kind === 'service') {
    if (typeof id !== 'string' || !(EVENT_PRODUCERS as readonly string[]).includes(id)) {
      throw new Error('INVALID_ACTOR');
    }
    return id;
  }
  return asUuid(id);
}
