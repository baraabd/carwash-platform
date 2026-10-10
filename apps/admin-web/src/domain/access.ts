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
  /** Record a reconciliation outcome through Billing (finance). */
  readonly reconcile: boolean;
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
    reconcile: has('billing.reconcile'),
  };
}

/** A customer, technician or guest has no business in this console at all. */
export function isStaff(caps: Capabilities): boolean {
  return caps.bookings || caps.resources || caps.reviewDecisions || caps.payments;
}

export type Screen = 'dashboard' | 'bookings' | 'technicians' | 'payments';

export const SCREENS: readonly Screen[] = ['dashboard', 'bookings', 'technicians', 'payments'];

export function defaultScreen(caps: Capabilities): Screen | null {
  if (caps.bookings) return 'dashboard';
  if (caps.payments) return 'payments';
  if (caps.resources || caps.reviewDecisions) return 'technicians';
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
  }
}
