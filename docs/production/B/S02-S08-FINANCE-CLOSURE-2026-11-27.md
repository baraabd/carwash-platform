# S02–S08 finance and entitlement implementation — 2026-11-27

This describes the implementation tranche on `implementation/s02-s12-closure-20261127`.
It is source and local diagnostic evidence, not production acceptance. The parent
closure record records the final commit, remote workflows, deployment, and operator evidence.

## Authority and ownership

Identity now issues the permissions used by the actual owners:
`pricing.prices.publish`, `billing.cash.correct`, and `billing.treasury.receive`.
Price publication remains a `super_admin` capability; financial correction and
treasury receipt use the finance role. The historical `pricing.publish` token is
retained for compatibility but cannot authorize the current publication endpoint.
The Billing and Wallet actor separation and four-eyes checks remain authoritative.
Role-grant tests cover all seven account roles, and the Identity HTTP acceptance
suite checks the permissions returned from real authentication.

## Pricing and subscription purchases

The canonical `subscription.v1` paths now have an owner implementation. Public
plans use UUID identities, immutable published versions and content hashes.
Historical administration records remain on explicitly named administration or
legacy reads; their slug identifiers are not silently presented as canonical plans.

Pricing owns `POST /internal/v1/pricing/subscription-quotes` and the corresponding
GET by quote ID. The request contains only the published plan ID and version.
Pricing reads the actual Subscription plan, copies its server price, and creates
an immutable, expiring, beneficiary-bound quote with durable idempotency. These
quotes have a separate surface from wash quotes and cannot pass Booking's wash
quote validation or reserve service capacity.

An authenticated account creates `POST /internal/v1/subscription/purchases` with
that quote. A durable local purchase precedes the Billing command. Fixed keys
recover a lost Billing create or payment-method response without making another
obligation. The purchase read resumes this already accepted workflow. Units remain
unavailable until Billing supplies independently verified funding; a UI status,
payment attempt, arbitrary payment reference, or bare `SETTLED` label is insufficient.
Cash on completion cannot prepay a subscription.

`GET /internal/v1/subscription/purchases/by-request/:idempotencyKey` recovers the
current purchase from the durable creation receipt scoped to the authenticated
account. A client can retain only the opaque key across reloads, without persisting
the financial command. Recovery returns current owner state and resumes the same
accepted Billing command if necessary. A missing receipt returns a non-enumerating
404; it does not prove that an in-flight create cannot still commit, so the client
must preserve its uncertain-request fence instead of creating a new purchase.

The service-only `POST /internal/v1/billing/subscription-funding/verify` requires
`billing.subscription-funding.read`. It rejects mixed human and workload credentials
and checks the account beneficiary, exact amount/currency/scale, settled obligation,
allocated provider credit, absence of a Booking binding, and absence of any pending,
unknown or succeeded refund reservation. The credit and obligation are locked in
the same order as refund processing. It is a read, not an instruction to charge.

Subscription activates a period, one GRANT movement, audit record, outbox record and
purchase state together under local row locks. Database uniqueness prevents reuse
of a quote, obligation or payment reference. Legacy staff activation and renewal
also require Billing funding evidence and cannot mutate canonical purchases.

### Eligibility and Booking use

The authenticated account can call
`POST /internal/v1/subscription/subscriptions/:id/eligibility` with package ID,
vehicle type and scheduled time. The response gives the owner's current revision,
eligibility and a closed refusal reason without reserving a unit.

Booking's workload commands use `/entitlement-reservations` and
`/:reservationId/resolution`. The provider checks the activated purchase, original
beneficiary, covered package/vehicle, funded service period, revision and available
units. Row locks serialize the last-unit race. Workload receipts and the natural
subscription/Booking key recover unknown results. Only the original reserving
workload may read or resolve the reservation. A canonical consumed unit cannot be
released or reversed through historical routes.

The reservation stays reserved across the scheduled service until Booking explicitly
releases it or reports actual completion. `expiresAt` describes the funded period;
there is no automatic expiry worker that could free a confirmed future booking.
Consumption can settle an already reserved unit after the period's wall-clock end.
An empty lookup is not proof that a timed-out reserve has failed. Booking must retry
the same reserve key to a definite outcome, then compensate the exact reservation.

Customer freeze/resume/cancel requests remain `PENDING_REVIEW`. A real
`subscription.manage` actor decides the request; a manager cannot decide their own
subscription. Freezing does not extend paid time, and cancellation does not create
an implicit monetary refund or cancel unrelated Booking work.

### Price publication editor contract

`GET /internal/v1/pricing/price-books/current` requires
`pricing.prices.publish` and returns either an explicit `UNPUBLISHED` state or the
complete current immutable book, including every entry. Its
`nextExpectedPriceBookRevision` is the revision to send on publication: initial 1,
then current plus 1. The existing POST receipt is described by
`PriceBookPublicationV1`; it contains publication metadata and the entry count,
not the complete book. Editors re-read the current book after publication.

Operations may read a wash quote for staff rescheduling, preserving its original
beneficiary. Billing independently compares that beneficiary with the authenticated
principal before creating an obligation, so operational read authority cannot
become authority to assign somebody else's quote to another account's debt.

## Support owner effects and recovery

