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

### Durable funding claim and refund exclusion

Billing owns `POST /internal/v1/billing/subscription-funding/claims`, requiring
`billing.subscription-funding.claim`, and
`POST /internal/v1/billing/subscription-funding/subscriptions/:id/release`, requiring
`billing.subscription-funding.release`. Both require a valid `Idempotency-Key`.
Subscription sends deterministic keys per subscription/period and per cancellation.
Billing stores an immutable workload/operation/key/request binding; another payload
under that key is rejected. Replays re-read the current funding fence rather than
reusing a positive proof after release or making a prepayment refusal permanent.

The claim binds one settled obligation and allocated provider credit to one
Subscription identity, beneficiary and period. Amount, currency, quote and account
must match the owner records exactly, with no Booking binding or refund that has
reserved or returned money. The same credit row lock serializes the claim and every
refund path. An additional database trigger refuses a new or advanced refund while
the claim remains active, including direct runtime SQL and historical refund APIs.
A funded period cannot share its obligation or credit with another subscription.
The older `/subscription-funding/verify` endpoint remains a diagnostic read and is
not sufficient to authorize a grant or consumption.

Subscription activates a period, one GRANT movement, audit record, outbox record and
purchase state together under local row locks, only after acquiring that durable
claim. A lost claim reply or rolled-back Subscription transaction is retried with
the same claim identity. Existing persisted periods also reacquire/check their
period's exact claim before eligibility, a new reservation, or consumption. If a
historical period cannot prove its funding, use fails closed; releasing a reservation
remains available to unwind work. Legacy staff activation and renewal now acquire
claims and cannot mutate a canonical purchase.

### Manual renewal is a separate purchase for the next period

The account owner calls
`POST /internal/v1/subscription/subscriptions/:id/renewals` with a new plan quote,
plan ID/version, exact total, payment method and `expectedRevision`. Only an ended
ACTIVE period may renew, following the existing no-overlap/no-rollover policy.
Outstanding reservations from an earlier period remain settleable; they do not
transfer units into the next period.

Renewal creates a new durable Purchase, fresh Pricing quote binding, separate Billing
obligation and separate claim for the next period. Published terms are captured by
that Purchase and cannot be rewritten by later plan publication. Activation advances
the subscription's current period and terms once; pending renewal does not hide the
previous activated purchase. `PurchaseV1.renewalOf` identifies the original
subscription and intended period even while payment is pending. The ordinary
`purchases/by-request/:key` recovery path returns the same identity after reload or
an unknown Billing/claim response. `SubscriptionV1.periodNo` and the owner-computed
`renewalAvailable` distinguish an ended active period from an ended frozen one.
There is no automatic debit, automatic renewal or staff-created settlement.

### Cancellation and durable release recovery

Cancellation is irreversible and enqueues `subscription_funding_release` in the same
local transaction, including historical cancellation paths and already cancelled
records backfilled by migration. The dedicated `start:funding-recovery` process
claims durable leases only for CANCELLED subscriptions with **no reserved units in
any period**. It calls Billing's release command; Billing persists a namespace
tombstone even if a claim has not arrived yet. A late activation claim therefore
cannot pass cancellation. Releasing this fence does not issue a refund: Finance
must still apply the independent authorization, amount and four-eyes rules.

Lost responses and transient errors retain the durable work item and retry with a
bounded delay. Lease completion requires the same worker, monotonically increasing
acquisition and unexpired lease; an expired worker cannot mark a newer attempt done.
After the retry budget is exhausted, the owner reports `ATTENTION_REQUIRED`.
`GET /internal/v1/subscription/administration/funding-recovery` requires
`subscription.manage` and exposes only subscription ID, attempt count/budget,
remaining reserved units, status and timestamps. Its
`POST /:subscriptionId/retry` action uses `{expectedAttempts}` and an idempotency key;
it atomically extends the retry budget and appends an audit record without resetting
acquisitions, clearing the Billing fence or manufacturing a successful release.

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
| Subscription | `SUBSCRIPTION_BILLING_ORIGIN`, `SUBSCRIPTION_BILLING_TIMEOUT_MS` | Create/read the account's obligation and claim/release funding. |
| Subscription | `SUBSCRIPTION_BILLING_CLIENT_ID`, `SUBSCRIPTION_BILLING_SERVICE_TOKEN` | Workload identity for funding evidence; no customer bearer is mixed into that request. |
| Billing workload registry | `billing.subscription-funding.read`, `billing.subscription-funding.claim`, `billing.subscription-funding.release` for the Subscription client | Authorize diagnostic evidence and durable claim/release commands. |
| Subscription workload registry | `subscription.entitlement.reserve`, `subscription.entitlement.resolve`, `subscription.entitlement.read` for Booking | Reserve, recover and settle canonical covered bookings. |

