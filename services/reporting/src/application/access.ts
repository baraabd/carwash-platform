import { AccessFault, type VerifiedSession } from '../ports/identity.ports';

/**
 * Who may read which operations projection. These are existing, published
 * Identity permissions whose meaning matches the read (decision D-P02-01,
 * pending owner/E acceptance; `reporting.read` is requested in CR-D-P01-01):
 * - booking operations belong to the operations role (`operations.dispatch`);
 * - workforce eligibility serves technician review (`verification.review`)
 *   and dispatch planning (`operations.dispatch`).
 * - cash-state KPIs are finance reads (`billing.read`), so operations staff
 *   cannot see amounts and finance staff cannot browse booking operations.
 * A reviewer therefore cannot browse bookings. Deny by default.
 */
export const OPERATIONS_READS = Object.freeze({
  bookings: ['operations.dispatch'],
  resources: ['verification.review', 'operations.dispatch'],
  freshness: ['verification.review', 'operations.dispatch', 'billing.read'],
  operationsKpis: ['operations.dispatch'],
  cashKpis: ['billing.read'],
} as const);

export type OperationsRead = keyof typeof OPERATIONS_READS;

export function requireRead(session: VerifiedSession, read: OperationsRead): void {
  const allowed: readonly string[] = OPERATIONS_READS[read];
  if (!allowed.some((permission) => session.permissions.includes(permission)))
    throw new AccessFault('AUTH_FORBIDDEN');
}

/**
 * Fixed-window per-subject read budget. Process-local by design: it bounds one
 * caller against one replica; global quotas belong to the edge.
 */
export class RequestBudget {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('INVALID_READ_BUDGET');
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
