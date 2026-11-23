# P03-B1 — Cash collection, receipt, technician custody and settlement

Status: **implemented and locally verified; review required; INTEGRATION_PENDING**.
Readiness remains 503 (`BUSINESS_READY = false`). This is not production-ready,
not deployed and not integrated. In production wiring every cash collection
fails closed with 503 until lane C publishes the work-completion contract
(B-P03-01) and Identity grants the CR-B-08 permissions (B-P03-02).

Parent task: P03-B (Lane B). Child branch:
`prod/p03-b-implement-cash-collection--receipt--technician-custody-b1`, based
directly on `main` `a14997a20b85341a24f17e7878d2a188eea3fe36` (tree
`0261a7ede0bf05c02ef5eb1f56b2afe6cfabba6b`), refreshed on 2026-10-09. The
audited `f875d31` was no longer current. Not stacked on any branch.

## Ownership decision (why Billing, not Wallet, holds custody)

`architecture/service-catalog.json` gives Billing "payment verification,
refunds, **cash reconciliation** and authoritative financial ledger", and
`owns: cash_receipts, ledger`. Wallet is "balances and holds referencing
Billing ledger postings; **no second financial ledger**".

Every fact below moves money between accounts:

- the customer's receivable;
- cash held by a technician;
- treasury cash;
- a shortage owed by a holder.

These facts are therefore Billing journals and receipts. A technician's
custody balance is the `CASH_IN_CUSTODY` ledger balance carried on lines with
that holder's Identity subject, so it is not a separate store.

Wallet's future role is a read projection of these postings: a technician
"wallet" view built from Billing references. It must not record movements of
its own. That projection is child B2. B2 is **blocked** on E registering the
billing cash/custody events (B-P03-03), because consuming an unpublished
event contract is forbidden. No Wallet code is changed in this child.

## The five facts are separate

| # | Fact | Owner / evidence | State in Billing |
| - | ---- | ---------------- | ---------------- |
| 1 | Service completed | Lane C work owner, read through the `WorkAuthority` port for the calling technician. The client never asserts it. | not stored as truth. The receipt keeps `booking_id`, `assignment_id` and `assignment_revision` as references. |
| 2 | Cash collected from the customer | `POST …/obligations/:id/cash-collections` by the assigned technician | `cash_receipt` row. The obligation becomes `SETTLED`, and its financial status is **`CASH_COLLECTED`**, not `PAID`. |
| 3 | Cash held by the technician | receipt `custody_status = HELD` | the holder's `CASH_IN_CUSTODY` balance |
| 4 | Cash handed to the company | first the holder declares (`PENDING`, receipts `IN_HANDOVER`), then an independent treasury receiver counts it (`RECEIVED`, receipts `DEPOSITED`) | `custody_handover` row. Custody moves to `TREASURY_CASH_UNRECONCILED`. Any shortage or overage is booked explicitly. |
| 5 | Settlement reconciled | a reconciler who is neither the holder nor the receiver | handover `RECONCILED`, receipts `SETTLED`, and the cash moves to `TREASURY_CASH` |

Collecting cash never shows `PAID`. A declared handover is never "received".
A treasury count is never "reconciled". Cash being in custody or settled never
counts as a second customer payment.

## Domain rules (`services/billing/src/domain/cash.ts`)

### Collection

The work owner must report all of the following for this booking:

- its quote equals the obligation's quote; otherwise the answer is 404, so
  nothing is enumerable;
- the assigned technician is the caller (`COLLECTOR_NOT_ASSIGNED`, 403);
- the work state is `COMPLETED` (`WORK_NOT_COMPLETED`, 409).

The binding and assignment checks run **before** any status check, so a
technician who is not the assignee learns nothing about the obligation.

The collection is also refused when:

- the collector is the obligation's owner;
- there is no active cash intent (`INTENT_NOT_CASH`);
- the amount differs in any way from the outstanding amount
  (`AMOUNT_NOT_EQUAL_OUTSTANDING`). There is no partial or over-collection.

Only `account` principals can collect. A guest session can never hold cash.

### Reversal

A reversal is a linked correction with a closed reason set (no free text):
`RECORDED_IN_ERROR`, `WRONG_BOOKING`, `AMOUNT_NOT_RECEIVED`,
`DUPLICATE_RECORD`.

- It requires `billing.cash.correct`.
- It can never be done by the collector, or by the obligation's owner.
- It is allowed only while the cash is still `HELD`. Cash already in a
  handover or at the treasury needs a treasury adjustment (B-06/B-07). That
  case is refused explicitly (`RECEIPT_NOT_HELD`), never hidden.

