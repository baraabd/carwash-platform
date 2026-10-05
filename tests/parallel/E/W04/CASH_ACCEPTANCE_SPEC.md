# W04-E cash acceptance specifications — not executable evidence

Every case is **BLOCKED / NOT_RUN** at `1ec9d8aebf4470a2815471116643fa6ebe0d5a95`.
No W04 runner or accepted BASE_W04 exists. This file is a test specification,
not a fixture promoted to runtime, a skipped passing test or a result artifact.
Entry checks must fail closed before any command when required providers, approved
inputs, current contracts, actor grants or convergence budgets are absent.

## Real environment and task-complete cases

Use actual separate owner databases/runtime/migration roles, Gateway/Identity,
Redis, RabbitMQ, Media object store/scanner and the actual three app bundles.
A deterministic sanitized isolated dataset must configure staff, two eligible
technicians, real accepted Aleppo coverage/hours and server price/currency policy.
Synthetic test accounts/images are labeled; real services/constraints/transport
are not mocked. Never send live money, merchant requests or real notifications.

| ID      | Concrete case                                                                                              | Required observation / evidence                                                                                                                                         |
| ------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CASH-01 | Customer selects seven separate steps and explicitly confirms cash                                         | Actual accepted quote/coverage, optional plate, persisted Booking/capacity/obligation IDs; guest and member variants; no fixture fallback                               |
| CASH-02 | Admin reviews eligible staff and assigns a scoped work item                                                | Current jurisdiction/grants, assignment revision, owner audit; admin owns no DB state                                                                                   |
| CASH-03 | Technician accepts/travels/arrives; before evidence then starts                                            | Legal Booking transitions and one Dispatch assignment; current eligibility checked, minimum customer data                                                               |
| CASH-04 | Before/after upload, processing, checklist and completion                                                  | Real private bytes/scan/checksum; before → start → checklist → after → explicit finish → vehicle handover/closure; reject premature transitions, one completion outcome |
| CASH-05 | Authorized full cash collection                                                                            | Q from immutable server total, C=Q/D=0, one business collection/posting/receipt, balanced ledger and audited collector                                                  |
| CASH-06 | Customer reads receipt; admin reconciles before and after handover                                         | Exact Booking/Billing/Wallet/Reporting IDs/amounts; K=Q/S=0 then K=0/S=Q; no second customer payment                                                                    |
| CASH-07 | Delivered but unpaid full journey                                                                          | Work completed, C=0/D=Q/K=0/S=0, unpaid follow-up and truthful customer/admin state; no collected receipt                                                               |
| CASH-08 | Reload each app before/after committed and pending mutations                                               | Independent browser storage; same server references/revisions; no demo order or duplicate submission                                                                    |
| CASH-09 | Restart one actual owner service mid-journey                                                               | Deterministic process handle/window, persisted recovery, same receipts and convergence within predeclared recovery budget                                               |
| CASH-10 | Two technicians accept simultaneously                                                                      | Synchronization barrier at real requests/transactions; one live assignment, losing result explicit; no hidden duplicate work/grants                                     |
| CASH-11 | Completion replay/concurrency and post-commit response loss                                                | One business transition and same stored result/event; lost HTTP response recovers same key across browser reload/service restart; DB uniqueness and broker replay       |
| CASH-12 | Completion same key with changed payload or stale revision                                                 | Conflict; original body/result preserved and no secondary evidence/transition                                                                                           |
| CASH-13 | Collection replay, parallel same-body and post-commit response loss                                        | Same collection/posting/receipt and one financial effect across restart; count business reference, not one ledger row                                                   |
| CASH-14 | Collection same key changed amount/currency/reference; new key duplicate business reference                | Conflict or accepted explicit rejection; immutable original posting; business uniqueness survives receipt retention                                                     |
| CASH-15 | Anonymous/foreign customer/unassigned technician/wrong-scope admin accesses private image or excess fields | Denied metadata and actual bytes; no leaked signed URL/cache; owner-local no forbidden access/effect                                                                    |
| CASH-16 | Expired/revoked media grants and reassigned technician                                                     | Deny new reservation/finalization/read under accepted URL/proxy semantics; no immediate bearer-URL revocation claim without enforcement at object fetch                 |
| CASH-17 | Technician attempts electronic-payment approval via raw API                                                | Real owner authorization rejection and unchanged financial state; absent button is insufficient                                                                         |
| CASH-18 | Revoked/foreign finance actor or revoked/reassigned technician attempts work/cash commands                 | Denied work/collection/correction/settlement under current grant/assignment/jurisdiction; unchanged owner work, ledger and custody                                      |
| CASH-19 | Exact references and lossless amounts across every stage                                                   | Immutable quote/obligation, collection/receipt/posting, holder/handover/treasury and applied source vector; no float coercion                                           |
| CASH-20 | Duplicate/out-of-order/gapped source events                                                                | No stale overwrite/double financial effect; explicit gap and authorized reconciliation to source revisions                                                              |
| CASH-21 | Producer outage / confirm loss / hard crash after confirm                                                  | Same immutable event/hash after restart, one local consumer effect, observable exhausted work and no stranded lease                                                     |
| CASH-22 | Consumer crash before commit / after commit before ACK                                                     | Atomic Inbox+effect, safe redelivery, synchronized same-ID different-bytes race and unrelated unique violation                                                          |
| CASH-23 | Stopped subscriber / missing one binding / DLQ outage                                                      | All required durable queues before producer; catch-up, partial-binding failure and integrity-preserving audited replay                                                  |
| CASH-24 | Custody/treasury commands lose response or restart at each local/remote window                             | Distinct durable operation receipts; no double handover/settlement, pending recovery remains visible                                                                    |
| CASH-25 | Upgrade from populated actual accepted predecessor data                                                    | Separate append-only owner migrations, immutable history preserved, upgrade/no-op/drift and real constraints; no reset/fresh-only substitution                          |
| CASH-26 | Cross-owner DB/role/broker/object denials with positive controls                                           | Forbidden DML/DDL/connection/escalation/publish/read fails; own actor succeeds; Gateway has no business DB                                                              |
| CASH-27 | Bounded causal convergence and pending-work accounting                                                     | Reviewed 30s/120s proposal or accepted replacement; monotonic deadlines, source checkpoints, exact facts; no arbitrary sleep assertions                                 |
| CASH-28 | Reporting rebuild/reconciliation                                                                           | Projection rebuild reaches same source vector without new payment, source mutation or notification sends                                                                |
| CASH-29 | Deterministic reference/candidate/diff for actual affected screens                                         | Linux pinned browser/fonts/clock, widths320/390/430/768/1024/1440, height900/DPR1/ar-SY/Asia-Damascus; existing thresholds unchanged                                    |
| CASH-30 | RTL/focus/keyboard/mobile/touch/motion and private comparison                                              | Correct order/focus/errors/sheets, normal and reduced motion, slider/play/zoom; separate Windows/device interaction evidence                                            |
| CASH-31 | All mandatory CI, all explicit app commands and latest source gates                                        | Candidate parents, full SHA/tree/clean context; unchanged gate matrix; repeat affected gates on actual resulting target                                                 |
| CASH-32 | Safe evidence, cleanup and reviewed handoff                                                                | Redacted test traces/media/receipts, correlations and digest manifest, real-versus-mocked labels, owned handles cleaned, independent review                             |

