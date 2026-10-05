# W03 acceptance matrix and actual-command inventory

Every W03 case below is **BLOCKED / NOT_RUN** at
`82e7402ed9ab6cc4f565f423441cd0655f2d627a`. No current W03 runner exists.
Future runner names, cases and evidence fields need review; this document does
not claim that a proposed command has been implemented.

## Task-complete integrated cases

| Case                                                 | Required real environment and observable                                                                                                                                                      |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authorized guest and member create                   | Actual Identity/object-authorized HTTP across owners; immutable quote/snapshot, one persisted Booking, committed capacity and independent cash due.                                           |
| First response lost, same-key replay                 | Drop real post-commit response; owner/process/browser restart; same key/body recovers original order and every provider reference with exactly one business effect.                           |
| Changed payload and parallel replay                  | Same actor/operation key with changed body conflicts; independent same-body requests do not create two orders/holds/obligations.                                                              |
| Replay authorization and retention                   | Current guest/member/reviewer revocation and beneficiary scope checked; tombstone/business uniqueness prevents duplicate effect after receipt retention.                                      |
| Last-slot race                                       | Independent authorized clients synchronize real Scheduling transaction race; exactly one committed allocation and loser has no leaked obligation/capacity.                                    |
| Hold expiry versus commit                            | Real DB authoritative clock with accepted boundary/skew; released/expired resource cannot silently commit; deterministic clock seams where approved.                                          |
| Quote expiry/revocation or current ownership failure | Owner validation rejects stale/foreign authority; immutable historical snapshot preserved; no new reservation or cash obligation leaks.                                                       |
| Every coordinator crash window                       | Kill before/after each local commit, remote dispatch/result record and final response; restart resumes same persisted saga generation and reconciles unknown outcomes.                        |
| Failed creation and compensation                     | Prove no orphan capacity/charge after recovery; failed compensation is recorded pending and eventually resolved by authorized owner, never relabeled success.                                 |
| Late/out-of-order financial result                   | Expired capacity cannot revive; approved reacquire/refund/manual policy and independent money-due facts, no assumed payment success.                                                          |
| Outbox publication and lease                         | Real broker outage/return/NACK/confirm loss and crash after confirm; concurrent/reclaimed/final-attempt leases; same immutable event identity and observable exhausted-work state.            |
| Consumer atomicity and integrity                     | Crash before commit and after commit/before ACK; same-ID/same/different-bytes concurrent delivery; unrelated unique constraint failure; one validated local effect.                           |
| Topology/catch-up/DLQ                                | All required durable bindings before producer; one subscriber process absent; missing binding while another matches; broker/DLQ failure/restart and authorized audited replay.                |
| Old/gapped events                                    | No stale state overwrite or repeated financial effect; authorized producer reconciliation/checkpoints.                                                                                        |
| Private document authorization                       | Actual Admin→Gateway→Workforce/Media API; current reviewer scope, private classified object and audit; foreign/expired/revoked grants deny upload/read/review.                                |
| Approve/correct/reject workflow                      | Actual Workforce revision/data/audit changes; resubmission and stale/double decision conflict; approval separate from Identity status/current eligibility.                                    |
| Migration from BASE_W02 data                         | Actual accepted baseline and sanitized owner data; preserve sessions, immutable snapshots, receipts/constraints/outbox/inbox; append-only upgrade/no-op/drift.                                |
| Runtime/migration-role isolation                     | Real forbidden connections/DML/DDL/role escalation across every affected owner; own-role positive controls and broker ACL denials.                                                            |
| All three actual apps                                | Explicit build/typecheck plus actual emitted bundle browser execution, errors and focus/RTL/reduced motion; complete affected W03 producer-backed customer/admin/operator journeys.           |
| Durable browser recovery                             | Restart actual browser session with reviewed guest recovery; safe authority lookup restores same server order, quote/capacity/cash due after process restart.                                 |
| Source/environment evidence and redaction            | Exact target/head/candidate/tree/dirty state, pinned tools, environment allocation/roles, clocks, source-bound artifacts and safe correlation; inject sensitive markers and assert exclusion. |

HTTP 200, liveness, fixture success or a missing/skipped dependency is not full
acceptance. Inspection may use owner-owned DB assertions; no Gateway/peer table
access or private implementation import is permitted.

## Existing commands, not newly executed W03 gates

