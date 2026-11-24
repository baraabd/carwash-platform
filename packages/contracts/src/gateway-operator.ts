import type { GatewayRoute } from './gateway';

/** Public technician transport for the merged Dispatch, Workforce, Booking and Media APIs.
 * Owners retain assignment, subject, revision and financial authorization. There is no BFF write saga.
 */
const read = (
  id: string,
  path: string,
  owner: GatewayRoute['owner'],
  upstream: string,
  permission: GatewayRoute['permission'] = 'work.read:assigned',
): GatewayRoute => ({
  id: `operator.${id}`,
  prefix: '/api/operator',
  method: 'GET',
  path,
  owner,
  upstream,
  permission,
});
const command = (
  id: string,
  method: GatewayRoute['method'],
  path: string,
  owner: GatewayRoute['owner'],
  upstream: string,
  extra: Partial<GatewayRoute> = {},
): GatewayRoute => ({
  id: `operator.${id}`,
  prefix: '/api/operator',
  method,
  path,
  owner,
  upstream,
  permission: 'work.execute:assigned',
  idempotency: 'required',
  ...extra,
});
const evidenceEnums = { phase: ['BEFORE', 'AFTER'], slot: ['0', '1'] } as const;
const equipmentKinds = [
  'SERVICE_VEHICLE',
  'PRESSURE_WASHER',
  'WATER_SUPPLY',
  'POWER_SUPPLY',
  'VACUUM',
  'CLEANING_KIT',
] as const;

export const OPERATOR_GATEWAY_ROUTES: readonly GatewayRoute[] = [
  {
    ...read('session', '/session', 'identity', '/internal/v1/identity/session'),
    authTransport: true,
  },
  read('jobs', '/jobs', 'dispatch', '/internal/v1/dispatch/me/jobs'),
  read('task', '/tasks/:id', 'dispatch', '/internal/v1/dispatch/me/tasks/:id'),
  read('booking', '/bookings/:id', 'booking', '/internal/v1/booking/bookings/:id/technician-view'),
  read('availability', '/availability', 'workforce', '/internal/v1/workforce/me/availability'),
  read('profile', '/profile', 'workforce', '/internal/v1/workforce/me/profile'),
  read(
    'custody',
    '/custody',
    'billing',
    '/internal/v1/billing/custody/holders/me',
    'billing.cash.collect',
  ),
  read(
    'cash.target',
    '/bookings/:id/cash-collection-target',
    'billing',
    '/internal/v1/billing/bookings/:id/cash-collection-target',
    'billing.cash.collect',
  ),
  read(
    'cash.receipt',
    '/cash-receipts/:id',
    'billing',
    '/internal/v1/billing/cash-receipts/:id',
    'billing.cash.collect',
  ),
  command(
    'cash.collect',
    'POST',
    '/obligations/:id/cash-collections',
    'billing',
    '/internal/v1/billing/obligations/:id/cash-collections',
    { permission: 'billing.cash.collect' },
  ),
  command(
    'availability.update',
    'PUT',
    '/availability',
    'workforce',
    '/internal/v1/workforce/me/availability',
  ),
  ...(['accept', 'decline'] as const).map((action) =>
    command(
      `offer.${action}`,
      'POST',
      `/offers/:id/${action}`,
      'dispatch',
      `/internal/v1/dispatch/offers/:id/${action}`,
    ),
  ),
  ...(
    [
      'depart',
      'arrive',
      'start',
      'document',
      'finish',
      'close',
      'cash-collection',
      'release',
      'notes',
    ] as const
  ).map((action) =>
    command(
      `task.${action}`,
      'POST',
      `/tasks/:id/${action}`,
      'dispatch',
      `/internal/v1/dispatch/tasks/:id/${action}`,
    ),
  ),
  command(
    'task.condition',
    'PUT',
    '/tasks/:id/condition-note',
    'dispatch',
    '/internal/v1/dispatch/tasks/:id/condition-note',
  ),
  command(
    'task.check',
    'PUT',
    '/tasks/:id/checklist/:code',
    'dispatch',
    '/internal/v1/dispatch/tasks/:id/checklist/:code',
    { pathEnums: { code: ['exterior', 'wheels', 'interior', 'quality'] } },
  ),
  ...(['PUT', 'DELETE'] as const).map((method) =>
    command(
      `task.evidence.${method.toLowerCase()}`,
      method,
      '/tasks/:id/evidence/:phase/:slot',
      'dispatch',
      '/internal/v1/dispatch/tasks/:id/evidence/:phase/:slot',
      { pathEnums: evidenceEnums },
    ),
  ),
  command('schedule.update', 'PUT', '/schedule', 'workforce', '/internal/v1/workforce/me/schedule'),
  command(
    'schedule.apply',
    'POST',
    '/schedule/apply',
    'workforce',
    '/internal/v1/workforce/me/schedule/apply',
  ),
  command(
    'exception.create',
    'POST',
    '/availability-exceptions',
    'workforce',
    '/internal/v1/workforce/me/availability-exceptions',
  ),
  command(
    'exception.cancel',
    'POST',
    '/availability-exceptions/:id/cancel',
    'workforce',
    '/internal/v1/workforce/availability-exceptions/:id/cancel',
  ),
  command(
    'equipment.update',
    'PUT',
    '/equipment/:kind/status',
    'workforce',
    '/internal/v1/workforce/me/equipment/:kind/status',
    { pathEnums: { kind: equipmentKinds } },
  ),
  command('media.reserve', 'POST', '/media/uploads', 'media', '/internal/v1/media/uploads'),
  command(
    'media.finalize',
    'POST',
    '/media/objects/:id/finalize',
    'media',
    '/internal/v1/media/objects/:id/finalize',
  ),
  read('media.object', '/media/objects/:id', 'media', '/internal/v1/media/objects/:id'),
  ...(['upload-url', 'read-url'] as const).map((action): GatewayRoute => ({
    id: `operator.media.${action}`,
    prefix: '/api/operator',
    method: 'POST',
    path: `/media/objects/:id/${action}`,
    owner: 'media',
    upstream: `/internal/v1/media/objects/:id/${action}`,
    permission: 'work.read:assigned',
    safe: true,
  })),
];
