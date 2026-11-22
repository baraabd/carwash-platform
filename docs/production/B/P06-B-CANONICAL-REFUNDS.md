# P06-B — Published obligation refund operations

This change implements the manual electronic-refund subset of the existing
`billing.v1` contract in `packages/contracts/src/billing/refunds.ts`. It records
an authorized finance request and a different staff member's out-of-band
outcome against an actual allocated provider credit. It does not initiate a
transfer, invent merchant verification, authorize automatic cancellation
refunds, or decide how cash leaves technician or treasury custody.

## Published routes and exact semantics

All paths below have the prefix `/internal/v1/billing`. Successful responses
are validated by the shared parsers before they leave Billing. Canonical errors
use the complete shared error envelope and its normative retry flags.

| Route | Authorization and revision | Result |
| --- | --- | --- |
| `POST /obligations/:id/refunds` | Account with `billing.refund`; never the payment's owner. `expectedRevision` is the obligation revision. | `201 RefundV1` in `REQUESTED`; `{amount, reason}` must satisfy the closed published request. |
| `GET /obligations/:id/refunds` | The obligation's owner or `billing.read`. | `200 ObligationRefundsV1`, newest first, with exact `refunded`, `inFlight`, and `refundable` totals. |
| `GET /refunds/:id` | `billing.read`. | `200 RefundV1`; no staff subjects, credit identifiers, evidence digest, or full transfer reference. |
| `POST /refunds/:id/outcome` | Account with `billing.reconcile`; never the requester or payment's owner. `expectedRevision` is the refund revision. | `200 RefundV1`; `SUCCEEDED`, `FAILED`, or `UNKNOWN` as the published outcome command. |

A request requires a `SETTLED` obligation and its confirmed `ALLOCATED` credit,
matched attempt, matching currency and exact verified amount. A settled intent
has left the active-intent slot; the immutable allocated credit and matched
attempt establish the payment method. A client claim or an active payment
choice cannot establish that binding.

`SUCCEEDED` requires the published 4–64 character reference and writes the
balanced `REFUND_PAID` journal. References retain the contract's permitted case
and hyphens; the existing per-provider uniqueness constraint rejects exact
reuse. Only the last four characters appear on the wire. `FAILED` and `UNKNOWN`
require a null reference. No synthetic evidence digest is created for the new
protocol.

`UNKNOWN` becomes `OUTCOME_UNKNOWN` on the public wire. Its reservation remains
until a later authorized command records `SUCCEEDED` or `FAILED`; elapsed time
and repeated `UNKNOWN` commands cannot release it. A terminal refund is
immutable. The requester cannot record an outcome even if another session for
the same account has both finance permissions.

## Concurrency, replay and financial truth

Both refund protocols lock the same credit before reading reservations. The
canonical protocol then locks the obligation and refund, preserving the
existing settlement lock order. The cap includes all requested, approved,
submitted, unknown and succeeded legacy records as well as canonical records.
Concurrent requests whose combined amount exceeds the refundable amount
produce one accepted request and `409 REFUND_EXCEEDS_REFUNDABLE` for the loser.

The command, audit event, versioned outbox event, financial journal when
applicable, and idempotency receipt share one transaction. A failure in any of
them leaves no partial result. Request and outcome operations have distinct
idempotency namespaces. Lost responses and simultaneous retries with the same
actor, key and body return the committed response once; changed bodies conflict.
Replayed responses remain historical. Clients obtain current refund state with
the read route after replay, rather than interpreting an old `REQUESTED` or
`OUTCOME_UNKNOWN` response as a new financial fact.

The obligation stays `SETTLED` and its public financial status stays `PAID`
after partial or full electronic refunds, as the published contract requires.
The original verified payment and receivable are unchanged. Internal finance
continues to report `PARTIALLY_REFUNDED` or `REFUNDED`, and the ledger records the
actual amount returned. Refund totals are read separately.

The published list permits at most 20 records. All historical records count,
including failed and rejected records. The server rejects a 21st request with
`422 VALIDATION_FAILED` and a `REFUND_LIMIT_REACHED` field issue. It never hides
older financial history to fit the wire format.

## Legacy compatibility

The original credit-based approval/evidence workflow remains available at
`POST /provider-credits/:id/refunds` and the existing `/refunds/:id/decision`,
`/provider-execution` and `/manual-completion` operations.
Its request reasons, approval step, manual evidence digest, provider capability
checks, journal rules and separation of duties remain enforced.

