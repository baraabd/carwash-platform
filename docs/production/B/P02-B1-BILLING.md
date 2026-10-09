# P02-B1 — Billing obligation and PaymentIntent core

Status: **implemented and locally verified; review required; INTEGRATION_PENDING**.
Readiness remains 503 (`BUSINESS_READY = false`). This is not production-ready,
not deployed and not integrated. No money flow is enabled: there is no merchant
account, no provider API and no real QR code.

Parent task: P02-B (Lane B). Child branch:
`prod/p02-b-implement-billing-obligation-and-paymentintent-core-b1`, based
directly on `main` (not stacked).

## What this child delivers

| Layer | Files (`services/billing/src/…`) |
| --- | --- |
| domain | `domain/money.ts` (exact Money), `domain/payment.ts` (state machines, reconciliation, void, financial status), `domain/journal.ts` + `domain/ledger.ts` (balanced double entry) |
| application | `application/billing.service.ts` (commands/queries), `billing-errors.ts`, `events.ts` (outbox envelopes), `views.ts`, `canonical-json.ts` |
| ports | `ports/billing.ports.ts` (repository/UoW, QuoteReader, AccessAuthority, Clock, Ids, Hasher) |
| infrastructure | Prisma repository, Identity session adapter, pricing.v1 quote reader, bounded outbound HTTP, system adapters |
| transport | `transport/http/billing.controller.ts` (no business logic) |
| persistence | migration `20261008100000_p02b_billing_obligations_payments` + schema mirror |

The domain and application layers import no Nest, HTTP or Prisma code
(`check-layers` passes).

## Model

- **Obligation**: what one owner (`PrincipalRef`, either an account or a guest) owes
  for one Pricing quote. There is exactly one obligation per `quote_id`, which is
  a unique key. Its `amount` is Pricing's server total, read with the caller's
  own token; a client-supplied amount is rejected with 400. `verified` starts
  at 0. Statuses are `OPEN`, then `SETTLED` or `VOIDED`, and both of those are
  terminal.
- **PaymentIntent**: the chosen method. It fixes the outstanding amount at the
  moment the method is chosen. There is at most one active intent per
  obligation, enforced by a unique `(obligation_id, active_slot)` index.
  Switching method supersedes the old intent, and is refused while a
  transaction number is under review.
  - Cash: `AWAITING_CASH_COLLECTION`. Collection and custody are later
    operations (owner decision B-07) and are not modelled here.
  - Electronic (Sham Cash / Syriatel Cash): `AWAITING_CUSTOMER_PAYMENT`, then
    `UNDER_REVIEW` after a reference is reported.
- **PaymentAttempt**: a provider transaction reference the customer reported.
  Its status is `PENDING_REVIEW`. `(method, normalized reference)` is globally
  unique, so one transaction can be claimed once, ever. Each obligation accepts
  at most 5 attempts. Responses and events never contain the full reference;
  responses show only `…` plus its last four characters.
- **Reconciliation** is done by Finance (`billing.reconcile`), and never by the
  obligation's own owner.
  - `MATCHED` requires an observed amount exactly equal to the outstanding
    amount. It is the **only** path that recognises money.
  - `MISMATCHED` returns the intent to awaiting payment.
  - `UNKNOWN` keeps the intent under review and shows `OUTCOME_UNKNOWN`. It is
    never success, and is later resolved to `MATCHED` or `MISMATCHED`.
- **Ledger**: append-only journals with balanced lines per currency, each under
  a unique business reference.
  - `OBLIGATION_BILLED`: Dr receivable / Cr billed-obligations control.
  - `PAYMENT_MATCHED`: Dr the method's clearing account / Cr receivable.
  - `OBLIGATION_VOIDED`: the reversal of `OBLIGATION_BILLED`.
  - The chart is a technical provisional one: no revenue or tax recognition
    (B-04/B-06).
- **Financial status** (derived only from server facts): `UNPAID`,
  `AWAITING_CASH`, `AWAITING_PAYMENT`, `UNDER_REVIEW`, `OUTCOME_UNKNOWN`,
  `PAID`, `VOIDED`. Creating an intent or submitting a transaction number never
  produces `PAID`.

## Command protocol (every mutation)

1. Ask Identity for a current session decision. There is no caching or retry,
   and a failure or timeout returns 503.
2. Check the permission.
3. Do a strict, closed parse of the request and validate the `Idempotency-Key`.
4. Fingerprint the request: SHA-256 of canonical JSON of operation, actor and
   request.
