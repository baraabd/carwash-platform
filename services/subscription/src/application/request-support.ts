import {
  AccessDenied,
  type AccessAuthority,
  type ServiceCallerAuthority,
  type ServiceScope,
  type VerifiedPrincipal,
} from '../ports';
import { SubscriptionApplicationError } from './subscription-errors';

/** Requested from Lane E/Identity (CR-B-10.1); until granted, staff management is denied. */
export const MANAGE_PERMISSION = 'subscription.manage';
/** Existing Identity grant for customers who may book (and so buy a plan). */
export const CUSTOMER_PERMISSION = 'bookings.create:self';
export const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UTC_MILLIS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MAX_INT = 2_147_483_647;

export interface RequestContext {
  readonly credential: string | undefined;
  readonly correlationId: string;
  readonly serviceClient?: string | undefined;
  readonly serviceToken?: string | undefined;
}

export async function verifiedPrincipal(
  authority: AccessAuthority,
  context: RequestContext,
  permission?: string,
): Promise<VerifiedPrincipal> {
  let principal: VerifiedPrincipal;
  try {
    principal = await authority.verify(context.credential, context.correlationId);
  } catch (error: unknown) {
    if (error instanceof AccessDenied) throw new SubscriptionApplicationError(error.reason);
    throw new SubscriptionApplicationError('AUTH_UNAVAILABLE');
  }
  if (permission && !principal.permissions.includes(permission))
    throw new SubscriptionApplicationError('AUTH_FORBIDDEN');
  return principal;
}

/** Authenticated service caller holding `scope`; unauthenticated and denied look the same. */
export function serviceCaller(
  callers: ServiceCallerAuthority,
  context: RequestContext,
  scope: ServiceScope,
): string {
  const client = callers.authorize(context.serviceClient, context.serviceToken, scope);
  if (!client) throw new SubscriptionApplicationError('SERVICE_AUTH_REQUIRED');
  return client;
}

export function idempotencyKey(value: unknown): string {
  if (typeof value !== 'string' || !IDEMPOTENCY_KEY.test(value))
    throw new SubscriptionApplicationError('IDEMPOTENCY_KEY_INVALID');
  return value;
}

export function objectWithKeys(body: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body))
    throw new SubscriptionApplicationError('REQUEST_INVALID');
  const input = body as Record<string, unknown>;
  if (Object.keys(input).sort().join(',') !== [...keys].sort().join(','))
    throw new SubscriptionApplicationError('REQUEST_INVALID');
  return input;
}

export function uuidField(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID.test(value))
    throw new SubscriptionApplicationError('REQUEST_INVALID', { field });
  return value;
}

export function boundedInt(value: unknown, min: number, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value >= MAX_INT)
    throw new SubscriptionApplicationError('REQUEST_INVALID', { field });
  return value;
}

export function timestamp(value: unknown, field: string, nullable: boolean): Date | null {
  if (value === null && nullable) return null;
  if (typeof value !== 'string' || !UTC_MILLIS.test(value))
    throw new SubscriptionApplicationError('REQUEST_INVALID', { field });
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value)
    throw new SubscriptionApplicationError('REQUEST_INVALID', { field });
  return date;
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  const found = allowed.find((candidate) => candidate === value);
  if (found === undefined) throw new SubscriptionApplicationError('REQUEST_INVALID', { field });
  return found;
}

/** Path ids: malformed and missing are indistinguishable (non-enumerating). */
export function pathId(value: string): string {
  if (!UUID.test(value)) throw new SubscriptionApplicationError('NOT_FOUND');
  return value;
}
