import { asAggregateVersion, asCanonicalUtc, asObject, asUuid, exactKeys } from './envelope';
import { parseEnvelopeV2, type EventEnvelopeV2, type EventProducer } from './envelope-v2';

/**
 * First business event set (envelope v2). Data carries opaque IDs, revisions
 * and non-personal facts only: no phone, name, plate, address text or point.
 * The envelope `aggregate.version` is the owner's committed revision; consumers
 * apply an event only when it is newer than what they hold.
 */

function oneOf<const T extends readonly string[]>(value: unknown, allowed: T): T[number] {
  if (typeof value !== 'string' || !allowed.includes(value)) throw new Error('INVALID_EVENT_DATA');
  return value;
}

const CHANGE = ['CREATED', 'UPDATED', 'ARCHIVED'] as const;
type Change = (typeof CHANGE)[number];

export interface EventSpec<TType extends string, TProducer extends EventProducer, TData> {
  readonly eventType: TType;
  readonly producer: TProducer;
  readonly aggregateType: string;
  readonly asyncApi: string;
  readonly parseData: (data: unknown) => TData;
}

export function defineBusinessEvent<TType extends string, TProducer extends EventProducer, TData>(
  value: EventSpec<TType, TProducer, TData>,
): EventSpec<TType, TProducer, TData> & {
  parse(value: unknown): EventEnvelopeV2<TType, TProducer, TData>;
} {
  return { ...value, parse: (event: unknown) => parseEnvelopeV2(event, value, value.parseData) };
}

const ASYNCAPI = 'docs/asyncapi/business-events-v1.yaml';

export const CUSTOMER_PROFILE_UPDATED_V1 = defineBusinessEvent({
  eventType: 'customer.profile-updated.v1',
  producer: 'customer',
  aggregateType: 'customer-profile',
  asyncApi: ASYNCAPI,
  parseData(data: unknown): { readonly change: 'CREATED' | 'UPDATED' | 'CLOSED' } {
    const d = asObject(data);
    exactKeys(d, ['change']);
    return { change: oneOf(d.change, ['CREATED', 'UPDATED', 'CLOSED'] as const) };
  },
});

export const CUSTOMER_ADDRESS_UPDATED_V1 = defineBusinessEvent({
  eventType: 'customer.address-updated.v1',
  producer: 'customer',
  aggregateType: 'customer-address',
  asyncApi: ASYNCAPI,
  parseData(data: unknown): { readonly customerId: string; readonly change: Change } {
    const d = asObject(data);
    exactKeys(d, ['customerId', 'change']);
    return { customerId: asUuid(d.customerId), change: oneOf(d.change, CHANGE) };
  },
});

export const VEHICLE_UPDATED_V1 = defineBusinessEvent({
  eventType: 'vehicle.vehicle-updated.v1',
  producer: 'vehicle',
  aggregateType: 'vehicle',
  asyncApi: ASYNCAPI,
  parseData(data: unknown): { readonly change: Change } {
    const d = asObject(data);
    exactKeys(d, ['change']);
    return { change: oneOf(d.change, CHANGE) };
  },
});

export const GEO_ZONE_UPDATED_V1 = defineBusinessEvent({
  eventType: 'geo.zone-updated.v1',
  producer: 'geo',
  aggregateType: 'service-zone',
  asyncApi: ASYNCAPI,
  parseData(data: unknown): {
    readonly status: 'ACTIVE' | 'SUSPENDED';
    readonly datasetRevision: number;
  } {
    const d = asObject(data);
    exactKeys(d, ['status', 'datasetRevision']);
    return {
      status: oneOf(d.status, ['ACTIVE', 'SUSPENDED'] as const),
      datasetRevision: asAggregateVersion(d.datasetRevision),
    };
  },
});

export const CATALOG_DEFINITIONS_PUBLISHED_V1 = defineBusinessEvent({
  eventType: 'catalog.definitions-published.v1',
  producer: 'catalog',
  aggregateType: 'catalog',
  asyncApi: ASYNCAPI,
  parseData(data: unknown): { readonly definitionIds: readonly string[] } {
    const d = asObject(data);
    exactKeys(d, ['definitionIds']);
    if (!Array.isArray(d.definitionIds) || d.definitionIds.length > 200) {
      throw new Error('INVALID_EVENT_DATA');
    }
    const ids = d.definitionIds.map((id) => asUuid(id).toLowerCase());
    if (new Set(ids).size !== ids.length) throw new Error('INVALID_EVENT_DATA');
    return { definitionIds: ids };
  },
});

const MONEY_MINOR = /^(0|[1-9][0-9]{0,17})$/;

export const PRICING_PRICE_BOOK_PUBLISHED_V1 = defineBusinessEvent({
  eventType: 'pricing.price-book-published.v1',
  producer: 'pricing',
  aggregateType: 'price-book',
  asyncApi: ASYNCAPI,
  parseData(data: unknown): { readonly currency: 'SYP' | 'USD' } {
    const d = asObject(data);
    exactKeys(d, ['currency']);
    return { currency: oneOf(d.currency, ['SYP', 'USD'] as const) };
  },
});

