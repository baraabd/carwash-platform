import type { GatewayRoute } from './gateway';

const ZONE_QUERY = {
  name: 'zoneId',
  pattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
} as const;
const DURATION_QUERY = {
  name: 'durationMinutes',
  pattern: /^(?:[5-9]|[1-9][0-9]|[1-3][0-9]{2}|4[0-7][0-9]|480)$/,
} as const;

/** Browser checkout transport. Owners remain authoritative for price, coverage and capacity. */
export const CUSTOMER_CHECKOUT_GATEWAY_ROUTES: readonly GatewayRoute[] = [
  {
    id: 'customer.bookings.recover',
    method: 'GET',
    path: '/customer/bookings/by-request/:idempotencyKey',
    owner: 'booking',
    upstream: '/internal/v1/booking/bookings/by-request/:idempotencyKey',
    permission: 'bookings.read:self',
    pathPatterns: { idempotencyKey: /^[A-Za-z0-9_-]{16,128}$/ },
  },
  {
    id: 'customer.holds.create',
    method: 'POST',
    path: '/customer/booking-holds',
    owner: 'booking',
    upstream: '/internal/v1/booking/booking-holds',
    permission: 'bookings.create:self',
    idempotency: 'required',
  },
  {
    id: 'customer.holds.read',
    method: 'GET',
    path: '/customer/booking-holds/:id',
    owner: 'booking',
    upstream: '/internal/v1/booking/booking-holds/:id',
    permission: 'bookings.read:self',
  },
  {
    id: 'customer.holds.release',
    method: 'POST',
    path: '/customer/booking-holds/:id/release',
    owner: 'booking',
    upstream: '/internal/v1/booking/booking-holds/:id/release',
    permission: 'bookings.create:self',
    idempotency: 'required',
  },
  {
    id: 'customer.quotes.create',
    method: 'POST',
    path: '/customer/quotes',
    owner: 'pricing',
    upstream: '/internal/v1/pricing/quotes',
    permission: 'bookings.create:self',
    idempotency: 'required',
  },
  {
    id: 'customer.quotes.read',
    method: 'GET',
    path: '/customer/quotes/:quoteId',
    owner: 'pricing',
    upstream: '/internal/v1/pricing/quotes/:quoteId',
    permission: 'bookings.read:self',
  },
  {
    id: 'customer.serviceability',
    method: 'POST',
    path: '/customer/serviceability',
    owner: 'geo',
    upstream: '/internal/v1/geo/serviceability',
    permission: 'bookings.create:self',
    safe: true,
  },
  {
    id: 'customer.service-zones',
    method: 'GET',
    path: '/customer/service-zones',
    owner: 'geo',
    upstream: '/internal/v1/geo/service-zones',
    public: true,
  },
  {
    id: 'customer.availability',
    method: 'GET',
    path: '/customer/availability',
    owner: 'scheduling',
    upstream: '/internal/v1/scheduling/availability',
    public: true,
    query: [ZONE_QUERY, { name: 'date', pattern: /^\d{4}-\d{2}-\d{2}$/ }, DURATION_QUERY],
  },
  {
    id: 'customer.availability.earliest',
    method: 'GET',
    path: '/customer/availability/earliest',
    owner: 'scheduling',
    upstream: '/internal/v1/scheduling/availability/earliest',
    public: true,
    query: [ZONE_QUERY, DURATION_QUERY],
  },
];
