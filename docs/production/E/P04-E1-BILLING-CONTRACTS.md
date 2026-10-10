# P04-E1 — `billing.v1` and Billing events

Parent: **P04-E** — harden provider security and certify P04 end-to-end
(parent status: **INTEGRATION_PENDING**).
Lane: E (Platform, Contracts, Gateway & Release).
Child: P04-E1. It publishes the wire contracts only. It contains no Gateway route,
no provider code and no runtime change.

## 1. What this publishes

| Artifact | Version | Status |
| --- | --- | --- |
| `@carwash/contracts` `billing.v1` (`./billing-v1`, `billingV1`) | 1 (package 0.2.0) | `published-provider-pending` |
| `@carwash/contracts` `common/payment-method` | additive | published |
| `RouteAccess` `provider-signed` | additive convention | published |
| `@carwash/event-contracts` `billing-v1` (6 events, envelope v2) | 1 (package 0.2.0) | `published-producer-pending` |
| `docs/contracts/billing.v1.openapi.json`, `docs/asyncapi/billing-events-v1.yaml` | generated from the built packages | checked by `check:contract-docs` |
| `architecture/contract-surface.lock.json` | additive (new contract, new events) | checked by `check:contract-surface` |

`booking.v1` is **not** part of this child. The earlier P02-E1 branch was never
opened as a PR and is stale against the merged Booking provider.

## 2. Conformance to the merged provider

The payment, void and cash-custody shapes follow what the merged Billing provider
already serves:

