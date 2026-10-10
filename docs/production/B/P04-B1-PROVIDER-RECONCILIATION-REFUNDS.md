# P04-B1 — Payment provider adapters, reconciliation and refunds (Billing)

Status: **implemented and locally verified; review required; INTEGRATION_PENDING**.
Readiness stays 503 (`BUSINESS_READY = false`). This is not production-ready, not
deployed and not integrated. **No live provider was contacted**: there are no
approved ShamCash or Syriatel Cash merchant API documents, credentials or sandbox
(blocker `LIVE_PROVIDER_ACCEPTANCE`).

Parent task: P04-B (Lane B). Child branch:
`prod/p04-b-implement-production-grade-payment-provider-adapters--r-b1`, based
directly on `main` `c65db708b9a7c50e5a885799330479426e863758` (tree
`9b0d9bef560cc4ea441c142839f772004de5275a`), refreshed on 2026-10-10. The
audited `f875d31` was no longer current.

## Why one child

The provider port, the received-money facts, their allocation to claims and the
refunds share one aggregate (the provider credit), one migration and one set of
COMMIT-time ledger checks. Splitting them would have forced a refund PR stacked
on an unmerged credit PR, which the execution contract forbids.

## What changed in behaviour (please review)

1. **A reviewer can no longer mark a payment MATCHED.** P02-B1 let Finance press
   `MATCHED` with an observed amount, with no recorded evidence and no second
   person. That path now answers `409 PROVIDER_CREDIT_REQUIRED`. Money is
   recognised only by **allocating a confirmed provider credit** to the claim
   that carries its reference. `MISMATCHED` and `UNKNOWN` decisions are unchanged.
2. **Main had a defect that blocked every Billing write.** Commit `5503125`
   (on main) revoked PUBLIC EXECUTE on the `billing_assert_*` helpers, but the
   COMMIT-time trigger functions call them as the runtime role, so creating an
   obligation, collecting cash or posting any journal failed with
   `permission denied for function billing_assert_*`. Reproduced on main with
   `node scripts/production/B/postgres-acceptance.mjs --service billing`. The
   P04-B migration makes those four trigger functions `SECURITY DEFINER` (pinned
   `search_path`, `pg_temp` last, read-only, cannot be called directly); the
   helpers stay revoked from PUBLIC.

## Model

### Provider port and capabilities (`ports/provider.ports.ts`)

Each `PaymentProviderAdapter` declares `ProviderCapabilities`:

| Capability | Meaning |
| --- | --- |
| `notifications` | authenticated push of final credits (signature/replay window computed by the adapter over the exact received bytes) |
| `creditQuery` | authenticated pull of one transaction by reference |
| `refunds` | `PROVIDER_API` only if the provider's refund API treats Billing's refund id as its idempotency key; otherwise `MANUAL_OUT_OF_BAND` |
| `statementEvidence` | Finance may record a credit read from the merchant's own statement |

Billing never calls an undeclared operation (`PROVIDER_CAPABILITY_MISSING`, or
404 for the callback route). Network calls never happen inside a database
transaction; an unknowable answer is `UNKNOWN`, never success.

### ShamCash and Syriatel Cash adapters (`infrastructure/providers/merchant-providers.ts`)

Both are `DocumentationPendingProvider`: `statementEvidence = true`,
`refunds = MANUAL_OUT_OF_BAND`, `notifications = false`, `creditQuery = false`,
`integration = OFFICIAL_DOCUMENTATION_PENDING`. No endpoint, signature scheme or
payload is guessed and no unofficial or reverse-engineered API is used
(`docs/parallel/B/W05/PROVIDER_CAPABILITIES.md`). Configuration:

- `BILLING_<PROVIDER>_MERCHANT_ACCOUNTS`: the company's receiving accounts.
  Unset means **no** account is accepted (fail closed).
- Any automation setting (`_API_ORIGIN`, `_API_KEY`, `_API_SECRET`,
  `_WEBHOOK_SECRET`, `_CLIENT_ID`, or their `_FILE` forms) **fails startup** with
  `<PREFIX>_AUTOMATION_NOT_IMPLEMENTED` instead of being silently ignored.
- `SecretValue` (for future official adapters) reads secrets from mounted files
  only, refuses inline env values, caps size, and renders `[redacted]` in every
  string/JSON/inspect form.
- `GET /providers` returns redacted diagnostics: capabilities, integration
  state, account count and a 12-hex fingerprint. It never returns accounts or
  secret values.

