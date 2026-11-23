import { WorkforceError, invalid } from './errors';
import { assertUuid, type OperatorState } from './operator';

export type VerificationCaseStatus = 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';

export type DecisionReason =
  'IDENTITY_MISMATCH' | 'EVIDENCE_INCOMPLETE' | 'EVIDENCE_INVALID' | 'POLICY_INELIGIBLE';

export interface VerificationCaseState {
  readonly id: string;
  readonly operatorId: string;
  readonly status: VerificationCaseStatus;
  readonly evidenceRefs: readonly string[];
  readonly submittedBy: string;
  readonly submittedAt: Date;
  readonly decidedBy: string | null;
  readonly decidedAt: Date | null;
  readonly decisionReason: DecisionReason | null;
  readonly validUntil: Date | null;
  readonly requester: string;
  readonly idempotencyKey: string;
  readonly requestFingerprint: string;
  readonly version: number;
}

export function assertEvidence(evidenceRefs: readonly string[]): string[] {
  if (evidenceRefs.length < 1 || evidenceRefs.length > 8) {
    invalid('Verification requires 1-8 evidence references.');
  }
  const unique = new Set<string>();
  for (const ref of evidenceRefs) {
    assertUuid(ref, 'evidenceRef');
    unique.add(ref.toLowerCase());
  }
  if (unique.size !== evidenceRefs.length) {
    invalid('Evidence references must be unique.');
  }
  return [...unique];
}

export function createVerificationCase(input: {
  id: string;
  operator: OperatorState;
  evidenceRefs: readonly string[];
  submittedBy: string;
  requester: string;
  idempotencyKey: string;
  requestFingerprint: string;
  now: Date;
}): VerificationCaseState {
  assertUuid(input.id);
  assertUuid(input.submittedBy, 'submittedBy');
  if (input.submittedBy.toLowerCase() !== input.operator.identitySubject) {
    throw new WorkforceError('FORBIDDEN', 'Only the operator may submit verification evidence.');
  }
  return {
    id: input.id.toLowerCase(),
    operatorId: input.operator.id,
    status: 'PENDING_REVIEW',
    evidenceRefs: assertEvidence(input.evidenceRefs),
    submittedBy: input.submittedBy.toLowerCase(),
    submittedAt: input.now,
    decidedBy: null,
    decidedAt: null,
    decisionReason: null,
    validUntil: null,
    requester: input.requester,
    idempotencyKey: input.idempotencyKey,
    requestFingerprint: input.requestFingerprint,
    version: 1,
  };
}

function requirePending(state: VerificationCaseState): void {
  if (state.status !== 'PENDING_REVIEW') {
    throw new WorkforceError('CASE_NOT_PENDING', 'Verification case is already closed.');
  }
}

export function approveVerification(
  state: VerificationCaseState,
  operator: OperatorState,
  reviewer: string,
  validUntil: Date,
  now: Date,
): VerificationCaseState {
  requirePending(state);
  assertUuid(reviewer, 'reviewer');
  if (reviewer.toLowerCase() === operator.identitySubject) {
    throw new WorkforceError('SELF_REVIEW_FORBIDDEN', 'A reviewer cannot approve their own case.');
  }
  if (validUntil.getTime() <= now.getTime()) {
    invalid('validUntil must be in the future.');
  }
  return {
    ...state,
    status: 'APPROVED',
    decidedBy: reviewer.toLowerCase(),
    decidedAt: now,
    decisionReason: null,
    validUntil,
    version: state.version + 1,
  };
}

export function rejectVerification(
  state: VerificationCaseState,
  operator: OperatorState,
  reviewer: string,
  reason: DecisionReason,
  now: Date,
): VerificationCaseState {
  requirePending(state);
  assertUuid(reviewer, 'reviewer');
  if (reviewer.toLowerCase() === operator.identitySubject) {
    throw new WorkforceError('SELF_REVIEW_FORBIDDEN', 'A reviewer cannot reject their own case.');
  }
  if (
    reason !== 'IDENTITY_MISMATCH' &&
    reason !== 'EVIDENCE_INCOMPLETE' &&
    reason !== 'EVIDENCE_INVALID' &&
    reason !== 'POLICY_INELIGIBLE'
  ) {
    invalid('Unknown verification decision reason.');
  }
  return {
    ...state,
    status: 'REJECTED',
    decidedBy: reviewer.toLowerCase(),
    decidedAt: now,
    decisionReason: reason,
    validUntil: null,
    version: state.version + 1,
  };
}

export function withdrawVerification(
  state: VerificationCaseState,
  subject: string,
  operator: OperatorState,
  now: Date,
): VerificationCaseState {
  requirePending(state);
  if (subject.toLowerCase() !== operator.identitySubject) {
    throw new WorkforceError('FORBIDDEN', 'Only the operator may withdraw the case.');
  }
  return {
    ...state,
    status: 'WITHDRAWN',
    decidedBy: null,
    decidedAt: now,
    decisionReason: null,
    validUntil: null,
    version: state.version + 1,
  };
}
