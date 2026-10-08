import {
  SCHEDULING_HOLD_CHANGED_V1,
  WORKFORCE_ELIGIBILITY_CHANGED_V1,
  parseBookingConfirmedV1,
} from '@carwash/event-contracts';
import {
  DERIVED_STATUSES,
  OPERATIONS_SOURCES,
  OperationsRuleError,
  deriveStatus,
  factFingerprint,
  freshness,
  pageSize,
  slotWindow,
  uuidInput,
  type DerivedOperationsStatus,
  type Eligibility,
  type Freshness,
  type OperationsFact,
  type OperationsSource,
} from '../domain/operations';
import type { Hasher } from '../ports/projection.ports';
import type {
  BookingOperationRow,
  EligibilitySummary,
  FactOutcome,
  LinkedHoldRow,
  OperationsReader,
  OperationsWriter,
  Page,
  ResourceEligibilityRow,
} from '../ports/operations.ports';

/** Every event type the operations projection consumes, with its producer exchange. */
export const OPERATIONS_SUBSCRIPTIONS = [
  { exchange: 'booking.events', eventType: 'booking.confirmed.v1' },
  { exchange: 'scheduling.events', eventType: SCHEDULING_HOLD_CHANGED_V1.eventType },
  { exchange: 'workforce.events', eventType: WORKFORCE_ELIGIBILITY_CHANGED_V1.eventType },
] as const;

/** A delivered event, normalised: the inbox identity plus one domain fact. */
export interface OperationsEvent {
  readonly eventId: string;
  readonly eventType: string;
  readonly correlationId: string;
  readonly fact: OperationsFact;
}

/**
 * Parse one delivered event with the owner's PUBLISHED contract parser and
 * normalise it to a domain fact. Anything else throws, and the consumer
 * dead-letters a message it cannot parse rather than guessing.
 */
export function parseOperationsEvent(raw: unknown): OperationsEvent {
  const eventType =
    raw !== null && typeof raw === 'object'
      ? (raw as { eventType?: unknown }).eventType
      : undefined;
  switch (eventType) {
    case 'booking.confirmed.v1': {
      const e = parseBookingConfirmedV1(raw);
      return {
        eventId: e.eventId.toLowerCase(),
        eventType: e.eventType,
        correlationId: e.correlationId,
        fact: {
          kind: 'BOOKING_CONFIRMED',
          source: 'booking',
          eventId: e.eventId.toLowerCase(),
          occurredAt: new Date(e.occurredAt),
          version: e.aggregateVersion,
          bookingId: e.data.bookingId.toLowerCase(),
          customerRef: e.data.customerId.toLowerCase(),
        },
      };
    }
    case SCHEDULING_HOLD_CHANGED_V1.eventType: {
      const e = SCHEDULING_HOLD_CHANGED_V1.parse(raw);
      return {
        eventId: e.eventId.toLowerCase(),
        eventType: e.eventType,
        correlationId: e.correlationId,
        fact: {
          kind: 'HOLD_CHANGED',
          source: 'scheduling',
          eventId: e.eventId.toLowerCase(),
          occurredAt: new Date(e.occurredAt),
          version: e.aggregate.version,
          holdId: e.aggregate.id.toLowerCase(),
          state: e.data.state,
          zoneId: e.data.zoneId.toLowerCase(),
          startsAt: new Date(e.data.startsAt),
          endsAt: new Date(e.data.endsAt),
          bookingId: e.data.bookingId?.toLowerCase() ?? null,
        },
      };
    }
    case WORKFORCE_ELIGIBILITY_CHANGED_V1.eventType: {
      const e = WORKFORCE_ELIGIBILITY_CHANGED_V1.parse(raw);
      return {
        eventId: e.eventId.toLowerCase(),
        eventType: e.eventType,
        correlationId: e.correlationId,
        fact: {
          kind: 'ELIGIBILITY_CHANGED',
          source: 'workforce',
          eventId: e.eventId.toLowerCase(),
          occurredAt: new Date(e.occurredAt),
          version: e.aggregate.version,
          resourceId: e.aggregate.id.toLowerCase(),
          eligibility: e.data.eligibility,
        },
      };
    }
    default:
      throw new OperationsRuleError('UNSUPPORTED_EVENT');
  }
}

export interface OperationsClock {
  now(): Date;
}

/** Applies one fact inside the caller's (inbox) transaction. */
export class OperationsProjector {
  constructor(
    private readonly hash: Hasher,
    private readonly clock: OperationsClock,
  ) {}

