# S02 / S06 owner runtime closure — 2026-11-27

## Scope and acceptance boundary

This change implements persistent runtime composition for Booking, Dispatch,
Scheduling and Workforce, with native owner publications consumed by Reporting
and Communications. It does not set `BUSINESS_READY=true`, certify a hosted
Staging environment, or authorize production traffic. Release acceptance must
bind the committed source, migrated owner databases, scoped credentials, broker
topology and actual deployed processes to the test evidence.

Each service has an HTTP process (`node dist/main.js`) and a separate worker
process (`node dist/workers/runtime.main.js`, package script `start:worker`). The
HTTP process never starts the consumers or background relays. Worker replicas
compete for service-owned queues and fenced owner database leases.

| Worker | Real responsibilities |
| --- | --- |
| Scheduling | Publish its hold-change outbox; expire due holds; purge old completed idempotency records. |
| Workforce | Publish eligibility changes and legacy shift updates without rewriting existing payloads. |
| Dispatch | Consume Scheduling holds and Workforce eligibility; publish assignment/task/cash events; expire offers; deliver evidence fences; run bounded automatic offers. |
| Booking | Advance creation/change sagas; publish booking events; consume authoritative Dispatch execution; consume reserved subscription units after actual completion. |
| Reporting | Consume native booking, assignment, cash-declaration, hold, eligibility and shift events; commit source-versioned projections with each inbox receipt. |
| Communications | Consume native booking confirmation/cancellation; persist a namespaced notification intent or cancellation fence with each inbox receipt. No provider submission occurs in this consumer. |

Reporting runs `node dist/inbox/operations-consumer.runner.js`; Communications
runs `node dist/inbox/event-notifications-consumer.runner.js`. Their provider
delivery process remains separate from event intake.

`SIGTERM` / `SIGINT` abort the group, stop consumers, drain in-flight effects,
close broker sessions, then disconnect the database and telemetry. An unexpected
loop failure aborts and drains its siblings. HTTP reads are bounded and occur
before projection transactions. No cross-owner SQL or source imports are used.

## Broker ownership, delivery and retry

| Queue | Owner | Source binding | Quorum delivery limit |
| --- | --- | --- | --- |
| `dispatch.scheduling.hold-changed` | Dispatch | `scheduling.events` / `scheduling.hold-changed.v1` | 30 |
| `dispatch.workforce.eligibility-changed` | Dispatch | `workforce.events` / `workforce.eligibility-changed.v1` | 30 |
| `booking.dispatch.execution` | Booking | `dispatch.events` / `dispatch.assignment-changed.v1`, `dispatch.task-progressed.v1` | 120 |
| `reporting.operations` | Reporting | Exact bindings on Booking, Dispatch, Scheduling and Workforce exchanges, declared by `OPERATIONS_SUBSCRIPTIONS` | 3 |
| `communications.event-notifications` | Communications | `booking.events` / `booking.created.v1`, `booking.cancelled.v1`, legacy `booking.confirmed.v1` | 3 |

Subscriber processes configure only their own queues and `<owner>.dlx` /
`<owner>.dlq`. They bind to producer exchanges; they do not declare or publish to
foreign exchanges. Infrastructure must bootstrap producer exchanges and grant
the documented configure/write/read permissions. Queue names never contain a
replica id.

Outboxes use existing `SKIP LOCKED` leases and acquisition fences. Publication is
persistent, mandatory and confirm-based; an unroutable message stays failed and
is not marked published. The default worker batch is 20, confirm timeout 5 s,
lease 120 s, and maximum 100 acquisitions before dead-letter attention. The
shared loop refuses a lease that cannot cover the sequential confirm budget.
Database/broker outages retry with bounded backoff. Inbox effects use a 1 s
transient retry delay; RabbitMQ owns the durable delivery counter. Invalid
contracts and event-id/content conflicts are dead-lettered immediately.

Operators must alert on nonempty DLQs, dead outbox rows, oldest unpublished age,
exhausted automatic assignments and unconsumed entitlement rows. A reconnect is
not proof of message processing. Never reset fencing counters while redriving
failed work. An owner-validated resolution and audited recovery procedure are
required before clearing an attention item.

## Booking lifecycle projection

The new `dispatch.v1` read is
`GET /internal/v1/dispatch/bookings/:bookingId/execution`, granted by
`dispatch.assignment.read`. One SQL statement returns the current assignment,
its revision, its bound hold and current live task. The task includes its own
revision and `completedAt`; it carries no contact, location or financial data.

Booking reads this authoritative snapshot before opening its transaction. Inside
one local transaction it writes the inbox receipt, source watermark, booking
revision/status, audit fact and lifecycle outbox event. A stale assignment
generation or older task revision cannot overwrite newer work. The bound hold
must match Booking's current schedule; an in-flight reschedule retries until the
owners converge. Terminal cancellation/rejection is not reopened.

`FINISHED` remains `IN_PROGRESS`: only a current `CLOSED` task with a verified
completion timestamp projects `COMPLETED`. Released, withdrawn or cancelled
tasks do not complete a booking. Dispatch forbids taking back a closed task.
Payment verification and work completion remain separate facts.

