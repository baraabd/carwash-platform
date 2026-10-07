import { invalid } from './errors';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type EmploymentStatus = 'ACTIVE' | 'INACTIVE';
export type SuspensionReason = 'OPERATIONS' | 'COMPLIANCE' | 'SAFETY';
export type VerificationStatus = 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'REJECTED';

export interface OperatorState {
  readonly id: string;
  readonly identitySubject: string;
  readonly displayName: string;
  readonly homeZoneId: string;
  readonly employmentStatus: EmploymentStatus;
  readonly suspensionReason: SuspensionReason | null;
  readonly verificationStatus: VerificationStatus;
  readonly verifiedUntil: Date | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export function assertUuid(value: string, field = 'id'): void {
  if (!UUID.test(value)) invalid(`${field} must be a UUID.`);
}

export function assertDisplayName(value: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (
    normalized.length < 2 ||
    normalized.length > 80 ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    invalid('displayName must contain 2-80 printable characters.');
  }
  return normalized;
}

export function createOperator(input: {
  id: string;
  identitySubject: string;
  displayName: string;
  homeZoneId: string;
  now: Date;
}): OperatorState {
  assertUuid(input.id);
  assertUuid(input.identitySubject, 'identitySubject');
  assertUuid(input.homeZoneId, 'homeZoneId');
  return {
    id: input.id.toLowerCase(),
    identitySubject: input.identitySubject.toLowerCase(),
    displayName: assertDisplayName(input.displayName),
    homeZoneId: input.homeZoneId.toLowerCase(),
    employmentStatus: 'ACTIVE',
    suspensionReason: null,
    verificationStatus: 'UNVERIFIED',
    verifiedUntil: null,
    version: 1,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function changeProfile(
  state: OperatorState,
  input: { displayName?: string; homeZoneId?: string },
  now: Date,
): OperatorState {
  const displayName =
    input.displayName === undefined
      ? state.displayName
      : assertDisplayName(input.displayName);
  let homeZoneId = state.homeZoneId;
  if (input.homeZoneId !== undefined) {
    assertUuid(input.homeZoneId, 'homeZoneId');
    homeZoneId = input.homeZoneId.toLowerCase();
  }
  if (displayName === state.displayName && homeZoneId === state.homeZoneId) {
    return state;
  }
  return {
    ...state,
    displayName,
    homeZoneId,
    version: state.version + 1,
    updatedAt: now,
  };
}

export function setEmployment(
  state: OperatorState,
  status: EmploymentStatus,
  now: Date,
): OperatorState {
  if (status !== 'ACTIVE' && status !== 'INACTIVE') {
    invalid('Unknown employment status.');
  }
  if (state.employmentStatus === status) return state;
  return {
    ...state,
    employmentStatus: status,
    version: state.version + 1,
    updatedAt: now,
  };
}

export function setSuspension(
  state: OperatorState,
  reason: SuspensionReason | null,
  now: Date,
): OperatorState {
  if (
    reason !== null &&
    reason !== 'OPERATIONS' &&
    reason !== 'COMPLIANCE' &&
    reason !== 'SAFETY'
  ) {
    invalid('Unknown suspension reason.');
  }
  if (state.suspensionReason === reason) return state;
  return {
    ...state,
    suspensionReason: reason,
    version: state.version + 1,
    updatedAt: now,
  };
}

export function setVerificationProjection(
  state: OperatorState,
  status: VerificationStatus,
  validUntil: Date | null,
  now: Date,
): OperatorState {
  if (status === 'VERIFIED') {
    if (!validUntil || validUntil.getTime() <= now.getTime()) {
      invalid('Verified status requires a future validUntil.');
    }
  } else if (validUntil !== null) {
    invalid('Only VERIFIED operators may have verifiedUntil.');
  }
  return {
    ...state,
    verificationStatus: status,
    verifiedUntil: validUntil,
    version: state.version + 1,
    updatedAt: now,
  };
}