What a reversal does:

- the receipt becomes `REVERSED` and is kept;
- a reversal row and a reversal journal are written;
- the obligation reopens (`SETTLED → OPEN`) and its receivable returns;
- a fresh cash intent is opened;
- a new collection is then possible.

There is at most one reversal per receipt, and the original is never edited
or deleted.

### Handover

- The holder declares a **set** of their own `HELD` receipts. Duplicates are
  refused. The fingerprint uses the sorted ids, because order carries no
  meaning.
- A handover holds at most 200 receipts, in one currency.
- The declared total must equal the server's sum of those receipts
  (`DECLARED_TOTAL_MISMATCH`).
- The holder can cancel while `PENDING`, and the treasury can refuse it.
  Either way the receipts return to `HELD`.

### Treasury receipt

- Requires `billing.treasury.receive`, and the receiver is never the holder.
- `counted` may be anything ≥ 0 in the handover's currency.
- `shortage = declared − counted` and `overage = counted − declared`. At most
  one of them is non-zero.
- Both are booked to the ledger and stay open: their resolution (deduction,
  write-off, investigation) is the owner's decision B-07 and is not
  automated.
- The treasury reference (a deposit slip or safe log number) can be claimed
  by one handover only. It is normalised, never logged or evented, and
  responses show it masked.

### Settlement reconciliation

- Requires `billing.reconcile`. The reconciler is neither the holder nor the
  receiver (`SEPARATION_OF_DUTIES`).
- The settlement reference is unique in the same way as the treasury
  reference.
- A count of 0 settles without a treasury journal, because nothing reached
  the treasury.

## Ledger (technical, provisional chart; no revenue or tax)

| Journal (business ref) | Lines |
| ---------------------- | ----- |
| `CASH_COLLECTED` (`receipt:<id>:collected`) | Dr `CASH_IN_CUSTODY`(holder) / Cr `CUSTOMER_RECEIVABLE` |
| `CASH_COLLECTION_REVERSED` (`receipt:<id>:reversed`) | Dr `CUSTOMER_RECEIVABLE` / Cr `CASH_IN_CUSTODY`(holder) |
| `CUSTODY_RECEIVED` (`handover:<id>:received`) | Dr `TREASURY_CASH_UNRECONCILED` (counted), Dr `CUSTODY_SHORTAGE_RECEIVABLE`(holder) (shortage) / Cr `CASH_IN_CUSTODY`(holder) (declared), Cr `CUSTODY_OVERAGE_SUSPENSE` (overage) |
| `CUSTODY_RECONCILED` (`handover:<id>:reconciled`) | Dr `TREASURY_CASH` / Cr `TREASURY_CASH_UNRECONCILED` |

Journal scope:

- Obligation journals carry `obligation_id`; handover journals carry
  `handover_id`. Exactly one of the two is set (`ledger_journal_scope`).
- `holder_subject` is present exactly on the holder accounts
  (`ledger_line_holder`).
- Zero-amount lines are never written.

## Database-enforced invariants

Migration: `20261009100000_p03b_cash_custody_settlement`. It is expand-only
with respect to P02-B1:

- new tables;
- new nullable columns;
- `obligation_id` relaxed to nullable on journals and audit;
- CHECK constraints widened only;
- guard functions replaced with supersets of the P02-B1 transitions.

### Receipts

- One effective receipt per obligation **and** per booking: unique
  `(obligation_id, active_slot)` and `(booking_id, active_slot)`.
- Receipt insert guard: the receipt is born `HELD`, for an active cash intent
  of an `OPEN` obligation, for exactly the outstanding amount, by someone
  other than the owner.
- Receipt update guard: identity, amount, collector and links are immutable,
  and `revision` moves by exactly +1. Each transition needs the fact that
  justifies it:

  | Transition | Required fact |
  | ---------- | ------------- |
  | `HELD → IN_HANDOVER` | a `PENDING` handover of the same holder and currency |
  | `IN_HANDOVER → HELD` | the handover is `CANCELLED` |
  | `IN_HANDOVER → DEPOSITED` | the handover is `RECEIVED` |
  | `DEPOSITED → SETTLED` | the handover is `RECONCILED` |
  | `HELD → REVERSED` | a reversal row written in this same transaction |

- `cash_receipt_reversal` is unique per receipt and immutable. Its insert
  guard requires a `HELD` receipt and a reverser who is not the collector.

