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
  readonly sessionId: string;
  readonly authVersion: number;
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
  readonly reviewModeration: boolean;
  readonly services: boolean;
  readonly coverage: boolean;
  readonly support: boolean;
  readonly custody: boolean;
  readonly subscriptions: boolean;
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
    reviewModeration: has('reviews.moderate'),
    services: has('catalog.publish') || has('pricing.prices.publish'),
    coverage: has('operations.dispatch'),
    support: has('support.cases.read') || has('billing.read') || has('operations.dispatch'),
    custody: has('billing.read'),
    subscriptions: has('subscription.manage'),
  };
}

/** A customer, technician or guest has no business in this console at all. */
export function isStaff(caps: Capabilities): boolean {
  return (
    caps.bookings ||
    caps.resources ||
    caps.reviewDecisions ||
    caps.payments ||
    caps.reviewModeration ||
    caps.services ||
    caps.coverage ||
    caps.support ||
    caps.custody ||
    caps.subscriptions
  );
}

export type Screen =
  | 'dashboard'
  | 'bookings'
  | 'technicians'
  | 'payments'
  | 'reviews'
  | 'notifications'
  | 'services'
  | 'coverage'
  | 'disputes'
  | 'wallets'
  | 'subscriptions';

export const SCREENS: readonly Screen[] = [
  'dashboard',
  'bookings',
  'technicians',
  'payments',
  'reviews',
  'notifications',
  'services',
  'coverage',
  'disputes',
  'wallets',
  'subscriptions',
];

export function defaultScreen(caps: Capabilities): Screen | null {
  if (caps.bookings) return 'dashboard';
  if (caps.payments) return 'payments';
  if (caps.resources || caps.reviewDecisions) return 'technicians';
  if (caps.reviewModeration) return 'reviews';
  if (caps.services) return 'services';
  if (caps.support) return 'disputes';
  if (caps.subscriptions) return 'subscriptions';
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
    case 'reviews':
      return caps.reviewModeration;
    case 'notifications':
      return caps.bookings;
    case 'services':
      return caps.services;
    case 'coverage':
      return caps.coverage;
    case 'disputes':
      return caps.support;
    case 'wallets':
      return caps.custody;
    case 'subscriptions':
      return caps.subscriptions;
  }
}
