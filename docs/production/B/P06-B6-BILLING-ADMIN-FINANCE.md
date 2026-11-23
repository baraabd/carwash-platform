# P06-B6 — Billing admin finance reads (summary + reconciliation work queue)

Status: **implemented; real PostgreSQL acceptance passed locally; review required.**
The parent task stays **INTEGRATION_PENDING**.

- Readiness stays 503 (`BUSINESS_READY = false`).
- The routes are **not part of a published contract yet**. See
  `CONTRACT_REQUEST_E_BILLING_ADMIN.md`, CR-B-10.
- This is not production-ready, not deployed and not integrated.

Parent: P06-B (Lane B). The branch
`prod/p06-b-close-commerce-finance-functional-matrix-and-admin-fina-b6-billing-admin-finance`
starts directly from `main` `3e1ab23bff450235858ea13e049f8fb373df393f` (tree
`53edea7ff5348c969408e9fd3ee23569b06a9f94`), refreshed on 2026-10-11. That main
already contains #125 (P04-B provider credits/refunds), so the summary includes
provider credits and refunds now. They are not deferred. Head and tree are listed
under Evidence.

## Problem

1. The published Gateway route `admin.billing` (`GET /admin/billing`) forwards to
   `GET /internal/v1/billing/summary` with `permission: 'billing.read'`. That owner
   route existed neither in Billing nor in `billing.v1`, so the admin route could
   only fail.
2. Finance had no work queue. Admin-web can reconcile an attempt only when it
   already knows the `obligationId`.

## What was added (owner routes)

| Route | Access | Purpose |
| --- | --- | --- |
| `GET /internal/v1/billing/summary` | staff **account** with `billing.read` | Per-currency finance summary from one consistent snapshot, plus ledger-vs-projection checks |
| `GET /internal/v1/billing/payment-attempts?status=&cursor=&limit=` | staff **account** with `billing.read` | Reconciliation work queue, oldest first, keyset-paginated |

Both routes deny by default:

- Anonymous or unknown credentials get 401.
- Customers, technicians, and guests get 403, even a guest holding `billing.read`.
- An Identity outage gets 503 `AUTH_UNAVAILABLE`.
- Authentication runs before query validation.
- Responses never carry customer subjects, staff subjects, full provider
  references, merchant accounts or treasury references.

### Summary (per currency, exact Money `{currency, amountMinor, scale}`)

- **Obligations:** count, `byStatus`, `byFinancialStatus`, `billed` (non-voided),
  `verified`, `outstanding`. `byFinancialStatus` uses the same domain function
  `financialStatus` as the obligation view (`groupFinancialStatus`), so the admin
  "PAID" count cannot drift from what a customer sees.
- **Attempts:** `byStatus` and `awaitingReview` (PENDING_REVIEW + UNKNOWN).
- **Cash custody:** `inCustody` (receipts HELD + IN_HANDOVER), `receiptsByStatus`,
  `handoversByStatus`.
- **Provider credits:** `byStatus`, `confirmed` (UNALLOCATED + ALLOCATED, gross),
  `awaitingApproval` (PENDING_APPROVAL; recorded but **not** money).
- **Refunds:** `byStatus`, `refunded` (SUCCEEDED), `inFlight` (REQUESTED, APPROVED,
  SUBMITTED, UNKNOWN), `refundable` (confirmed − refunded − inFlight).
- **Ledger checks:**

  | Check | Ledger side | Must equal |
  | --- | --- | --- |
  | `receivable` | CUSTOMER_RECEIVABLE over obligation journals | `outstanding` |
  | `cleared` | clearing + cash-in-custody + unallocated-credit accounts over obligation journals | `verified` |
  | `custody` | CASH_IN_CUSTODY | `inCustody` |
  | `refunds` | REFUND_PAID clearing credits | `refunded` |
  | `refundCap` | reserved refunds | at most confirmed credits |

  `ledgerConsistent` is the AND of all checks in every currency. These are the
  COMMIT-time trigger sums (`billing_assert_obligation_ledger`) aggregated over the
  whole ledger.

How the summary is read and reported:

- All facts are read in **one read-only REPEATABLE READ transaction**
  (`PrismaFinanceReadModel.financeFacts`), so the figures are mutually consistent
  while commands commit.
- A broken cap is reported by `refundCap: false` and `refundable` shows 0. A
  negative figure is never shown, and nothing is silently clamped into a "healthy" number.
- A stored currency outside the supported set is treated as corruption and fails
  loudly. It is never skipped.

### Queue