The one conflicting read path is explicit: callers that require the old
credit-based response must use **`GET /legacy/refunds/:id`**. The published
`GET /refunds/:id` now returns the closed `RefundV1` shape. Legacy mutations
cannot operate on a canonical refund, and the canonical outcome command cannot
skip a legacy record's required approval/evidence workflow. The legacy queue
filters its workflow before applying its limit.

Allocated legacy records participate in the canonical obligation summary:
`APPROVED` is projected as `REQUESTED`, `SUBMITTED`/`UNKNOWN` as
`OUTCOME_UNKNOWN`, and `REJECTED` as `FAILED`. Approval therefore cannot appear
as money returned. An unallocated legacy refund has no obligation and remains
readable through its explicit legacy route. A historical successful provider
refund without a final reference, or an obligation with more than 20 historic
refunds, cannot be represented truthfully by the closed contract and returns
`503 SERVICE_NOT_READY`; history is neither fabricated nor truncated.

## Migration, deployment and rollback

Migration `20261122090000_canonical_obligation_refunds` adds an immutable
`workflow` discriminator to the existing refund table. Existing rows receive
`CREDIT_V1` without changing their amounts, references, actors, decisions or
timestamps. `OBLIGATION_V1` adds the published two-person outcome lifecycle.
Both use the same credit, cap, unique provider reference and commit-time ledger
guards. The migration retains every old workflow's fact/transition checks,
adds the canonical branches, and permits the registered
`billing.refund-status-changed.v1` event in the owner outbox.

Apply the migration with the Billing migration identity before deploying code.
The runtime identity retains DML-only access and cannot invoke the private
financial assertion helpers or read migration history. The disposable upgrade
sentinel writes an approved legacy refund under the previous P04 schema,
applies the full history, compares all old refund facts unchanged, and completes
that refund with its required evidence and balanced journal using the runtime
role. No test grants or disabled triggers are needed.

A code rollback is compatible while no `OBLIGATION_V1` row has been committed.
Once the new protocol has recorded financial facts, an older binary does not
understand them: use a reviewed forward repair or restoration plan. Never delete
or rewrite financial history to enable rollback. Stop new canonical requests
at the service boundary before any such operation; unknown reservations must
remain visible and reserved.

## Verification scope and remaining decisions

The actual HTTP/PostgreSQL regression is
`services/billing/test/integration/billing.refunds-v1.postgres.spec.ts`. It uses
two independent Billing pools and the production statement adapter, with
separate recorder/approver identities. Identity and Pricing are HTTP doubles;
Work is an explicit port double. The tests cover partial/full refunds with
shared parsers, authentication and four eyes, strict validation and malformed
JSON, stale revisions, two-replica cap and idempotency races, lost request and
outcome responses, durable unknown outcomes, duplicate references, history
limits, rollback on outbox failure, legacy compatibility, cash refusal, and
database constraints. Pure projection tests cover every legacy lifecycle state
and nonrepresentable history.

The canonical CI command is
`node scripts/production/B/postgres-acceptance.mjs --service billing` on pinned
PostgreSQL 16.10. It includes the populated-history upgrade sentinel, schema
drift check, all owner integration suites, and isolated finance/relay suites.
Local PostgreSQL 17 evidence is diagnostic and does not replace the final
commit's canonical CI result.

Local candidate verification on 2026-11-22 passed the populated P04 refund
upgrade, runtime-role restrictions and zero schema drift. The complete Billing
PostgreSQL regression passed 111 tests: 105 command/integration tests, three
isolated finance tests and three isolated relay-storage tests. The 105 include
the 13 canonical refund cases. Billing's 86 offline tests and nine migration
orchestration tests also passed, with no skips or TODOs. Release build, test
build, scoped ESLint, formatting and the immutable-reference guard passed.

| Area | Current boundary |
| --- | --- |
| Manual electronic refund on an actual allocated credit | Executable published request/read/outcome subset, with explicit out-of-band accounting. |
| Provider transfer, refund API and merchant verification | No new provider adapter or merchant agreement is supplied. B-11 remains external. |
| Cash refund | A real cash receipt can be read, but a refund request returns `503 SERVICE_NOT_READY` without creating a refund or journal. B-06/B-07 must establish the refund method, authorization, funding source and custody effects. |
| Cancellation, no-show, automatic refund amount or eligibility | B-06 remains a product decision. No automatic eligibility or amount policy is introduced. |
| Refund event delivery | The registered event is persisted atomically. The current cash-custody relay allowlist does not publish refund events; this change does not claim refund broker delivery or a deployed consumer. |
| Production acceptance | Requires exact-candidate CI, configured operational controls and the outstanding external decisions. This slice does not approve the whole P04/P06 sprint or production release. |
