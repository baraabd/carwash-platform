import type { OutboxEvent } from '../ports';

/**
 * Customer integration events, written to the local outbox in the same
 * transaction as the state change they describe.
 *
 * They carry references and revisions only - never a name, phone number,
 * address line, note or coordinate. A consumer that needs current details asks
 * Customer through an authorised API. The shapes follow the shared envelope
 * rules; registration in @carwash/event-contracts and the broker topology are a
 * Lane E request (docs/production/A/P01-A1_CONTRACT_REQUESTS.md), so the relay
 * is not started by this service yet and rows remain pending in the outbox.
 */
export const CUSTOMER_EVENTS_EXCHANGE = 'washgo.customer.events';
export const CUSTOMER_PROFILE_UPDATED_V1 = 'customer.profile-updated.v1' as const;
export const CUSTOMER_ADDRESS_UPDATED_V1 = 'customer.address-updated.v1' as const;

export type ProfileChange = 'created' | 'updated';
export type AddressChange = 'created' | 'updated' | 'archived';

interface Envelope<TType extends string, TData> {
  readonly eventId: string;
  readonly eventType: TType;
  readonly schemaVersion: 1;
  readonly producer: 'customer';
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly aggregateVersion: number;
  readonly data: TData;
}

export type CustomerProfileUpdatedV1 = Envelope<
  typeof CUSTOMER_PROFILE_UPDATED_V1,
  { readonly customerId: string; readonly change: ProfileChange }
>;

export type CustomerAddressUpdatedV1 = Envelope<
  typeof CUSTOMER_ADDRESS_UPDATED_V1,
  {
    readonly customerId: string;
    readonly addressId: string;
    readonly change: AddressChange;
    readonly status: 'ACTIVE' | 'ARCHIVED';
  }
>;

export interface EventContext {
  readonly eventId: string;
  readonly occurredAt: Date;
  readonly correlationId: string;
  readonly traceParent: string | null;
}

function toOutbox(
  event: CustomerProfileUpdatedV1 | CustomerAddressUpdatedV1,
  context: EventContext,
): OutboxEvent {
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    exchange: CUSTOMER_EVENTS_EXCHANGE,
    routingKey: event.eventType,
    payload: JSON.stringify(event),
    correlationId: event.correlationId,
    traceParent: context.traceParent,
  };
}

export function profileUpdatedEvent(
  context: EventContext,
  customerId: string,
  revision: number,
  change: ProfileChange,
): OutboxEvent {
  return toOutbox(
    {
      eventId: context.eventId,
      eventType: CUSTOMER_PROFILE_UPDATED_V1,
      schemaVersion: 1,
      producer: 'customer',
      occurredAt: context.occurredAt.toISOString(),
      correlationId: context.correlationId,
      aggregateVersion: revision,
      data: { customerId, change },
    },
    context,
  );
}

export function addressUpdatedEvent(
  context: EventContext,
  address: {
    readonly id: string;
    readonly customerId: string;
    readonly revision: number;
    readonly status: 'ACTIVE' | 'ARCHIVED';
  },
  change: AddressChange,
): OutboxEvent {
  return toOutbox(
    {
      eventId: context.eventId,
      eventType: CUSTOMER_ADDRESS_UPDATED_V1,
      schemaVersion: 1,
      producer: 'customer',
      occurredAt: context.occurredAt.toISOString(),
      correlationId: context.correlationId,
      aggregateVersion: address.revision,
      data: {
        customerId: address.customerId,
        addressId: address.id,
        change,
        status: address.status,
      },
    },
    context,
  );
}
