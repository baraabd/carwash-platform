# P05-B3 — Wallet technician-custody projection from Billing events

Parent P05-B status: **INTEGRATION_PENDING**. This child is not production-ready,
not deployed and not integrated. Review required; do not auto-merge.

| | |
|---|---|
| Base | `main` `3e1ab23bff450235858ea13e049f8fb373df393f` (tree `53edea7ff5348c969408e9fd3ee23569b06a9f94`), fetched 2026-10-11. The audited `f875d31` was stale. |
| Branch | `prod/p05-b-implement-subscription--promotion-and-remaining-wallet-b3-wallet` |
| Migration | `services/wallet/prisma/migrations/20261011110000_p05b_wallet_custody_projection` (expand-only on the W01 marker) |
| Events consumed | `billing.cash-collected.v1`, `billing.cash-collection-reversed.v1`, `billing.custody-handover-changed.v1` (registered by E in P04-E1, parsed with `@carwash/event-contracts`) |
| Events produced | none |
| Contract request | `CONTRACT_REQUEST_E_WALLET.md` (CR-B-12) |

## Scope boundary: owner decision B-08

B-08 approves exactly one Wallet use case: **internal technician custody**.
Customer stored value, funding, transfer and withdrawal are not approved, so
Wallet has no such table, route or event; tests assert that `POST` on such paths
returns 404. Wallet is "balances and holds referencing Billing ledger postings;
no second financial ledger": Billing remains the financial authority and every
Wallet movement cites the Billing event (`event_id`, aggregate and version) it
mirrors. Wallet never posts, corrects or settles money.

## Design

- **Domain** (`src/domain/custody.ts`): buckets per (holder, currency) in exact
  bigint minor units: `held`, `inHandover`, `deposited`, `settled`, `shortage`,
  `overage`. Mapping:
  - cash collected (custody `HELD`) → `held +amount`;
  - collection reversed → `held −amount` of the projected receipt (Billing
    reverses only HELD receipts; amount and currency must match, else rejected);
  - handover `null→PENDING` → `held −declared`, `inHandover +declared`;
  - `PENDING→RECEIVED` → `inHandover −declared`, `deposited +counted`,
    `shortage`/`overage` recorded as facts (`counted + shortage − overage =
    declared` is enforced, never invented);
  - `RECEIVED→RECONCILED` → `deposited −counted`, `settled +counted`;
  - `PENDING→CANCELLED` → back to `held`.
- **Holder attribution.** `billing.cash-collected.v1` has no holder field. The
  holder is the envelope actor (`account`), which Billing writes as the collector;
  any other actor kind is recorded `REJECTED / HOLDER_UNATTRIBUTABLE`. CR-B-12.2
  asks E for an explicit `holder`. Reversals find the holder through the projected
  receipt (same Billing aggregate).
- **Inbox and ordering** (`src/application/custody-projector.ts`): one local
  transaction per event writes the inbox row, source state, movement and account.
  - same event id again (sequential or concurrent) → `DUPLICATE`, no effect;
  - aggregate version not newer than projected → `STALE`, recorded;
  - invalid / unsupported / unattributable / mismatching → `REJECTED`, recorded, acked;
  - depends on an event not yet projected (reversal before its collection,
    handover transition from a status not held, declaring more than is held) →
    `ProjectionDeferred`: nothing recorded, the handler returns retryable 503 so
    the broker requeues and eventually dead-letters by policy (reconciliation path).
  Receipt revisions also move when a receipt joins a handover without a receipt
  event, so version gaps on receipts are accepted; handovers carry
  `previousStatus`, which is checked against the projected status.
- **Database invariants**: CHECKs (non-negative buckets, SYP/USD, per-kind movement
  shapes), append-only inbox and movements, no delete/truncate, movements only for
  an APPLIED inbox row and source row written by the same transaction, immutable
  source identity with forward-only versions, and a COMMIT-time assertion that
  every account equals the sum of its movements. No partial indexes (Prisma drift);
  the schema mirror is exact.