### Handovers

- `custody_handover` has CHECKs for:
  - the facts present in each status;
  - the discrepancy arithmetic;
  - separation of duties between holder, receiver and reconciler;
  - reference shape and uniqueness;
  - timestamp ordering.
- Its guards allow only `PENDING → RECEIVED | CANCELLED` and
  `RECEIVED → RECONCILED`. Declared facts and, once set, received facts are
  immutable.
- Handover items are immutable and written only by the transaction that
  created their `PENDING` handover, for the holder's own receipts at their
  exact amounts.

### Obligations and intents (replaced P02-B1 guards)

- A cash intent may now go `AWAITING_CASH_COLLECTION → SUCCEEDED`, but only
  when a receipt for that intent is written in the same transaction.
- A succeeded cash intent may go `SUCCEEDED → CANCELLED`, but only when the
  reversal of its receipt is written in the same transaction.
- An obligation may reopen (`SETTLED → OPEN`, with `verified` decreasing),
  but only when a reversal for it is written in the same transaction.
- Every other P02-B1 rule is unchanged.

### COMMIT-time checks (deferred constraint triggers)

- **Per holder and currency:** the `CASH_IN_CUSTODY` ledger balance equals
  the receipts that holder still holds (`HELD` + `IN_HANDOVER`).
- **Per handover:**
  - the items add up to the declared total and count;
  - every item's receipt is in the custody status the handover status
    implies;
  - the handover's journals carry exactly the expected net per account,
    with no foreign holder.
- **Per journal (new; also closes a P02-B1 gap):** every inserted journal
  re-checks the facts it moves:
  - its obligation's ledger agreement;
  - its handover's consistency;
  - the custody balance of every holder it touches.

  A stray balanced journal without its state change can therefore never
  commit. Before this, a stray obligation journal was only caught when the
  obligation row itself changed.
- The obligation/ledger agreement now counts `CASH_IN_CUSTODY` as cleared
  receipt.

### Append-only and privileges

- Receipts and handovers can never be deleted. Reversals and items can never
  be updated or deleted. `TRUNCATE` is blocked on the four new tables.
- New trigger functions have `EXECUTE` revoked from `PUBLIC`.
- The three `billing_assert_*` helpers keep PostgreSQL's default `EXECUTE`,
  because trigger functions call them as the invoking runtime role. They are
  `SECURITY INVOKER`, read Billing tables only and write nothing.

## Application protocol, concurrency and failure handling

Every command uses the shared `CommandSupport` protocol, which was extracted
from P02-B1 unchanged except for the fix below:

1. a current Identity decision;
2. the permission check;
3. a closed request parse and the idempotency key;
4. the fingerprint;
5. replay of an existing receipt;
6. **one** local ACID transaction holding the business change, journal,
   audit, outbox rows and idempotency receipt.

Ordering and locks:

- The work owner is read **before** the transaction, so no network call holds
  a lock. A timeout or outage returns 503 with nothing written, and the same
  key can be retried.
- Lock order is obligation → receipt, and handover → receipts. Receipts are
  always locked in ascending id order.

