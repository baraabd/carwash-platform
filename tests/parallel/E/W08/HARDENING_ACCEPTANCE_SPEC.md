# W08-E declarative hardening acceptance specification

Status: **45 families BLOCKED_NOT_RUN**. No new executable product tests are claimed.
This specification consumes accepted contracts once published; all proposed
schemas/policies remain unapproved. Shared prerequisites and artifact requirements
apply to every family, including all its required subcases.

## Common execution and oracle requirements

Use the exact combined candidate SHA/tree and retained image/config/profile IDs,
real owner processes/transactions and isolated namespaces. Record start/end/fault
instants, original actor/object/operation/idempotency IDs, synchronized barriers,
actual persisted state and owner API responses. Use owner-authorized observation
APIs or each owner's own tests; E must not cross-read owner databases. Retain
redacted runner output, current-source receipts, before/after invariants, resource
samples and independent cleanup outcome. Distinguish fixtures and controlled mocks
from real providers. No skipped case, fast timeout, navigation or screenshot can
stand in for durable money/capacity/work/media evidence.

H36..H40 preserve every obligation in the [W07 full-scope matrix](../../../../docs/parallel/E/W07/FULL_SCOPE_MATRIX.md):
seven separate customer steps and87 actions/20 families; operator-web5 views,
6 phases and21 sheets; all17 admin capabilities plus shell actions. Retain
per-action/per-state evidence; no deferred or dropped row is counted as accepted.
User motion preference and OS precedence require the pending approved preference
contract; the current account preference is deferred, not silently waived.

For races, use genuinely concurrent real transactions and repeat under the frozen
contention profile; no sequential helper test or invented repetition count. For
faults, interrupt the real dependency at every specified commit/confirm/ACK seam,
restart and replay the original IDs, and inspect authoritative final state after
approved post-health convergence. A cleanup failure remains FAIL; an operation
that committed before cancellation retains its receipt/status. For app families,
retain real-browser and separate device evidence with reference/candidate/diff
artifacts where applicable; raw private data must not enter the evidence collector.

## H01 — Live principal, guest and ownership

Risk E08-R01; owner Identity/E; all owners. **BLOCKED_NOT_RUN**.

At prepare, commit, replay, status and download, deny foreign subject/order/attempt/purpose and expired guest grants; assert zero unauthorized persisted effects and bytes.

Source observation: Live session/authVersion checks exist; accepted guest/object/purpose capabilities are absent. Source: `services/identity/src/application/identity-auth.service.ts`.

## H02 — Staff revocation during active work

Risk E08-R02; owner Identity/E; A-D. **BLOCKED_NOT_RUN**.

Revoke staff between authorization and commit, during replay and before private download; prove current authority is rechecked at the accepted consistency boundary and stale content disappears.

Source observation: Identity has suspension and permission invalidation tests; owner business operations are absent. Source: `tests/identity/api.test.mjs`.

## H03 — Gateway identity and trust headers

Risk E08-R03; owner Gateway/E. **BLOCKED_NOT_RUN**.

Send forged subject/session/authVersion, duplicate headers and mismatched claims through real Gateway and owners; reject spoofing and retain actual actor attribution.

Source observation: Gateway forwards a verified principal; domain fixtures are explicit stubs. Source: `apps/api-gateway/src/application/gateway.service.ts`.

## H04 — Direct service API bypass

Risk E08-R04; owner A-D; E platform. **BLOCKED_NOT_RUN**.

Call actual owner services without UI/Gateway restrictions using user, guest, staff and service identities; deny unintended endpoints, object scopes and cross-market/delegation access.

Source observation: Routing acceptance uses real Identity but stub domain providers. Source: `tests/gateway/api.test.mjs`.

## H05 — Runtime identity, TLS and secret rotation

Risk E08-R05; owner E infrastructure; each owner. **BLOCKED_NOT_RUN**.

