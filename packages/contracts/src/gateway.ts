import type { IdentityPermission } from './identity';
/** F007 is a routing contract, never an implementation of a business operation. */
export const GATEWAY_V1 = '/api/v1' as const;
export type GatewayOwner =
  | 'identity'
  | 'customer'
  | 'catalog'
  | 'booking'
  | 'workforce'
  | 'billing'
  | 'support'
  | 'reporting';
export interface GatewayRoute {
  readonly id: string;
  readonly method: 'GET' | 'POST' | 'PATCH';
  readonly path: string;
  readonly owner: GatewayOwner;
  readonly upstream: string;
  readonly permission?: IdentityPermission;
  readonly authTransport?: boolean;
  /**
   * Anonymous read: the Gateway forwards only request/correlation/trace
   * headers - never cookies, bearer tokens or identity headers - and the
   * owner must not personalize the response. Only GET routes may be public.
   */
  readonly public?: true;
  readonly idempotency?: 'required';
  /**
   * P04-E2: an external payment provider's server notification. No identity,
   * cookie, bearer or browser header is ever forwarded; the exact raw request
   * bytes (bounded) and only the allowlisted provider headers reach the owner,
   * which verifies the signature and de-duplicates. POST only; never combined
   * with permission/public/authTransport/idempotency.
   */
  readonly providerIngress?: true;
}
/** Provider headers the Gateway forwards on a providerIngress route; nothing else. */
export const PROVIDER_INGRESS_HEADERS = [
  'x-provider-signature',
  'x-provider-timestamp',
  'x-provider-notification-id',
] as const;
export const PROVIDER_INGRESS_CONTENT_TYPES = [
  'application/json',
  'application/x-www-form-urlencoded',
] as const;
export const PROVIDER_INGRESS_MAX_BYTES = 16_384;
export const GATEWAY_ROUTES: readonly GatewayRoute[] = [
  {
    id: 'auth.csrf',
    method: 'GET',
    path: '/auth/csrf',
    owner: 'identity',
    upstream: '/internal/v1/identity/csrf',
    authTransport: true,
  },
  {
    id: 'auth.jwks',
    method: 'GET',
    path: '/auth/.well-known/jwks.json',
    owner: 'identity',
    upstream: '/internal/v1/identity/.well-known/jwks.json',
    authTransport: true,
  },
  ...(
    [
      'register',
      'login',
      'challenges/resend',
      'challenges/verify',
      'refresh',
      'logout',
      'logout-all',
      'guest-sessions',
      'guest-sessions/recover',
    ] as const
  ).map((name): GatewayRoute => ({
    id: `auth.${name.replaceAll('/', '.')}`,
    method: 'POST',
    path: `/auth/${name}`,
    owner: 'identity',
    upstream: `/internal/v1/identity/${name}`,
    authTransport: true,
  })),
  {
    id: 'auth.session',
    method: 'GET',
    path: '/auth/session',
    owner: 'identity',
    upstream: '/internal/v1/identity/session',
    authTransport: true,
  },
  {
    id: 'customer.profile.read',
    method: 'GET',
    path: '/customer/profile',
    owner: 'customer',
    upstream: '/internal/v1/customer/me',
    permission: 'profile.read:self',
  },
  {
    id: 'customer.profile.write',
    method: 'PATCH',
    path: '/customer/profile',
    owner: 'customer',
    upstream: '/internal/v1/customer/me',
    permission: 'profile.write:self',
    idempotency: 'required',
  },
  {
    // Guests browse the published catalog before any identity exists.
    id: 'customer.catalog',
    method: 'GET',
    path: '/customer/packages',
    owner: 'catalog',
    upstream: '/internal/v1/catalog/packages',
    public: true,
  },
  {
    id: 'customer.bookings.read',
    method: 'GET',
    path: '/customer/bookings',
    owner: 'booking',
    upstream: '/internal/v1/booking/mine',
    permission: 'bookings.read:self',
  },
  {
    id: 'customer.bookings.create',
    method: 'POST',
    path: '/customer/bookings',
    owner: 'booking',
    upstream: '/internal/v1/booking',
    permission: 'bookings.create:self',
    idempotency: 'required',
  },
  {
    id: 'customer.payments.create',
    method: 'POST',
    path: '/customer/payments',
    owner: 'billing',
    upstream: '/internal/v1/billing/obligations',
    permission: 'bookings.create:self',
    idempotency: 'required',
  },
  {
    id: 'customer.payments.read',
    method: 'GET',
    path: '/customer/payments/:id',
    owner: 'billing',
    upstream: '/internal/v1/billing/obligations/:id',
    permission: 'bookings.read:self',
  },
  {
    id: 'customer.payments.status',
    method: 'GET',
    path: '/customer/payments/:id/status',
    owner: 'billing',
    upstream: '/internal/v1/billing/obligations/:id/financial-status',
    permission: 'bookings.read:self',
  },
  {
    id: 'customer.payments.method',
    method: 'POST',
    path: '/customer/payments/:id/method',
    owner: 'billing',
    upstream: '/internal/v1/billing/obligations/:id/payment-intents',
    permission: 'bookings.create:self',
    idempotency: 'required',
  },
  {
    id: 'customer.payments.reference',
    method: 'POST',
    path: '/customer/payments/:id/transaction-reference',
    owner: 'billing',
    upstream: '/internal/v1/billing/obligations/:id/payment-attempts',
    permission: 'bookings.create:self',
    idempotency: 'required',
  },
  {
    id: 'customer.payments.refunds',
    method: 'GET',
    path: '/customer/payments/:id/refunds',
    owner: 'billing',
    upstream: '/internal/v1/billing/obligations/:id/refunds',
    permission: 'bookings.read:self',
  },
  {
    // P04-E2: provider server notification; signature verified by Billing.
    id: 'payments.provider.sham-cash',
    method: 'POST',
    path: '/payments/provider-notifications/sham-cash',
    owner: 'billing',
    upstream: '/internal/v1/billing/provider-notifications/sham-cash',
    providerIngress: true,
  },
  {
    // P04-E2: provider server notification; signature verified by Billing.
    id: 'payments.provider.syriatel-cash',
    method: 'POST',
    path: '/payments/provider-notifications/syriatel-cash',
    owner: 'billing',
    upstream: '/internal/v1/billing/provider-notifications/syriatel-cash',
    providerIngress: true,
  },
  {
    id: 'technician.work.read',
    method: 'GET',
    path: '/technician/work',
    owner: 'booking',
    upstream: '/internal/v1/booking/assigned',
    permission: 'work.read:assigned',
  },
  {
    id: 'technician.work.execute',
    method: 'POST',
    path: '/technician/work/:id/execute',
    owner: 'booking',
    upstream: '/internal/v1/booking/:id/execute',
    permission: 'work.execute:assigned',
    idempotency: 'required',
  },
  {
    id: 'technician.profile',
    method: 'GET',
    path: '/technician/profile',
    owner: 'workforce',
    upstream: '/internal/v1/workforce/me',
    permission: 'work.read:assigned',
  },
  {
    id: 'admin.dispatch',
    method: 'POST',
    path: '/admin/dispatch/:id',
    owner: 'booking',
    upstream: '/internal/v1/booking/:id/dispatch',
    permission: 'operations.dispatch',
    idempotency: 'required',
  },
  {
    id: 'admin.billing',
    method: 'GET',
    path: '/admin/billing',
    owner: 'billing',
    upstream: '/internal/v1/billing/summary',
    permission: 'billing.read',
  },
  {
    id: 'admin.billing.obligation',
    method: 'GET',
    path: '/admin/billing/obligations/:id',
    owner: 'billing',
    upstream: '/internal/v1/billing/obligations/:id',
    permission: 'billing.read',
  },
  {
    id: 'admin.billing.reconcile',
    method: 'POST',
    path: '/admin/billing/payment-attempts/:id/reconciliation',
    owner: 'billing',
    upstream: '/internal/v1/billing/payment-attempts/:id/reconciliation',
    permission: 'billing.reconcile',
    idempotency: 'required',
  },
  {
    id: 'admin.billing.refunds.list',
    method: 'GET',
    path: '/admin/billing/obligations/:id/refunds',
    owner: 'billing',
    upstream: '/internal/v1/billing/obligations/:id/refunds',
    permission: 'billing.read',
  },
  {
    id: 'admin.billing.refunds.request',
    method: 'POST',
    path: '/admin/billing/obligations/:id/refunds',
    owner: 'billing',
    upstream: '/internal/v1/billing/obligations/:id/refunds',
    permission: 'billing.refund',
    idempotency: 'required',
  },
  {
    id: 'admin.billing.refund',
    method: 'GET',
    path: '/admin/billing/refunds/:id',
    owner: 'billing',
    upstream: '/internal/v1/billing/refunds/:id',
    permission: 'billing.read',
  },
  {
    id: 'admin.billing.refund.outcome',
    method: 'POST',
    path: '/admin/billing/refunds/:id/outcome',
    owner: 'billing',
    upstream: '/internal/v1/billing/refunds/:id/outcome',
    permission: 'billing.reconcile',
    idempotency: 'required',
  },
  {
    id: 'admin.support',
    method: 'GET',
    path: '/admin/support',
    owner: 'support',
    upstream: '/internal/v1/support/cases',
    permission: 'support.cases.read',
  },
  {
    id: 'admin.review',
    method: 'POST',
    path: '/admin/reviews/:id',
    owner: 'workforce',
    upstream: '/internal/v1/workforce/:id/review',
    permission: 'verification.review',
    idempotency: 'required',
  },
  {
    id: 'admin.status',
    method: 'POST',
    path: '/admin/accounts/:id/status',
    owner: 'identity',
    upstream: '/internal/v1/identity/accounts/:id/status',
    permission: 'identity.accounts.suspend',
    authTransport: true,
  },
  {
    id: 'admin.roles',
    method: 'POST',
    path: '/admin/accounts/:id/roles',
    owner: 'identity',
    upstream: '/internal/v1/identity/accounts/:id/roles',
    permission: 'identity.roles.assign',
    authTransport: true,
  },
];
export const GATEWAY_COMPOSITIONS = [
  {
    id: 'customer.overview',
    path: '/customer/overview',
    routes: ['customer.profile.read', 'customer.catalog'],
  },
  {
    id: 'technician.overview',
    path: '/technician/overview',
    routes: ['technician.profile', 'technician.work.read'],
  },
  { id: 'admin.overview', path: '/admin/overview', routes: ['admin.billing', 'admin.support'] },
] as const;
export type GatewayErrorCode =
  | 'REQUEST_INVALID'
  | 'AUTH_REQUIRED'
  | 'AUTH_FORBIDDEN'
  | 'AUTH_CSRF'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'VALIDATION_FAILED'
  | 'RATE_LIMITED'
  | 'UPSTREAM_UNAVAILABLE'
  | 'UPSTREAM_TIMEOUT'
  | 'UPSTREAM_INVALID'
  | 'INTERNAL_ERROR';
export interface GatewayErrorEnvelope {
  readonly error: {
    readonly code: GatewayErrorCode;
    /**
     * P04-E2: the owner's published business reason (e.g. PAYMENT_IN_REVIEW) for
     * CONFLICT / VALIDATION_FAILED, forwarded only when it is in that owner's
     * merged contract `reasons`. Absent otherwise. Never internal detail.
     */
    readonly reason?: string;
    readonly message: string;
    readonly requestId: string;
    readonly correlationId: string;
  };
}