## Native Reporting and Communications effects

Reporting accepts the published native Booking confirmation and Dispatch
assignment contracts into its existing operation rows. Cancellation, reschedule,
execution progression, shift changes and technician cash declarations have a
separate `ops_owner_observation` projection keyed by event type and aggregate.
Source versions advance monotonically; contradictory same-version projected
facts fail with an integrity error. A cash declaration never creates or changes
a Billing obligation or a paid state. These observations remain derived owner
facts; they do not grant Reporting command authority.

Communications retains `CUSTOMER` as the namespace of historical intents.
Native Booking beneficiaries are explicitly `IDENTITY_ACCOUNT` or
`IDENTITY_GUEST`, so an Identity subject cannot be silently treated as a Customer
record id. The provider adapter defaults to the historical namespace. An adapter
which actually resolves Identity recipients must explicitly declare the supported
namespaces in `NOTIFICATION_PROVIDER_RECIPIENT_NAMESPACES`; unsupported namespaces
return `NOT_SUBMITTED` before any network call. Persisted intake is not evidence
of provider acceptance or delivery.

Cancellation is stored in the immutable owner-local
`booking_notification_cancellation` table. A per-booking transaction lock orders
cancellation, intake, claims and retry completion. Cancellation-before-confirmation
suppresses delayed intake; already queued, never attempted intents become
`CANCELLED`; attempted work keeps its uncertainty and cannot be retried after
cancellation. Actual accepted provider outcomes remain provider evidence, not
fabricated cancellation or delivery. A provider HTTP 408 remains ambiguous.

## Automatic assignment policy

The additive Workforce `GET /assignment-candidates` uses scope
`workforce.capacity.read` and publishes the real operator-to-Identity subject
binding, eligibility revision, requested-zone shifts, declared availability and
availability revision. A missing availability declaration is `ON_BREAK`.

The worker considers unassigned, non-pending jobs starting within the next
24 hours. A candidate must be `ELIGIBLE`, explicitly `AVAILABLE`, and have a
shift covering the entire interval in the requested zone. Newer pushed
ineligibility overrides an older read. No position, rating or nearest-technician
claim is inferred.

Eligible candidates are ordered by the owner's active task/offer count, then by
resource UUID. A resource lock and overlap query guard automatic offers. The
existing database exclusion constraint remains the final acceptance guard.
There are at most ten distinct resource offers per assignment; each offer lives
for at most 120 seconds and never beyond the job end. Every tried resource and
offer id is persisted. After a decline or expiry, another process resumes with
the next untried candidate. Restarts never reset the sequence.

Unavailable dependencies or candidates retry every 30 seconds, up to twenty
persisted failed passes, then require operations attention. These bounds are
explicit launch policy defaults, not an optimized travel or capacity model.
Operations can still offer, reassign or unassign. Each such successful command
pauses automatic handling atomically, so automation never undoes a manual choice.
The policy and reasons remain owner records in `automatic_assignment_policy`;
the audit action `assignment.automatic-attention-required` identifies exhaustion.

## Checkout and operations contracts

Booking now owns the customer hold facade:

- `POST /internal/v1/booking/booking-holds` — published `HoldRequestV1` and caller idempotency key.
- `GET /internal/v1/booking/booking-holds/:id` — published `HoldV1`.
- `POST /internal/v1/booking/booking-holds/:id/release` — published `ReleaseHoldRequestV1` and caller key.
- `GET /internal/v1/booking/bookings/by-request/:idempotencyKey` — authenticated owner recovery of the original create result.

The facade forwards the real caller credential, checks beneficiary ownership and
validates returned hold identity, quote, time and duration. It does not fabricate
capacity. A pending create claim returns `IDEMPOTENCY_IN_PROGRESS`; an absent
owner claim returns not found. No contact data needs to be retained by the
browser to recover an ambiguous create request.

Staff reschedule requests now record a distinct staff requester and retain all
hold beneficiary, revision, expiry, duration and zone checks. Scheduling exposes
`POST /staff/holds` for `operations.dispatch`, using the staff's own credential
and the original beneficiary of a valid Pricing quote. Pricing must grant that
explicit staff read; no caller identity is forged. Holds still require a usable
quote. A fresh quote is required when the original quote has expired.

The technician read uses the current schedule after a reschedule and exposes the
financial-source discriminator described below. It never exposes subscription
or entitlement identifiers to the technician.

## Subscription funding and product restrictions

The optional create field is
`subscription: { subscriptionId, expectedRevision }`. It is allowed only for an
account and a quote containing one package of quantity one, with no extra,
surcharge, fee, tax or discount lines. The server derives the package and vehicle
type from the trusted quote and sends the scheduled UTC instant to Subscription.
Unsupported coverage fails explicitly with `SUBSCRIPTION_COVERAGE_UNSUPPORTED`.

