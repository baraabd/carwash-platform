# Reviews owner runtime

The service implements the four published `reviews.v1` operations: submit a review,
read the caller's booking review, list pending moderation, and apply a moderation
decision. It owns `cw_reviews`; runtime replicas use `cw_reviews_app`, and isolated
migration jobs use `cw_reviews_migrate`. No runtime connection to another owner's
database is permitted.

Every operation resolves the current principal through Identity HTTP. Submission
also reads Booking over HTTP and requires the same principal **kind and subject**
and a `COMPLETED` booking. A caller-supplied author, cached projection, staff role,
or fabricated completion flag cannot establish eligibility. A guest can review
their own completed booking. Moderation requires the current Identity permission
`reviews.moderate`; a Workforce reviewer grant is unrelated.

One review is allowed per booking. Submission and moderation use durable,
actor-scoped idempotency, database locks, and atomic review/audit/outbox/receipt
writes. A successful retry returns its original response revision even if the
review has since changed. A stale moderation revision fails with HTTP 412.
Identity revocation is checked before any replay.

Comments are returned only to the author or an authorized moderator. They are
never included in event payloads, audit records, command receipts, request URLs,
or logs. The published status event is persisted in the owner's outbox in the
same transaction; a Reviews broker relay and downstream delivery are **not**
implemented or claimed by this slice.

## Configuration

| Setting | Purpose |
| --- | --- |
| `DATABASE_URL` | Reviews runtime database identity; use the migration identity only in a separate migration job. |
| `IDENTITY_SESSION_ORIGIN` | Identity origin used for current session verification. |
| `REVIEWS_BOOKING_ORIGIN` | Booking origin used for the authoritative eligibility read. |
| `IDENTITY_SESSION_TIMEOUT_MS` | Identity request and streamed-body deadline, 100–10000 ms; default 2000 ms. |
| `REVIEWS_BOOKING_TIMEOUT_MS` | Booking request and streamed-body deadline, 100–10000 ms; default 2000 ms. |

Owner origins must be HTTPS, or HTTP on loopback for allocated test/development
environments. Embedded credentials, path prefixes, query strings, fragments and
redirects are rejected. Missing origins fail closed. Owner reads forward only the
Bearer credential, correlation ID and JSON Accept header. They have bounded
response bodies and no automatic retries.

## Verification and readiness

From the repository root:

- `pnpm --filter @carwash/reviews generate`
- `pnpm --filter @carwash/reviews build`
- `pnpm --filter @carwash/reviews typecheck`
- `pnpm --filter @carwash/reviews test:runtime`
- `pnpm --filter @carwash/reviews migrate:deploy`, with the allocated migration identity.
- `node scripts/production/D/run-real-infra.mjs --suite reviews-owner-http`, against a provisioned canonical acceptance stack.

The offline runtime suite uses HTTP listeners but no PostgreSQL. The Lane D suite
uses actual PostgreSQL, Redis, Identity, Booking, two Reviews instances and
Gateway. Its booking records are explicitly seeded in the Booking-owned database
as test fixtures; this is not proof of a customer checkout and completed wash
journey. The same suite runs through the canonical `d-services` CI lane, including
migrations, privilege hardening and schema drift checks.

`BUSINESS_READY` deliberately remains `false`: `/health/live` returns 200 and
`/health/ready` returns 503 with `FOUNDATION_NOT_READY`. Runtime startup never
performs migrations. Exact-source CI acceptance, deployment configuration,
customer/admin UI integration and event delivery remain separate release gates.
See [the provider implementation record](../../docs/production/D/P05-D2-REVIEWS-PROVIDER.md)
for transitions, privacy, migration and evidence scope.
