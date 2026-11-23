import { invalid } from '../../domain';
import type { HeaderBag } from './actor-resolver';

/** Closed body: unknown fields are refused, never ignored. */
export function objectBody(
  body: unknown,
  allowed: readonly string[],
  required: readonly string[],
): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body))
    throw invalid('Body must be a JSON object.');
  const record = body as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) throw invalid(`Unexpected field: ${key.slice(0, 40)}.`);
  }
  for (const key of required) if (!(key in record)) throw invalid(`Missing field: ${key}.`);
  return record;
}

export function str(value: unknown, field: string, max = 200): string {
  if (typeof value !== 'string' || value.length > max) throw invalid(`${field} must be a string.`);
  return value;
}

export function int(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value))
    throw invalid(`${field} must be an integer.`);
  return value;
}

export function bool(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw invalid(`${field} must be a boolean.`);
  return value;
}

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

/** UTC instants only; an offset-less or local time is rejected, never guessed. */
export function instant(value: unknown, field: string): Date {
  const text = str(value, field);
  if (!INSTANT.test(text)) throw invalid(`${field} must be a UTC ISO-8601 instant.`);
  const date = new Date(text);
  if (!Number.isFinite(date.getTime())) throw invalid(`${field} is not a valid instant.`);
  return date;
}

export function idempotencyKey(req: HeaderBag): string | undefined {
  const value = req.headers['idempotency-key'];
  return typeof value === 'string' ? value : undefined;
}
