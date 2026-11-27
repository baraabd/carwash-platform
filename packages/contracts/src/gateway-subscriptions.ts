import type { GatewayRoute } from './gateway';

const PAGE = [
  { name: 'limit', pattern: /^(?:[1-9]|[1-9][0-9]|100)$/ },
  { name: 'cursor', pattern: /^[A-Za-z0-9_-]{1,200}$/ },
] as const;

/** Each command is authorized again by its owner; no entitlement is created at the edge. */
export const SUBSCRIPTION_GATEWAY_ROUTES: readonly GatewayRoute[] = [
  ...(['', '/:planId'] as const).map((suffix): GatewayRoute => ({
    id: suffix ? 'customer.subscription-plan' : 'customer.subscription-plans',
    method: 'GET',
    path: `/customer/subscription-plans${suffix}`,
    owner: 'subscription',
    upstream: `/internal/v1/subscription/plans${suffix}`,
    public: true,
    ...(suffix ? {} : { query: PAGE }),
  })),
  ...(
    [
      ['subscription-quotes', 'pricing', 'subscription-quotes'],
      ['subscription-purchases', 'subscription', 'purchases'],
    ] as const
  ).flatMap(([browser, owner, resource]): GatewayRoute[] => [
    {
      id: `customer.${browser}.create`,
      method: 'POST',
      path: `/customer/${browser}`,
      owner,
      upstream: `/internal/v1/${owner}/${resource}`,
      permission: 'bookings.create:self',
      idempotency: 'required',
    },
    {
      id: `customer.${browser}.read`,
      method: 'GET',
      path: `/customer/${browser}/:id`,
      owner,
      upstream: `/internal/v1/${owner}/${resource}/:id`,
      permission: 'bookings.create:self',
    },
  ]),
  {
    id: 'customer.subscription-purchases.recover',
    method: 'GET',
    path: '/customer/subscription-purchases/by-request/:idempotencyKey',
    owner: 'subscription',
    upstream: '/internal/v1/subscription/purchases/by-request/:idempotencyKey',
    permission: 'bookings.create:self',
    pathPatterns: { idempotencyKey: /^[A-Za-z0-9_-]{16,128}$/ },
  },
  ...(['', '/:id'] as const).map((suffix): GatewayRoute => ({
    id: suffix ? 'customer.subscription' : 'customer.subscriptions',
    method: 'GET',
    path: `/customer/subscriptions${suffix}`,
    owner: 'subscription',
    upstream: `/internal/v1/subscription/subscriptions${suffix}`,
    permission: 'bookings.create:self',
    ...(suffix ? {} : { query: PAGE }),
  })),
  {
    id: 'customer.subscription.eligibility',
    method: 'POST',
    path: '/customer/subscriptions/:id/eligibility',
    owner: 'subscription',
    upstream: '/internal/v1/subscription/subscriptions/:id/eligibility',
    permission: 'bookings.create:self',
    safe: true,
  },
  {
    id: 'customer.subscription.change',
    method: 'POST',
    path: '/customer/subscriptions/:id/changes',
    owner: 'subscription',
    upstream: '/internal/v1/subscription/subscriptions/:id/changes',
    permission: 'bookings.create:self',
    idempotency: 'required',
  },
  {
    id: 'admin.subscription-plans',
    method: 'GET',
    path: '/admin/subscription-plans',
    owner: 'subscription',
    upstream: '/internal/v1/subscription/plans',
    permission: 'subscription.manage',
    query: PAGE,
  },
  {
    id: 'admin.subscription-plan.publish',
    method: 'POST',
    path: '/admin/subscription-plans/:planId/versions',
    owner: 'subscription',
    upstream: '/internal/v1/subscription/plans/:planId/versions',
    permission: 'subscription.manage',
    idempotency: 'required',
  },
  {
    id: 'admin.subscription.read',
    method: 'GET',
    path: '/admin/subscriptions/:id',
    owner: 'subscription',
    upstream: '/internal/v1/subscription/subscriptions/:id',
    permission: 'subscription.manage',
  },
  {
    id: 'admin.subscription-changes',
    method: 'GET',
    path: '/admin/subscription-changes',
    owner: 'subscription',
    upstream: '/internal/v1/subscription/administration/changes',
    permission: 'subscription.manage',
  },
  {
    id: 'admin.subscription-change.decision',
    method: 'POST',
    path: '/admin/subscriptions/:id/changes/:changeId/decision',
    owner: 'subscription',
    upstream: '/internal/v1/subscription/subscriptions/:id/changes/:changeId/decision',
    permission: 'subscription.manage',
    idempotency: 'required',
  },
];
