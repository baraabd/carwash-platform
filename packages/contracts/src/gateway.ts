import type { IdentityPermission } from './identity';
import type { ApiErrorCode, FieldIssue } from './common/errors';
import { OPERATOR_GATEWAY_ROUTES } from './gateway-operator';
import { ADMIN_GATEWAY_ROUTES } from './gateway-admin';
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
  | 'reporting'
  | 'dispatch'
  | 'communications'
  | 'media';
export interface GatewayRoute {
  readonly id: string;
  readonly method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** Explicit deployed browser namespace. Omission retains /api/v1. */
  readonly prefix?: '/api/operator';
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
  /** Read-only POST (e.g. short-lived media URL); still authenticated and CSRF checked. */
  readonly safe?: true;
  /** Only this route may forward a validated If-Match revision to its owner. */
  readonly revisioned?: true;
  /** Named parameters are UUIDs unless a closed enum is declared here. */
  readonly pathEnums?: Readonly<Record<string, readonly string[]>>;
  /** GET-only query allowlist; unknown and duplicate keys are rejected. */
  readonly query?: readonly GatewayQueryParam[];
  readonly anyPermission?: readonly IdentityPermission[];
  /**
   * P04-E2: an external payment provider's server notification. No identity,
   * cookie, bearer or browser header is ever forwarded; the exact raw request
   * bytes (bounded) and only the allowlisted provider headers reach the owner,
   * which verifies the signature and de-duplicates. POST only; never combined
   * with permission/public/authTransport/idempotency.
   */
  readonly providerIngress?: true;
}
export interface GatewayQueryParam {
  readonly name: string;
  readonly pattern: RegExp;
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
    revisioned: true,
  },
  {
    id: 'customer.profile.bootstrap',
    method: 'PUT',
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
    upstream: '/internal/v1/catalog/definitions',
    public: true,
  },
  {
    id: 'customer.bookings.read',
    method: 'GET',
    path: '/customer/bookings',
    owner: 'booking',
    upstream: '/internal/v1/booking/mine',
    permission: 'bookings.read:self',
    query: [
      { name: 'limit', pattern: /^(?:[1-9][0-9]?|100)$/ },
      { name: 'cursor', pattern: /^[A-Za-z0-9_-]{8,200}$/ },
    ],
  },
  {
    id: 'customer.bookings.get',
    method: 'GET',
    path: '/customer/bookings/:id',
    owner: 'booking',
    upstream: '/internal/v1/booking/bookings/:id',
    permission: 'bookings.read:self',
  },
  {
    id: 'customer.bookings.changes',
    method: 'GET',
    path: '/customer/bookings/:id/changes',
    owner: 'booking',
    upstream: '/internal/v1/booking/bookings/:id/changes',
    permission: 'bookings.read:self',
  },
  ...(['cancellation', 'reschedule'] as const).map((action): GatewayRoute => ({
    id: `customer.bookings.${action}`,
    method: 'POST',
    path: `/customer/bookings/:id/${action}`,
    owner: 'booking',
    upstream: `/internal/v1/booking/bookings/:id/${action}`,
    permission: 'bookings.create:self',
    idempotency: 'required',
  })),
  {
    id: 'customer.bookings.create',
    method: 'POST',
    path: '/customer/bookings',
    owner: 'booking',
    upstream: '/internal/v1/booking/bookings',
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
  ...OPERATOR_GATEWAY_ROUTES,
  ...ADMIN_GATEWAY_ROUTES,
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
export type GatewayErrorCode = ApiErrorCode;
export interface GatewayErrorEnvelope {
  readonly error: {
    readonly code: GatewayErrorCode;
    /**
     * P04-E2: the owner's published business reason (e.g. PAYMENT_IN_REVIEW) for
     * CONFLICT / VALIDATION_FAILED, forwarded only when it is in that owner's
     * merged contract `reasons`. Null otherwise. Never internal detail.
     */
    readonly reason: string | null;
    readonly message: string;
    readonly requestId: string;
    readonly correlationId: string;
    /** Retry the same intent/key after transient transport failure; never assume rollback. */
    readonly retryable: boolean;
    readonly retryAfterMs: number | null;
    readonly issues: readonly FieldIssue[];
  };
}
