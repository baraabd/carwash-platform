import type {
  CapacityReleaseResult,
  ConfirmResult,
  DispatchCancelResult,
  RebindResult,
  ReplaceResult,
  RevertResult,
  SettlementResult,
  SlotSnapshot,
} from '../../domain';
import type { BillingCancellation, CommitmentChanges, DispatchChanges } from '../../ports';
import { errorOf, type HttpOutcome, type OwnerHttpClient } from '../http/owner-http.client';
import { ContractViolation, parseHold } from './contract-acl';

/**
 * Owner adapters of the P04-C3 change saga, over the REQUESTED contracts of
 * docs/production/C/P04-C-interfaces.md. Every request carries a key derived
 * from the change id, so a retry after a lost response is the same request.
 * Anything that is not a recognised definitive answer is UNKNOWN: the saga
 * retries it and never reads it as success.
 */
function unknown(outcome: HttpOutcome, fallback = 'UPSTREAM_INVALID') {
  if (outcome.kind !== 'RESPONSE') return { kind: 'UNKNOWN' as const, error: outcome.error };
  return {
    kind: 'UNKNOWN' as const,
    error: outcome.status === 200 ? fallback : `HTTP_${outcome.status}`,
  };
}

function reason(outcome: HttpOutcome): string | null {
  return outcome.kind === 'RESPONSE' ? (errorOf(outcome.body)?.reason ?? null) : null;
}

function field(body: unknown, name: string): unknown {
  return typeof body === 'object' && body !== null
    ? (body as Record<string, unknown>)[name]
    : undefined;
}

function key(operation: string, changeId: string): string {
  return `booking-change-${operation}-${changeId}`;
}

/** The change view Dispatch answers with: it must be about this booking and change. */
function changeOutcome(outcome: HttpOutcome, bookingId: string): string | null {
  if (outcome.kind !== 'RESPONSE' || outcome.status !== 200) return null;
  if (field(outcome.body, 'bookingId') !== bookingId) return null;
  const value = field(outcome.body, 'outcome');
  return typeof value === 'string' ? value : null;
}

export class DispatchChangesAdapter implements DispatchChanges {
  constructor(private readonly http: OwnerHttpClient) {}

  private post(
    bookingId: string,
    path: string,
    operation: string,
    changeId: string,
    body: object,
    correlationId: string,
  ) {
    return this.http.call({
      method: 'POST',
      path: `/internal/v1/dispatch/bookings/${encodeURIComponent(bookingId)}${path}`,
      correlationId,
      idempotencyKey: key(operation, changeId),
      body,
    });
  }

  async cancel(
    bookingId: string,
    changeId: string,
    correlationId: string,
  ): Promise<DispatchCancelResult> {
    const outcome = await this.post(
      bookingId,
      '/cancellation',
      'cancel',
      changeId,
      { changeId },
      correlationId,
    );
    const answered = changeOutcome(outcome, bookingId);
    if (answered === 'CANCELLED') return { kind: 'CANCELLED' };
    if (answered === 'NOT_OPENED') return { kind: 'NOT_OPENED' };
    if (outcome.kind === 'RESPONSE' && outcome.status === 422) {
      const refusal = reason(outcome);
      if (refusal === 'WORK_STARTED' || refusal === 'WORK_COMPLETED') {
        return { kind: 'REFUSED', reason: refusal };
      }
    }
    return unknown(outcome);
  }

  async rebind(
    bookingId: string,
    changeId: string,
    slot: SlotSnapshot,
    correlationId: string,
  ): Promise<RebindResult> {
    const outcome = await this.post(
      bookingId,
      '/rebinding',
      'rebind',
      changeId,
      {
        changeId,
        holdId: slot.holdId,
        zoneId: slot.zoneId,
        startsAt: slot.startsAt.toISOString(),
        endsAt: slot.endsAt.toISOString(),
      },
      correlationId,
    );
    const answered = changeOutcome(outcome, bookingId);
    // A replay after confirmation answers CONFIRMED: the rebind certainly happened.
    if (answered === 'REBOUND' || answered === 'CONFIRMED') return { kind: 'REBOUND' };
    if (outcome.kind === 'RESPONSE' && outcome.status === 422) {
      const refusal = reason(outcome);
      if (
        refusal === 'WORK_STARTED' ||
        refusal === 'WORK_COMPLETED' ||
        refusal === 'BOOKING_CANCELLED'
      ) {
        return { kind: 'REFUSED', reason: refusal };
      }
    }
    if (
      outcome.kind === 'RESPONSE' &&
      outcome.status === 409 &&
      reason(outcome) === 'ASSIGNMENT_NOT_OPEN'
    ) {
      return { kind: 'NOT_READY' };
    }
    return unknown(outcome);
  }

  async confirm(
    bookingId: string,
    changeId: string,
    correlationId: string,
  ): Promise<ConfirmResult> {
    const outcome = await this.post(
      bookingId,
      '/rebinding/confirm',
      'confirm',
      changeId,
      { changeId },
      correlationId,
    );
    if (changeOutcome(outcome, bookingId) === 'CONFIRMED') return { kind: 'CONFIRMED' };
    return unknown(outcome, 'UPSTREAM_INVALID');
  }

