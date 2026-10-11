# P04-D contract and dependency requests

Status: **SUBMITTED BY D / NOT ACCEPTED**. Lane D writes only its own scope. It
does not edit shared contracts, the Gateway, Identity, broker bootstrap, CI,
lockfiles or another lane's service. Each request names the exact change. D
consumes only the merged, versioned result. Until a request merges, the
dependent D behavior stays fail-closed, as each section describes.

This file is byte-identical in every P04-D child pull request, so the children
merge in any order.

Base observed: `origin/main` `c65db708b9a7c50e5a885799330479426e863758`
(tree `9b0d9bef560cc4ea441c142839f772004de5275a`).

The P02-D and P03-D requests (`P02_CONTRACT_REQUESTS.md`,
`P03_CONTRACT_REQUESTS.md`) are still open. In particular the admin console
still has no Gateway route to any owner on `main` (CR-D-P02-01,
CR-D-P03-02/06/08).

## CR-D-P04-01 (Lane B, then E): Billing refund and reversal command

**Update (2026-10-10):** Lane B's open PR #125 (P04-B1) provides the owner
side: `POST provider-credits/:id/refunds` (`billing.refund`, body
`{ expectedRevision, amount, reason }`), `POST refunds/:id/decision` by a
DIFFERENT `billing.refund` holder, and provider or manual completion. It also
replaces a reviewer's `MATCHED` with two-person statement credits
(`POST provider-credits`, `POST provider-credits/:id/decision`); a manual
`MATCHED` then answers `409 PROVIDER_CREDIT_REQUIRED`. Lane D does not
consume an unmerged provider branch. Once #125 merges, the Support Billing
adapter maps: refund proposal → `provider-credits/:id/refunds` (as the
proposer), refund approval → `refunds/:id/decision` (as the approver);
`APPROVE_MATCH` → statement credit recorded by the decider and approved in
Billing by a second reviewer. Until then Support's behavior below stands; with
#125 merged and the adapter unchanged, `APPROVE_MATCH` would be refused by
Billing and recorded as `OWNER_REJECTED` (fail-safe, never "paid").

The original request, kept for the record:

Support records a four-eyes refund decision (proposer and a different
approver, both holding `billing.refund`) and then needs ONE owner command to
carry it out. Billing has none. Requested, in `billing.v1`:

| | |
| --- | --- |
| Route | `POST /internal/v1/billing/obligations/:id/refunds` |
| Permission | `billing.refund`; never the obligation's own owner |
| Headers | `Idempotency-Key` (same rules as every Billing command), `X-Correlation-Id` |
| Body (closed) | `{ expectedRevision, amount: Money, reasonCode, caseRef }` where `caseRef` is the opaque Support case id |
| Answers | `202` with the refund in `REQUESTED`; later `SUBMITTED`, `COMPLETED`, `FAILED` or `UNKNOWN` as Billing learns from the provider; `409 REVISION_CONFLICT`; `422 AMOUNT_EXCEEDS_REFUNDABLE` |
| Audit | `billing.refund.requested` with the human actor and the correlation id |
| Event | `billing.refund-status-changed.v1` (ids, statuses, exact amounts only) |

Support already sends exactly this body (`owner.operation = billing.refund`).
Interim behavior: the Support adapter sends nothing and the decision is
`BLOCKED_ON_OWNER` / `OWNER_CAPABILITY_UNPUBLISHED`. The money stays recorded
as received in Billing (proven in `support-exception-cases.test.mjs` H4).

## CR-D-P04-02 (Lane E): register the Support events

Register in `@carwash/event-contracts`, with the parsers already in
`services/support/src/application/events.ts`:

- `support.case-opened.v1`: `{ kind, subjectType, subjectId, status }`;
- `support.case-status-changed.v1`:
  `{ kind, previousStatus, status, decisionNo, action }`.

Aggregate type `support-case`; actor kind `account`. Exchange
`support.events` in the shared bootstrap. These replace the catalog's planned
`support.case-resolved.v1` (RESOLVED is one value of `status`). Update
`architecture/service-catalog.json` for Support (`api.status`, `events`).

