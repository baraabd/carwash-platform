import { randomUUID } from 'node:crypto';

/**
 * Trace propagation without personal data.
 *
 * A caller-supplied correlation id is accepted only when it is a well-formed
 * UUID, so an untrusted header can never become a log label or an event field.
 */

export const CORRELATION_HEADER = 'x-correlation-id';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function resolveCorrelationId(headerValue: unknown): string {
  if (typeof headerValue === 'string' && UUID.test(headerValue)) return headerValue.toLowerCase();
  return randomUUID();
}
