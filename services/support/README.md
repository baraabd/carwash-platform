# support-service

**Status: P04-D1 exception cases implemented; not production-ready.** `BUSINESS_READY` stays false.

Staff exception cases for payments and bookings: payment review (match,
mismatch, unknown), refunds (four-eyes), late payments, operational
cancellation and reschedule. Each case holds reasoned, evidenced decisions and
the owner's answer. Support never writes money or booking state: Billing and
Booking carry decisions out with the deciding staff member's own credential.

Owns `support_case`, `resolution_request`, `case_event` and `outbox_message`
(catalog: cases, case_events, resolution_requests). Database: `cw_support`. No
other service may read or write these tables.

- Design and evidence: `docs/production/D/P04-D1_SUPPORT_EXCEPTION_CASES.md`.
- Requests to other lanes: `docs/production/D/P04_CONTRACT_REQUESTS.md`.
- HTTP: `/internal/v1/support/cases`.
- Environment: `DATABASE_URL`, `IDENTITY_ORIGIN`, `BILLING_ORIGIN`,
  `BOOKING_ORIGIN`, optional `BILLING_TIMEOUT_MS`, `BOOKING_TIMEOUT_MS`,
  `SUPPORT_REQUESTS_PER_MINUTE`, `SUPPORT_EXECUTION_LEASE_MS`. Without
  `IDENTITY_ORIGIN` every request fails closed with 503; without an owner
  origin nothing is sent to that owner.

Layers: domain → application → ports → adapters → transport. Do not import
another service's source or Prisma client.
