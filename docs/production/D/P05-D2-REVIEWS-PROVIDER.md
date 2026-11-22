# P05 Reviews provider implementation

Date: 2026-11-22. Scope: the existing `reviews.v1` HTTP provider and its durable
owner records. This record does not approve P05 or production readiness.

## Contract and routes

The authority is `packages/contracts/src/reviews/v1.ts`, with generated discovery
at `docs/contracts/reviews.v1.openapi.json`. This implementation does not add a
rating policy, public review listing, comment editing, consent editing, a new UI,
or a second approval requirement.

| Owner route | Gateway alias | Authorization |
| --- | --- | --- |
| `POST /internal/v1/reviews/reviews` | `POST /api/v1/customer/reviews` | Current account or guest, matching completed Booking beneficiary. |
| `GET /internal/v1/reviews/bookings/:bookingId/review` | `GET /api/v1/customer/bookings/:id/review` | The stored author, or a current moderator. Other principals receive 404. |
| `GET /internal/v1/reviews/moderation/reviews` | `GET /api/v1/admin/customer-reviews` | Current account with `reviews.moderate`. |
| `POST /internal/v1/reviews/moderation/reviews/:reviewId/decision` | `POST /api/v1/admin/customer-reviews/:id/decision` | Current account with `reviews.moderate`. |

Both commands require `Idempotency-Key`; moderation also requires the published
`expectedRevision` in its body. Shared closed parsers validate all request and
response fields. The queue accepts only `limit` and `cursor`: default limit 20,
maximum 100, and an opaque versioned keyset cursor with an `asOf` ceiling. It
returns only `PENDING_MODERATION` records. A cursor is a pagination position, not
an authorization token; every page still verifies the current moderator.

Gateway now authenticates principal-only routes even when no permission name is
required. Explicit public routes and Identity auth transport keep their existing
behavior; permission/any-permission checks, provider ingress, mixed-credential
denial and CSRF behavior remain enforced. OpenAPI records Bearer/session security
on these principal-only routes. Existing Workforce verification routes named
`/admin/reviews/...` remain distinct and unchanged.

## Owner authority and eligibility

Reviews resolves Identity's actual session endpoint on every operation, including
completed idempotent replays. The service checks principal kind, subject, roles
and permissions; forged service/principal headers cannot substitute. Current
revocation or a removed moderation grant blocks new operations and receipt
recovery. Moderation belongs to the existing `reviews.moderate` permission, not
the separate Workforce reviewer role.

For a new submission, Reviews reads the existing Booking owner HTTP endpoint. It
retains only booking ID, revision, beneficiary kind/subject and status. Eligibility
requires an exact matching beneficiary and the terminal `COMPLETED` status.
Missing, foreign, noncompleted or malformed owner facts fail closed. Staff
privileges do not override author matching. No address, contact, price, technician
or payment details are copied into Reviews.

The bounded Booking read occurs before opening a Reviews transaction. Completion
is a terminal Booking fact; its checked revision and verification timestamp are
recorded immutably with the review. Reads and decisions on an existing review use
the recorded author, rather than pretending that a Booking outage changes review
ownership. A successful submit replay can recover during a Booking outage because
it returns an already-committed receipt; Identity still must authorize the actor.

Production ports accept configured HTTPS origins and loopback HTTP for tests. They
reject redirects, embedded credentials and arbitrary paths. Timeouts cover the
streamed response, and Identity/Booking bodies are limited to 16 KiB/64 KiB.
Neither port logs response bodies or sends cookies/service identity headers.

## Consent, moderation and private content

Submission without publication consent creates `PRIVATE`. Explicit consent
creates `PENDING_MODERATION`. Consent, author, booking binding, rating and comment
are immutable in this contract version.

| Current status | Allowed decision | Result |
| --- | --- | --- |
| `PENDING_MODERATION` | `PUBLISH` with `MEETS_GUIDELINES` | `PUBLISHED` |
| `PENDING_MODERATION` | `REJECT` with a published rejection reason | `REJECTED` |
| `PUBLISHED` | `HIDE` with a published reason | `HIDDEN` |
| `PRIVATE`, `REJECTED`, `HIDDEN` | None | Explicit contract failure; no mutation. |

`CUSTOMER_WITHDREW_CONSENT` is an existing moderation reason for hiding a published
review. The provider preserves the original consent fact when it records that
reason: the published `ReviewV1` invariant requires consent to remain true on
`HIDDEN` records. It does not invent a consent mutation endpoint. A private review
cannot be published by an administrator without consent. Published contract
semantics do not require author and moderator to differ; this implementation
therefore makes no four-eyes approval claim.