- **Read API** (`/internal/v1/wallet`, read-only):
  `GET custody/holders/:holder[/movements]` for finance with the existing grant
  `billing.read` (`wallet.read` requested as CR-B-12.1);
  `GET custody/me[/movements]` for technicians with `work.read:assigned`
  (subject = holder). Deny by default, non-enumerating 404, Identity verified on
  every request, outage → 503.
- **Transport**: `BillingCustodyEventHandler` (service-kit consumer adapter
  shape) plus the proposed queue `wallet.billing-custody.v1` and bindings. Wallet
  has no broker dependency; adding one changes the E-owned lockfile (CR-B-12.3).
- `BUSINESS_READY = false`; readiness stays 503.

## Evidence

| Family | Result |
|---|---|
| Domain + projector rules (in-memory double), handler classification, Nest composition (API mounted read-only, 401/503 fail-closed, no customer-wallet routes, readiness 503) | **PASSED 13/13** (`node --test services/wallet/dist-tests/test/*.spec.js`) |
| typecheck, build:tests, ESLint, Prettier | PASSED |
| `check-design-reference`, `reference-lock.test.mjs` (12/12), boundaries (74 rules), layers, service shells, migrations (incl. append-only vs origin/main) | PASSED |
| **Real PostgreSQL** (`postgres-acceptance.mjs --service wallet --record`): 8 integration tests written: lifecycle, 2-replica concurrent same-event exactly-once, concurrent different events, deferral/stale ordering, poison/rejections, direct-SQL tampering, HTTP auth 401/403/404/503 | **NOT RUN (BLOCKED: host resources)**. Three attempts failed in phase 5, before any spec ran: the migrate step lost its connection (P1001, then pg connect timeouts) during the provisioner restart. The host had ~200 MB of 16 GB free. The script was hardened (init-complete wait, 30 s timeouts, transient retries), but by rule no docker run is started under 1.5 GB free. Rerun required. |
| **Real RabbitMQ** (`wallet-broker-acceptance.mjs --record`): ack-lost redelivery + duplicate publish exactly-once, deferred requeue then in-order apply, poison recorded/acked once | **NOT RUN (BLOCKED: host resources)**, same reason. Runtime broker wiring itself BLOCKED on E (CR-B-12.3). |
| Playwright / visual | NOT APPLICABLE: no UI; custody screens are not designed |

Real vs mocked: PostgreSQL and RabbitMQ are real disposable containers; the
runtime role `cw_wallet_app` executes every write. Identity is a local HTTP stub.
Billing is not running: events are built in its registered envelope-v2 shape and
validated by the shared parsers. In the broker suite the test's amqplib consumer
loop is the broker adapter; the Wallet runtime broker wiring is blocked on E.

## Security and privacy

No customer data enters Wallet. Events carry opaque IDs and amounts; the
projection stores holder subject UUIDs, amounts and Billing event references only.
Logs carry outcome codes, never payloads. Staff read needs `billing.read`;
technicians see only themselves; customers get 403.

## Rollback

Revert the PR. The migration only adds Wallet-owned tables and functions; before
any production data exists, drop them in reverse order. The projection is fully
rebuildable from Billing events, so no financial data is lost by rollback.

## Blockers

| ID | Blocker | Owner |
|---|---|---|
| B-P05-31 | Runtime broker dependency, queue/bindings/DLQ, Wallet broker identity, Billing outbox relay (CR-B-12.3) | E |
| B-P05-32 | Explicit holder on cash-collected; receipt ids on handover changes (CR-B-12.2) | E + Billing |
| B-P05-33 | `wallet.read` permission if the owner wants it separate from `billing.read` (CR-B-12.1) | E / owner |
| B-P05-34 | Gateway aliases and admin/technician custody screens (not designed) | E, owner design, D/C |
| B-P05-35 | B-08 remains the only approved purpose; any customer wallet needs an owner decision | Owner |

Next consumers: admin finance console and technician app (after E routes and an
approved design); E's broker binding to run the projector in production.
