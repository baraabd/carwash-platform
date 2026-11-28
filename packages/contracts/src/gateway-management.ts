import type { GatewayRoute } from './gateway';

export const SUPPORT_READ_PERMISSIONS = [
  'support.cases.read',
  'billing.read',
  'operations.dispatch',
] as const;
const SUPPORT_COMMAND_PERMISSIONS = [
  'billing.reconcile',
  'billing.refund',
  'operations.dispatch',
] as const;
export const SUPPORT_QUERY = [
  { name: 'limit', pattern: /^(?:[1-9]|[1-9][0-9]|100)$/ },
  { name: 'cursor', pattern: /^[A-Za-z0-9_-]{8,120}$/ },
  {
    name: 'kind',
    pattern:
      /^(?:PAYMENT_REVIEW|REFUND|LATE_PAYMENT|BOOKING_CANCELLATION|BOOKING_RESCHEDULE)(?:,(?:PAYMENT_REVIEW|REFUND|LATE_PAYMENT|BOOKING_CANCELLATION|BOOKING_RESCHEDULE))*$/,
  },
  {
    name: 'status',
    pattern:
      /^(?:OPEN|AWAITING_APPROVAL|EXECUTING|OUTCOME_UNKNOWN|BLOCKED_ON_OWNER|OWNER_REJECTED|RESOLVED|CLOSED)(?:,(?:OPEN|AWAITING_APPROVAL|EXECUTING|OUTCOME_UNKNOWN|BLOCKED_ON_OWNER|OWNER_REJECTED|RESOLVED|CLOSED))*$/,
  },
] as const;

export const MANAGEMENT_GATEWAY_ROUTES: readonly GatewayRoute[] = [
  {
    id: 'admin.catalog.current',
    method: 'GET',
    path: '/admin/catalog/current',
    owner: 'catalog',
    upstream: '/internal/v1/catalog/current',
    anyPermission: ['catalog.publish', 'pricing.prices.publish'],
  },
  {
    id: 'admin.catalog.read',
    method: 'GET',
    path: '/admin/catalog',
    owner: 'catalog',
    upstream: '/internal/v1/catalog/definitions',
    anyPermission: ['catalog.publish', 'pricing.prices.publish'],
  },
  {
    id: 'admin.catalog.publish',
    method: 'POST',
    path: '/admin/catalog/publications',
    owner: 'catalog',
    upstream: '/internal/v1/catalog/publications',
    permission: 'catalog.publish',
    idempotency: 'required',
  },
  {
    id: 'admin.service-zones',
    method: 'GET',
    path: '/admin/service-zones',
    owner: 'geo',
    upstream: '/internal/v1/geo/service-zones',
    permission: 'operations.dispatch',
  },
  {
    id: 'admin.serviceability',
    method: 'POST',
    path: '/admin/serviceability',
    owner: 'geo',
    upstream: '/internal/v1/geo/serviceability',
    permission: 'operations.dispatch',
    safe: true,
  },
  {
    id: 'admin.availability',
    method: 'GET',
    path: '/admin/availability',
    owner: 'scheduling',
    upstream: '/internal/v1/scheduling/availability',
    permission: 'operations.dispatch',
    query: [
      {
        name: 'zoneId',
        pattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      },
      { name: 'date', pattern: /^\d{4}-\d{2}-\d{2}$/ },
      { name: 'durationMinutes', pattern: /^(?:[5-9]|[1-9][0-9]|[1-3][0-9]{2}|4[0-7][0-9]|480)$/ },
    ],
  },
  {
    id: 'admin.price-book.current',
    method: 'GET',
    path: '/admin/price-books/current',
    owner: 'pricing',
    upstream: '/internal/v1/pricing/price-books/current',
    permission: 'pricing.prices.publish',
  },
  {
    id: 'admin.price-book.publish',
    method: 'POST',
    path: '/admin/price-books',
    owner: 'pricing',
    upstream: '/internal/v1/pricing/price-books',
    permission: 'pricing.prices.publish',
    idempotency: 'required',
  },
  {
    id: 'admin.support.open',
    method: 'POST',
    path: '/admin/support',
    owner: 'support',
    upstream: '/internal/v1/support/cases',
    anyPermission: SUPPORT_COMMAND_PERMISSIONS,
    idempotency: 'required',
  },
  ...(['', '/current'] as const).map((suffix): GatewayRoute => ({
    id: suffix ? 'admin.support.current' : 'admin.support.read',
    method: 'GET',
    path: `/admin/support/:id${suffix}`,
    owner: 'support',
    upstream: `/internal/v1/support/cases/:id${suffix}`,
    anyPermission: SUPPORT_READ_PERMISSIONS,
  })),
  {
    id: 'admin.support.decide',
    method: 'POST',
    path: '/admin/support/:id/decisions',
    owner: 'support',
    upstream: '/internal/v1/support/cases/:id/decisions',
    anyPermission: SUPPORT_COMMAND_PERMISSIONS,
    idempotency: 'required',
  },
  ...(['approval', 'execution'] as const).map((action): GatewayRoute => ({
    id: `admin.support.${action}`,
    method: 'POST',
    path: `/admin/support/:id/decisions/:no/${action}`,
    owner: 'support',
    upstream: `/internal/v1/support/cases/:id/decisions/:no/${action}`,
    idempotency: 'required',
    pathPatterns: { no: /^[1-9][0-9]{0,8}$/ },
    ...(action === 'approval'
      ? { permission: 'billing.refund' as const }
      : { anyPermission: SUPPORT_COMMAND_PERMISSIONS }),
  })),
  ...(['reconciliation', 'holders/:subject', 'handovers/:id'] as const).map(
    (resource): GatewayRoute => ({
      id: `admin.custody.${resource.split('/')[0]}`,
      method: 'GET',
      path: `/admin/billing/custody/${resource}`,
      owner: 'billing',
      upstream: `/internal/v1/billing/custody/${resource}`,
      permission: 'billing.read',
    }),
  ),
  ...(['treasury-receipt', 'reconciliation'] as const).map((action): GatewayRoute => ({
    id: `admin.custody.handover.${action}`,
    method: 'POST',
    path: `/admin/billing/custody/handovers/:id/${action}`,
    owner: 'billing',
    upstream: `/internal/v1/billing/custody/handovers/:id/${action}`,
    idempotency: 'required',
    permission: action === 'treasury-receipt' ? 'billing.treasury.receive' : 'billing.reconcile',
  })),
];