Interim behavior: rows are written to `app.outbox_message` in the same
transaction as the case change and stay pending; no relay runs.

## CR-D-P04-03 (Lane C, then E): Booking operational cancel and reschedule

Operations decides a cancellation or a reschedule in a Support case with a
reason and Booking's current revision. Booking has the `CANCELLED` transition
but no command. Requested, in `booking.v1`:

| Route | Body (closed) | Permission |
| --- | --- | --- |
| `POST /internal/v1/booking/bookings/:id/cancellation` | `{ expectedRevision, reasonCode }` | `operations.dispatch` |
| `POST /internal/v1/booking/bookings/:id/reschedule` | `{ expectedRevision, reasonCode, window: { startsAt, endsAt } }` | `operations.dispatch` |

Both need `Idempotency-Key`, the human actor in Booking's audit, and Booking's
saga compensations: release or replace the Scheduling hold, unassign through
Dispatch, void the obligation or open a refund through Billing. Support
already sends exactly these bodies.

Interim behavior: `BLOCKED_ON_OWNER`; the booking is unchanged (proven in H5).

## CR-D-P04-04 (Lane E): Gateway routes for Support cases

Depends on CR-D-P02-01 (query allowlist and `anyPermission`). The `:no`
segment is a decision number (`[1-9][0-9]{0,5}`).

| Route id | Method and path | Upstream | Permission (any of) | Query / body |
| --- | --- | --- | --- | --- |
| `admin.cases.list` | GET `/admin/cases` | `/internal/v1/support/cases` | `billing.read`, `operations.dispatch`, `support.cases.read` | `kind`, `status`, `subjectType`, `subjectId`, `limit`, `cursor` |
| `admin.cases.open` | POST `/admin/cases` | `/internal/v1/support/cases` | `billing.reconcile`, `billing.refund`, `operations.dispatch` | `Idempotency-Key` |
| `admin.cases.get` | GET `/admin/cases/:id` | `/internal/v1/support/cases/:id` | as list | none |
| `admin.cases.current` | GET `/admin/cases/:id/current` | `/internal/v1/support/cases/:id/current` | as list | none |
| `admin.cases.decide` | POST `/admin/cases/:id/decisions` | `/internal/v1/support/cases/:id/decisions` | as open | `Idempotency-Key` |
| `admin.cases.approve` | POST `/admin/cases/:id/decisions/:no/approval` | same path | `billing.refund` | `Idempotency-Key` |
| `admin.cases.resend` | POST `/admin/cases/:id/decisions/:no/execution` | same path | as open | none (the frozen owner key is reused) |

