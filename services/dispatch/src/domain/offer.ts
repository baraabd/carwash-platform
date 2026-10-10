import { DispatchError, invalid } from './errors';

/**
 * An offer of one job to one workforce resource (and the technician account
 * that operations named for it).
 *
 *   OFFERED -> ACCEPTED   (technician, before the deadline)
 *   OFFERED -> DECLINED   (technician)
 *   OFFERED -> EXPIRED    (deadline passed; decided by the injected clock)
 *   OFFERED | ACCEPTED -> WITHDRAWN (operations reassigned or the job was cancelled)
 *
 * DECLINED, EXPIRED and WITHDRAWN are terminal. An offer that is no longer
 * OFFERED can never be accepted: that is the fence against a technician
 * acting on a stale screen after operations moved the job elsewhere.
 */
export type OfferStatus = 'OFFERED' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED' | 'WITHDRAWN';

export const DECLINE_REASONS = ['UNAVAILABLE', 'TOO_FAR', 'OTHER'] as const;
export type DeclineReason = (typeof DECLINE_REASONS)[number];

export const WITHDRAW_REASONS = [
  'REASSIGNED',
  'UNASSIGNED',
  'JOB_CANCELLED',
  'RELEASED_BY_TECHNICIAN',
  'RESOURCE_INELIGIBLE',
  'JOB_RESCHEDULED',
] as const;
export type WithdrawReason = (typeof WITHDRAW_REASONS)[number];

export interface OfferState {
  readonly id: string;
  readonly assignmentId: string;
  readonly resourceId: string;
  readonly technicianSubject: string;
  readonly status: OfferStatus;
  readonly expiresAt: Date;
  readonly declineReason: DeclineReason | null;
  /** Optional free text from the technician (3-500 printable characters). */
  readonly declineNote: string | null;
  readonly withdrawReason: WithdrawReason | null;
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly version: number;
}

export const OFFER_LIMITS = Object.freeze({
  minTtlSeconds: 60,
  maxTtlSeconds: 60 * 60,
  defaultTtlSeconds: 15 * 60,
});

export function offerTtlSeconds(requested: number | undefined): number {
  if (requested === undefined) return OFFER_LIMITS.defaultTtlSeconds;
  if (
    !Number.isSafeInteger(requested) ||
    requested < OFFER_LIMITS.minTtlSeconds ||
    requested > OFFER_LIMITS.maxTtlSeconds
  ) {
    throw invalid('ttlSeconds is outside the allowed range.');
  }
  return requested;
}

export function isDeclineReason(value: unknown): value is DeclineReason {
  return typeof value === 'string' && DECLINE_REASONS.some((reason) => reason === value);
}

/** The offer never outlives the job window it is for. */
export function createOffer(input: {
  readonly id: string;
  readonly assignmentId: string;
  readonly resourceId: string;
  readonly technicianSubject: string;
  readonly ttlSeconds: number;
  readonly jobEndsAt: Date;
  readonly createdBy: string;
  readonly now: Date;
}): OfferState {
  const deadline = Math.min(
    input.now.getTime() + input.ttlSeconds * 1000,
    input.jobEndsAt.getTime(),
  );
  return {
    id: input.id,
    assignmentId: input.assignmentId,
    resourceId: input.resourceId,
    technicianSubject: input.technicianSubject,
    status: 'OFFERED',
    expiresAt: new Date(deadline),
    declineReason: null,
    declineNote: null,
    withdrawReason: null,
    createdBy: input.createdBy,
    createdAt: input.now,
    updatedAt: input.now,
    version: 1,
  };
}

/** An OFFERED offer whose deadline is at or before `now` can no longer be accepted. */
export function isDue(offer: OfferState, now: Date): boolean {
  return offer.status === 'OFFERED' && offer.expiresAt.getTime() <= now.getTime();
}

function bump(offer: OfferState, change: Partial<OfferState>, now: Date): OfferState {
  return { ...offer, ...change, updatedAt: now, version: offer.version + 1 };
}

/** Caller checks `isDue` first and records the expiry instead. */
function assertLive(offer: OfferState, now: Date): void {
  if (offer.status !== 'OFFERED') {
    throw new DispatchError('OFFER_NOT_LIVE', 'The offer is no longer live.');
  }
  if (isDue(offer, now)) throw new DispatchError('OFFER_EXPIRED', 'The offer has expired.');
}

export function accept(offer: OfferState, now: Date): OfferState {
  assertLive(offer, now);
  return bump(offer, { status: 'ACCEPTED' }, now);
}

export function decline(
  offer: OfferState,
  reason: DeclineReason,
  now: Date,
  note: string | null = null,
): OfferState {
  assertLive(offer, now);
  return bump(offer, { status: 'DECLINED', declineReason: reason, declineNote: note }, now);
}

export function expire(offer: OfferState, now: Date): OfferState {
  if (!isDue(offer, now)) throw new Error('OFFER_NOT_DUE');
  return bump(offer, { status: 'EXPIRED' }, now);
}

/** Withdrawing a terminal offer is a no-op (returns the same object). */
export function withdraw(offer: OfferState, reason: WithdrawReason, now: Date): OfferState {
  if (offer.status !== 'OFFERED' && offer.status !== 'ACCEPTED') return offer;
  return bump(offer, { status: 'WITHDRAWN', withdrawReason: reason }, now);
}
