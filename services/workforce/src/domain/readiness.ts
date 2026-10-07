import type { OperatorState } from './operator';

export type NotReadyReason =
  | 'EMPLOYMENT_INACTIVE'
  | 'SUSPENDED'
  | 'VERIFICATION_REQUIRED'
  | 'VERIFICATION_EXPIRED'
  | 'NO_SKILLS';

export interface Readiness {
  readonly ready: boolean;
  readonly reasons: readonly NotReadyReason[];
}

export function operationalReadiness(
  operator: OperatorState,
  skillCodes: readonly string[],
  now: Date,
): Readiness {
  const reasons: NotReadyReason[] = [];
  if (operator.employmentStatus !== 'ACTIVE') reasons.push('EMPLOYMENT_INACTIVE');
  if (operator.suspensionReason !== null) reasons.push('SUSPENDED');
  if (operator.verificationStatus !== 'VERIFIED' || operator.verifiedUntil === null) {
    reasons.push('VERIFICATION_REQUIRED');
  } else if (operator.verifiedUntil.getTime() <= now.getTime()) {
    reasons.push('VERIFICATION_EXPIRED');
  }
  if (skillCodes.length === 0) reasons.push('NO_SKILLS');
  return { ready: reasons.length === 0, reasons };
}
