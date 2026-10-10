/**
 * What the signed-in staff member may see in the admin console.
 *
 * This is presentation gating only. Every read and action is authorized again
 * by its owner (Reporting, Workforce, Booking, Dispatch, Billing,
 * Communications) and by the Gateway; hiding a control is never the security
 * boundary.
 */
export interface StaffSession {
  readonly subject: string;
  readonly principalKind: 'account' | 'guest';
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
}

export interface Capabilities {
  /** Booking operations, live assignment and KPIs (operations role). */
  readonly bookings: boolean;
  /** Workforce eligibility projection (reviewer or operations). */
  readonly resources: boolean;
  /** Approve or reject a technician verification case (reviewer). */
  readonly reviewDecisions: boolean;
  /** Offer, reassign and unassign jobs through Dispatch (operations). */
  readonly assignmentActions: boolean;
  /** Billing obligations and cash-state KPIs (finance). */
  readonly payments: boolean;
  /** Read exception cases of at least one desk (finance, operations or the support desk). */
  readonly cases: boolean;
  /** Open and decide payment cases (finance: billing.reconcile or billing.refund). */
  readonly financeCases: boolean;
  /** Open and decide booking cancellation and reschedule cases (operations). */
  readonly operationsCases: boolean;
}

export function capabilities(session: StaffSession): Capabilities {
  const has = (permission: string): boolean =>
    session.principalKind === 'account' && session.permissions.includes(permission);
  return {
    bookings: has('operations.dispatch'),
    resources: has('operations.dispatch') || has('verification.review'),
    reviewDecisions: has('verification.review'),
    assignmentActions: has('operations.dispatch'),
    payments: has('billing.read'),
    cases: has('billing.read') || has('operations.dispatch') || has('support.cases.read'),
    financeCases: has('billing.reconcile') || has('billing.refund'),
    operationsCases: has('operations.dispatch'),
  };
}

/** A customer, technician or guest has no business in this console at all. */
export function isStaff(caps: Capabilities): boolean {
  return caps.bookings || caps.resources || caps.reviewDecisions || caps.payments || caps.cases;
}

export type Screen = 'dashboard' | 'bookings' | 'technicians' | 'payments' | 'disputes';

export const SCREENS: readonly Screen[] = [
  'dashboard',
  'bookings',
  'technicians',
  'payments',
  'disputes',
];

export function defaultScreen(caps: Capabilities): Screen | null {
  if (caps.bookings) return 'dashboard';
  if (caps.payments) return 'payments';
  if (caps.resources || caps.reviewDecisions) return 'technicians';
  if (caps.cases) return 'disputes';
  return null;
}

export function canOpen(screen: Screen, caps: Capabilities): boolean {
  switch (screen) {
    case 'dashboard':
    case 'bookings':
      return caps.bookings;
    case 'technicians':
      return caps.resources || caps.reviewDecisions;
    case 'payments':
      return caps.payments;
    case 'disputes':
      return caps.cases;
  }
}