| Current command                                                                                                                               | Scope/prerequisite                                                                                |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `node scripts/verify-toolchain.mjs`                                                                                                           | Actual Node 24.21.0/pnpm 10.32.1 pins                                                             |
| `pnpm install --frozen-lockfile`                                                                                                              | Existing immutable dependency install                                                             |
| `node scripts/check-design-reference.mjs --base-ref <full-actual-sha>`                                                                        | Reference preservation against actual source, not React pixel parity                              |
| `node architecture/implementation-status.mjs --self-test`                                                                                     | Registry consistency                                                                              |
| `node scripts/f001/acceptance.mjs --base-ref <full-actual-sha>`                                                                               | Foundation ownership/workspace acceptance                                                         |
| `pnpm generate`, `pnpm build`, `pnpm typecheck`                                                                                               | Existing backend/shared scope; excludes frontend commands                                         |
| `pnpm --filter @carwash/customer-web typecheck`, `pnpm --filter @carwash/customer-web build`                                                  | Explicit customer compile/build                                                                   |
| `pnpm --filter @carwash/operator-web typecheck`, `pnpm --filter @carwash/operator-web build`                                                  | Explicit operator compile/build                                                                   |
| `pnpm --filter @carwash/admin-web typecheck`, `pnpm --filter @carwash/admin-web build`                                                        | Explicit admin compile/build                                                                      |
| `pnpm lint`, `pnpm format:check`, `pnpm check:boundaries`, `pnpm check:gateway-contract`                                                      | Existing static gates; preserve thresholds                                                        |
| `pnpm test:unit`, `pnpm test:gateway`, `pnpm test:observability`                                                                              | Existing technical/unit scopes                                                                    |
| `pnpm build:tests`, `pnpm test:nest`                                                                                                          | Existing Nest scope                                                                               |
| `node scripts/check-migrations.mjs --base-ref <full-actual-sha>`                                                                              | History/layout integrity; not populated business-data upgrade                                     |
| `pnpm acceptance:preflight`, `pnpm acceptance:run`                                                                                            | Existing disposable real PG/RabbitMQ foundation; Docker required                                  |
| `pnpm test:integration`                                                                                                                       | Existing provisioned foundation context via CW_CONTEXT_FILE                                       |
| `pnpm acceptance:identity`, `pnpm acceptance:gateway`                                                                                         | Existing real Identity PG/Redis plus browser-security fixture/Gateway                             |
| `node scripts/parallel/E/two-stack-acceptance.mjs --evidence-dir <absolute-unique-dir>`                                                       | Existing isolated two-PG-stack acceptance; self-acquires heavy lease; do not wrap with with-heavy |
| `node scripts/ci/run.mjs static`, `node scripts/ci/run.mjs integration`, `node scripts/ci/run.mjs security`, `node scripts/ci/run.mjs codeql` | Current hosted F009 stages and their prerequisites                                                |
| `node scripts/ci/image.mjs <actual-catalog-target-id>`                                                                                        | Actual independent image build/boot gate                                                          |
| `pnpm test:f010:unit`, `pnpm f010:fonts`, `pnpm test:f010:browser`                                                                            | Existing golden reference/parity harness                                                          |
| `node scripts/c002/browser-acceptance.mjs` through `scripts/c014/browser-acceptance.mjs`                                                      | Existing customer fixture/parity scopes; configured unique origins/evidence required              |

Preserve F009 plan/targeted/static/integration/images/security/codeql, aggregate
and inherited gates. Static already runs all six explicit frontend commands.
W01 GATE_MANIFEST and its historical evidence are not a W03 release manifest.
No production-provider/staging or Windows/device test was run by this audit.

## Exact real-versus-fixture boundaries

Customer React C002–C014 uses fixture session state. C014 reload explicitly
expects order-handoff state **not-found**; it proves absence of durable recovery.
Pure confirmation replay/conflict tests prove session logic, not owner receipts.
Root build success alone does not cover any frontend.

`tests/parallel/E/web-runtime.test.mjs` serves actual dist assets over HTTP but
does not execute browser JavaScript. Operator/Admin are Vite technical boots,
BUSINESS_READY=false, without the product React/client workflows. F006 uses a
security fixture page against real Identity/PG/Redis, not the three product apps.
Foundation messaging tests use Catalog probes, not Booking/cash effects.

All three complete HTML authorities and F010 hashes were independently read.
The later F010 technician/admin registrations supersede older wording about
unregistered future designs, while missing production screens still need approval.
F010 reference-to-itself parity and known debt matching are not React parity or
full accessibility conformance.

Preserve seven customer steps, optional plate, Arabic RTL/icons/motion/focus and
each reference's own visuals. Private review/correction UI is absent from Admin's
prototype handlers. Riyadh/SAR/Card/admin KPI examples are not Aleppo operating
inputs or a fourth customer payment method. Technician completion/unpaid-follow-up,
cash collection, company custody and payment verification stay distinct. Approved
cash/ShamCash/Syriatel choices do not prove operational provider connectivity.
