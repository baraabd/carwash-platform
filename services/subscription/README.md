# subscription

Owner service for customer wash-plan subscriptions (P05-B1): plan revisions with
effective windows, customer subscriptions, entitlement periods and the
reserve/commit/release/reverse lifecycle used by the Booking saga. Design,
evidence and blockers: `docs/production/B/P05-B1-SUBSCRIPTION.md`. Contract
requests to Lane E: `docs/production/B/CONTRACT_REQUEST_E_SUBSCRIPTION.md`.

`BUSINESS_READY` stays `false` and `/health/ready` keeps returning 503: readiness
promotion is an E-owned gate that also needs published contracts, the
`subscription.manage` grant, event registration and the Booking consumer.

Its database is `cw_subscription`. Runtime replicas use `cw_subscription_app`;
migration jobs use `cw_subscription_migrate`. Runtime startup never migrates.

Configuration (all optional for the image to boot; protected paths fail closed):

- `DATABASE_URL`: runtime identity connection string.
- `IDENTITY_SESSION_ORIGIN`, `IDENTITY_SESSION_TIMEOUT_MS`: Identity session
  verification; unset means every protected request answers 503.
- `SUBSCRIPTION_SERVICE_CLIENTS`: service callers as SHA-256 token digests with
  scopes `subscription.entitlement.reserve` / `subscription.entitlement.settle`
  (P04-E3 format). Unset means every entitlement route is refused; malformed
  configuration stops startup.

From the repository root:

- `pnpm --filter @carwash/subscription generate`
- `pnpm --filter @carwash/subscription build`
- `pnpm --filter @carwash/subscription typecheck`
- `pnpm --filter @carwash/subscription test:runtime` (domain + Nest specs, no database)
- `node scripts/production/B/postgres-acceptance.mjs --service subscription [--record]`
  (real PostgreSQL in a disposable container, runtime role, two replicas)