The Gateway maps every owner `409` to `CONFLICT` and drops the owner's
code (`CASE_ALREADY_OPEN`, `SUBJECT_NOT_ELIGIBLE`, `CASE_NOT_DECIDABLE`,
`SAME_PERSON_APPROVAL`, …). Requested: forward the owner's `error.code` when it
matches `^[A-Z][A-Z0-9_]{1,63}# P04-D contract and dependency requests

Status: **SUBMITTED BY D / NOT ACCEPTED**. Lane D writes only its own scope. It
does not edit shared contracts, the Gateway, Identity, broker bootstrap, CI,
lockfiles or another lane's service. Each request names the exact change. D
consumes only the merged, versioned result. Until a request merges, the
dependent D behavior stays fail-closed, as each section describes.

This file is byte-identical in every P04-D child pull request, so the children
merge in any order.

Base observed: `origin/main` `c65db708b9a7c50e5a885799330479426e863758`
(tree `9b0d9bef560cc4ea441c142839f772004de5275a`).

The P02-D and P03-D requests (`P02_CONTRACT_REQUESTS.md`,
`P03_CONTRACT_REQUESTS.md`) are still open. In particular the admin console
still has no Gateway route to any owner on `main` (CR-D-P02-01,
CR-D-P03-02/06/08).

## CR-D-P04-01 (Lane B, then E): Billing refund and reversal command

**Update (2026-10-10):** Lane B's open PR #125 (P04-B1) provides the owner
side: `POST provider-credits/:id/refunds` (`billing.refund`, body
`{ expectedRevision, amount, reason }`), `POST refunds/:id/decision` by a
DIFFERENT `billing.refund` holder, and provider or manual completion. It also
replaces a reviewer's `MATCHED` with two-person statement credits
(`POST provider-credits`, `POST provider-credits/:id/decision`); a manual
`MATCHED` then answers `409 PROVIDER_CREDIT_REQUIRED`. Lane D does not
consume an unmerged provider branch. Once #125 merges, the Support Billing
adapter maps: refund proposal → `provider-credits/:id/refunds` (as the
proposer), refund approval → `refunds/:id/decision` (as the approver);
`APPROVE_MATCH` → statement credit recorded by the decider and approved in
Billing by a second reviewer. Until then Support's behavior below stands; with
#125 merged and the adapter unchanged, `APPROVE_MATCH` would be refused by
Billing and recorded as `OWNER_REJECTED` (fail-safe, never "paid").

The original request, kept for the record:

Support records a four-eyes refund decision (proposer and a different
approver, both holding `billing.refund`) and then needs ONE owner command to
carry it out. Billing has none. Requested, in `billing.v1`:

| | |
| --- | --- |
| Route | `POST /internal/v1/billing/obligations/:id/refunds` |
| Permission | `billing.refund`; never the obligation's own owner |
| Headers | `Idempotency-Key` (same rules as every Billing command), `X-Correlation-Id` |
| Body (closed) | `{ expectedRevision, amount: Money, reasonCode, caseRef }` where `caseRef` is the opaque Support case id |
| Answers | `202` with the refund in `REQUESTED`; later `SUBMITTED`, `COMPLETED`, `FAILED` or `UNKNOWN` as Billing learns from the provider; `409 REVISION_CONFLICT`; `422 AMOUNT_EXCEEDS_REFUNDABLE` |
| Audit | `billing.refund.requested` with the human actor and the correlation id |
| Event | `billing.refund-status-changed.v1` (ids, statuses, exact amounts only) |

Support already sends exactly this body (`owner.operation = billing.refund`).
Interim behavior: the Support adapter sends nothing and the decision is
`BLOCKED_ON_OWNER` / `OWNER_CAPABILITY_UNPUBLISHED`. The money stays recorded
as received in Billing (proven in `support-exception-cases.test.mjs` H4).

## CR-D-P04-02 (Lane E): register the Support events

Register in `@carwash/event-contracts`, with the parsers already in
`services/support/src/application/events.ts`:

- `support.case-opened.v1`: `{ kind, subjectType, subjectId, status }`;
- `support.case-status-changed.v1`:
  `{ kind, previousStatus, status, decisionNo, action }`.

Aggregate type `support-case`; actor kind `account`. Exchange
`support.events` in the shared bootstrap. These replace the catalog's planned
`support.case-resolved.v1` (RESOLVED is one value of `status`). Update
`architecture/service-catalog.json` for Support (`api.status`, `events`).

Interim behavior: rows are written to `app.outbox_message` in the same
transaction as the case change and stay pending; no relay runs.

## CR-D-P04-03 (Lane C, then E): Booking operational cancel and reschedule

Operations decides a cancellation or a reschedule in a Support case with a
reason and Booking's current revision. Booking has the `CANCELLED` transition
but no command. Requested, in `booking.v1`:

| Route | Body (closed) | Permission |
| --- | --- | --- |
| `POST /internal/v1/booking/bookings/:id/cancellation` | `{ expectedRevision, reasonCode }` | `operations.dispatch` |
| `POST /internal/v1/booking/bookings/:id/reschedule` | `{ expectedRevision, reasonCode, window: { startsAt, endsAt } }` | `operations.dispatch` |

Both need `Idempotency-Key`, the human actor in Booking's audit, and Booking's
saga compensations: release or replace the Scheduling hold, unassign through
Dispatch, void the obligation or open a refund through Billing. Support
already sends exactly these bodies.

Interim behavior: `BLOCKED_ON_OWNER`; the booking is unchanged (proven in H5).

## CR-D-P04-04 (Lane E): Gateway routes for Support cases

Depends on CR-D-P02-01 (query allowlist and `anyPermission`). The `:no`
segment is a decision number (`[1-9][0-9]{0,5}`).

| Route id | Method and path | Upstream | Permission (any of) | Query / body |
| --- | --- | --- | --- | --- |
| `admin.cases.list` | GET `/admin/cases` | `/internal/v1/support/cases` | `billing.read`, `operations.dispatch`, `support.cases.read` | `kind`, `status`, `subjectType`, `subjectId`, `limit`, `cursor` |
| `admin.cases.open` | POST `/admin/cases` | `/internal/v1/support/cases` | `billing.reconcile`, `billing.refund`, `operations.dispatch` | `Idempotency-Key` |
| `admin.cases.get` | GET `/admin/cases/:id` | `/internal/v1/support/cases/:id` | as list | none |
| `admin.cases.current` | GET `/admin/cases/:id/current` | `/internal/v1/support/cases/:id/current` | as list | none |
| `admin.cases.decide` | POST `/admin/cases/:id/decisions` | `/internal/v1/support/cases/:id/decisions` | as open | `Idempotency-Key` |
| `admin.cases.approve` | POST `/admin/cases/:id/decisions/:no/approval` | same path | `billing.refund` | `Idempotency-Key` |
| `admin.cases.resend` | POST `/admin/cases/:id/decisions/:no/execution` | same path | as open | none (the frozen owner key is reused) |

. Interim: on `CONFLICT` the console looks up
the open case for the subject, otherwise shows a generic “state changed /
not allowed now” message.

The Gateway forwards the caller's bearer credential and correlation id; Support
forwards both to Billing and Booking (on behalf of the caller, never a
standing service credential). The exact change used for the candidate tree is
`docs/production/D/P04_CANDIDATE_GATEWAY.patch` (P04-D2).

## CR-D-P04-05 (Lane B): DEFECT — hardened Billing cannot create an obligation

**Update (2026-10-10):** Lane B found the same defect independently; open PR
#125 makes the four calling trigger functions `SECURITY DEFINER` with a pinned
`search_path`. When #125 merges, Lane D's suite logs `NOT_NEEDED` and stops
applying the grant.

Found while running P04-D1 on real PostgreSQL. Migration
`20261009100000_p03b_cash_custody_settlement` runs
`REVOKE ALL ON FUNCTION app.billing_assert_obligation_ledger(UUID) FROM PUBLIC`
(and the same for `billing_assert_custody_holder(UUID, CHAR(3))` and
`billing_assert_handover(UUID)`). The trigger functions that call them run
with invoker rights, so after `hardenPrivileges` the runtime identity
`cw_billing_app` fails every obligation insert:

```
permission denied for function billing_assert_obligation_ledger
```

Requested: an additive Billing migration
`GRANT EXECUTE ON FUNCTION <the three helpers> TO cw_billing_app` (or make the
helpers `SECURITY DEFINER` with a fixed `search_path`), plus a Billing
real-PostgreSQL test that runs as the hardened runtime identity.

Interim behavior in Lane D's suite only: it first proves the runtime identity
is refused, then applies exactly that grant as the migration identity, and
logs `CR-D-P04-05 billing ledger helper grant: APPLIED`. Lane D does not change
Billing.

## CR-D-P04-06 (Lane B): finance review queue and reconciliation reference

1. `GET /internal/v1/billing/payment-attempts?status=PENDING_REVIEW,UNKNOWN&limit&cursor`
   (`billing.read`): attempt id, obligation id, method, masked reference,
   claimed amount, submitted at. Without it, the finance queue lists only
   attempts someone opened a case for (from the obligation lookup).
2. An optional `caseRef` (opaque uuid) on
   `POST payment-attempts/:id/reconciliation`, recorded in
   `billing_audit_event`, so Billing's audit links to the Support case that
   holds the reason and evidence.

## External (not a lane request)

No payment provider sandbox or statement API exists for Sham Cash or Syriatel
Cash, so "provider verification" is a finance reviewer reading the
provider's statement and recording a `PROVIDER_STATEMENT` evidence reference.
Automated verification is BLOCKED on merchant onboarding.
