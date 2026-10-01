import { BOOKING_CONFIRMED_V1 } from './booking-confirmed';
import { FOUNDATION_PROBE_CREATED_V1 } from './foundation-probe-created';

export type EventContractStatus = 'foundation-runtime' | 'contract-only';

export interface EventContractDescriptor {
  readonly id: typeof BOOKING_CONFIRMED_V1 | typeof FOUNDATION_PROBE_CREATED_V1;
  readonly producer: 'booking' | 'catalog';
  readonly schemaVersion: 1;
  readonly status: EventContractStatus;
  readonly asyncApi: string;
}

export const EVENT_CONTRACTS: readonly EventContractDescriptor[] = [
  {
    id: FOUNDATION_PROBE_CREATED_V1,
    producer: 'catalog',
    schemaVersion: 1,
    status: 'foundation-runtime',
    asyncApi: 'docs/asyncapi/foundation-probe.yaml',
  },
  {
    id: BOOKING_CONFIRMED_V1,
    producer: 'booking',
    schemaVersion: 1,
    status: 'contract-only',
    asyncApi: 'docs/asyncapi/booking-confirmed-v1.yaml',
  },
] as const;

export function eventContract(id: EventContractDescriptor['id']): EventContractDescriptor {
  const contract = EVENT_CONTRACTS.find((candidate) => candidate.id === id);
  if (!contract) throw new Error('UNKNOWN_EVENT_CONTRACT');
  return contract;
}