`status` is required and must be one of the closed attempt statuses. `limit` is
1..100 (default 50). `cursor` is opaque: base64url of `(submittedAt ms, attemptId)`,
and a value that does not round-trip exactly is refused. Unknown or repeated
parameters return 400.

Each item carries:

- `obligationId` and the **current `obligationRevision`**, which is the
  `expectedRevision` of the existing reconciliation command.
- The masked reference `…XXXX`.
- `claimed` Money, `submittedAt` and `reconciledAt`.

Paging is keyset-based on `(submitted_at, id)` and uses the existing
`payment_attempt_status_submitted_idx`.

## Design

- Clean/hexagonal:
  - domain fold `domain/finance-summary.ts` (pure)
  - port `ports/finance.ports.ts`
  - query service `application/finance-query.service.ts`
  - adapter `infrastructure/persistence/prisma-finance.read-model.ts`
  - transport `transport/http/finance.controller.ts`
- **New files only.** The shared files were touched only for wiring: `app.module.ts`
  and the three `index.ts` barrels. The read model is a separate port, not added to
  `BillingRepository`.
- **No migration.** No schema change, so no expand/contract step.
- Read-only. No idempotency, outbox or audit is needed: nothing mutates. The summary
  is a report and never confirms money.
- Scale: the summary scans Billing's tables. That is acceptable at current volume.
  Incremental balances would be a later optimisation under the same contract.

## Tests (evidence)

| Family | File | Result |
| --- | --- | --- |
| Domain/model-based | `test/billing.finance.domain.spec.ts` | PASSED 7/7, details below |
| HTTP auth/transport | `test/billing.finance.http.spec.ts` | PASSED 4/4, details below |
| Real PostgreSQL (isolated) | `test/integration/billing.finance.postgres.spec.ts` | PASSED 3/3, details below |
| Existing billing PG specs (regression) | `test/integration/*.postgres.spec.ts` | PASSED 72/72 in the same run |
| Existing + new billing unit/Nest specs | `test/*.spec.ts` | PASSED 65/65 (`node --test dist-tests/test/*.spec.js`) |

Domain/model-based details:

- Over 3,000 seeds, the group status equals the per-obligation rule.
- Over 500 random populations, the fold equals a naive per-obligation reference.
- Every corrupted ledger figure is detected in its own check and currency.
- A refund-cap breach is an alarm.
- An empty store gives empty output. An unknown currency throws.
- Cursor forgery is refused.
- Closed query parsing is enforced.

HTTP auth/transport details:

- The 401/403/200 matrix holds: guests are refused even with `billing.read`.
- With Identity down, the routes return 503.
- Authentication precedes validation.
- No subjects appear in the summary.
- The queue masks references and its pages do not overlap.

The HTTP specs run with real Nest and the real Identity adapter against a local
Identity stub.

Real PostgreSQL details:

1. **Model-based delta.** The spec runs 33 seeded command sequences, covering all 11
   paths: unpaid, voided, awaiting cash, cash collected, awaiting payment, under
   review, unknown, mismatched, paid by approved statement, partially refunded,
   and refund in flight. They go through the real Billing / custody / provider /
   refund services over HTTP on two replicas. Every obligation view matches the
   model. Each summary figure changes (after − before) by exactly the model's
   delta in SYP and USD, and every ledger check is true.
2. **Snapshot under writes.** Every summary taken while 3 writer lanes commit
   paid, cash, refunded and unknown flows is `ledgerConsistent`.
3. **Queue under concurrent inserts.** New claims land between and during page
   reads. Every pre-existing claim is listed exactly once, nothing repeats, and the
   order is (submittedAt, attemptId) ascending. The listed `obligationRevision`
   is accepted by the reconciliation command. Customers get 403 and anonymous
   callers get 401.

Isolation: the acceptance script now runs `isolatedSpecs` **alone after** the
parallel batch. The summary asserts exact database-wide deltas, and another spec
writing concurrently would make a delta meaningless. Data left by the earlier specs
is part of the "before" snapshot, and that snapshot was itself asserted
ledger-consistent.

### Dependencies: real vs stubbed

| Dependency | In these tests |
| --- | --- |
| PostgreSQL 16.10 (disposable, runtime role `cw_billing_app`, migrated by `cw_billing_migrate`) | REAL |
| Identity | LOCAL HTTP STUB (real adapter) |
| Pricing | LOCAL HTTP STUB (published `pricing.v1` getQuote shape) |
| Work completion (lane C) | TEST DOUBLE |
| RabbitMQ | NOT USED (reads only; no events) |

### Other checks

