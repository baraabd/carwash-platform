# P05-E1 — advanced product contracts

Parent: **P05-E**, which certifies advanced product contracts, privacy and recovery semantics.
The parent's status is **INTEGRATION_PENDING**.
Lane: E (Platform, Contracts, Gateway & Release).
Child: P05-E1. It publishes wire contracts, events, generated documents and the
route-access convention. The Identity privacy contract (`privacy.v1`) ships with its
provider in P05-E2, so neither child is stacked on the other. It adds no provider, no migration, no Gateway route and no
runtime behaviour. The only runtime-reachable change is the Gateway reason lookup in §5.

Base: `origin/main` `66aa7528500a06f65a4b73305506feee7c3fc3b3`
(tree `3a2203e360a534dc3f98529717a7625257aaccd0`).

## 1. What this publishes

| Artifact | Owner (lane) | Provider today | Status |
| --- | --- | --- | --- |
| `subscription.v1` (`./subscription-v1`, `subscriptionV1`) | Subscription (B) | foundation shell (503) | `published-provider-pending` |
| `promotion.v1` (`./promotion-v1`, `promotionV1`), prefix `/internal/v1/pricing` | Pricing (B) | none | `published-provider-pending` |
| `support.v1` (`./support-v1`, `supportV1`) | Support (D) | open PR #126 (P04-D1) | `published-provider-pending` |
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
- **Support** (from PR #126).
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

`tests/production/E/contracts-product.test.mjs` contains 16 tests, all executed against the
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

Commands on the final tree: see the PR description. Existing Lane E suites: 93 of 93 passing.

## 4. Requests to other lanes (submitted by E)

| ID | Lane | Request |
| --- | --- | --- |
| CR-E-P05-01 | D (P05-D1 / PR #126) | Once #126 merges, Lane E adds a transpiled provider-conformance test like the reporting one. Until then support.v1 is checked by fixture against #126 head `89d9492`. Any change to the #126 views requires a contract change. |
| CR-E-P05-02 | D (P05-D2) | The Reviews provider implements `reviews.v1` exactly: consent and moderation invariants, one review per Booking, no comment in events. Moderation uses `reviews.moderate`; P05-E2 grants it to the `support` role. |
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
