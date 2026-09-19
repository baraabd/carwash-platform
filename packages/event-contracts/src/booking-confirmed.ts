export interface BookingConfirmedV1 {
  eventId: string;
  eventType: 'booking.confirmed.v1';
  schemaVersion: 1;
  producer: 'booking';
  occurredAt: string;
  correlationId: string;
  aggregateVersion: number;
  data: { bookingId: string; customerId: string };
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('EXPECTED_OBJECT');
  return value as Record<string, unknown>;
}
function exactKeys(value: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key)))
    throw new Error('UNEXPECTED_EVENT_FIELDS');
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !uuid.test(value)) throw new Error('INVALID_UUID');
  return value;
}
/** Structural validation is NOT authentication. Broker ACLs establish producer identity. */
export function parseBookingConfirmedV1(value: unknown): BookingConfirmedV1 {
  const v = object(value);
  exactKeys(v, ['eventId','eventType','schemaVersion','producer','occurredAt','correlationId','aggregateVersion','data']);
  if (v.eventType !== 'booking.confirmed.v1' || v.schemaVersion !== 1 || v.producer !== 'booking')
    throw new Error('UNSUPPORTED_EVENT');
  if (typeof v.occurredAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v.occurredAt))
    throw new Error('INVALID_TIMESTAMP');
  const timestamp = Date.parse(v.occurredAt);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== v.occurredAt)
    throw new Error('INVALID_TIMESTAMP');
  if (typeof v.aggregateVersion !== 'number' || !Number.isSafeInteger(v.aggregateVersion) || v.aggregateVersion < 1)
    throw new Error('INVALID_AGGREGATE_VERSION');
  const data = object(v.data);
  exactKeys(data, ['bookingId', 'customerId']);
  return { eventId:id(v.eventId), eventType:'booking.confirmed.v1', schemaVersion:1, producer:'booking',
    occurredAt:v.occurredAt, correlationId:id(v.correlationId), aggregateVersion:v.aggregateVersion,
    data:{bookingId:id(data.bookingId), customerId:id(data.customerId)} };
}
