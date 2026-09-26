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
  readonly idempotency?: 'required';
}
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
    id: 'customer.catalog',
    method: 'GET',
    path: '/customer/packages',
    owner: 'catalog',
    upstream: '/internal/v1/catalog/packages',
    permission: 'profile.read:self',
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
    id: 'admin.refund',
    method: 'POST',
    path: '/admin/billing/:id/refund',
    owner: 'billing',
    upstream: '/internal/v1/billing/:id/refund',
    permission: 'billing.refund',
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
    readonly message: string;
    readonly requestId: string;
    readonly correlationId: string;
  };
}