Prove per-owner DB/role/broker/storage rights, production auth enabled, TLS and distinct secret/key handling; rotate keys during active/replayed requests without unauthorized fallback or secret exposure.

Source observation: Disposable ACL checks exist; deployed current_user, TLS and rotation are unproved. Source: `infra/postgres/provision.sh`.

## H06 — Private media purpose and object access

Risk E08-R06; owner Media/C; consuming apps. **BLOCKED_NOT_RUN**.

Test cross-user/order/work-attempt/purpose access at prepare, finalize, processing, read and recovery; reassignment/revocation must deny bytes and side effects.

Source observation: Media is a marker-only shell; private media contracts are unpublished. Source: `services/media/prisma/schema.prisma`.

## H07 — Malicious upload and quarantine

Risk E08-R07; owner Media/C. **BLOCKED_NOT_RUN**.

Execute wrong MIME/extension/magic, polyglot, corrupt/truncated, huge-pixel/metadata/filename and exhaustion cases against approved server limits; rejected/quarantined media cannot fulfill work or payment.

Source observation: No production upload validation or quarantine exists. Source: `services/media/prisma/schema.prisma`.

## H08 — Stale links and cached private previews

Risk E08-R08; owner Media/C; Identity/E. **BLOCKED_NOT_RUN**.

Copy links across actors and retry after expiry, revoke, reassignment, delete, retention and account switch; inspect server bytes, browser caches and invalidated previews under the approved policy.

Source observation: No signed-link implementation or accepted lifetime/revocation policy exists. Source: `services/media/prisma/schema.prisma`.

## H09 — Private canaries in logs, exports and browser evidence

Risk E08-R09; owner E observability; A-D exports. **BLOCKED_NOT_RUN**.

Use isolated private sentinels through errors/retries/workers, logs/traces, CSV/PDF, screenshots and collector output, including signed links/free text; assert no prohibited disclosure with evidence access and retention controls.

Source observation: Server redaction exists; browser collector records raw URLs and errors. Source: `scripts/c004/parity-harness.mjs`.

## H10 — Audit integrity and approved retention

Risk E08-R10; owner Identity/E; audit-owning services. **BLOCKED_NOT_RUN**.

Attempt audit UPDATE/DELETE with actual runtime identity, replay provisioning, upgrade/restore and exercise approved purge authority; prove transactional audit completeness and forbidden mutation denial.

Source observation: Own runtime receives UPDATE/DELETE on own tables; IdentityAudit has no immutable DB guard. Static control gap, no exploit run. Source: `infra/postgres/provision.sh`.

## H11 — Scanners and retained finding disposition

Risk E08-R11; owner E CI/security. **BLOCKED_NOT_RUN**.

Retain complete-history/source secret, all-severity dependency, all required image and real CodeQL records on the candidate; resolve findings under existing policy, including installer/ACL redirect, timeout, truncation, checksum and redaction regressions.

Source observation: Exact f0 security passed; CodeQL has four nonblocking warnings. Source: `scripts/ci/policy.mjs`.

## H12 — Evidence identity and fixture boundary

Risk E08-R12; owner E release; all owners. **BLOCKED_NOT_RUN**.

Bind source/tree/config/image/profile/run/attempt and dirty state to every artifact; refuse missing/stale/malformed records, mocked provider substitution, partial checkout, suppressed failures and private-data artifacts.

Source observation: F009 accepts foundation only; demo/fixtures cannot establish product readiness. Source: `scripts/ci/aggregate.mjs`.

## H13 — Last available slot

Risk E08-R13; owner Scheduling/Booking/C. **BLOCKED_NOT_RUN**.

Synchronize real competing transactions for the final capacity unit; only allowed winners commit, losers remain actionable, holds expire/release and capacity reconciles without orphan or oversell.

Source observation: Scheduling and Booking have marker models; no persistent capacity producer. Source: `services/scheduling/prisma/schema.prisma`.

## H14 — Last entitlement