Origins must satisfy the shared owner transport security policy. Missing owner configuration or unavailable
authority returns an unavailable outcome and cannot activate paid entitlements.
Funding evidence and mutation routes are private owner-to-owner routes; no public Gateway alias exposes them.
Run `node dist/workers/funding.main.js` (package `start:funding-recovery`) as an
independent Subscription worker with the same database and Billing workload settings.
The worker requires explicit configuration, drains bounded in-flight work on signals,
and leaves unknown outcomes in its durable queue. HTTP service startup does not
automatically start this worker.

`infra/runtime-processes.json` now inventories every standalone owner worker,
including this process, as **desired-not-deployed** configuration. It binds workers
to their owner's runtime image, distinguishes the repository working directory
from the image's `/app`, and requires disabling the image's inherited API HTTP
healthcheck. Worker deployments require process supervision and role-specific
queue/lease/progress alerts. The observed Railway inventory is unchanged; the
manifest and its completeness test do not establish that any worker is deployed.

New migrations belong exclusively to their owners:

- Support `20261127090000_support_owner_commands`.
- Subscription `20261127093000_canonical_entitlement_commands`,
  `20261127094000_canonical_plan_coverage`, `20261127100000_subscription_purchases`,
  `20261127102000_subscription_change_requests`,
  `20261127111000_funding_release_recovery`,
  `20261127112000_canonical_renewal_purchases`.
- Billing `20261127110000_subscription_funding_claims`.
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
  cross-replica unit races, legacy bypass refusal, human change approval and database guards;
  fresh renewal purchases/obligations/periods, lost claim replies, historical funding
  checks, all-period reservation drain, durable release retries and audited redrive.
- `services/pricing/test/integration/subscription-quotes.postgres.spec.ts`:
  immutable quote storage, durable idempotency and two-replica races.
- Billing PostgreSQL suites: foreign quote ownership and rejection of pending,
  unknown or completed refund amounts as Subscription funding, durable claim/refund
  races across replicas, runtime SQL refund fences, cancellation tombstones and
  idempotency-key binding.
- `tests/production/D/support-exception-cases.test.mjs`: real owner cancellation,
  hold-based rescheduling, approved refund request, original-actor recovery and
  independent Billing outcome.

The continuation executed the owner suites against an isolated PostgreSQL 16.16
server using fresh owner migrations and restricted runtime roles:

| Scope | Observed local result |
| --- | --- |
| Billing runtime/adapter suite | 89 passed, no failures/skips |
| Billing PostgreSQL refund/funding suite | 16 passed, no failures/skips |
| Subscription runtime/adapter suite | 27 passed, no failures/skips |
| Subscription PostgreSQL suites | 21 passed, no failures/skips |
| Billing–Subscription HTTP funding process acceptance | 1 passed, no failures/skips, also after all 21 Subscription PostgreSQL cases in the same databases |
| Pricing runtime/adapter suite | 67 passed, no failures/skips |
| Pricing PostgreSQL suites | 23 passed, no failures/skips |
| Prisma schema mirrors | Billing, Subscription and Pricing match the migrated databases |
| Scope lint and design-reference preservation | Passed; all 10 frozen artifacts preserved |
| Runtime inventory/static CI coverage | 4 passed, including all 18 worker entrypoints |

These runs used the modified worktree, explicit Identity/provider boundary doubles
and an injected clock; they are local owner diagnostics, not an exact-commit CI or
a real merchant, broker, browser or deployment acceptance.

The focused process case in `tests/production/B/subscription-funding-http.pg.test.mjs`
runs real Billing and Subscription HTTP adapters and restricted owner databases.
Test provider evidence is recorded and approved through Billing's owner APIs,
then Subscription's production client acquires the durable claim. It verifies
the deterministic `Idempotency-Key`, workload-only authentication, conflicting
replay refusal and refund exclusion. The compiled funding worker is launched
from the declared process command with only its own runtime database and Billing
workload credential. A transparent test proxy drops one reply after Billing has
committed release; the test stops and restarts the worker, proves durable retry
and one Billing command receipt, refuses late grant replay, and allows a refund
request only after release. Identity/Pricing and statement evidence remain
explicit fixtures. The existing `b-subscription` CI family now provisions the
separate Billing peer database and runs this case after the owner suites.

Final CI, browser acceptance, staging smoke, source provenance, restoration,
merchant onboarding and production sign-off remain separate gates.

## Explicit limits

The durable Billing claim excludes refunds until the Subscription owner has
cancelled the subscription and drained every outstanding reservation. This is an
explicit recoverable cross-owner protocol, not a shared database transaction. The
release worker must be deployed and monitored; HTTP availability alone cannot
prove recovery is operating. Historical periods are denied new use if Billing
cannot establish their exact claim; a pre-existing financial inconsistency is not
silently repaired or declared paid.

Manual canonical renewal retains the approved expired-period/no-rollover policy.
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

The additional Billing obligation-to-Reporting implementation and its independent
PostgreSQL/broker acceptance are described in
`S07-BILLING-REPORTING-CASH-2026-11-27.md`. It publishes only the two canonical
obligation event types to the existing cash KPI projection. Actual deployment
and current-source broker acceptance must still be recorded separately.
