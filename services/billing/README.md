# billing-service

**Status: owner core (P02-B1), cash custody (P03-B1) and provider credits/refunds (P04-B1) implemented; not business ready (readiness 503); INTEGRATION_PENDING.**

Payments, cash collection, refunds, ledger and customer entitlements.

Owns `payments,cash_receipts,refunds,ledger,subscriptions,entitlement_reservations`. Database: `cw_billing`. No other service may read or write these tables.

Implemented (see `docs/production/B/P02-B1-BILLING.md`): financial obligations from
Pricing quotes, payment intents (cash after the wash / Sham Cash / Syriatel Cash),
reported payment attempts, Finance reconciliation with an explicit UNKNOWN outcome,
an append-only balanced ledger, idempotent commands, audit, and a transactional
outbox (relay not started until Lane E registers the events).

P03-B1 (see `docs/production/B/P03-B1-CASH-CUSTODY.md`): cash collection
receipts by the assigned technician after Dispatch reports a CLOSED task,
linked reversals, technician custody as a ledger balance per holder, handover to
the company, independent treasury count with explicit shortage/overage, and
settlement reconciliation, with separation of duties enforced in the database.
The production work adapter reads Dispatch's
`GET /internal/v1/dispatch/me/bookings/:bookingId/work` using the technician's
current bearer credential, with bounded responses, timeout and no redirects.
FINISHED alone cannot authorise cash: that task can still be reassigned.
The obligation must have an immutable local `BookingObligation` link created
by the authenticated booking saga. A client-created obligation is never adopted
from a supplied booking or an asserted quote.

`GET /internal/v1/billing/bookings/:bookingId/cash-collection-target` requires
an account with `billing.cash.collect` and current assigned-work authority.
It returns only `bookingId`, `obligationId`, `revision`, `amountDue` and `receipt`.
The revision is the collection command's `expectedRevision`, checked again under
the obligation lock. An existing receipt restores to the same collector after
current Identity authorization without requiring another Dispatch request;
this supports a lost collection response. The same idempotency key also replays
the committed command across replicas. Neither path permits another collector
to read the receipt or bypasses current Identity authorization.

P04-B1 (see `docs/production/B/P04-B1-PROVIDER-RECONCILIATION-REFUNDS.md`): a
`PaymentProvider` port with explicit capabilities; provider credits (received
money) from authenticated notifications, verified queries or merchant statements
approved by a second person; allocation to the claim carrying the reference
(exact amount only, otherwise visible UNALLOCATED money); refunds with
reservation, two-person approval, provider-API or manual evidence channels and
UNKNOWN outcomes. A reviewer can no longer mark a payment MATCHED. ShamCash and
Syriatel Cash run without an official merchant API (statement evidence + manual
refunds only) until LIVE_PROVIDER_ACCEPTANCE.

Not implemented: subscriptions, entitlements, an official provider API adapter,
cash refunds or real QR/merchant data. Choosing a method or reporting a
transaction number never marks money as received; collecting cash shows
CASH_COLLECTED, never PAID.

Configuration: `DATABASE_URL` (runtime role), `IDENTITY_SESSION_ORIGIN`,
`PRICING_ORIGIN` (+ `*_TIMEOUT_MS`), `BILLING_DISPATCH_ORIGIN` and
`BILLING_DISPATCH_TIMEOUT_MS` (100–10000 ms; default 2000 ms).
Origins require HTTPS except local loopback tests, with no credentials, path,
query or fragment. Unset origins fail closed with 503 for dependent operations.
`BILLING_SHAM_CASH_MERCHANT_ACCOUNTS`, `BILLING_SYRIATEL_CASH_MERCHANT_ACCOUNTS`
(unset: no merchant account accepted). Provider automation settings fail startup
until an official adapter exists; secrets are read from mounted `*_FILE` paths only.
Migrations run only as the migration identity (`pnpm --filter @carwash/billing migrate:deploy`).

Implement domain → application → ports → adapters → transport. Do not import another service's source or Prisma client.