export const PRICING_QUOTE_ISSUED_V1 = defineBusinessEvent({
  eventType: 'pricing.quote-issued.v1',
  producer: 'pricing',
  aggregateType: 'quote',
  asyncApi: ASYNCAPI,
  parseData(data: unknown): {
    readonly currency: 'SYP' | 'USD';
    readonly totalMinor: string;
    readonly expiresAt: string;
  } {
    const d = asObject(data);
    exactKeys(d, ['currency', 'totalMinor', 'expiresAt']);
    if (typeof d.totalMinor !== 'string' || !MONEY_MINOR.test(d.totalMinor)) {
      throw new Error('INVALID_EVENT_DATA');
    }
    return {
      currency: oneOf(d.currency, ['SYP', 'USD'] as const),
      totalMinor: d.totalMinor,
      expiresAt: asCanonicalUtc(d.expiresAt),
    };
  },
});

export const SCHEDULING_HOLD_CHANGED_V1 = defineBusinessEvent({
  eventType: 'scheduling.hold-changed.v1',
  producer: 'scheduling',
  aggregateType: 'hold',
  asyncApi: ASYNCAPI,
  parseData(data: unknown): {
    readonly state: 'HELD' | 'COMMITTED' | 'RELEASED' | 'EXPIRED';
    readonly zoneId: string;
    readonly startsAt: string;
    readonly endsAt: string;
    readonly bookingId: string | null;
  } {
    const d = asObject(data);
    exactKeys(d, ['state', 'zoneId', 'startsAt', 'endsAt', 'bookingId']);
    const state = oneOf(d.state, ['HELD', 'COMMITTED', 'RELEASED', 'EXPIRED'] as const);
    const startsAt = asCanonicalUtc(d.startsAt);
    const endsAt = asCanonicalUtc(d.endsAt);
    if (Date.parse(endsAt) <= Date.parse(startsAt)) throw new Error('INVALID_EVENT_DATA');
    const bookingId = d.bookingId === null ? null : asUuid(d.bookingId);
    if ((state === 'COMMITTED') !== (bookingId !== null)) throw new Error('INVALID_EVENT_DATA');
    return { state, zoneId: asUuid(d.zoneId), startsAt, endsAt, bookingId };
  },
});

export const WORKFORCE_ELIGIBILITY_CHANGED_V1 = defineBusinessEvent({
  eventType: 'workforce.eligibility-changed.v1',
  producer: 'workforce',
  aggregateType: 'capacity-resource',
  asyncApi: ASYNCAPI,
  parseData(data: unknown): { readonly eligibility: 'ELIGIBLE' | 'INELIGIBLE' } {
    const d = asObject(data);
    exactKeys(d, ['eligibility']);
    return { eligibility: oneOf(d.eligibility, ['ELIGIBLE', 'INELIGIBLE'] as const) };
  },
});

export const CONFIGURATION_PUBLISHED_V1 = defineBusinessEvent({
  eventType: 'configuration.configuration-published.v1',
  producer: 'configuration',
  aggregateType: 'configuration-scope',
  asyncApi: ASYNCAPI,
  parseData(data: unknown): {
    readonly marketId: string;
    readonly namespace: 'booking.policy.v1' | 'market.presentation.v1';
    readonly contentHash: string;
    readonly effectiveAt: string;
  } {
    const d = asObject(data);
    exactKeys(d, ['marketId', 'namespace', 'contentHash', 'effectiveAt']);
    if (typeof d.marketId !== 'string' || !/^[a-z]{2}(-[a-z0-9]{2,8})?$/.test(d.marketId)) {
      throw new Error('INVALID_EVENT_DATA');
    }
    if (typeof d.contentHash !== 'string' || !/^[0-9a-f]{64}$/.test(d.contentHash)) {
      throw new Error('INVALID_EVENT_DATA');
    }
    return {
      marketId: d.marketId,
      namespace: oneOf(d.namespace, ['booking.policy.v1', 'market.presentation.v1'] as const),
      contentHash: d.contentHash,
      effectiveAt: asCanonicalUtc(d.effectiveAt),
    };
  },
});

export const BUSINESS_EVENTS_V1 = [
  CUSTOMER_PROFILE_UPDATED_V1,
  CUSTOMER_ADDRESS_UPDATED_V1,
  VEHICLE_UPDATED_V1,
  GEO_ZONE_UPDATED_V1,
  CATALOG_DEFINITIONS_PUBLISHED_V1,
  PRICING_PRICE_BOOK_PUBLISHED_V1,
  PRICING_QUOTE_ISSUED_V1,
  SCHEDULING_HOLD_CHANGED_V1,
  WORKFORCE_ELIGIBILITY_CHANGED_V1,
  CONFIGURATION_PUBLISHED_V1,
] as const;
