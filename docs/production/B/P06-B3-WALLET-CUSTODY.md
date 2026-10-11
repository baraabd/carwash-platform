# P06-B3 — Wallet technician-custody read projection

Parent: P06-B (close the commerce/finance functional matrix). Status of this
child: **PR open, review required**. The parent stays **INTEGRATION_PENDING**.
Nothing here is production-ready, deployed or integrated. Wallet receives no
live events until Lane E accepts CR-W-01/02.

- Base: main `66aa7528500a06f65a4b73305506feee7c3fc3b3`
  (tree `3a2203e360a534dc3f98529717a7625257aaccd0`), refreshed 2026-10-11. The
  audited `f875d31` is an older ancestor and was no longer current.
- Branch: `prod/p06-b-close-commerce-finance-functional-matrix-and-admin-fina-b3-wallet-custody`
- Accepted source: `56fd88b5fa34032045705b769977adcb2d20ca9d` (tree
  `30e31ff391384bd488e6b894cb3d23fa2d94e3f0`, clean). The commit that adds this
  document and the evidence JSON changes only `docs/`.

## What this closes

P03-B left "B2 — Wallet read projection of technician custody from Billing
postings (no second ledger)" NOT STARTED because the billing events were not
registered. Lane E published them in P04-E1 (`billing.v1` events in
`packages/event-contracts/src/billing-v1.ts`), so Wallet now implements the
projection against the merged contract. Wallet consumes only published shapes.

## Design

- **Ownership.** Billing remains the only financial ledger and the authority
  for custody (`GET /internal/v1/billing/custody/holders/:subject`). Wallet holds
  a derived, eventually consistent read model. Every state row and movement
  references the Billing event that caused it. Wallet has no write route and
  cannot create, move or settle money. The response says `authoritative: false`
  and `authority: "billing"`.
- **Consumed events (v1, envelope v2, exchange `washgo.billing.events`):**
  - `billing.cash-collected.v1`. The holder is the event actor, which must be an
    `account`; otherwise the event is POISON.
  - `billing.cash-collection-reversed.v1`
  - `billing.custody-handover-changed.v1`

  Every other Billing type is recorded as `IGNORED/NOT_CUSTODY_EVENT`. Unknown
  types are recorded as `IGNORED/UNKNOWN_EVENT_TYPE`. Validation uses only the
  shared contract parsers.
- **Hexagonal layout.**
  - `domain/custody.ts` holds the pure rules: receipt merge, handover
    last-revision-wins, transition graph, shape rules and the `positionOf`
    reference fold.
  - `application/` holds the translation, the exactly-once projection handler
    (a service-kit `ApplicationMessageHandler`) and the authorised query.
  - `ports/` holds the store, Identity, clock and hasher ports.
  - `infrastructure/` holds the Prisma store, the Identity session adapter and
    the system adapters.
  - `transport/` holds the Nest controller and the message adapter.
- **Exactly once.** One READ COMMITTED transaction performs these steps:
  1. Take a per-aggregate advisory lock.
  2. Run the domain decision.
  3. Claim the inbox with `INSERT … ON CONFLICT DO NOTHING`.
  4. Write the state row.
  5. Take the account row lock (`FOR UPDATE`).
  6. Re-derive the balances from the state rows.
  7. Append the movements.

  A concurrent duplicate waits on the lock or claim, then classifies itself as
  `DUPLICATE`. When a commit fails, nothing is written, so redelivery applies
  the event once.
- **Faults.**
  - Same id with different bytes (canonical-JSON SHA-256) is recorded in
    `wallet_inbox_conflict` and raised as non-retryable 409, so the broker
    dead-letters it.
  - Unreadable payloads are recorded as POISON with a closed reason code and
    acknowledged.
  - Contradictory facts are also recorded as POISON with a closed reason code
    and acknowledged. Examples: an amount mismatch, a holder mismatch, a
    regressed transition, invalid shortage/overage arithmetic.
- **Ordering.**
  - A reversal that arrives before its collection is stored unattributed (no
    holder). When the collection arrives, both are attributed and both
    movements are posted. Each movement references its own event.
  - Handover events carry the full state, so an older revision is `STALE`.
  - `held` may be transiently negative while a handover precedes its
    collections. `complete` is then `false`, and it is reported rather than
    clamped.
- **Position** (per holder, currency, purpose `TECHNICIAN_CUSTODY`):
  - `collected`, `reversed`, `inHandover` (PENDING), `receivedByTreasury`
    (RECEIVED), `settled` (RECONCILED), `shortage`, `overage`.
  - `held = collected − reversed − inHandover − receivedByTreasury − settled`
  - `outstanding = held + inHandover`

  A recorded shortage stays open in Billing and is shown separately, never
  netted. Money is bigint minor units with the currency's contract scale.
- **Read API** (`/internal/v1/wallet`):
  - `GET custody/holders/me` needs an account principal with
    `billing.cash.collect`.
  - `GET custody/holders/:subject` needs `billing.read`.

  Identity is asked on every request. The API denies by default. A missing or
  unknown credential gets 401, an Identity failure or timeout gets 503 (never a
  grant), and an invalid subject gets 400 after authorisation.

## Paths