Risk E08-R14; owner Subscription/B; Booking/C. **BLOCKED_NOT_RUN**.

Race real reserve/consume/release for the last eligible entitlement; inspect owner records and coordinator receipts, one valid consumption and full failed/expired recovery.

Source observation: Persistent entitlement reserve/consume/compensate contracts are absent. Source: `services/subscription/prisma/schema.prisma`.

## H15 — Last funds and promotion use

Risk E08-R15; owner Wallet/Pricing/B; Booking/C. **BLOCKED_NOT_RUN**.

Race approved custody/balance holds and final promotion use; enforce exact currency/minor units and immutable historical snapshots without negative funds, double redemption or replacement financial effects.

Source observation: Wallet/promotion producers and approved holder/purpose policy are absent. Source: `services/wallet/prisma/schema.prisma`.

## H16 — Competing assignment

Risk E08-R16; owner Dispatch/Workforce/C. **BLOCKED_NOT_RUN**.

Race staff/operator assignments and reassignment against current revisions, availability and authority; one valid assignment wins and stale actors cannot perform or upload against the superseded attempt.

Source observation: Real assignment/work execution producers are absent. Source: `services/dispatch/prisma/schema.prisma`.

## H17 — Repeated payment/refund and reviewer CAS

Risk E08-R17; owner Billing/B; Workforce/C; E Identity. **BLOCKED_NOT_RUN**.

Race duplicate verification, concurrent reviewer decisions, refund requests and provider callbacks; assert one authorized monetary effect, exact audit/ledger linkage and durable reconciliation of conflicting outcomes.

Source observation: Financial verification/refund runtime is absent; a proof image is not money. Source: `services/billing/prisma/schema.prisma`.

## H18 — Idempotency conflicts and UNKNOWN

Risk E08-R18; owner Every mutation owner; E Gateway. **BLOCKED_NOT_RUN**.

Race same key/same fingerprint and same key/changed fingerprint, lose the committed reply, reload/retry/status; recover the original operation and immutable result without generating a replacement key or second effect.

Source observation: Gateway makes one bounded attempt; key forwarding is not persistent deduplication. Source: `apps/api-gateway/src/infrastructure/http-client.ts`.

## H19 — Late payment after expired capacity

Risk E08-R19; owner Billing/B; Scheduling/Booking/C. **BLOCKED_NOT_RUN**.

Commit verified payment after hold expiry/reassignment; keep money and capacity independent, forbid automatic resurrection and complete the approved compensation/refund disposition.

Source observation: No durable multi-owner compensation coordinator exists. Source: `services/booking/prisma/schema.prisma`.

## H20 — Quote revision and terminal intent

Risk E08-R20; owner Pricing/B; Booking/C; customer/A. **BLOCKED_NOT_RUN**.

Change catalog/price/availability between quote and commit, replay narrow C intent and expired/terminal receipt; require current revalidation, immutable prior snapshots and no unintended later commit.

Source observation: Pure helpers/demo do not persist real pricing or booking. Source: `services/pricing/prisma/schema.prisma`.

## H21 — Privacy result linkage and suppression

Risk E08-R21; owner Identity/E; Support/Reporting/D; approved coordinator and all data owners. **BLOCKED_NOT_RUN**.

Bind request, subject and owner task/result; forge foreign/duplicate/conflicting/out-of-order results and race commit/ACK/replay, revoke/delete, export and restore; reject invalid linkage, preserve suppression and owner-local deletion without cross-database deletes or unavailable-as-empty.

Source observation: No accepted privacy fulfillment/result producer exists. Source: `services/support/prisma/schema.prisma`.

## H22 — Inbox duplicates versus conflicts

Risk E08-R22; owner Communications/Reporting/D; E messaging. **BLOCKED_NOT_RUN**.

Synchronize both real stores for same-ID/same-bytes, changed bytes and unrelated effect constraint violations; inspect committed winner/payload and rollback, refusing unjustified ACK or masked conflict.