5. If a receipt is already committed for this key, replay it (with no upstream
   call). The same key with a different request returns `IDEMPOTENCY_CONFLICT`.
6. Create only: read the quote from Pricing **before** the transaction, so no
   network call ever holds a lock.
7. Run **one local ACID transaction**:
   1. Re-check the receipt.
   2. `SELECT … FOR UPDATE` the obligation.
   3. Check ownership; a wrong owner gets 404, so nothing is enumerable.
   4. Check `expectedRevision`; a mismatch returns 412 `REVISION_CONFLICT`.
   5. Apply the domain plan, with guarded writes on intent and attempt status.
   6. Update the obligation with compare-and-set, `revision + 1`.
   7. Post the balanced journal.
   8. Append the audit row.
   9. Append an outbox row when the financial status changes.
   10. Insert the receipt.
8. Races:
   - A same-key race that loses on the receipt or the unique quote index
     replays the winner's receipt.
   - A different-key create for the same quote returns that owner's existing
     obligation (200).
   - A losing reference claim gets `PROVIDER_REFERENCE_TAKEN`.

Replay policy: only committed successes are stored as receipts. A rejected
command leaves no receipt, and the same key may be retried after the condition
changes. Receipt retention (B-05) is open, so receipts are kept indefinitely.

## Database-enforced invariants (migration triggers/constraints)

- Amounts:
  - All amounts are BIGINT minor units plus a currency, which must be SYP or
    USD (a mirror of the published `CURRENCIES`).
  - `0 < amount < 10^18` and `0 ≤ verified ≤ amount`.
  - `SETTLED` holds if and only if `verified = amount`. `VOIDED` implies
    `verified = 0`.
- Obligation update guard:
  - id, owner, quote, currency, amount and correlation are immutable.
  - `revision` moves by exactly +1, and `verified` never decreases.
  - `SETTLED` and `VOIDED` are terminal.
- Intents and attempts:
  - Intent and attempt insert/update guards enforce the transition tables,
    immutable fields and consistency: same currency, intent amount equals
    outstanding, attempt amount equals intent amount.
  - Only an awaiting electronic intent accepts an attempt.
  - Cash can never become `SUCCEEDED`.
  - A `MATCHED` attempt requires `observed = claimed`. An `UNKNOWN` attempt
    has no observed amount.
- Journals:
  - Ledger lines can only be inserted by the transaction that created their
    journal.
  - COMMIT-time constraint trigger: every journal has at least 2 lines,
    balances per currency and uses its obligation's currency.
- COMMIT-time ledger/state agreement:
  - receivable balance = `amount − verified` (0 once `VOIDED`);
  - clearing total = `verified`.
  - So a state change without its journal, or a journal without its state
    change, cannot commit.
- Append-only:
  - journals, lines, receipts and audit rows can never be updated or deleted;
  - obligations, intents and attempts can never be deleted;
  - `TRUNCATE` is blocked on the core ledger tables.
- Trigger functions have `EXECUTE` revoked from PUBLIC. The runtime role has
  DML only, with no DDL and no access to `_prisma_migrations`.

## Distributed behaviour (saga, compensation, events)

