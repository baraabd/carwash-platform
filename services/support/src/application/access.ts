import {
  KIND_POLICIES,
  actionPolicy,
  type CaseAction,
  type CaseDesk,
  type CaseKind,
  CASE_KINDS,
} from '../domain';
import { AccessFault, type VerifiedSession } from '../ports/identity.ports';

/**
 * Role separation, deny by default. A desk's cases are visible to that desk
 * (and read-only to the support desk); decisions need the SAME permission the
 * owner will demand for the operation, so Support never lets anyone decide
 * what the owner would refuse them.
 *
 *   FINANCE cases     read: billing.read | support.cases.read
 *                     open: billing.reconcile | billing.refund
 *   OPERATIONS cases  read: operations.dispatch | support.cases.read
 *                     open: operations.dispatch
 *   decide            billing.reconcile / billing.refund / operations.dispatch
 *                     per owner operation; DISMISS needs the desk's open grant
 *   approve (refund)  billing.refund, by a different person than the proposer
 */
const DESK_READ: Readonly<Record<CaseDesk, readonly string[]>> = {
  FINANCE: ['billing.read', 'support.cases.read'],
  OPERATIONS: ['operations.dispatch', 'support.cases.read'],
};
const DESK_OPEN: Readonly<Record<CaseDesk, readonly string[]>> = {
  FINANCE: ['billing.reconcile', 'billing.refund'],
  OPERATIONS: ['operations.dispatch'],
};
const OPERATION_PERMISSION = {
  'billing.reconcile': 'billing.reconcile',
  'billing.refund': 'billing.refund',
  'booking.cancel': 'operations.dispatch',
  'booking.reschedule': 'operations.dispatch',
} as const;
export const APPROVE_PERMISSION = 'billing.refund';

function holdsAny(session: VerifiedSession, permissions: readonly string[]): boolean {
  return permissions.some((permission) => session.permissions.includes(permission));
}

export function readableKinds(session: VerifiedSession): readonly CaseKind[] {
  return CASE_KINDS.filter((kind) => holdsAny(session, DESK_READ[KIND_POLICIES[kind].desk]));
}

export function requireAnyRead(session: VerifiedSession): void {
  if (readableKinds(session).length === 0) throw new AccessFault('AUTH_FORBIDDEN');
}

export function requireRead(session: VerifiedSession, kind: CaseKind): void {
  if (!holdsAny(session, DESK_READ[KIND_POLICIES[kind].desk]))
    throw new AccessFault('AUTH_FORBIDDEN');
}

export function requireOpen(session: VerifiedSession, kind: CaseKind): void {
  if (!holdsAny(session, DESK_OPEN[KIND_POLICIES[kind].desk]))
    throw new AccessFault('AUTH_FORBIDDEN');
}

export function requireDecide(session: VerifiedSession, kind: CaseKind, action: CaseAction): void {
  const policy = actionPolicy(kind, action);
  const needed =
    policy.operation === null
      ? DESK_OPEN[KIND_POLICIES[kind].desk]
      : [OPERATION_PERMISSION[policy.operation]];
  if (!holdsAny(session, needed)) throw new AccessFault('AUTH_FORBIDDEN');
}

export function requireApprove(session: VerifiedSession): void {
  if (!session.permissions.includes(APPROVE_PERMISSION)) throw new AccessFault('AUTH_FORBIDDEN');
}

/**
 * Fixed-window per-subject budget. Process-local by design: it bounds one
 * caller against one replica; global quotas belong to the edge.
 */
export class RequestBudget {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('INVALID_REQUEST_BUDGET');
  }

  take(subject: string): void {
    const at = this.now();
    const current = this.windows.get(subject);
    if (!current || at - current.start >= this.windowMs) {
      if (this.windows.size >= 10_000) this.windows.clear();
      this.windows.set(subject, { start: at, count: 1 });
      return;
    }
    current.count += 1;
    if (current.count > this.limit) throw new AccessFault('AUTH_RATE_LIMITED');
  }
}