  async apply(writer: OperationsWriter, fact: OperationsFact): Promise<FactOutcome> {
    const fingerprint = this.hash(factFingerprint(fact));
    let outcome: FactOutcome;
    switch (fact.kind) {
      case 'BOOKING_CONFIRMED':
        outcome = await writer.applyBookingConfirmed(fact, fingerprint);
        break;
      case 'HOLD_CHANGED':
        outcome = await writer.applyHoldChanged(fact, fingerprint);
        break;
      case 'ELIGIBILITY_CHANGED':
        outcome = await writer.applyEligibilityChanged(fact, fingerprint);
        break;
    }
    // A stale or repeated fact still proves the source pipeline is flowing.
    await writer.touchFreshness(fact.source, fact.occurredAt, this.clock.now());
    return outcome;
  }
}

/** Which owner holds the authoritative record a derived row only points at. */
export interface Authority {
  readonly owner: string;
  readonly reads: string;
}

/** What every read returns besides its rows: this is a projection, not the owner. */
export interface ProjectionMeta {
  readonly derived: true;
  readonly authority: readonly Authority[];
  readonly freshness: readonly Freshness[];
}

export interface BookingOperationView extends BookingOperationRow {
  readonly derivedStatus: DerivedOperationsStatus | null;
}

export const BOOKING_AUTHORITY: readonly Authority[] = [
  { owner: 'booking', reads: 'booking lifecycle, customer, vehicle, package, price and payment' },
  { owner: 'scheduling', reads: 'authoritative slot and hold state' },
  { owner: 'dispatch', reads: 'technician assignment and field progress' },
];

export const WORKFORCE_AUTHORITY: readonly Authority[] = [
  { owner: 'workforce', reads: 'operator identity, verification cases and review decisions' },
];

function view(row: BookingOperationRow): BookingOperationView {
  return {
    ...row,
    derivedStatus: deriveStatus({ confirmed: row.confirmedAt !== null, latestSlot: row.slot }),
  };
}

function cursorInput(value: unknown): string | null {
  if (value === undefined) return null;
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,200}$/.test(value))
    throw new OperationsRuleError('INVALID_CURSOR');
  return value;
}

function statusInput(value: unknown): DerivedOperationsStatus | null {
  if (value === undefined) return null;
  const status = DERIVED_STATUSES.find((s) => s === value);
  if (!status) throw new OperationsRuleError('INVALID_STATUS');
  return status;
}

function eligibilityInput(value: unknown): Eligibility | null {
  if (value === undefined) return null;
  if (value !== 'ELIGIBLE' && value !== 'INELIGIBLE')
    throw new OperationsRuleError('INVALID_ELIGIBILITY');
  return value;
}

export class OperationsQueries {
  constructor(
    private readonly reader: OperationsReader,
    private readonly clock: OperationsClock,
  ) {}

  private async meta(
    sources: readonly OperationsSource[],
    authority: readonly Authority[],
  ): Promise<ProjectionMeta> {
    const checkpoints = await this.reader.checkpoints();
    const now = this.clock.now();
    return {
      derived: true,
      authority,
      freshness: sources.map((s) => freshness(s, checkpoints.get(s) ?? null, now)),
    };
  }

  async bookings(input: {
    from: unknown;
    to: unknown;
    zoneId: unknown;
    status: unknown;
    limit: unknown;
    cursor: unknown;
  }): Promise<Page<BookingOperationView> & ProjectionMeta> {
    const window = slotWindow(input.from, input.to);
    const page = await this.reader.listBookings({
      ...window,
      zoneId: input.zoneId === undefined ? null : uuidInput(input.zoneId, 'INVALID_ZONE'),
      status: statusInput(input.status),
      limit: pageSize(input.limit),
      cursor: cursorInput(input.cursor),
    });
    return {
      items: page.items.map(view),
      nextCursor: page.nextCursor,
      ...(await this.meta(['booking', 'scheduling'], BOOKING_AUTHORITY)),
    };
  }

  async booking(bookingId: unknown): Promise<
    ProjectionMeta & {
      readonly item: BookingOperationView | null;
      readonly holds: readonly LinkedHoldRow[];
    }
  > {
    const id = uuidInput(bookingId, 'INVALID_BOOKING_ID');
    const row = await this.reader.booking(id);
    return {
      item: row && view(row),
      holds: row ? await this.reader.bookingHolds(id) : [],
      ...(await this.meta(['booking', 'scheduling'], BOOKING_AUTHORITY)),
    };
  }

  async resources(input: {
    eligibility: unknown;
    limit: unknown;
    cursor: unknown;
  }): Promise<Page<ResourceEligibilityRow> & ProjectionMeta & { summary: EligibilitySummary }> {
    const page = await this.reader.listResources({
      eligibility: eligibilityInput(input.eligibility),
      limit: pageSize(input.limit),
      cursor: cursorInput(input.cursor),
    });
    return {
      ...page,
      summary: await this.reader.resourceSummary(),
      ...(await this.meta(['workforce'], WORKFORCE_AUTHORITY)),
    };
  }

  async freshness(): Promise<readonly Freshness[]> {
    return (await this.meta(OPERATIONS_SOURCES, [])).freshness;
  }
}
