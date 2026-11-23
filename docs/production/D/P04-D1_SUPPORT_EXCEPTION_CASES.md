# P04-D1: Support exception cases (payment verification, mismatch, refunds, booking exceptions)

Parent task: P04-D, "admin payment verification, mismatch, refunds and
exception handling". Parent status: **INTEGRATION_PENDING**.

This child turns the foundation-only `services/support` shell into the owner
of staff **exception cases**. It is not production-ready and not deployed.
`BUSINESS_READY` stays `false`.

## What Support owns, and what it never owns

| Support owns (`cw_support`) | Owners keep |
| --- | --- |
| `support_case`: kind, subject reference, summary, owner snapshot at intake, status | Billing: payment attempts, reconciliation, "paid", refunds |
| `resolution_request`: each reasoned decision (reason code + note, evidence references, exact amount or window), its four-eyes approval, the frozen owner command and the owner's answer | Booking: booking status and service window, cancellation, reschedule |
| `case_event`: append-only audit (actor, action, from/to, outcome, correlation id) | |
| `outbox_message`: `support.case-opened.v1`, `support.case-status-changed.v1` | |

Support never writes a payment or booking status. A decision is carried out
by the **owner**, through the owner's own HTTP command, with the deciding
staff member's own bearer credential (on behalf of). The owner therefore
authorizes and audits the human, and refuses what that person may not do.
Support holds no standing credential for Billing or Booking.

## Case kinds and decisions

| Kind (desk) | Subject | Decision | Owner command | Approval | Evidence | Amount / window |
| --- | --- | --- | --- | --- | --- | --- |
| `PAYMENT_REVIEW` (finance) | payment attempt in `PENDING_REVIEW`/`UNKNOWN` | `APPROVE_MATCH` | Billing reconcile `MATCHED` | single | required | observed amount |
| | | `REJECT_MISMATCH` | Billing reconcile `MISMATCHED` | single | required | observed amount |
| | | `MARK_UNKNOWN` | Billing reconcile `UNKNOWN` | single | optional | none |
| | | `DISMISS` | none | single | optional | none |
| `REFUND` (finance) | obligation with money received | `REFUND` | Billing refund (**unpublished**, CR-D-P04-01) | **four-eyes** | required | refund amount |
| `LATE_PAYMENT` (finance) | payment attempt | `ACCEPT_LATE_PAYMENT` | Billing reconcile `MATCHED` | single | required | observed amount |
| | | `REFUND` | Billing refund (unpublished) | four-eyes | required | refund amount |
| `BOOKING_CANCELLATION` (operations) | booking not finished | `CANCEL_BOOKING` | Booking cancel (**unpublished**, CR-D-P04-03) | single | optional | none |
| `BOOKING_RESCHEDULE` (operations) | booking `PENDING_CONFIRMATION`/`CONFIRMED`/`ASSIGNED` | `RESCHEDULE_BOOKING` | Booking reschedule (unpublished) | single | optional | new UTC window, ≤ 12 h |

Every decision requires a reason code allowed for its kind **and** a note of
10–500 characters. Evidence references are opaque (`[A-Za-z0-9._:/-]`, no
spaces), so a phone number or a name cannot be pasted whole; at most five.
Amounts are exact: `{ currency, amountMinor: "<integer string>", scale }`,
stored as `NUMERIC(20,0)`, never a float, never rescaled.

## Role separation (server-side, deny by default)

| | Finance cases | Operations cases |
| --- | --- | --- |
| read | `billing.read` or `support.cases.read` | `operations.dispatch` or `support.cases.read` |
| open | `billing.reconcile` or `billing.refund` | `operations.dispatch` |
| decide | the permission the owner demands: `billing.reconcile` / `billing.refund`; `DISMISS` needs the open grant | `operations.dispatch` |
| approve | `billing.refund`, by a different person than the proposer | — |

Another desk's case answers `404`, not `403`, so its existence does not leak.
The support desk reads every queue and decides nothing. Customers,
technicians and anonymous callers are refused.

## State machine and failure handling

```
OPEN ──decide──▶ EXECUTING ──owner 2xx──▶ RESOLVED
  │                 │ owner refused ──▶ OWNER_REJECTED ──decide again──▶ …
  │                 │ timeout / reset / 408 / 429 / 5xx ──▶ OUTCOME_UNKNOWN ──resend──▶ EXECUTING
  │                 │ owner command unpublished ──▶ BLOCKED_ON_OWNER ──resend | decide (supersedes)──▶ …
  ├──REFUND──▶ AWAITING_APPROVAL ──approve (other person)──▶ EXECUTING
  │                          └──reject──▶ OPEN
  └──DISMISS──▶ CLOSED
```

- **Process manager, not a distributed transaction.** Step 1 records the
  decision, the case status, the audit event and the outbox row in ONE local
  transaction. Step 2 calls the owner. Step 3 records the owner's answer in
  another local transaction.
- **The owner command is frozen** at decision time (or approval time for
  four-eyes) from the owner's CURRENT revision: operation, target, body and
  the key `support-<case>-d<n>`. Every resend is byte-identical, so the
  owner's idempotency replays instead of acting twice.
