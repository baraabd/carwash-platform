/**
 * Technician verification decisions as Workforce accepts them. The console
 * only shapes the request; Workforce decides (pending state, self-review,
 * permission) and its answer is the only truth shown afterwards.
 */
export const REJECT_REASONS = [
  'EVIDENCE_INCOMPLETE',
  'EVIDENCE_INVALID',
  'IDENTITY_MISMATCH',
  'POLICY_INELIGIBLE',
] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

export type ReviewDecision =
  | { readonly decision: 'APPROVE'; readonly validUntil: string }
  | { readonly decision: 'REJECT'; readonly reason: RejectReason };

export type DecisionProblem =
  'VALID_UNTIL_REQUIRED' | 'VALID_UNTIL_NOT_FUTURE' | 'VALID_UNTIL_TOO_FAR' | 'REASON_REQUIRED';

/** Verification is re-checked at least every two years. */
export const MAX_VALIDITY_DAYS = 730;

export function isRejectReason(value: unknown): value is RejectReason {
  return REJECT_REASONS.some((r) => r === value);
}

/**
 * Approval validity is the END of the chosen local calendar day, so "valid
 * until 2027-03-01" really covers that whole day for the operator.
 */
export function approval(dateInput: string, now: Date): ReviewDecision | DecisionProblem {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateInput);
  if (!match) return 'VALID_UNTIL_REQUIRED';
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const end = new Date(year, month - 1, day, 23, 59, 59, 0);
  if (end.getFullYear() !== year || end.getMonth() !== month - 1 || end.getDate() !== day)
    return 'VALID_UNTIL_REQUIRED';
  if (end.getTime() <= now.getTime()) return 'VALID_UNTIL_NOT_FUTURE';
  if (end.getTime() - now.getTime() > MAX_VALIDITY_DAYS * 86_400_000) return 'VALID_UNTIL_TOO_FAR';
  return { decision: 'APPROVE', validUntil: end.toISOString() };
}

export function rejection(reason: string): ReviewDecision | DecisionProblem {
  return isRejectReason(reason) ? { decision: 'REJECT', reason } : 'REASON_REQUIRED';
}

export function isProblem(value: ReviewDecision | DecisionProblem): value is DecisionProblem {
  return typeof value === 'string';
}
