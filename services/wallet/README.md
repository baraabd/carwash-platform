# wallet

Owner of the **technician-custody read projection** (P05-B3). Owner decision B-08
approves exactly this Wallet use case: showing the cash a technician holds for the
company. Wallet is "balances and holds referencing Billing ledger postings; no
second financial ledger": Billing stays the only financial authority, and every
Wallet movement cites the registered Billing event it mirrors. There is **no
customer wallet**, top-up, transfer or withdrawal (not approved; no route exists).

- Consumed events (registered by Lane E, parsed with `@carwash/event-contracts`):
  `billing.cash-collected.v1`, `billing.cash-collection-reversed.v1`,
  `billing.custody-handover-changed.v1`.
- Idempotent inbox (`wallet_inbox`, one row per event id), per-aggregate ordering,
  recorded rejections, deferral (retryable) when an earlier event is missing.
- Buckets per (holder, currency): held, inHandover, deposited, settled, shortage,
  overage. COMMIT-time assertion: account = sum of its movements.
- Read API (`/internal/v1/wallet`): `GET custody/holders/:holder[/movements]`
  (finance, `billing.read`), `GET custody/me[/movements]` (technician,
  `work.read:assigned`). Deny by default; Identity outage fails closed (503).
- The application message handler exists; the runtime broker binding is blocked
  on Lane E (CR-B-12.3 in `docs/production/B/CONTRACT_REQUEST_E_WALLET.md`).
- `BUSINESS_READY = false`; `/health/ready` stays 503.

Its database is cw_wallet. Runtime replicas use cw_wallet_app; migration jobs use
cw_wallet_migrate. Runtime startup never performs migrations.

From the repository root:

- pnpm --filter @carwash/wallet generate | build | typecheck | test:runtime
- node scripts/production/B/postgres-acceptance.mjs --service wallet [--record] (real PostgreSQL)
- node scripts/production/B/wallet-broker-acceptance.mjs [--record] (real RabbitMQ + PostgreSQL)

Details and evidence: `docs/production/B/P05-B3-WALLET-CUSTODY.md`.