Same-key race fix (applies to every Billing command, including P02-B1's):

- Before: a request that lost a same-key race while waiting for a row lock
  returned the loser's rejection, for example `REVISION_CONFLICT`.
- Now: any failed transaction first looks for a receipt committed under its
  own key, and replays it.
- A same-key retry therefore always returns the committed outcome. A
  different payload still gets `IDEMPOTENCY_CONFLICT`.

Permanent uniqueness also prevents a repeat effect when a client retries
with a **new** key:

- one effective receipt per obligation and per booking;
- one reversal per receipt;
- one handover claim per receipt;
- unique journal business references;
- unique treasury and settlement references.

## Owner API (`/internal/v1/billing`, proposed for `billing.v1`, CR-B-08)

| Method/path | Access | Success |
| ----------- | ------ | ------- |
| `POST /obligations/:id/cash-collections` `{expectedRevision, bookingId, amount}` | `billing.cash.collect`, account, assigned technician (work owner) | 201 `{ receipt, obligation: FinancialStatusView }` |
| `GET /cash-receipts/:id` | collector (own) or `billing.read` | 200 receipt view (+ reversal) |
| `POST /cash-receipts/:id/reversal` `{expectedRevision, reason}` | `billing.cash.correct`, not collector/owner | 200 `{ receipt, obligation }` |
| `POST /custody/handovers` `{receiptIds, declaredAmount}` | `billing.cash.collect`, account, own receipts | 201 handover view |
| `GET /custody/handovers/:id` | holder (own) or `billing.read` | 200 |
| `POST /custody/handovers/:id/cancel` `{expectedRevision}` | holder or `billing.treasury.receive` | 200 |
| `POST /custody/handovers/:id/treasury-receipt` `{expectedRevision, countedAmount, treasuryReference}` | `billing.treasury.receive`, not holder | 200 |
| `POST /custody/handovers/:id/reconciliation` `{expectedRevision, settlementReference}` | `billing.reconcile`, not holder/receiver | 200 |
| `GET /custody/holders/me` | `billing.cash.collect` | 200 position per currency |
| `GET /custody/holders/:subject` | `billing.read` | 200 |
| `GET /custody/reconciliation` | `billing.read` | 200 invariant report (REPEATABLE READ snapshot) |

What the read views contain:

- **Obligation view:** gains a `cashReceipt` summary `{receiptId, amount,
  collectedAt}` for its owner. The customer never sees custody or treasury
  data.
- **Reconciliation report:** lists holder ledger/receipt mismatches as exact
  signed minor-unit strings (never clamped), orphan receipts or settlements,
  pending, awaiting and discrepancy handover counts, and treasury positions.

## Events (outbox only; relay not started)

These are written in the same transaction as the fact, validated through the
shared envelope v2 parser, and proposed in CR-B-08.2:

- `billing.cash-collected.v1` (aggregate `billing-cash-receipt`)
- `billing.cash-collection-reversed.v1` (aggregate `billing-cash-receipt`)
- `billing.custody-handover-changed.v1` (aggregate `billing-custody-handover`)
- plus the existing `billing.obligation-status-changed.v1`, for example
  `AWAITING_CASH → CASH_COLLECTED`.

Data carries opaque IDs, statuses, closed reason codes and amounts only. It
never contains a treasury or settlement reference, phone, name or customer
detail.

## Security and privacy

- Deny by default. The four requested permissions (CR-B-08.1) do not exist in
  Identity yet, so production denies every cash command. Nothing falls back
  to a broader existing grant.
- Separation of duties is enforced both in the application and as database
  CHECKs/guards: collector ≠ owner, reverser ≠ collector, receiver ≠ holder,
  reconciler ∉ {holder, receiver}.
- Not-assigned and foreign callers get 404 or 403 without any financial
  state. Holders read only their own receipts and handovers.
- Logs carry correlation ID, status code and replay flag only. Audit rows
  record actor, action, obligation/receipt/handover scope and a fixed outcome
  code. Responses mask references.

## Test evidence (exact commands; results on the submitted head)

| Family | Command | Result |
| ------ | ------- | ------ |
| Domain/unit invariants (cash + P02-B1) | `node --test services/billing/dist-tests/test/billing.cash.domain.spec.js services/billing/dist-tests/test/billing.domain.spec.js` | PASSED (21) |
| Adapters + Nest composition (routes mounted, fail closed 401/503, readiness 503) | `node --test services/billing/dist-tests/test/billing.adapters.spec.js services/billing/dist-tests/test/billing.nest.spec.js` | PASSED (19) |
| Real PostgreSQL: runtime role, two replicas, races, triggers, ledger, upgrade sentinel, drift | `node scripts/production/B/postgres-acceptance.mjs --service billing --record` | PASSED: 51 tests (21 new custody + 30 P02-B1) plus all phases; see `evidence/billing-postgres-95a380453513.json` (source `95a3804`, tree `2afc3ec`, clean) |
| Upgrade from P02-B1 history with a live cash obligation, then collection under the new schema | same run, phase "upgrade from previous migration history" | PASSED |
| Strict typecheck / build / ESLint / Prettier | `tsc -p services/billing/tsconfig.json --noEmit`, `pnpm --filter @carwash/billing build`, `pnpm exec eslint services/billing scripts/production/B`, `pnpm exec prettier --check services/billing scripts/production/B docs/production/B` | PASSED |
| Design lock, boundaries, layers, service shells, migrations (append-only vs `origin/main`), secrets, ownership, foundation, contract surface/docs | `node scripts/check-design-reference.mjs`, `node --test tests/design/reference-lock.test.mjs` (12), `pnpm check:boundaries`, `node scripts/check-migrations.mjs --base-ref origin/main`, `node scripts/check-secrets.mjs`, `pnpm check:ownership`, `pnpm check:foundation`, `pnpm check:contract-surface`, `pnpm check:contract-docs` | PASSED |
| Real RabbitMQ outbox/inbox/redelivery | — | **BLOCKED** (CR-B-05, CR-B-08.2) |
| Real lane C work owner → Billing | — | **BLOCKED** (B-P03-01: no work-completion state or contract exists) |
| Real Identity grants → Billing | — | **BLOCKED** (CR-B-08.1) |
| Wallet projection (B2) | — | **BLOCKED** (needs registered events) |
| Gateway / technician app / admin finance UI / Playwright | — | **NOT APPLICABLE to this child**: no UI change. Operator and admin screens for custody are **not designed** (DESIGN_LOCK §7), so they remain pending and are not inferred. |

The concurrency and negative cases proven on real PostgreSQL are:

- same-key collection and handover on two replicas (one effect, identical
  replay);
- 8 concurrent different-key collections (exactly one receipt and one
  journal);
- reversal vs handover, treasury receipt vs cancel, and two treasury receipts
  on one handover (exactly one applies);
- one handover claim per receipt, and reuse of a treasury reference
  (case-insensitive) is refused;
- work owner outage (503, no rows, and the same key succeeds later);
- the production fail-closed adapter (503);
- not completed, wrong or no assignee, and a foreign booking;
- guest, customer, treasury and anonymous callers;
- shortage, overage and zero count;
- separation of duties, including a person who holds both the receive and
  the reconcile grants;
- direct-SQL attacks as the runtime role: delete, truncate, amount edit,
  unjustified transition, reopening without a reversal, a forged receipt, a
  stray journal, a missing holder dimension, editing a received count, and
  self-reconciliation.

Real vs mocked dependencies:

- **Real:** PostgreSQL 16.10, a disposable container provisioned by the
  shared provisioner with separate migration and runtime roles.
- **Doubles:**
  - Identity session and Pricing quote: local HTTP servers.
  - The lane C work owner: an in-process double behind the `WorkAuthority`
    port (`test/support/work-double.ts`). A third replica runs the
    production `UnpublishedWorkAuthority`.
- **Not used:** a broker.

## Rollback and compensation

- **Code:** revert the PR. P02-B1 behaviour is a subset, and the replaced
  guard functions are supersets.
- **Schema, before any cash row exists:** restore the P02-B1 function bodies
  and constraints, then drop the new triggers, functions, tables and columns
  in reverse order.
- **Schema, after cash rows exist:** a reviewed financial data plan and
  restore evidence are required. Financial facts are never dropped or edited
  silently.
- **Business compensation:** a linked reversal while the cash is held, or
  handover cancellation while it is pending. After treasury receipt, the
  owner's adjustment policy (B-06/B-07) applies, and it is refused, not
  hidden, until that policy exists.

## Remaining blockers (P03-B stays INTEGRATION_PENDING)

| ID | Blocker | Owner |
| -- | ------- | ----- |
| B-P03-01 | No work-completion state exists (Dispatch stops at `ASSIGNED`), and no published contract tells Billing the booking's quote, current assignee and completion for the calling technician. The production `WorkAuthority` fails closed. | C (+ E for the contract) |
| B-P03-02 | Identity permissions `billing.cash.collect`, `billing.cash.correct`, `billing.treasury.receive` (CR-B-08.1) and `billing.reconcile` (CR-B-03.1) | E |
| B-P03-03 | Registration of the cash/custody events, topology and relay; real RabbitMQ evidence; this unblocks the Wallet projection B2 (CR-B-08.2, CR-B-05) | E, then B2 |
| B-P03-04 | `billing.v1` routes and Gateway aliases for the technician app and the admin finance queue (CR-B-08.4); operator and admin custody screens are not designed | E, then D/C UI after an approved design |
| B-P03-05 | Owner decision B-07: individual vs team custody (individual is implemented, per the task text), handover frequency and thresholds, shortage/overage resolution (deduction, write-off), the treasury recipient's identity, and adjustments after deposit | Owner |
| B-P02-* | All P02-B1 blockers (`billing.v1`, events, Pricing conformance, workload identity, `@carwash/contracts` dependency, merchant data) | E / B / Owner |

## Next consumer

- **Lane C:** after the work-completion contract, the technician app's
  "cash received" step consumes `cash-collections` and `custody/holders/me`
  through E's Gateway aliases.
- **Admin finance:** consumes the treasury receipt, reconciliation and report
  routes, once approved designs exist.
- **B2:** builds the Wallet projection once E registers the events.