### Provider credits (`domain/provider.ts`, table `provider_credit`)

A credit is money a provider independently reports in one of our merchant
accounts. Unique key: (provider, merchant account, normalised reference) among
non-rejected credits.

| Source | Established when |
| --- | --- |
| `PROVIDER_NOTIFICATION` | the adapter authenticates it (no Identity session) |
| `PROVIDER_QUERY` | Finance asks the provider about one claim and the adapter returns a final credit |
| `MERCHANT_STATEMENT` | recorded by one `billing.reconcile` holder (`PENDING_APPROVAL`, no financial effect) and **approved by another** |

On establishment it is allocated in the same transaction if it settles a claim:
an open claim (`PENDING_REVIEW` or `UNKNOWN`) with the same provider and
reference, on the active `UNDER_REVIEW` intent of an `OPEN` obligation, same
currency, **exactly** the outstanding (= claimed) amount, and no refund reserved
against it. Otherwise it stays `UNALLOCATED` with one of `NO_CLAIM`,
`CLAIM_CLOSED`, `OBLIGATION_NOT_OPEN`, `CURRENCY_MISMATCH`, `AMOUNT_MISMATCH`,
`REFUND_RESERVED`. Received money is never erased.

- **Late claim.** A credit that arrived first is allocated when the customer
  reports its reference (same command).
- **Late arrival.** A credit for a closed claim or a settled/voided obligation
  stays visible unallocated money for refund. It is never re-applied silently.
- **Concurrency.** Claim submission and credit confirmation both take a
  transaction-scoped advisory lock on (provider, reference), so two concurrent
  writers can never both miss each other. Proven on real PostgreSQL across
  replicas.
- **Replay protection.**
  - The adapter rejects stale timestamps and bad signatures.
  - Billing's natural key makes an identical replay a no-op (`200 duplicate`).
  - A notification with different facts for a recorded reference is refused
    (`409 PROVIDER_CREDIT_CONFLICT`).
- **Separation of duties.**
  - Statement recorder ≠ approver.
  - Neither the recorder nor the approver/trigger may own the obligation.
  - Only staff accounts may act; guests are refused.

### Refunds (`domain/refund.ts`, table `payment_refund`)

1. A `billing.refund` holder requests a refund against a confirmed credit:
   - an `ALLOCATED` credit takes `SERVICE_NOT_DELIVERED` or `BOOKING_CANCELLED`;
   - an `UNALLOCATED` credit takes `DUPLICATE_PAYMENT` or `UNALLOCATABLE_CREDIT`.

   The amount is **reserved** immediately. The sum of `REQUESTED`, `APPROVED`,
   `SUBMITTED`, `UNKNOWN` and `SUCCEEDED` refunds never exceeds the credit,
   enforced by the application, by the insert guard (which locks the credit row)
   and at COMMIT.
2. A different person approves or rejects it.
3. Execution depends on the channel:
   - **`PROVIDER_API`:** `POST /refunds/:id/provider-execution` submits an
     `APPROVED` refund, or asks for the status of a `SUBMITTED`/`UNKNOWN` one.
     The refund id is the provider's idempotency key, so a retry after a lost
     answer pays at most once. Outcomes:
     - `PENDING` → `SUBMITTED`;
     - timeout, transport error or unreadable answer → `UNKNOWN` (the
       reservation is kept);
     - `SUCCEEDED` / `FAILED`.
   - **`MANUAL_OUT_OF_BAND`:** a person other than the requester records
     `SUCCEEDED`, with the transfer reference (unique per provider) and the
     SHA-256 of the evidence, or `FAILED`.
4. Only `SUCCEEDED` posts `REFUND_PAID`. `FAILED` and `REJECTED` release the
   reservation. The original credit and its journals are never edited.

Customer-facing status:
- `PARTIALLY_REFUNDED` / `REFUNDED`, only after completion; a requested refund
  is still `PAID`.
- Cash refunds are out of scope: they need disbursement and custody authority
  (owner decisions B-06/B-07), and they are refused because a cash receipt is
  not a provider credit.

### Ledger (technical, provisional chart; no revenue/tax, B-04/B-06)

