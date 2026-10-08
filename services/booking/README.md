# booking-service

**Status: implemented, not accepted for production (`BUSINESS_READY = false`, readiness 503).**

Owns the booking lifecycle: the Booking aggregate, its immutable snapshots
(contact, vehicle, address/service area, priced catalog selection, slot), the
idempotent create command and the durable creation saga (process manager) that
validates the quote, creates the Billing obligation, commits the Scheduling hold
(pivot) and publishes `booking.created.v1` through the transactional outbox.
Technician assignment is Dispatch's and is never stored here.

Database: `cw_booking` (tables `booking`, `booking_request`, `booking_saga`,
`outbox_message`, `audit_entry`). No other service may read or write them.

Processes:
- API: `node dist/main.js` (`/internal/v1/booking/bookings`).
- Saga worker: `node dist/workers/saga.main.js [--interval-ms 500] [--batch 20]`.

Configuration: `DATABASE_URL`, `IDENTITY_URL`, `PRICING_URL`, `SCHEDULING_URL`,
`VEHICLE_URL`, `CUSTOMER_URL`, `BILLING_URL`, `BOOKING_TOKEN_<OWNER>` (interim
per-owner service credentials), `BOOKING_OWNER_TIMEOUT_MS`, `BOOKING_SAGA_LEASE_MS`,
`BOOKING_INLINE_SAGA_BUDGET_MS`, `BOOKING_CLAIM_LEASE_MS`,
`BOOKING_USER_REQUESTS_PER_MINUTE`. A missing owner URL or credential fails closed.

Design, invariants, evidence and blockers: `docs/production/C/P02-C2-booking.md`
and `docs/production/C/contract-requests/CR-P02-C2-booking-v1.md`.