| Check | Result |
| --- | --- |
| `node scripts/check-design-reference.mjs` | PASSED (no UI touched) |
| `node scripts/check-layers.mjs` | PASSED |
| `node scripts/check-boundaries.mjs` | PASSED |
| `node scripts/check-migrations.mjs` | PASSED (no migration) |
| `eslint` (changed files) | PASSED |
| `prettier --check` (changed files) | PASSED |
| `tsc -p services/billing/tsconfig.json` | PASSED |

Not run, and not claimed:

- The full repository `pnpm lint` / `pnpm typecheck` / `pnpm test:nest` across all
  services. The local host was saturated by parallel lanes, so CI is the authority.
- Browser or Playwright tests. There is no UI change.
- Gateway end-to-end through `admin.billing`, which needs E's published contract.

## Evidence

- Base: `3e1ab23bff450235858ea13e049f8fb373df393f`, tree `53edea7ff5348c969408e9fd3ee23569b06a9f94`.
- Code head under test: `f5e6d9c192ffad86dff386f0bd1e1dd4ea99cb4f`, tree `448c2d2c7e85f5d2c27cd9f2ef86a27567886d91` (clean). The later commit only adds this document and the evidence file.
- Recorded run: `docs/production/B/evidence/billing-postgres-f5e6d9c192ff.json`. It names the
  exact source commit and tree.
- Command: `node scripts/production/B/postgres-acceptance.mjs --service billing --record`.

Two earlier runs did not produce evidence:

- On `ccbcc11` the build failed with a test-type error. That record was discarded,
  and the fix is in `8fbe896`.
- An unrecorded attempt had 2 isolated tests fail with 503 `AUTH_UNAVAILABLE`.
  The Identity stub's 1 s budget was missed at 4-way concurrency on a saturated
  host. Concurrency was lowered to every path sequentially, then pairs, and 3
  snapshot writer lanes. No summary assertion had failed.

## Changed paths

```
services/billing/src/domain/finance-summary.ts                       (new)
services/billing/src/ports/finance.ports.ts                          (new)
services/billing/src/application/finance-query.service.ts            (new)
services/billing/src/infrastructure/persistence/prisma-finance.read-model.ts (new)
services/billing/src/transport/http/finance.controller.ts            (new)
services/billing/src/app.module.ts, src/{domain,ports,application}/index.ts (wiring)
services/billing/test/billing.finance.domain.spec.ts                 (new)
services/billing/test/billing.finance.http.spec.ts                   (new)
services/billing/test/support/finance-http-harness.ts                (new)
services/billing/test/integration/billing.finance.postgres.spec.ts   (new)
scripts/production/B/postgres-acceptance.mjs                         (isolatedSpecs)
docs/production/B/CONTRACT_REQUEST_E_BILLING_ADMIN.md                (new)
docs/production/B/P06-B6-BILLING-ADMIN-FINANCE.md                    (new)
docs/production/B/evidence/billing-postgres-f5e6d9c192ff.json            (new)
```

Migration IDs: none. Contract version: none published. `billing.v1` is unchanged;
CR-B-10 requests the addition. Event versions: none.

## Security and privacy

- These are read-only staff reads. They are deny-by-default and limited to staff
  accounts holding `billing.read`. There are no client-supplied filters on
  subjects.
- Queue references are masked to the last 4 characters.
- Logs come from the shared exception filter only: code and status, with no
  amounts or references.

## Rollback

Revert the commits. There is no schema or data change and no event, so rollback
is safe at any time. `admin.billing` then returns to its pre-change failure.

## Rebase interaction

- Sibling child B4 (booking-obligation saga routes) also adds Billing files and
  wiring. The expected conflicts are only in `app.module.ts`, the barrels and
  `postgres-acceptance.mjs` (the `billing` entry).
- Whichever PR merges second must keep both controllers and both config keys, then
  re-run the recorded acceptance on the merged tree.

## Remaining blockers

| ID | Owner | Blocker |
| --- | --- | --- |
| B-P06-B6-01 | E | Publish CR-B-10, `getFinanceSummary` + `listPaymentAttempts`, in `billing.v1`. Add the Gateway route `admin.billing.attempts`. Decide internal vs v1 refund-status projection. |
| B-P06-B6-02 | D | Admin-web consumer: the overview with a visible alarm when `ledgerConsistent` is false, and the queue → reconcile flow. These are pending admin screen design acceptance (DESIGN_LOCK §7). |
| B-P06-B6-03 | E | Real Identity acceptance for `billing.read` staff accounts. Readiness promotion. |

Next consumers: Lane E (contract and Gateway), then Lane D (admin-web finance console).