Source observation: Transaction-wide unique errors become DUPLICATE; consumer ACKs duplicates. Source risk, no reproduced data loss. Source: `services/reporting/src/inbox/prisma-inbox.store.ts`.

## H23 — Producer commit, publish, confirm and mark

Risk E08-R23; owner Catalog/B; E messaging. **BLOCKED_NOT_RUN**.

Kill actual producer/relay at each accepted DB commit, publish, confirm and mark seam; restart and inspect original event/operation IDs, durable pending disposition and one downstream business effect.

Source observation: Real foundation outbox/probe exists; product producers absent. Source: `services/catalog/src/outbox/prisma-outbox.store.ts`.

## H24 — Consumer commit and ACK

Risk E08-R24; owner Communications/Reporting/D; E messaging. **BLOCKED_NOT_RUN**.

Crash before/after effect plus inbox commit and before/after broker ACK; replay with real transactions and reconcile one business effect, valid conflict handling and no forgotten delivery.

Source observation: Real probe consumer exists, not business inbox acceptance. Source: `packages/platform-messaging/src/inbox-consumer.ts`.

## H25 — Final lease crash and fencing

Risk E08-R25; owner Catalog/B; E messaging. **BLOCKED_NOT_RUN**.

Crash on final permitted lease and overlap reused worker identity/reclaim; prove explicit exhausted-state disposition and the accepted unique-instance/per-lease fencing invariant without replacing event identity.

Source observation: A final leased attempt crash can leave unpublished/nondead work ineligible. Static risk. Source: `services/catalog/src/outbox/prisma-outbox.store.ts`.

## H26 — Batch lease tail under delayed confirms

Risk E08-R26; owner Catalog/B; E messaging. **BLOCKED_NOT_RUN**.

Delay confirms through tail expiry and run competing reclaimers; inspect fencing, retained identities, duplicate deliveries versus one business effect and complete durable reconciliation.

Source observation: Batch20 leases30s before sequential publish with10s confirm deadline; tail can outlive lease. Inference, not measurement. Source: `packages/platform-messaging/src/outbox-relay.ts`.

## H27 — Publisher pressure, listeners and stalled connect

Risk E08-R27; owner E messaging; Catalog/B. **BLOCKED_NOT_RUN**.

Sustain broker pressure/repeated passes and stall connection/channel creation; measure outstanding work/listeners/RSS/FD, confirm/return integrity, bounded shutdown and no leaked owned handle.

Source observation: publish backpressure return is ignored; reused-channel publisher listeners lack disposal; connection has no explicit attempt AbortSignal. Source: `packages/platform-messaging/src/publisher.ts`.

## H28 — Transient retry, poison and dead letter

Risk E08-R28; owner E messaging; each consumer. **BLOCKED_NOT_RUN**.

Run transient/poison/oversized messages, unavailable consumer and replay; enforce approved retry/backoff/exhaustion/queue-byte limits, explicit dead-letter disposition and recovery without hot loops or silent loss.

Source observation: Immediate transient requeue and probe quorum ceiling3 exist; accepted business retry/capacity policy absent. Source: `packages/platform-messaging/src/inbox-consumer.ts`.

## H29 — DB outage, readiness and pool acquisition

Risk E08-R29; owner E service kit; all owners. **BLOCKED_NOT_RUN**.

Block DB/network and repeat readiness under load; inspect pool waiters/sockets/in-flight probes, acquire deadlines, late completion and durable operation status; quick503 alone is insufficient.

Source observation: Readiness timeout does not cancel the underlying probe; aggregate pool/acquire budgets absent. Source: `packages/service-kit/src/health.ts`.

## H30 — Provider and storage interruptions

Risk E08-R30; owner Billing/B; Media/C; E environment. **BLOCKED_NOT_RUN**.

Interrupt accepted verification/refund and media acquire/upload/process/finalize/read before/after commits; resume the original operation, one finalized object/effect, quarantine enforcement and no orphaned money/holds.