| Journal | Scope | Lines |
| --- | --- | --- |
| `CREDIT_RECEIVED` | credit | Dr `CLEARING_<PROVIDER>` / Cr `PROVIDER_CREDITS_UNALLOCATED` |
| `CREDIT_ALLOCATED` | obligation + credit | Dr `PROVIDER_CREDITS_UNALLOCATED` / Cr `CUSTOMER_RECEIVABLE` |
| `REFUND_PAID` | credit | Dr `REFUNDS_CONTROL` (allocated) or `PROVIDER_CREDITS_UNALLOCATED` (unallocated) / Cr `CLEARING_<PROVIDER>` |

## Database-enforced invariants (migration `20261010100000_p04b_provider_credits_refunds`)

- **Unique keys:**
  - one effective credit per provider/merchant/reference;
  - one credit per attempt;
  - one attempt per credit;
  - one refund per provider refund reference.
- **Credit guards:**
  - money facts are immutable;
  - allowed transitions are `PENDING_APPROVAL → REJECTED | UNALLOCATED | ALLOCATED`
    and `UNALLOCATED → ALLOCATED`;
  - a statement credit cannot be inserted already established;
  - CHECKs enforce the facts each status needs, decider ≠ recorder, and
    `occurred_at ≤ created_at`.
- **Attempt guard:** `MATCHED` requires a credit `ALLOCATED` to exactly this
  claim (provider, reference, currency and amount) written in the same
  transaction. The credit link is immutable.
- **Intent guard:** an electronic `UNDER_REVIEW → SUCCEEDED` requires a
  credit-matched attempt in the same transaction.
- **Refund guards:**
  - the insert guard locks the credit and enforces the reservation cap;
  - the transition table depends on the channel;
  - CHECKs enforce separation (decider/completer ≠ requester) and the evidence
    required for a manual success.
- **COMMIT-time `billing_assert_provider_credit`, per credit:**
  - net clearing = amount − refunded;
  - net unallocated = amount − refunded while `UNALLOCATED`, else 0;
  - net refunds control = refunded while `ALLOCATED`;
  - net receivable = amount while `ALLOCATED`;
  - reservations ≤ amount;
  - an allocated credit names the `MATCHED` attempt that names it back.

  It runs on every credit or refund change and on every credit-scoped journal,
  so a stray journal or a state change without its journal cannot commit.
- **Obligation ledger agreement** now also counts money applied from credits.
- **Append-only:** no delete or truncate on credits or refunds. The new and
  replaced functions are revoked from PUBLIC.

## Owner API (`/internal/v1/billing`, transport only)

| Route | Permission | Notes |
| --- | --- | --- |
| `GET providers` | `billing.read` | redacted diagnostics |
| `POST providers/:provider/notifications` | adapter authentication | 404 without the capability; 401 `NOTIFICATION_REJECTED`; body ≤ 16 KiB; answers only `{recorded}` |
| `POST provider-credits` | `billing.reconcile` | statement credit, `Idempotency-Key` |
| `GET provider-credits?status=&limit=` / `GET provider-credits/:id` | `billing.read` | references and accounts masked |
| `POST provider-credits/:id/decision` | `billing.reconcile` | `{expectedRevision, decision, rejectionReason}` |
| `POST payment-attempts/:id/provider-verification` | `billing.reconcile` | outcome `FOUND`, `PENDING`, `NOT_FOUND`, `UNKNOWN` or `WRONG_MERCHANT_ACCOUNT` |
| `POST provider-credits/:id/refunds` | `billing.refund` | `{expectedRevision, amount, reason}` |
| `GET refunds?status=&limit=` / `GET refunds/:id` | `billing.read` | |
| `POST refunds/:id/decision` | `billing.refund` | |
| `POST refunds/:id/provider-execution` | `billing.refund` | provider-API channel only |
| `POST refunds/:id/manual-completion` | `billing.refund` | `{expectedRevision, outcome, transferReference, evidenceDigest}` |

New error codes:

| Status | Codes |
| --- | --- |
| 401 | `NOTIFICATION_REJECTED` |
| 409 | `PROVIDER_CREDIT_REQUIRED`, `PROVIDER_CAPABILITY_MISSING`, `PROVIDER_CREDIT_CONFLICT`, `PROVIDER_CREDIT_ALREADY_RECORDED`, `PROVIDER_REFUND_REFERENCE_TAKEN`, `CREDIT_NOT_PENDING`, `CREDIT_NOT_CONFIRMED`, `CREDIT_NOT_REFUNDABLE`, `REFUND_NOT_REQUESTED`, `REFUND_NOT_EXECUTABLE`, `REFUND_NOT_PENDING_AT_PROVIDER`, `REFUND_CHANNEL_MISMATCH` |
| 422 | `MERCHANT_ACCOUNT_UNKNOWN`, `OCCURRED_IN_FUTURE`, `REFUND_REASON_NOT_ALLOWED`, `REFUND_CURRENCY_MISMATCH`, `REFUND_EXCEEDS_AVAILABLE` |

