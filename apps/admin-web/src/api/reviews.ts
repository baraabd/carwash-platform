import type { ReviewDecision } from '../domain/review';
import {
  INSTANT,
  UUID,
  integer,
  nullableText,
  object,
  oneOf,
  request,
  text,
  type Result,
} from './http';

/**
 * Technician verification decisions go to their owner, Workforce, through the
 * published Gateway route `admin.review` (POST /admin/reviews/:id, permission
 * `verification.review`, idempotency key required). The console never records
 * a decision itself: what it shows afterwards is Workforce's answer.
 */
export interface VerificationCase {
  readonly caseId: string;
  readonly operatorId: string;
  readonly status: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';
  readonly decidedAt: string | null;
  readonly decisionReason: string | null;
  readonly validUntil: string | null;
  readonly version: number;
}

function verificationCase(raw: unknown): VerificationCase {
  const c = object(raw, '$');
  return {
    caseId: text(c.caseId, 'caseId', UUID),
    operatorId: text(c.operatorId, 'operatorId', UUID),
    status: oneOf(
      c.status,
      ['PENDING_REVIEW', 'APPROVED', 'REJECTED', 'WITHDRAWN'] as const,
      'status',
    ),
    decidedAt: nullableText(c.decidedAt, 'decidedAt', INSTANT),
    decisionReason: nullableText(c.decisionReason, 'decisionReason', /^[A-Z_]{2,40}$/),
    validUntil: nullableText(c.validUntil, 'validUntil', INSTANT),
    version: integer(c.version, 'version'),
  };
}

/**
 * `key` is generated once per decision attempt and reused only when the
 * operator retries an UNKNOWN outcome of the very same decision.
 */
export function decide(
  caseId: string,
  decision: ReviewDecision,
  key: string,
): Promise<Result<VerificationCase>> {
  return request(`/admin/reviews/${encodeURIComponent(caseId)}`, {
    method: 'POST',
    body: decision,
    idempotencyKey: key,
    read: verificationCase,
  });
}