- P02-B1 (#106): obligations, intents, attempts and reconciliation.
- P03-B1 (#111): cash collection, custody, handover and settlement.

These are not copies of a proposal. `tests/production/E/contracts-billing.test.mjs`
transpiles the exact provider modules in this tree (`domain/*`, `ports/*`,
`application/views.ts`, `custody-views.ts`, `events.ts`, `custody-events.ts`)
with no edits. It renders each state and requires the published parsers to
accept it:

- every `financialStatus`: UNPAID, AWAITING_CASH, AWAITING_PAYMENT, UNDER_REVIEW,
  OUTCOME_UNKNOWN, PAID, CASH_COLLECTED and VOIDED, each in both the full and
  the lean view;
- reversed cash receipts, a reconciled handover with a shortage, holder
  positions, and the reconciliation report (consistent and inconsistent);
- all five outbox envelopes the provider writes today.

Differences from Lane B's CR-B-01 text, all following the merged code:

- `FinancialStatus` gains `CASH_COLLECTED`.
- `ObligationV1` gains `cashReceipt`.
- The masked reference alphabet follows the provider's normalisation.

## 3. Contract-first additions (no accepted provider yet)

### Refunds

Manual-review mode is the accepted production mode until a provider with a
refund API and a merchant agreement exists.

| Route | Access | Rule |
| --- | --- | --- |
| `POST /obligations/:obligationId/refunds` | `billing.refund` | Requires a SETTLED obligation. The amount must not exceed `verified − refunded − inFlight`. Of several concurrent over-requests, exactly one wins; the others get `409 REFUND_EXCEEDS_REFUNDABLE`. |
| `GET /obligations/:obligationId/refunds` | owner or `billing.read` | `refunded`, `inFlight` and `refundable` are derived from the items, and the parser checks them. |
| `GET /refunds/:refundId` | `billing.read` | — |
| `POST /refunds/:refundId/outcome` | `billing.reconcile`, never the requester (`SEPARATION_OF_DUTIES`) | SUCCEEDED requires a reference. FAILED and UNKNOWN carry none. UNKNOWN stays in flight and resolves later to SUCCEEDED or FAILED, never by a timeout. |

- REQUESTED and OUTCOME_UNKNOWN never mean the money went back.
- A refund does not change `financialStatus` in v1. Refunds are read explicitly.
- Refund views carry no staff subjects and only masked references.
- Reasons form a closed set. There is no free-text field.

### Provider notifications

`POST /provider-notifications/:provider`, with `provider` ∈ {`sham-cash`, `syriatel-cash`}.

- Access is `provider-signed`. The body is the provider's own format, and the
  owner verifies the signature over the exact raw bytes before parsing.
- De-duplication uses the signed notification id, because a provider cannot
  send an `Idempotency-Key`.
- The Gateway forwards only:
  - the raw body, up to 16 KiB;
  - the content type;
  - `x-provider-signature`, `x-provider-timestamp` and `x-provider-notification-id`.

  It never forwards cookies, bearer tokens or identity headers.
- Replay window: 300 s.
- Responses:
  - `204` for accepted or already-seen notifications;
  - `401` with `NOTIFICATION_SIGNATURE_INVALID` or `NOTIFICATION_STALE`;
  - `503` with `NOTIFICATION_PROVIDER_DISABLED` while no merchant configuration is active.
- A notification is a claim. It settles nothing without the same exact-amount
  rules as manual reconciliation.
- The real Sham Cash and Syriatel Cash signing schemes are **external
  blockers**: there is no official sandbox, documentation or merchant
  credentials. The route shape is fixed, and the scheme is the provider
  adapter's job.

### `provider-signed` route access

Before this change, `contractProblems` refused every unauthenticated mutation.
A `provider-signed` route must be a plain POST, with no idempotent, revisioned,
safe or paged flag. Every other unauthenticated mutation is still refused, and
the test suite asserts this.

## 4. Events (`washgo.billing.events`, routing key = event type)

| Event | Aggregate | Producer today |
| --- | --- | --- |
| `billing.obligation-created.v1` | `billing-obligation` | written to outbox (relay not started) |
| `billing.obligation-status-changed.v1` | `billing-obligation` | written to outbox |
| `billing.cash-collected.v1` | `billing-cash-receipt` | written to outbox |
| `billing.cash-collection-reversed.v1` | `billing-cash-receipt` | written to outbox |
| `billing.custody-handover-changed.v1` | `billing-custody-handover` | written to outbox |
| `billing.refund-status-changed.v1` | `billing-refund` | none (contract-first) |

Event data is closed, and money uses exact minor units. Events never carry a
provider, treasury or settlement reference, phone number, name or receipt image.
The parser accepts only legal refund transitions:

- `null → REQUESTED`;
- `REQUESTED → {SUCCEEDED, FAILED, OUTCOME_UNKNOWN}`;
- `OUTCOME_UNKNOWN → {SUCCEEDED, FAILED}`.

## 5. Evidence (this head)

| Family | Command | Result |
| --- | --- | --- |
| Billing contract + provider conformance | `node --test tests/production/E/contracts-billing.test.mjs` | PASSED 11/11 |
| Lane E contract suite + registry | `node --test tests/unit/x003-contract-registry.test.mjs tests/production/E/*.test.mjs` | PASSED 82/82 |
| Generated docs match code | `pnpm check:contract-docs` | PASSED (13 documents) |
| Surface lock (additive, reviewed) | `pnpm check:contract-surface` | PASSED |
| Typecheck of consumers | `tsc --noEmit` on `packages/api-clients` and `apps/api-gateway` | PASSED |
| Lint | `eslint packages/contracts/src packages/event-contracts/src tests/production/E scripts/production/E` | PASSED |
| Design lock | `node scripts/check-design-reference.mjs` | unchanged |
| Real provider HTTP / PostgreSQL / RabbitMQ for refunds and notifications | — | **BLOCKED**: no provider (Lane B, P04-B) |
| Live wallet provider | — | **BLOCKED (external)**: no sandbox, documentation or merchant credentials |

## 6. Requests and next consumers

- **Lane B (Billing):**
  - Implement refunds and provider notifications against these shapes.
  - Add `@carwash/contracts` and `@carwash/event-contracts` as dependencies in
    `services/billing/package.json` (CR-B-04). Lane E regenerates the lockfile in
    the same PR.
  - Replace the local mirrors with the published parsers.
  - Emit `traceparent` in outbox envelopes. Today it is `null`, which breaks
    HTTP → RabbitMQ trace continuity.
- **Lane E, next children:**
  - P04-E2: Gateway payment routes and the provider-ingress route kind.
  - P04-E3: shared service-scope and webhook-signature primitives, plus the
    CodeQL disposition.
  - P04-E4: P04 certification.
- **Lane A/C/D:** consume only this merged contract, for example the customer
  payment step, the technician cash collection, and the admin finance screens
  once those are designed.

## 7. Rollback

The change is additive. Revert the PR to remove the contract, the events and the
generated documents. No service imports them yet, so nothing at runtime depends
on them.