`paymentMethod` is required for direct creates and optional when a subscription
is selected. Covered creates normalize the otherwise inapplicable legacy
database/event field to `CASH_ON_COMPLETION`; a supplied supported value is
ignored and normalizes identically. This is solely schema compatibility, never
a request to collect cash or evidence of payment. Clients must use
`financialSource=SUBSCRIPTION`, ignore the legacy method and render entitlement
coverage. Missing direct methods, malformed subscription selections and invalid
provided methods remain rejected.

The creation saga validates the quote, reserves the entitlement, then commits
the Scheduling hold. It never creates a second Billing obligation for a funded
unit. The response exposes `financialSource: DIRECT | SUBSCRIPTION`,
`entitlementReservationId` and `obligationId`. For covered bookings the obligation
is null; a confirmed covered booking has a durable reservation reference. The
retail quote snapshot remains immutable and is not represented as money due.

A timed-out reserve may still commit. Booking repeats the identical idempotent
command until the owner gives a definitive outcome; an empty concurrent lookup
is not treated as proof of absence. If success arrives after the capture
deadline, Booking releases that exact reservation before rejecting. Pre-pivot
compensation and accepted cancellation restore the reservation through the
Subscription owner. Cancellation finishes with `ENTITLEMENT_RELEASED`, not a
fabricated refund or voided debt.

Actual work completion atomically queues entitlement consumption. The queue uses
60 s exclusive leases, monotonic acquisition fences, one owner call per pass and at most
50 attempts with persisted capped backoff. Only a matching owner `CONSUMED`
receipt marks it delivered. Subscription keeps a reservation until explicit
resolution; period end is not an automatic release of a confirmed future job.

Subscription currently has no reservation date-change contract. Therefore an
existing covered booking cannot be rescheduled in place; it returns
`SUBSCRIPTION_RESCHEDULE_UNAVAILABLE` and must be cancelled/rebooked. The customer
UI selects coverage from the Subscription owner's eligibility decision and
submits its actual subscription revision without asking for another payment
method. Hosted acceptance of that owner-to-customer journey remains required.
These restrictions must be visible in product acceptance and must not be called
unrestricted S06/S07 completion. Technician UI must treat `SUBSCRIPTION` as
covered and use `NOT_CASH`, never collect the displayed retail quote amount.

## Required configuration and verification

All workers need their owner's `DATABASE_URL` and `BROKER_URL`. Dispatch also
requires validated `DISPATCH_WORKFORCE_*` and `DISPATCH_MEDIA_*` workload targets.
Booking requires `BOOKING_DISPATCH_*` for projection and its existing Pricing,
Billing, Scheduling, Vehicle and Customer URLs/credentials for sagas. Covered
bookings additionally require `SUBSCRIPTION_URL`, `BOOKING_TOKEN_SUBSCRIPTION`,
and the reserve/read/resolve Subscription scopes on that Booking credential.

Migrations are appended, not changes to historical migration files:

- Booking `20261127010000_s02_execution_projection` and `20261127030000_s06_entitlement_funding`.
- Dispatch `20261127020000_s06_automatic_assignment`.
- Booking `20261127120000_s02_change_outcome_constraints` allows definitive refused/failed cancellations to retain their absent settlement and persists the already authorized staff requester kind.
- Reporting `20261127121000_s02_owner_event_observations` adds the source-versioned owner observation table.
- Communications `20261127122000_s02_recipient_namespace_cancellation` adds recipient namespaces and irreversible cancellation fences; trigger functions deny public execution.

Focused unit tests exercise source-generation fencing, FINISHED/CLOSED
distinction, retry ordering, authoritative reads outside transactions, failed
preparation without ACK, automatic fallback after reconstruction, pause and
exhaustion, subscription ambiguity and unsupported coverage. Existing owner
unit and contract parity tests remain required.

`tests/production/C/runtime-closure-processes.test.mjs` must run against the real
lane-C PostgreSQL/RabbitMQ stack, including Reporting and Communications databases,
after release and test builds for all six services. It boots actual worker entrypoints and real Workforce/Dispatch HTTP
APIs, generates Workforce and Scheduling facts through their applications, kills
and restarts workers, and drives real Dispatch task rules to Booking completion.
It checks durable Reporting/Communications effects through their actual consumer
processes, then restarts those consumers and verifies duplicate event handling.
There is no wildcard observer standing in for a business consumer. Resource cleanup
is registered before setup, and worker exits immediately reject pending waits.
Pricing/Billing snapshot ports and Media evidence are declared fixtures; the
test does not substitute for hosted Staging acceptance, provider verification,
object-store acceptance, or customer-to-technician browser E2E.

The companion `native-owner-effects.pg.test.mjs` uses real owner PostgreSQL roles
to prove native namespace isolation, cancellation ordering/races, in-flight retry
fencing, immutable cancellation records, monotonic source projections and the
separation of technician cash declarations from Billing payments. On the current
uncommitted candidate, local PostgreSQL 16.16 diagnostics passed Booking 57/57,
Scheduling 44/44 and the six new native-effect tests; Reporting/Communications
unit/HTTP tests passed 80/80, all without skipped tests. These local diagnostics
do not approve a release SHA. Real RabbitMQ process proof and source-bound CI
acceptance are still required.