Source observation: Real provider/storage boundaries and policy are unpublished. Source: `services/media/prisma/schema.prisma`.

## H31 — Partition and projection catch-up

Risk E08-R31; owner Communications/Reporting/D; E environment. **BLOCKED_NOT_RUN**.

Partition/reorder/delay messages and stop projection owners; measure post-health catch-up against approved limits, retained checkpoints, correct original order/revision and no false paid/empty/zero status.

Source observation: Probe checkpoint behavior exists; business projections/recovery contracts absent. Source: `services/reporting/src/inbox/consumer.runner.ts`.

## H32 — Cancellation, D3 recovery and late mutations

Risk E08-R32; owner E harness; affected producers. **BLOCKED_NOT_RUN**.

Cancel during outage, restore, blocked producer transaction and pool wait; require independent awaited cleanup, owned worker stop, failure propagation, no late mutation into next reset/case and retained committed receipts.

Source observation: Case A now uses awaited recovery; D3 still swallows async-finally cleanup errors. Scope guards cannot drain signal-ignoring DB operations. Source: `tests/integration/outbox-inbox.test.mjs`.

## H33 — Representative workload and data

Risk E08-R33; owner E environment; A-D. **BLOCKED_NOT_RUN**.

Execute approved browse/quote/book/pay/execute and reporting mix with realistic sizes/skew/contention/guest-member/method mix and measured offered/completed demand; retain immutable generator and dataset identity.

Source observation: No accepted functional base or realistic workload profile. Source: `architecture/parallel-contract-release.json`.

## H34 — Latency, errors, saturation and convergence

Risk E08-R34; owner E environment; each owner. **BLOCKED_NOT_RUN**.

Measure per-journey p95/p99, failures/timeouts, pool/queue depth/oldest age/retries and CPU/RSS/I/O under the frozen predeclared profile; validate business invariants and recovery against approved limits.

Source observation: HTTP business labels collapse to application; product numeric limits and queue/backlog instrumentation are unapproved. Source: `packages/observability/src/metrics.ts`.

## H35 — Workstation validity and abort rules

Risk E08-R35; owner E environment. **BLOCKED_NOT_RUN**.

Measure generator/host headroom and abort per frozen limits; classify product FAIL separately from constrained/invalid environment, preserve failing evidence and rerun only without lowering limits.

Source observation: One heavy slot is the initial allocation rule; no representative resource budget exists. Source: `docs/parallel/E/W07/W08_HARDENING_AND_BLOCKERS.md`.

## H36 — All-app motion and reduced motion

Risk E08-R36; owner A/C/D; E coordination. **BLOCKED_NOT_RUN**.

Test cold start and runtime OS preference change on every required route/state, map, comparison and loading interaction; no state transition depends on an effect timer or prohibited motion.

Source observation: Customer partial demo handles reduced motion; operator/admin are technical boots. Source: `apps/customer-web/src/styles/customer-shell.css`.

## H37 — Focus, keyboard and dialog races

Risk E08-R37; owner A/C/D; E coordination. **BLOCKED_NOT_RUN**.

Execute validation focus, open/change/close/reopen/back/unmount/late-close races and revoked viewer state; prove correct current focus, inert background, scroll release and reachable controls across all apps.

Source observation: Customer native dialog/scroll lock exists; full app keyboard flow absent. Source: `apps/customer-web/src/shared/Sheet.tsx`.

## H38 — RTL/LTR and required English

Risk E08-R38; owner A/C/D; approved design owners. **BLOCKED_NOT_RUN**.

Run mixed-direction phone/order IDs, long real errors and complete approved language flow with correct semantics and focus; require design decisions for missing states before app implementation acceptance.

Source observation: Frozen references are Arabic; full approved English/production states are absent. Source: `docs/design/f010-reference-manifest.json`.

## H39 — Phone and slow-network recovery