Support cancellation calls Booking's current cancellation command. Rescheduling
requires a frozen, owner-verified Scheduling hold ID and revision, then calls the
current Booking reschedule command. Original customer identity remains derived
from the case and owner facts. Historical decisions lacking a hold fail closed.
Booking `IN_PROGRESS` retains Support `EXECUTING`; only a completed owner change
resolves the case.

Refund decisions use Billing's canonical obligation refund request and read the
durable refund's current outcome. The fixed request key is preserved across retries.
`REQUESTED` and `OUTCOME_UNKNOWN` remain pending; `SUCCEEDED` completes the Support
effect, and a confirmed failure remains rejected. Support never writes a payment
success or provider outcome. Recovery requires the original deciding/approving
human identity; another support session cannot inherit that authority. The existing
four-eyes policy applies to refund decisions.

`LATE_PAYMENT` accepts the canonical Billing refund reasons in addition to the
historical case reasons. The unambiguous historical `PAID_AFTER_CANCELLATION`
maps to `BOOKING_CANCELLED`; ambiguous historical reasons require an explicit
canonical refund reason. A malformed successful HTTP response is an unknown owner
outcome, not successful work.

## Deployment configuration

Existing Identity, database and TLS settings remain required. New owner connections
are:

| Runtime | Setting | Purpose |
| --- | --- | --- |
| Pricing | `SUBSCRIPTION_ORIGIN`, `SUBSCRIPTION_TIMEOUT_MS` | Read published Subscription plan versions for plan quotes. |
| Subscription | `SUBSCRIPTION_PRICING_ORIGIN` | Read the account's immutable plan quote. |
| Subscription | `SUBSCRIPTION_BILLING_ORIGIN`, `SUBSCRIPTION_BILLING_TIMEOUT_MS` | Create/read the account's obligation and verify funding. |
| Subscription | `SUBSCRIPTION_BILLING_CLIENT_ID`, `SUBSCRIPTION_BILLING_SERVICE_TOKEN` | Workload identity for funding evidence; no customer bearer is mixed into that request. |
| Billing workload registry | `billing.subscription-funding.read` for the Subscription client | Authorize the service-only evidence endpoint. |
| Subscription workload registry | `subscription.entitlement.reserve`, `subscription.entitlement.resolve`, `subscription.entitlement.read` for Booking | Reserve, recover and settle canonical covered bookings. |

Origins must satisfy the existing owner security policy; the new Subscription
clients require HTTPS outside loopback. Missing owner configuration or unavailable
authority returns an unavailable outcome and cannot activate paid entitlements.
The funding route is not a public Gateway route.

New migrations belong exclusively to their owners:

- Support `20261127090000_support_owner_commands`.
- Subscription `20261127093000_canonical_entitlement_commands`,
  `20261127094000_canonical_plan_coverage`, `20261127100000_subscription_purchases`,
  `20261127102000_subscription_change_requests`.
- Pricing `20261127101000_subscription_quotes`.

Apply owner migrations through the existing migration deployment gate. Do not use
schema push, reset, or a shared cross-service Prisma client.

## Verification and remaining acceptance

Local checks cover builds, runtime and adapter tests, contract/permission tests,
scoped lint, migration ownership/append-only guards and layer boundaries. The
additional PostgreSQL and end-to-end cases are compiled for the repository's real
infrastructure acceptance runners:

- `services/subscription/test/integration/subscription.canonical.postgres.spec.ts`:
  immutable publication/replay, lost Billing reply, exactly-once funded activation,
  cross-replica unit races, legacy bypass refusal, human change approval and database guards.
- `services/pricing/test/integration/subscription-quotes.postgres.spec.ts`:
  immutable quote storage, durable idempotency and two-replica races.
- Billing PostgreSQL suites: foreign quote ownership and rejection of pending,
  unknown or completed refund amounts as Subscription funding.
- `tests/production/D/support-exception-cases.test.mjs`: real owner cancellation,
  hold-based rescheduling, approved refund request, original-actor recovery and
  independent Billing outcome.

Local execution without PostgreSQL/RabbitMQ does not establish those integration
outcomes. Final CI, browser acceptance, staging smoke, source provenance, restoration,
merchant onboarding and production sign-off remain separate gates.

## Explicit limits

Funding verification is point-in-time evidence. This tranche does not introduce an
atomic cross-owner funding claim or automatic entitlement revocation after a later
Billing refund. Production refund procedures must coordinate the relevant owner
states; this record does not claim that orchestration is complete.

Canonical renewal has no newly invented pricing or automatic-renewal policy.
Historical renewal cannot rewrite a canonical purchase's immutable funding binding.
Subscription-covered rescheduling requires a coordinated reservation change;
the Booking owner currently refuses that unsupported path explicitly.

Unallocated late provider credits are not allocated obligation refunds. Billing has
a separate provider-credit refund workflow; the Support obligation-refund adapter
does not silently treat those two workflows as equivalent. Merchant API details,
credentials and production financial verification remain evidence supplied by the
real provider integration, never fabricated by local tests.

This tranche does not add a customer stored-value wallet or claim that every finance
outbox has a running publisher. Existing cash custody remains its own Wallet domain;
the runtime and release closure record must prove the deployed consumers separately.