  async revert(bookingId: string, changeId: string, correlationId: string): Promise<RevertResult> {
    const outcome = await this.post(
      bookingId,
      '/rebinding/revert',
      'revert',
      changeId,
      { changeId },
      correlationId,
    );
    const answered = changeOutcome(outcome, bookingId);
    if (answered === 'REVERTED' || answered === 'NOTHING_TO_REVERT') return { kind: 'REVERTED' };
    return unknown(outcome);
  }
}

export class SchedulingCommitmentsAdapter implements CommitmentChanges {
  constructor(private readonly http: OwnerHttpClient) {}

  async release(
    bookingId: string,
    holdId: string,
    correlationId: string,
  ): Promise<CapacityReleaseResult> {
    const outcome = await this.http.call({
      method: 'POST',
      path: `/internal/v1/scheduling/bookings/${encodeURIComponent(bookingId)}/commitment/release`,
      correlationId,
      idempotencyKey: key('release', holdId),
      body: { holdId },
    });
    if (outcome.kind === 'RESPONSE' && outcome.status === 200) {
      const hold = parsedHold(outcome.body);
      return hold !== null && hold.holdId === holdId && hold.state === 'RELEASED'
        ? { kind: 'RELEASED' }
        : unknown(outcome);
    }
    if (
      outcome.kind === 'RESPONSE' &&
      outcome.status === 409 &&
      reason(outcome) === 'COMMITMENT_NOT_FOUND'
    ) {
      return { kind: 'NOT_COMMITTED' };
    }
    return unknown(outcome);
  }

  async replace(
    input: {
      readonly bookingId: string;
      readonly fromHoldId: string;
      readonly toHoldId: string;
      readonly toExpectedRevision: number;
    },
    correlationId: string,
  ): Promise<ReplaceResult> {
    const outcome = await this.http.call({
      method: 'POST',
      path: `/internal/v1/scheduling/bookings/${encodeURIComponent(input.bookingId)}/commitment/replace`,
      correlationId,
      idempotencyKey: key('replace', input.toHoldId),
      body: {
        fromHoldId: input.fromHoldId,
        toHoldId: input.toHoldId,
        toExpectedRevision: input.toExpectedRevision,
      },
    });
    if (outcome.kind !== 'RESPONSE') return unknown(outcome);
    if (outcome.status === 200) {
      const committed = parsedHold(field(outcome.body, 'committed'));
      const released = parsedHold(field(outcome.body, 'released'));
      if (
        committed === null ||
        released === null ||
        committed.holdId !== input.toHoldId ||
        committed.state !== 'COMMITTED' ||
        committed.bookingId !== input.bookingId ||
        released.holdId !== input.fromHoldId ||
        released.state !== 'RELEASED'
      ) {
        return unknown(outcome);
      }
      return {
        kind: 'REPLACED',
        slot: {
          holdId: committed.holdId,
          zoneId: committed.zoneId,
          startsAt: committed.startsAt,
          endsAt: committed.endsAt,
        },
      };
    }
    const refusal = reason(outcome);
    if (outcome.status === 422 && refusal === 'HOLD_EXPIRED') {
      return { kind: 'REFUSED', reason: 'HOLD_EXPIRED' };
    }
    if ((outcome.status === 422 && refusal === 'HOLD_NOT_ACTIVE') || outcome.status === 412) {
      return { kind: 'REFUSED', reason: 'HOLD_NOT_ACTIVE' };
    }
    if (outcome.status === 404 || (outcome.status === 409 && refusal === 'COMMITMENT_NOT_FOUND')) {
      return { kind: 'REFUSED', reason: 'HOLD_UNAVAILABLE' };
    }
    return unknown(outcome);
  }
}

function parsedHold(body: unknown) {
  try {
    return parseHold(body);
  } catch (error) {
    if (error instanceof ContractViolation) return null;
    throw error;
  }
}

const SETTLEMENTS = ['VOIDED', 'REFUND_PENDING', 'NOTHING_DUE'] as const;

/**
 * Billing cancellation settlement (REQUESTED from Lane B, P04-C-interfaces
 * §Billing). Until Billing serves it the call is UNKNOWN (404/NOT_CONFIGURED)
 * and the saga keeps the cancellation's settlement PENDING with `attention`.
 */
export class BillingCancellationAdapter implements BillingCancellation {
  constructor(private readonly http: OwnerHttpClient) {}

  async settle(
    bookingId: string,
    changeId: string,
    correlationId: string,
  ): Promise<SettlementResult> {
    const outcome = await this.http.call({
      method: 'POST',
      path: `/internal/v1/billing/bookings/${encodeURIComponent(bookingId)}/cancellation-settlement`,
      correlationId,
      idempotencyKey: key('settle', changeId),
      body: { changeId },
    });
    if (
      outcome.kind === 'RESPONSE' &&
      outcome.status === 200 &&
      field(outcome.body, 'bookingId') === bookingId
    ) {
      const value = field(outcome.body, 'outcome');
      const settlement = SETTLEMENTS.find((s) => s === value);
      if (settlement !== undefined) return { kind: 'SETTLED', settlement };
    }
    return unknown(outcome);
  }
}