Risk E08-R39; owner A/C/D; Media/C. **BLOCKED_NOT_RUN**.

On actual phone and separate Windows/device evidence test keyboard/footer/safe area/orientation, optional plate, permission/manual fallback, reordered reads/account switches, committed-reply loss and interrupted uploads; no stale private content or duplicate write.

Source observation: C014 is bounded session-only handoff; production tracking/network behavior absent. Source: `apps/customer-web/src/widgets/order-handoff/OrderHandoff.tsx`.

## H40 — Canonical pixels and accessibility debt

Risk E08-R40; owner A/C/D; E reference governance. **BLOCKED_NOT_RUN**.

Preserve exact frozen pixel thresholds and execute actual all-app accessibility with approved criteria; record owner decisions for inherited debt without regenerating goldens, weakening checks or copying debt into PASS.

Source observation: Reference has serious contrast debt and admin overflow; debt is not a future production waiver. Source: `docs/design/f010-reference-debt-baseline.json`.

## H41 — Upgrade, backup and restore

Risk E08-R41; owner E release; each data owner. **BLOCKED_NOT_RUN**.

Upgrade clean and accepted prior populated state, restore the approved backup and reconcile finance/holds/inbox/outbox/checkpoints under owner RPO/RTO; preserve current revocation/privacy suppression and secret/session/key policy.

Source observation: Clean/no-op/drift and populated Identity foundation tests are bounded; complete populated-product restore absent. Source: `docs/VERIFICATION.md`.

## H42 — Rollback and forward recovery

Risk E08-R42; owner E release; all owners. **BLOCKED_NOT_RUN**.

Rehearse the approved compatible rollback or forward path with schema/client/event/worker versions; do not replay charges/refunds/benefits/notifications or destroy durable recovery identifiers.

Source observation: No complete reviewed product migration/worker/client rollback inventory. Source: `architecture/service-catalog.json`.

## H43 — Monitoring, on-call and owned cleanup

Risk E08-R43; owner E operations; named owners. **BLOCKED_NOT_RUN**.

Trigger approved fault alerts in already-authorized isolated/existing staging scope, prove dashboard/alert/on-call/escalation and abort actions, preserve evidence and release only owned resources.

Source observation: Existing staging identities/access, collector wiring and on-call rehearsal are unverified. Source: `docs/parallel/E/W07/CANDIDATE_AND_STAGING_GATES.md`.

## H44 — Owner fixes and latest candidate/target

Risk E08-R44; owner E integrator; independent reviewers. **BLOCKED_NOT_RUN**.

Return owner corrections to normal PR review; test latest-target plus head candidate with all mandatory/affected gates, independent approval and unchanged refs; recheck actual resulting target before advancing.

Source observation: Current f0 mandatory CI is foundation evidence only; W08 product acceptance absent. Source: `scripts/ci/aggregate.mjs`.

## H45 — Frozen W09 barrier

Risk E08-R45; owner E release; all owners. **BLOCKED_NOT_RUN**.

Freeze source/tree/digests/config/contracts/migrations/profile/findings/rehearsal only after every blocking risk passes on current combined source; publish BASE_W09 through the accepted barrier and stop before unrequested W09 work.

Source observation: BASE_W08 and BASE_W09 are unpublished; parent cannot be DONE. Source: `architecture/parallel-contract-release.json`.

## Completion barrier

Every required subcase needs current-source result and linked authoritative oracle.
Missing instrumentation/producer/approved criterion means BLOCKED, not PASS.
Measured invariant/security failure means FAIL; constrained generator/environment
means INVALID/CONSTRAINED and requires an approved rerun without adjusted limits.
After normal owner fixes, rerun affected and mandatory integrated gates on the
latest candidate and actual resulting target. Parent remains NOT_STARTED until
entry is satisfied, then INTEGRATION_PENDING until every declared risk and rehearsal
passes and independent review is complete. No automatic W09 task begins.