- **UNKNOWN is never success.** A lost answer leaves `OUTCOME_UNKNOWN`; no
  new decision may be taken over it (money may have moved); only a resend of
  the same command can settle it. If a resend is refused as stale
  (`REVISION_CONFLICT`, `ATTEMPT_NOT_OPEN`, …), Support reads Billing and
  marks the decision APPLIED only if the attempt now has the requested status.
- **Stale-worker fencing.** Each send claims `execution_fence + 1`; only the
  latest claim may record the owner's answer. A resend inside the lease
  (`SUPPORT_EXECUTION_LEASE_MS`, default 15 s) is refused with
  `EXECUTION_IN_PROGRESS`.
- **Idempotency of Support's own commands.** Opening a case is keyed by
  (staff member, `Idempotency-Key`) with a request fingerprint; a decision by
  (case, staff member, key). The same request replays (and resumes an
  interrupted send); a different body with the same key is
  `IDEMPOTENCY_CONFLICT`.
- **Owner calls** have explicit timeouts (`BILLING_TIMEOUT_MS`,
  `BOOKING_TIMEOUT_MS`), bounded bodies and no automatic retries.

## Database-enforced invariants (migration `20261011090000_p04d_exception_cases`)

- one active case per (kind, subject): `support_case_active_subject_key` with
  `active_slot` = 1 exactly while not `RESOLVED`/`CLOSED`;
- one decision in flight per case: `resolution_request_inflight_key`;
- four-eyes: `approved_by <> decided_by`; approval fields all-or-none;
- reason note ≥ 10 characters; evidence required for money decisions;
  amounts all-or-none and integer; window start before end;
- nothing is `EXECUTING`/`APPLIED`/… without a frozen owner request;
- `case_event` is append-only (trigger, also against the runtime identity);
  what a case is about and what a decision said are frozen (trigger), and the
  revision only moves forward by one;
- outbox event types are the two registered names.

## HTTP API (`/internal/v1/support/cases`)

| Method and path | Purpose |
| --- | --- |
| `GET /` | Queue, oldest first; `kind`, `status`, `subjectType`+`subjectId`, `limit` ≤ 100, `cursor` |
| `POST /` | Open a case (`Idempotency-Key`); `201` created, `200` replayed, `409 CASE_ALREADY_OPEN` |
| `GET /:id` | Case, decisions and audit |
| `GET /:id/current` | The subject's state read NOW from its owner, as the caller |
| `POST /:id/decisions` | Record a decision and carry it out (`Idempotency-Key`) |
| `POST /:id/decisions/:no/approval` | Four-eyes approve or reject (`Idempotency-Key`) |
| `POST /:id/decisions/:no/execution` | Resend the frozen owner command |

Every response carries `authority` (who owns which fact). Logs record
operation, case id, subject, correlation id and outcome code only: never the
summary, note, evidence, amounts or references.

## Evidence

Base `origin/main` `c65db708b9a7c50e5a885799330479426e863758`. The exact head,
tree and command results are in the pull request and in
`evidence/p04-d1-real-infra.json`.

| Family | Result |
| --- | --- |
| Domain + process-manager unit tests (`services/support/test/case.commands.spec.ts`) | PASSED 10/10 (plus the Nest shell spec) |
| Real infrastructure `support-exception-cases.test.mjs`: H1 approve match through REAL Billing with Billing's audit actor and correlation id; H2 reject mismatch; H3 lost answer → `OUTCOME_UNKNOWN`, refresh, same-request retry, resend → exactly one Billing reconciliation; H4 four-eyes refund, self-approval refused (application and database), `BLOCKED_ON_OWNER`; H5 operations cancel/reschedule against REAL Booking, booking unchanged, no contact data stored; H6 role denial; S1 concurrent opens; S2 append-only/frozen/exact-money/DDL refusal | PASSED 8/8 |
| Full Lane D real-infrastructure gate (adds Support migrate/harden/drift) | see PR |
| typecheck, unit, Nest specs, ESLint, Prettier, boundaries/layers, migrations, ownership, design reference | see PR |

**Real:** PostgreSQL 16 for Support, Billing and Booking (each its own
database and runtime identity), the real Identity service, the real Billing
and Booking HTTP adapters.

**Declared doubles:** Billing's Pricing quote upstream; Booking's upstream
owners (Booking's own test doubles); an HTTP relay that drops one Billing
answer to produce a lost response.

**Declared harness workaround:** CR-D-P04-05 (Billing helper-function grant),
proven refused first, then applied as the migration identity.

## Not proven here (blockers)

- **CR-D-P04-01 (B):** Billing refund command — refunds stop at
  `BLOCKED_ON_OWNER`.
- **CR-D-P04-03 (C):** Booking cancel/reschedule commands — same.
- **CR-D-P04-02 (E):** event registration and topology; the outbox is not relayed.
- **CR-D-P04-04 (E):** Gateway routes; the console reaches Support only on a candidate tree.
- **CR-D-P04-05 (B):** hardened Billing cannot create obligations on `main`.
- **CR-D-P04-06 (B):** Billing attempt queue and `caseRef`.
- External: no provider statement API or sandbox.
- No RabbitMQ test: Support publishes nothing until CR-D-P04-02.

## Rollback

The migration is additive (expand only). Roll back by redeploying the previous
Support image; the new tables stay unused. No other service depends on them.