## Events (outbox, relay not started; proposed in CR-B-09)

`billing.provider-credit-changed.v1` and `billing.refund-changed.v1`, both
validated through the shared envelope v2 parser before being written.
- **Never in an event:** provider references, merchant accounts, evidence digests.
- **Actor:** the envelope actor is `system` for provider-caused changes.

## Test evidence

| Family | Command | Result |
| --- | --- | --- |
| Domain/unit (provider credits, refunds, events + P02/P03 domain) | `node --test services/billing/dist-tests/test/*.spec.js` | PASSED 54/54 (with the two rows below) |
| Provider adapter contract + config/secret isolation + fake signed adapter | `billing.provider.adapters.spec.ts` (same command) | PASSED |
| Nest composition: provider/refund routes mounted, 401/503 fail closed, callback 404, automation config fails startup | `billing.nest.spec.ts` | PASSED |
| **Real PostgreSQL 16.10**: runtime role, 4 replicas, races, triggers, ledger, upgrade sentinel | `node scripts/production/B/postgres-acceptance.mjs --service billing --record` | **PASSED 72/72** (24 new + 48 P02/P03), every phase, upgrade sentinel (cash collection + electronic claim settled by a credit), no drift; `evidence/billing-postgres-bf5a02261bfd.json` (source `bf5a022`, tree `646f65c`, clean) |
| Real RabbitMQ | — | **BLOCKED** (CR-B-05, CR-B-09.2) |
| **Live / sandbox ShamCash, Syriatel Cash** | — | **BLOCKED: `LIVE_PROVIDER_ACCEPTANCE`** (no official documents, credentials or sandbox) |
| Playwright / visual | — | **NOT APPLICABLE**: no UI change; refund and reconciliation screens are not designed |

**Real vs mocked.**

- **Real:** PostgreSQL, with separate migration and runtime roles.
- **Local HTTP doubles:** Identity and Pricing.
- **Production adapters:** ShamCash and Syriatel Cash, run on replicas A/B.
- **Deterministic `FakeSignedProvider`:** test-only, replicas C/D. Its HMAC
  scheme is invented for the double and is not any provider's protocol. It is
  never acceptance evidence for a real provider.

## Rollback / compensation

- **Code:** revert the PR. Note that this also restores the manual `MATCHED`
  path and loses the permission fix. Prefer a forward fix.
- **Schema, before any credit/refund row exists:** restore the P03-B1 function
  bodies and constraints, then drop the new objects in reverse order.
- **Schema, after rows exist:** a reviewed financial data plan and restore
  evidence are required.
- **Business compensation:**
  - wrong statement line → rejection;
  - unallocatable money → refund;
  - refund failure → `FAILED` (the reservation is released);
  - unknown provider outcome → `UNKNOWN` until the provider's answer resolves it.

## Remaining blockers (P04-B stays INTEGRATION_PENDING)

| ID | Blocker | Owner |
| --- | --- | --- |
| B-P04-01 | **LIVE_PROVIDER_ACCEPTANCE**: approved merchant documentation, credentials, sandbox/test facility and live acceptance for ShamCash and Syriatel Cash; then an official adapter declares notifications/query/refund-API | Owner + providers (external) |
| B-P04-02 | CR-B-09.2 event registration, relay and real RabbitMQ | E, then B |
| B-P04-03 | CR-B-09.3 `billing.v1` routes; the published `admin.refund` Gateway route does not match | E |
| B-P04-04 | CR-B-09.4 public callback ingress, secret delivery (only once B-P04-01 lands) | E |
| B-P04-05 | Owner decision B-06: refund policy (reasons, fees, partial refunds, cash refunds), manual-evidence retention, approval thresholds | Owner |
| B-P04-06 | Admin finance UI for credit/refund queues (not designed; not inferred) | Owner design, then D |
| B-P02-*, B-P03-* | Still open | E / C / Owner |

**Next consumers:**

- the admin finance console (credit approval, refund queues), after E's routes
  and an approved design;
- the Booking saga, which consumes `billing.refund-changed.v1` for cancellations
  after E registers it;
- an official provider adapter, after B-P04-01.