Only the author and current moderators may receive the comment. Audit and event
records contain enum values, opaque IDs, ratings and timestamps, never comment
text. Receipts reference immutable audit revisions and reconstruct the original
view with the one stored private comment, avoiding another comment copy. HTTP
logging uses fixed operation names, status and correlation ID; parser failures
produce a shared error envelope without reflecting input or exception text.

## Persistence, concurrency and event facts

`20261122160000_reviews_v1` adds owner-local review, immutable audit, command
receipt and outbox tables while retaining the original ServiceMarker. Unique
booking identity enforces one review per booking. Advisory command locks prevent
two replicas from committing a key independently; a booking lock and unique
constraint serialize distinct keys against the same booking. Moderation takes a
row lock and checks the exact current revision before changing status.

Keys are scoped by actor kind, actor subject and operation. Fingerprints use the
published common canonical JSON protocol on the accepted original request body:
sorted keys and NFC strings, with no additional owner coercion. A changed business
value cannot reuse a successful key; equivalent Unicode composition and JSON
property ordering preserve the same fingerprint.
Completed replays return the original status/revision and
`Idempotent-Replayed: true`; a changed body returns `IDEMPOTENCY_CONFLICT`. A lost
response can be retried on another replica with the same key. Stale revisions
return 412, and simultaneous in-flight keys return an explicit retryable conflict.

Each accepted change atomically writes review, audit, receipt and a published
`reviews.review-status-changed.v1` outbox event. Its closed payload contains
`bookingId`, `rating`, `previousStatus` and `status`; it never includes the comment.
Database checks and triggers freeze review content/history, require one coherent
set of effects, and validate the event against its owner revision and audit.
An outbox failure rolls the entire transaction back, leaving no successful receipt.

Runtime and migration roles remain separate. The runtime cannot create schema
objects, read migration history, execute trigger helpers directly, rewrite audit
or receipts, or connect to the Booking database. Privilege hardening is applied by
both normal provisioning and the canonical acceptance runner. Trigger functions
use invoker rights and a fixed search path; no runtime helper grant is needed.

The outbox records are durable pending facts. This slice does not run a Reviews
AMQP relay or claim delivery, consumer effects or a public display of reviews.

## Verification and release boundaries

The committed regression sources are:

- `services/reviews/test/reviews.authorities.spec.ts`: owner URL/credential rules,
  current Identity checks, malformed/oversized/redirected owner responses, and
  streamed-body deadlines, alongside the existing runtime tests.
- `tests/production/D/reviews-owner-http.test.mjs`: actual Identity, Booking,
  Gateway and two Reviews HTTP instances against separate owner databases and
  Redis; shared request/response parsers; account/guest eligibility; noncompleted
  and foreign bookings; duplicate submissions; concurrent commands/decisions;
  lost-response retries; immutable content/consent; revoked grants; rollback;
  least-privilege SQL; no private text in logs or events.
- `tests/gateway/unit.test.mjs`: principal-only authentication and discovery plus
  the existing public/auth/permission regression suite.

Local development verification uses PostgreSQL 17.12 and Redis 8.0.2. It is
diagnostic evidence, not the canonical CI PostgreSQL 16.10 / Redis 8.2.10 gate.
The provider candidate passed 20 real owner HTTP/SQL tests with no skips, 14
offline runtime/authority tests, and a combined 68 Gateway/product/common/event
contract checks (including all 37 Gateway unit cases). Fresh migration application
and comparison to the Prisma schema reported no drift. Scoped ESLint, formatting,
boundary/layer/template, migration append-only and the ten-artifact design lock
checks passed. Canonical integrated-source CI remains required.
The real owner tests explicitly seed completed Booking records as owner-owned
test fixtures and capture OTP delivery. They do not prove a complete customer
checkout, technician completion, browser interface or external delivery provider.
The canonical `d-services` lane now builds and migrates Reviews, checks migration
drift, reapplies least-privilege grants and discovers the same HTTP suite.

`BUSINESS_READY` remains false. Before any readiness change, the integrated source
must pass canonical CI and deployment configuration must be reviewed. Customer
and moderator UI integration, event relay/consumers and the broader P05 journeys
remain separately tracked. No reference design or screenshot baseline changes are
part of this implementation.

Deploy the migration with the allocated migration identity before enabling the
new routes. Runtime startup does not migrate. For rollback, remove traffic to the
new operations and roll forward a reviewed repair; do not drop private reviews,
rewrite receipts, disable constraints, or reverse an applied migration to recover
an older binary. Existing ServiceMarker data is preserved by the additive schema.