- Billing → Pricing is a synchronous read only (published `pricing.v1`
  `getQuote`, caller's token).
  - Outage, timeout, a non-200 response, an oversized body or a contract
    violation (for example a different scale) all return 503
    `UPSTREAM_UNAVAILABLE`.
  - No obligation and no receipt are written, so a retry with the same key is
    safe.
- Booking saga (future consumer):
  1. Booking pins a quote and creates the obligation (idempotent on its key,
     unique per quote).
  2. If the booking fails afterwards, the compensation is `void`, which is
     allowed only while no transaction number was ever reported.
  3. After a report, compensation needs Finance's refund/adjustment flow
     (B-06). It is not automated and is never hidden.
- Events:
  - `billing.obligation-created.v1` and `billing.obligation-status-changed.v1`
    are written to `app.outbox_message` in the same transaction, using
    envelope v2 validated by the shared parser.
  - The relay is **not started** until E registers the contracts and topology
    (CR-B-02, CR-B-05), so the rows stay pending. Nothing is published to a
    broker by this child.

## Security, privacy and observability

- Deny by default:
  - every route needs a current Identity decision;
  - customer access is object-scoped to the owner `PrincipalRef`, and guests
    and accounts never see each other's obligations;
  - Finance reads with `billing.read`;
  - reconciliation needs the requested `billing.reconcile` and separation of
    duties.
- Upstream adapters:
  - HTTPS is required off loopback, and credentials or paths in the origin are
    rejected;
  - redirects are refused, timeouts are bounded and response bodies are capped
    at 16 KiB;
  - nothing is retried, so a timeout is never success.
- Logs carry the correlation ID, status code and replay flag only: never
  amounts, references, subjects or tokens. The correlation ID propagates to
  Identity and Pricing and into audit, journal and outbox rows.
- Rate limiting: Billing bounds reported attempts per obligation (5) and the
  global request-rate limit is the Gateway's (E-owned) policy.
- Audit rows record actor, action, obligation, attempt and a fixed outcome
  code for every successful mutation.

## Test evidence (exact commands; results on the submitted head)

| Family | Command | Result |
| --- | --- | --- |
| Domain/unit invariants | `node --test services/billing/dist-tests/test/billing.domain.spec.js` | PASSED (10) |
| Upstream adapters (real local HTTP doubles) | `…/billing.adapters.spec.js` | PASSED (8) |
| Nest composition / readiness 503 / fail-closed | `…/billing.nest.spec.js` | PASSED (10) |
| Real PostgreSQL (runtime role, two replicas, races, triggers, ledger) | `node scripts/production/B/postgres-acceptance.mjs --service billing --record` | PASSED (30), see `evidence/billing-postgres-*.json` |
| Upgrade from previous migration history, migration-history isolation, schema drift | same run, phases | PASSED |
| Typecheck (strict) / ESLint / Prettier | `tsc -p services/billing/tsconfig.json --noEmit`, `pnpm exec eslint services/billing scripts/production/B`, `pnpm exec prettier --check …` | PASSED |
| Design lock, boundaries, layers, service shells, migrations (append-only vs `origin/main`), secrets, ownership, foundation | `node scripts/check-design-reference.mjs`, `check-boundaries`, `check-layers`, `generate-service-shells --check`, `check-migrations --base-ref origin/main`, `check-secrets`, `pnpm check:ownership`, `pnpm check:foundation` | PASSED |
| Real RabbitMQ outbox/inbox/redelivery | — | **BLOCKED** (CR-B-02/05: no registered contract, topology or relay dependency) |
| Real Identity → Billing, real Pricing → Billing | — | **BLOCKED** (Pricing does not serve the published `pricing.v1` shape yet, B-P02-03; workload identity pending at E) |
| Gateway / browser journey / Playwright visual | — | **NOT APPLICABLE to this child** (no UI change; the consumer is a later lane after E's Gateway aliases) |

The real dependencies are PostgreSQL 16.10 (disposable container, shared
provisioner, separate migration and runtime roles). The test doubles are the
Identity session and the Pricing `getQuote` endpoint (real local HTTP servers).
No broker was used.

## Rollback

The migration is additive. Before any financial row exists, roll back by
reverting the PR and dropping the new tables and functions in reverse order;
the foundation `service_marker` table is untouched. Once rows exist, a
rollback needs a reviewed financial data plan and restore evidence; never
drop them silently. The code rollback is safe because nothing consumes these
APIs or events yet.

## Remaining blockers (P02-B stays INTEGRATION_PENDING)

| ID | Blocker | Owner |
| --- | --- | --- |
| B-P02-01 | `billing.v1` HTTP contract, Gateway aliases, error-reason allowlist (CR-B-01, CR-B-06) | E |
| B-P02-02 | Event registration, topology, relay dependency; real RabbitMQ evidence (CR-B-02, CR-B-05) | E, then B2 |
| B-P02-03 | Pricing serves a pre-contract quote shape (Money without `scale`, no `REVOKED`); it must conform to the published `pricing.v1` before Billing can obtain a real quote | B (Pricing follow-up) / E reconciliation |
| B-P02-04 | `billing.reconcile` permission (CR-B-03.1); until then reconciliation is always 403 in production | E |
| B-P02-05 | Workload identity for the booking saga to create and void obligations (CR-B-03.2) | E, then B2 + Booking |
| B-P02-06 | `@carwash/contracts` dependency to drop the local Money/QuoteV1 mirrors (CR-B-04) | E |
| B-P02-07 | Merchant accounts, per-wallet QR/payee data and provider statement access for real reconciliation | Owner + providers (external) |
| B-P02-08 | Owner decisions B-03 (currency policy), B-05 (receipt retention), B-06 (refunds/unknown handling), B-07 (cash custody) | Owner |

## Next consumer

After E publishes `billing.v1` and the Gateway aliases, the customer journey's
payment and confirmation screens (seven-screen reference; no visual change)
and the Booking saga consume these APIs. B2 then starts the outbox relay
against real RabbitMQ.