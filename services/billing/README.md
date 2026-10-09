# billing-service

**Status: owner core implemented (P02-B1); not business ready (readiness 503); INTEGRATION_PENDING.**

Payments, cash collection, refunds, ledger and customer entitlements.

Owns `payments,cash_receipts,refunds,ledger,subscriptions,entitlement_reservations`. Database: `cw_billing`. No other service may read or write these tables.

Implemented (see `docs/production/B/P02-B1-BILLING.md`): financial obligations from
Pricing quotes, payment intents (cash after the wash / Sham Cash / Syriatel Cash),
reported payment attempts, Finance reconciliation with an explicit UNKNOWN outcome,
an append-only balanced ledger, idempotent commands, audit, and a transactional
outbox (relay not started until Lane E registers the events).

Not implemented: cash collection/custody, refunds, subscriptions, entitlements,
provider APIs or real QR/merchant data. Choosing a method or reporting a
transaction number never marks money as received.

Configuration: `DATABASE_URL` (runtime role), `IDENTITY_SESSION_ORIGIN`,
`PRICING_ORIGIN` (+ `*_TIMEOUT_MS`). Unset origins fail closed with 503.
Migrations run only as the migration identity (`pnpm --filter @carwash/billing migrate:deploy`).

Implement domain → application → ports → adapters → transport. Do not import another service's source or Prisma client.