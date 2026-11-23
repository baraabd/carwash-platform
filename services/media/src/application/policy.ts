import type { MediaPolicy } from '../ports';

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Idempotency records are kept this long, then purged by the worker. */
export const IDEMPOTENCY_RETENTION_MS = 7 * DAY;

interface Bound {
  readonly fallback: number;
  readonly min: number;
  readonly max: number;
}

/** Defaults and hard bounds, in seconds. A value outside them stops the process. */
export const POLICY_BOUNDS_SECONDS: Readonly<Record<keyof MediaPolicy, Bound>> = {
  reservationTtlMs: { fallback: 15 * 60, min: 5 * 60, max: 60 * 60 },
  uploadUrlTtlMs: { fallback: 5 * 60, min: 60, max: 15 * 60 },
  readUrlTtlMs: { fallback: 120, min: 60, max: 300 },
  retentionMs: { fallback: 24 * 3_600, min: 2 * 3_600, max: 30 * 24 * 3_600 },
  claimGuardMs: { fallback: 3_600, min: 5 * 60, max: 6 * 3_600 },
  expiryGraceMs: { fallback: 120, min: 30, max: 15 * 60 },
};

export type PolicySeconds = Partial<Record<keyof MediaPolicy, number>>;

/**
 * Builds the validated policy from optional overrides in whole seconds.
 * Cross-field rules: an upload URL never outlives its reservation and the claim
 * guard is at most half of the retention window, so claims stay possible.
 */
export function mediaPolicy(seconds: PolicySeconds = {}): MediaPolicy {
  const pick = (name: keyof MediaPolicy): number => {
    const bound = POLICY_BOUNDS_SECONDS[name];
    const value = seconds[name] ?? bound.fallback;
    if (!Number.isSafeInteger(value) || value < bound.min || value > bound.max) {
      throw new Error(`MEDIA_POLICY_OUT_OF_RANGE_${name}`);
    }
    return value * SECOND;
  };
  const policy: MediaPolicy = {
    reservationTtlMs: pick('reservationTtlMs'),
    uploadUrlTtlMs: pick('uploadUrlTtlMs'),
    readUrlTtlMs: pick('readUrlTtlMs'),
    retentionMs: pick('retentionMs'),
    claimGuardMs: pick('claimGuardMs'),
    expiryGraceMs: pick('expiryGraceMs'),
  };
  if (policy.uploadUrlTtlMs > policy.reservationTtlMs) {
    throw new Error('MEDIA_POLICY_UPLOAD_URL_OUTLIVES_RESERVATION');
  }
  if (policy.claimGuardMs * 2 > policy.retentionMs) {
    throw new Error('MEDIA_POLICY_CLAIM_GUARD_TOO_LARGE');
  }
  return policy;
}