- `services/wallet/src/domain/{money,custody,index}.ts`
- `services/wallet/src/application/{billing-events,custody-projection.service,custody-query.service,errors,canonical-json,index}.ts`
- `services/wallet/src/ports/{wallet.ports,index}.ts`
- `services/wallet/src/infrastructure/{persistence/prisma-custody.store,identity/identity-session.authority,http/bounded-fetch,system/system.adapters}.ts`
- `services/wallet/src/transport/http/wallet.controller.ts`, `services/wallet/src/transport/messaging/consumer.ts`, `services/wallet/src/app.module.ts`
- `services/wallet/prisma/schema.prisma` (mirror) and the migration below
- `services/wallet/test/**` (unit, HTTP, real-PG integration, support doubles)
- `services/wallet/package.json` (`test:runtime` now runs every root spec)
- `scripts/production/B/postgres-acceptance.mjs` (adds the `wallet` entry only)
- `docs/production/B/{P06-B3-WALLET-CUSTODY,CONTRACT_REQUEST_E_WALLET}.md`, `docs/production/B/evidence/wallet-postgres-*.json`

## Migration

`20261011100000_p06b3_wallet_custody_projection` is expand-only. It adds new
tables only:

- `wallet_inbox`
- `wallet_inbox_conflict`
- `wallet_custody_receipt`
- `wallet_custody_handover`
- `wallet_accounts`
- `wallet_movements`

Database invariants:

- CHECK constraints mirror the producer's handover rules.
- The purpose is fixed to `TECHNICIAN_CUSTODY`, so no customer stored value is
  possible.
- Amounts are non-negative and `reversed ≤ collected`.
- Triggers make the inbox, conflicts and movements append-only and forbid
  deleting state or accounts.
- Receipt/handover guards forbid identity rewrites and status regression.

The runtime role keeps provisioner DML, so the protection lives in triggers. It
has no DDL. Rollback: the application change is additive; reverting the code
leaves the new tables unused. There is no destructive down-migration.

## Commands and results

All results were produced on the accepted source above:

| Family | Command | Result |
| ------ | ------- | ------ |
| Domain/application unit + model-based (40 seeded histories, shuffled with duplicates) | `node --test services/wallet/dist-tests/test/wallet.custody.spec.js` | PASSED 13/13 |
| HTTP auth/object access (real Nest + real Identity adapter, local Identity double) | `node --test services/wallet/dist-tests/test/wallet.http.spec.js` | PASSED 5/5 |
| Runtime/foundation (existing) | `node --test services/wallet/dist-tests/test/*.spec.js` | PASSED 27/27 (custody 13, HTTP 5, foundation 9) |
| Real PostgreSQL (upgrade, re-provision, schema drift, runtime-role integration incl. 2-replica concurrency and model-based) | `node scripts/production/B/postgres-acceptance.mjs --service wallet --record` | ACCEPTED: all 9 phases PASS; integration 8/8, 0 skipped (`evidence/wallet-postgres-56fd88b5fa34.json`) |
| Typecheck | `pnpm --filter @carwash/wallet typecheck` | PASSED |
| Migration guards | `node scripts/check-migrations.mjs --base-ref origin/main` | PASSED |
| Boundaries/layers | `node scripts/check-boundaries.mjs`, `node scripts/check-layers.mjs`, `node scripts/dev/generate-service-shells.mjs --check` | PASSED |
| Design lock | `node scripts/check-design-reference.mjs` | PASSED (no UI touched) |
| Lint/format | `npx eslint services/wallet scripts/production/B`, `npx prettier --check` (changed files) | PASSED |
| Real RabbitMQ | — | **BLOCKED** by CR-W-01/02. Not claimed. |
| Real Billing-to-Wallet on a shared broker | — | **BLOCKED** by CR-W-01/02/05 |

Dependencies, real vs. not real:

- PostgreSQL is **REAL** (a disposable pinned container, runtime role
  `cw_wallet_app`).
- Identity is a **local HTTP double**.
- Billing is a **test model** of its custody state machine. It emits envelopes
  that the shared `billing.v1` parsers accept.
- RabbitMQ is **NOT USED**.

Two earlier runs on this branch failed and were fixed, not hidden:

- `a38e07f`: schema drift. The unique index name in the Prisma mirror was not
  mapped.
- `c611653`: the two-replica burst test hit Prisma `Unable to start a
  transaction in the given time`. The fix adds `maxWait` for pooled
  connections. That error is a retryable infra failure, never an applied
  event.

## Security and privacy

- Events and logs carry only opaque ids, closed codes and outcomes. Logs never
  contain amounts or subjects.
- No phone numbers, names, treasury/settlement references or customer data are
  stored.
- Object access is enforced server-side, and a technician cannot read another
  holder.

## Blockers (exact, residual)

- **B-P06-W1 (Lane E, CR-W-01/02):** the platform-messaging dependency, the
  broker queue/ACL/DLQ, and the real RabbitMQ redelivery evidence.
- **B-P06-W2 (Lane E, CR-W-03/04):** `wallet.v1` registration, the Gateway
  alias, and the grant naming decision.
- **B-P06-W3 (Lane E/B, CR-B-08):** Identity actually issuing
  `billing.cash.collect`/`billing.read` to real staff.
- **B-P06-W4 (Owner, B-08):** customer stored value, funding, holds and
  withdrawal stay out of scope. The schema forbids any purpose other than
  technician custody.

## Next consumers

- The admin finance console (Lane D) reads per-technician custody next to
  Billing's authoritative reconciliation.
- The technician app (Lane C) reads "cash with me".

Both wait for CR-W-03.