All 32 remain visible until their actual combined-source results exist. Failures
after valid entry are FAIL, missing entry is BLOCKED; neither is a successful skip.
The two journeys include actual three-browser execution and saved evidence.
Foundation probes, pure lifecycle/ledger tests and F010 reference-self comparison
cannot close these cases.

## Existing commands, with bounded meaning

The current repository implements these commands; this child only runs the
local toolchain/reference/format/JSON/scope checks recorded in CHECKPOINT.
Hosted foundation results are linked and source-bound in the live PR.

```sh
node scripts/verify-toolchain.mjs
node scripts/check-design-reference.mjs --base-ref 1ec9d8aebf4470a2815471116643fa6ebe0d5a95
pnpm --filter @carwash/customer-web typecheck
pnpm --filter @carwash/customer-web build
pnpm --filter @carwash/operator-web typecheck
pnpm --filter @carwash/operator-web build
pnpm --filter @carwash/admin-web typecheck
pnpm --filter @carwash/admin-web build
node scripts/ci/run.mjs static
node scripts/ci/run.mjs integration
node scripts/ci/run.mjs security
node scripts/ci/run.mjs codeql
```

Preserve F009 plan/targeted/static/integration/23 images/security/codeql/aggregate
and all inherited mandatory gates. Static already runs the six frontend commands.
Existing `pnpm acceptance:run` tests disposable foundation PG/RabbitMQ;
`pnpm acceptance:gateway` uses real Identity PG/Redis and a security fixture page.
`node scripts/parallel/E/two-stack-acceptance.mjs --evidence-dir <allocated-absolute-dir>`
self-acquires the heavy lease; do not wrap it with a second heavy lease.
Existing `pnpm test:f010:browser` and C002–C014 browser scripts target references/
fixture customer state. No existing command is a persisted W04 cash E2E runner.

A future E implementation must publish its actual runner and pre-run manifest
after accepted providers/contracts. No nonexistent command is claimed here.
No local browser/product stack, merchant/provider, staging or Windows/device
acceptance has been executed by this documentation child.
