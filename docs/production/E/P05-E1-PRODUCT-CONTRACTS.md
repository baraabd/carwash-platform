# P05-E1 — advanced product contracts

Parent: **P05-E**, which certifies advanced product contracts, privacy and recovery semantics.
The parent's status is **INTEGRATION_PENDING**.
Lane: E (Platform, Contracts, Gateway & Release).
Child: P05-E1. It publishes wire contracts, events, generated documents and the
route-access convention. The Identity privacy contract (`privacy.v1`) ships with its
provider in P05-E2, so neither child is stacked on the other. It adds no provider, no migration, no Gateway route and no
runtime behaviour. The only runtime-reachable change is the Gateway reason lookup in §5.

Base: `origin/main` `3e1ab23` (after #124–#127 merged; first drafted on `66aa752`).

## 1. What this publishes

| Artifact | Owner (lane) | Provider today | Status |
| --- | --- | --- | --- |
| `subscription.v1` (`./subscription-v1`, `subscriptionV1`) | Subscription (B) | foundation shell (503) | `published-provider-pending` |
| `promotion.v1` (`./promotion-v1`, `promotionV1`), prefix `/internal/v1/pricing` | Pricing (B) | none | `published-provider-pending` |
| `support.v1` (`./support-v1`, `supportV1`) | Support (D) | **merged** PR #126 (P04-D1) | conformance tested (§3) |
| `reviews.v1` (`./reviews-v1`, `reviewsV1`) | Reviews (D) | foundation shell; P05-D2 to conform | `published-provider-pending` |
| `reporting.v1` (`./reporting-v1`, `reportingV1`) | Reporting (D) | **merged** operations projections | conformance tested (§3) |
| `IDENTITY_PERMISSIONS` `reviews.moderate` | Identity (E) | role grant in P05-E2 | additive |
| `RouteAccess` `permission:<a>\|<b>` (any of ≤ 4) and `routePermissions()` | E | — | additive convention |
| `contractsOf(owner)` | E | — | additive |
| `@carwash/event-contracts` `product-v1` (7 events) | B/D producers | none merged | `published-producer-pending` |
| `docs/contracts/{subscription,promotion,support,reviews,reporting}.v1.openapi.json`, `docs/asyncapi/product-events-v1.yaml` | generated | — | `check:contract-docs` |
| `architecture/contract-surface.lock.json` | additive only | — | `check:contract-surface` |

The package versions stay at `0.1.0`. Bumping a version triggers F001 "shared version drift".
The api-clients surface is generated from the contract metadata. `callRoute` reads route,
method, idempotency and revision rules from each descriptor, so the new contracts need no
hand-written client and no forked DTO.

`architecture/service-catalog.json` still lists the F001 planning event names, for example
`support.case-resolved.v1`. This follows the P04-E1 precedent, where the billing events
were not edited there either. The registry in `@carwash/event-contracts` is the
authoritative list.

## 2. Semantics fixed on the wire

Each rule below is enforced by a parser, so a provider that breaks it fails its consumer's parse.

- **Subscription.**
  - A purchase is `ACTIVATED` exactly when it has a `subscriptionId`.
  - Activation, review and unknown outcomes all require a Billing `obligationId`.
  - `PAYMENT_UNKNOWN` is never a subscription.
  - The parser recomputes the units (`available = total − reserved − consumed`, never
    negative). `EXHAUSTED` holds exactly when every unit is consumed.
  - A change result with status `APPLIED` must show the new state. `PENDING_REVIEW`
    leaves the subscription unchanged, because a requested cancellation is not a
    cancelled subscription.
  - A reservation resolves once and is bound to one Booking.
  - Cancellation never refunds money. A refund is a separate Billing fact.
- **Promotion.**
  - The eligibility check is `safe` and consumes no quota.
  - `UNAVAILABLE` is never `INELIGIBLE` and never a zero discount.
  - A promotion quote is a *new* immutable Pricing quote with exactly one `DISCOUNT` line.
  - The client never sends a discount, a percentage or a total.
  - `REDEEMED` is final.
  - Ineligibility reasons never reveal another beneficiary's usage or a campaign counter.
- **Support** (merged PR #126).
  - The route set, closed enums, kind-to-subject binding and request bodies match the provider.
  - On the wire, an approval is never by the person who decided (`SAME_PERSON_APPROVAL`).
  - A decision that left the pre-execution states must name its frozen owner command.
  - Decisions are numbered sequentially.
  - Free text (summary and notes) stays in staff views only.
  - Customer complaint intake is **not** in this contract. No approved customer screen or
    owner flow exists for it (DESIGN_LOCK §7), so it stays listed as pending.
- **Reviews.**
  - A review is for a verified service: the author is the Booking's own principal, and
    the Booking must be complete.
  - Publishing needs both the author's consent and a moderation decision.
  - Without consent the review stays `PRIVATE`.
  - `PUBLISHED` requires the reason `MEETS_GUIDELINES`.
  - The comment never appears in events.
- **Reporting.**
  - Every response is labelled `derived` and carries the authority list and per-source freshness.
  - `NO_DATA` means exactly "no checkpoint".
  - The window is at most 31 days.
  - The cash-state vocabulary is Billing's. Reporting is never a payment fact.

## 3. Evidence

`tests/production/E/contracts-product.test.mjs` contains 17 tests, all executed against the
built packages:

- lint, registry and honest status for all five contracts;
- no method+path collision between contracts of the same owner (pricing/promotion);
- the any-of access grammar, with negative controls for duplicates, more than four
  permissions, an empty alternative and `service:` any-of;
- every staff permission named by the new contracts is published by Identity;
- positive and negative parser cases for each contract and the events;
- **reporting provider conformance:** `OperationsController` from this tree is transpiled
  by `ts-module-loader.mjs` and run with Nest decorators stubbed and the real service-kit
  error, correlation and logging modules. Domain-built freshness rows are fed through it.
  All six responses must parse under `reporting.v1`. The provider's own `OPERATIONS_READS`
  must equal the published any-of permission sets.
- **support provider conformance:** the merged `CasesController` is run the same way, using
  records built with the provider's own domain functions (`caseSubject`, `reason`,
  `evidenceList`, `exactAmount`, `ownerCommandKey`). All seven routes, including `current`,
  must parse under `support.v1`. The provider's enums and kind-to-subject map must equal the
  published ones. Its outbox rows (`caseOpenedEvent`, `caseStatusChangedEvent`) must parse
  under the published events and exchange.

Commands and results on the final tree are listed in the PR description.

## 4. Requests to other lanes (submitted by E)

| ID | Lane | Request |
| --- | --- | --- |
| CR-E-P05-01 | D (Support) | Done for the merged #126 views; any later view change needs a `support.v1` change, and the conformance test fails until it has one. Customer complaint intake needs an approved design and owner flow before a contract exists. |
| CR-E-P05-02 | D (P05-D2) | The Reviews provider implements `reviews.v1` exactly: consent and moderation invariants, one review per Booking, no comment in events. Moderation uses `reviews.moderate`. Following decision E-P03-D1, it is held only by `super-admin` until the owner approves a narrower staff role (decision E-P05-D1). |
| CR-E-P05-03 | D (P05-D5) | The merged Configuration provider is a generic key/value store. Its routes (`values/:namespace/:key`, `revisions`) do not match the published `configuration.v1` (`scopes/:marketId/:namespace/current`, drafts). Reads require a human `configuration.read` session, and no service scope exists, so no owner can read approved policy service-to-service today. P05-D5 must conform to `configuration.v1`. |
| CR-E-P05-04 | D (Reporting) | Reporting's `CashState` omits Billing's `CASH_COLLECTED` (billing.v1, P03-B1). A `billing.cash-collected.v1`/status-changed fact with that value has no Reporting representation. `reporting.v1` already accepts the full Billing vocabulary. |
| CR-E-P05-05 | B | The Subscription provider implements `subscription.v1`, and the Pricing provider implements `promotion.v1`. Plans, units, validity, budgets and stacking are B/product policy inputs; none are fixed here. |

## 5. Gateway change

`publishedReason` now considers the reasons of **every** contract the owner serves
(`contractsOf`). Before this change only the first contract per owner was consulted, so
`promotion.v1` reasons from Pricing would have been reduced to a bare `CONFLICT`. No new
route was added. Gateway routes for privacy ship in P05-E2; routes for the other new
contracts (P05-E3) wait until this child merges.

## 6. Rollback

The change is additive. Reverting the merge commit removes the new exports, documents and
lock entries. No consumer depends on them on `main`.
