# W05-B acceptance specifications

All cases below are **UNEXECUTED**. No business test/build, database/broker test, provider call, account operation, live-money test or refund ran. Actual local proposal diagnostics are recorded in [B's checkpoint](../../../../docs/parallel/B/W05/CHECKPOINT.md).
Immutable observed main: `3ce756cd39a9b0c1013043cee0ca1bb183466da7`; tree `cc3517ec85525c7310fe340397506ef6be3fe0a9`; inspected in `carwash-w05b-source`.
`carwash-w05-source` was observed during this audit at unmerged A proposal `1eeafc09d6c6392201067032d76a8e4fa63de54e`; its A/W05 additions are excluded from accepted evidence.
Entry is blocked: BASE_W05/W04 cash acceptance, frozen provider/refund contracts, Paymera decision, genuine protocols and authorized merchant/sandbox configuration are absent. E's registry remains W01 INTEGRATION_PENDING with BASE_W02 null and accepted-next-wave list empty.
Billing/Wallet currently have ServiceMarker-only schemas and foundation readiness false; Billing's pure journal assertion is not a ledger, receipt, received-credit, refund or SQL-immutability implementation.
Required execution facilities: E-allocated separate owned PostgreSQL databases/runtime and migration roles, durable RabbitMQ namespaces/ACLs/bindings, merged Identity/Media/Booking/Scheduling/Wallet/Reporting providers, scoped ports/output/browser profiles and approved test merchant access. Synthetic callbacks remain separately labeled.

- **W05-B-001 — Entry, bounded producer sequence and provenance — UNEXECUTED**
  Given the observed source, inspect E's immutable base/release record, W04 actual cash journey and closed contracts/policies; sequence narrow verification/review, refund/compensation, C coordination and A/C/D consumers against merged providers.
  Require exact accepted SHA/tree/package/policy versions and independent gate records; proposal merges, foundation counts and unmerged A/W05 documents cannot authorize runtime implementation or close parent acceptance.

- **W05-B-002 — Genuine provider capability and scope dossier — UNEXECUTED**
  For ShamCash, Syriatel Cash and Paymera only if required by the recorded decision, verify genuine current merchant protocols for authentication/raw signatures, recipient/reference, currency/denomination, finality, webhook/polling, refund/idempotency/query and test-account facilities.
  Record effective source/version/owner and documented supported versus unavailable capabilities; missing documentation/access remains blocked, with no invented endpoint, signature, timing, exchange rate or fourth checkout method.

- **W05-B-003 — Real database upgrade, constraints and financial privileges — UNEXECUTED**
  Apply append-only migrations to a real accepted predecessor business database and fresh owner database; exercise concurrent SQL, malformed/overflow Money, cross-currency/unbalanced journals, unrelated uniqueness failures and UPDATE/DELETE using runtime roles, then replay provisioning.
  Require immutable posted originals, exact per-currency balance/bounds, merchant-scoped external/business uniqueness, atomic audit/Outbox and owner isolation after replay; marker-only upgrade or application validation alone supplies no financial evidence.

- **W05-B-004 — Intent, instructions, proof and funds remain distinct — UNEXECUTED**
  Create/replay an intent for an immutable obligation; expose genuinely configured QR/instructions, submit proof and query state through real HTTP, including unavailable configuration/automation and expiry.
  Require separate instructions/awaiting-transfer/proof-processing/review/pending-verification/verified states; amount and beneficiary come from accepted server facts. No navigation, QR scan, proof, provider request acceptance or client body creates money/postings.

- **W05-B-005 — Proof intake semantics and duplicate submissions — UNEXECUTED**
  Exercise valid transaction-hint-only, authorized processed-image-only and both; reject neither, invalid normalization, foreign/nonexistent objects, pending processing, changed-payload replay and conflicting replacements under the frozen schema.
  Require stable submission/review identities and truthful pending/rejected outcomes with no allocation/posting created by proof alone; preserve any prior independently verified credit/allocation; customer image and scan success remain search/review inputs, independent of evidence establishing merchant funds.

- **W05-B-006 — Exact raw-body signature, forgery and authentication — UNEXECUTED**
  For providers with documented signed callbacks, run explicitly synthetic negative fixtures through E's real callback route: missing/forged signature, wrong documented key/algorithm identifier and modified bytes, whitespace, encoding or parser representations using the documented raw-body procedure.
  Require verification over the documented original bytes before trusted processing, rejected/quarantined outcomes and no posting/refund/Booking effect; retain redacted request hashes and protocol/evidence revisions, never secrets or reconstructed-body acceptance.

- **W05-B-007 — Signed replay, key rotation and temporal boundaries — UNEXECUTED**
  Replay authentic deliveries, reuse nonce/event identity, alter bytes under the same identity, test documented timestamp/skew/replay-window limits, key rotation/revocation and provider-occurrence versus Billing observation/commit time.
  Require one persisted processing outcome per valid identity, conflict quarantine and approved expiry behavior; signature validity alone does not establish final funds. No guessed replay period, auto-extension or expired key acceptance.

- **W05-B-008 — Account, exact Money, direction, reference and finality binding — UNEXECUTED**
  Submit independently sourced evidence for wrong recipient merchant/account, unknown intent/reference, under/overpayment, wrong currency/precision, unsupported denomination, debit direction, pending/reversed transaction and fabricated finality.
  Require no obligation-paid allocation without approved matching; evidence for another merchant or unproven authenticity/finality cannot establish receipt by this business. Test exact large amounts without Number rounding, tolerance or implicit FX.

- **W05-B-009 — Independent received credit versus allocation — UNEXECUTED**
  Establish genuine final credit to the approved merchant with mismatched amount/currency/reference or unknown/cancelled Booking; later resolve matching or disputed allocation through approved B-owned reconciliation.
  Require immutable received-credit/evidence identity and explicit unallocated/mismatch/disputed state while obligation-paid/Work eligibility remains absent; no erasure of real credit, fabricated suspense policy, double allocation or automatic refund.

- **W05-B-010 — Event/reference/business deduplication and two-verifier races — UNEXECUTED**
  Race two verifiers; repeat same scoped key/fingerprint, changed payload and different keys for one `(provider, recipient merchant, external transaction ID)`; repeat after restart and permitted replay-cache expiry, including references reused at other merchants.
  Require original stable receipt/allocation/posting/operation IDs for authorized replays and at most one approved financial effect; different obligations cannot consume one credit without an explicitly accepted split policy. Conflicting content under the same immutable delivery/evidence identity is quarantined. Documented new status/finality/reversal observations for the same payment reference retain distinct accepted delivery/revision identities; they are neither discarded as duplicate credits nor a second financial effect.

- **W05-B-011 — Independent manual review and current reviewer revocation — UNEXECUTED**
  Exercise approved reviewer/merchant-evidence access, submitter/requester self-approval, technician/raw-admin role denial, wrong object/market/purpose/audience, stale session/authVersion and revocation between claim/evidence read/decision/commit/replay.
  Require current accepted permission plus independent authoritative evidence and immutable provenance/audit; proof rejection cannot erase received money. Revoked decisions/reads have no new effect, and manual review cannot satisfy separately required provider integration/sandbox acceptance.

- **W05-B-012 — Private Media lifecycle, access and redaction — UNEXECUTED**
  Use real Media reserve/upload/finalize/scan/access APIs for foreign, quarantined, unsafe, deleted, changed-version and revoked evidence; test guest expiry/claim and reviewer reassignment, scoped URL expiry and later download after revocation.
  Require object/version/purpose/beneficiary linkage and current authorization at every phase, audit of authorized reads and approved retention/legal-hold behavior. Generic events/logs/public caches and unauthorized receipts/Reporting exports expose no proof bytes, signed URLs, private hints, merchant secrets or unnecessary customer data; authorized minimal receipt/review fields follow the accepted access/export contract.

- **W05-B-013 — Cancellation races and independent owner facts — UNEXECUTED**
  Race accepted cancellation versus verification, cash collection, assignment/start/completion and hold expiry; fail between each Booking resource release, Billing assessment/reservation and owner commit, then restart/reconcile through public contracts.
  Require fenced current authority/policy, separate durable cancellation/resource/financial outcomes and stable compensation refs; cancellation cannot erase receipt/work/custody, refund automatically, roll back committed truth or invent a cross-database transaction.

- **W05-B-014 — Cumulative partial/full refund allowance under concurrency — UNEXECUTED**
  Race distinct partial refunds and full refund requests using actual SQL constraints/transactions; replay one business refund under multiple keys and test wrong currency, negative/zero/overflow amounts, fees/cap policy and allowance exhaustion.
  Require confirmed refunds plus active reserved/in-flight/unknown amounts never exceed the approved original refundable cap; one business request reserves once, denied requests make no provider/journal effect, and original captured/received total stays immutable.

- **W05-B-015 — Immutable originals, linked reversals and atomic confirmation — UNEXECUTED**
  Confirm partial/full refunds using independent final evidence; inject failures between refund receipt, balanced reversal, allowance consumption, status, audit and Outbox, and attempt SQL mutation/deletion of original or posted reversal.
  Require all-or-nothing local commit, original payment/allocation/receipt retained, exact linked refund/reversal IDs and append-only corrections. Wallet/Reporting reference Billing effects once and never create a second ledger or rewrite historical snapshots.

- **W05-B-016 — Unknown provider outcome and restart without blind repeat — UNEXECUTED**
  Crash before send, during send, after possible provider acceptance and before durable response; lose HTTP reply or receive timeout/disconnect/5xx, restart worker and reconcile using the same documented provider operation/idempotency/query identity.
  Require durable not-sent/pending/unknown distinction, reserved allowance retained and no new refund/send identity for uncertainty. Resend only when documented semantics and durable evidence prove it safe; unresolved query remains pending with owner/escalation, not timed-out failure.

- **W05-B-017 — Definitive failure, reordered success and compensation identity — UNEXECUTED**
  Resolve documented definitive failure or confirmed refund once; deliver duplicate/out-of-order success/failure and contradictory evidence after release, then replay cancellation/late-payment compensation with different transport keys and after restart.
  Require terminal allowance release only with accepted final evidence, contradictory evidence quarantined for B reconciliation and unique stable original refund/compensation identities; no second reversal/return, silently released unknown allowance or replacement recovery operation.

- **W05-B-018 — Authorized cash refund recording and custody effects — UNEXECUTED**
  Against accepted W04 cash providers, record authorized actual cash disbursement to the approved beneficiary with current distinct approval/execution authority and independent evidence; race refund before settlement, handover/deposit/treasury acceptance, wrong holder/receiver and stale allocations, then lose reply/restart.
  Require exact original collection/receipt/posting links, one immutable refund/reversal and corresponding approved Wallet custody/settlement/discrepancy effects; declaration or self-acceptance is not delivered refund. Retain original custody and treasury history with linked adjustments; no unpaid reset, erased settlement or silent custody transfer.

- **W05-B-019 — Late financial truth without capacity resurrection — UNEXECUTED**
  Deliver genuine success after intent/hold expiry or cancellation, before/after refund events and with duplicates; observe real Booking/Scheduling/Dispatch owner state, late-compensation notifications and restart at each owner handoff.
  Require money truth recorded independently and one approved recoverable disposition; original expired/released capacity, assignment and Work remain unchanged. Any separately authorized new booking revalidates current Catalog/Pricing/Geo/Scheduling and preserves original snapshots.

- **W05-B-020 — Real broker replay, raw hash conflicts and crash windows — UNEXECUTED**
  Use real allocated RabbitMQ for lost publisher confirms, crash after publish/before marking sent, consumer crash before/after Inbox/effect commit/ACK, duplicate/reordered/gapped/refund-first events, same identity/different bytes, missing bindings and exhausted retries/DLQ recovery.
  Require atomic owner Outbox and consumer Inbox/hash/effect/checkpoint, no regression/duplicate posting/provider command/capacity restoration, bounded durable recovery and authorized snapshot repair. Unrelated uniqueness errors are not duplicates; no exactly-once or HA claim from one broker.

- **W05-B-021 — Read/replay authorization, reconciliation and immutable audit — UNEXECUTED**
  Query actual intent/received-credit/allocation/review/refund/provider-operation/compensation status after response loss/restart; test account/guest/delegation revocation, foreign IDs, scope-bound cursors and unavailable/stale Wallet/Reporting source reconciliation.
  Require authorized stable references/revisions/exact amounts, separate refunded/reserved/residual values and explicit unknown/coverage/discrepancy owner; missing projections never mean zero/paid/refunded or grant execution. Audit records actor versus beneficiary, evidence/hash/parser/policy, original refs and committed outcomes without secrets.

- **W05-B-022 — Permitted genuine provider verification/refund acceptance — UNEXECUTED**
  For each required provider, run only approved genuine sandbox/test-merchant verification and partial/full refund paths if such facilities are documented and available; reconcile provider transaction/merchant/finality against actual Billing DB and consumer delivery.
  Require redacted effective protocol/account authorization, real request/result/reference/evidence links and per-provider acceptance status; synthetic callbacks remain separate. Unavailable sandbox or required disabled/untested provider blocks acceptance; live money/refunds require separate explicit authority.

- **W05-B-023 — Actual A/C/D journeys, approved states and visual/accessibility evidence — UNEXECUTED**
  On merged real producers, exercise customer seven-step account/guest flows with optional plate, proof/image/hint/review/refund/reload/error/unknown outcomes, technician denied electronic approval and independent admin review/cash refund/custody views.
  Require honest server states, original approved cash/ShamCash/Syriatel choices, Arabic RTL/focus/motion/reduced-motion and pinned Linux reference/candidate/diff plus separate device evidence. Customer demo `paid_demo/refund_review_demo`, technician local collection and admin aggregate cards do not approve missing production states; exact A/C/D/product decisions remain dependencies.

- **W05-B-024 — W06 handoff and serialized final acceptance — UNEXECUTED**
  Submit owner-reviewed confirmed-posting, wallet credit/hold/capture and subscription activation/reversal sequencing/reconciliation contract requests to E for accepted publication; give A/C/D exact approved pending/review/refund mappings and run all mandatory/affected cases on latest-target-plus-head candidate.
  Require per-case command/result/source/tree/contract/policy/migration/evidence matrix, real versus mocked facilities, skipped/blocked owners, owned process cleanup and independent review/resulting-target checks. Provider children may pass bounded gates; parent stays INTEGRATION_PENDING until every combined-source task case passes, with no automatic merge/deploy/next-wave execution.

## Available entrypoints and acceptance limits

Source-pinned tooling is Node `24.21.0` (`.nvmrc`) and pnpm `10.32.1` (`package.json`); `node scripts/verify-toolchain.mjs` verifies it before authorized execution.
Existing guards/builds: `node scripts/check-design-reference.mjs` before/after authorized edits; `pnpm check:migrations`; `pnpm --filter @carwash/billing generate`, `build`, `build:tests`, `typecheck`, `migrate:deploy`; equivalent Wallet scripts exist. Migration command needs E-allocated owner credentials and approved append-only migrations.
Existing unit/framework gates: `pnpm test:domain`, `pnpm test:contracts`, `pnpm test:nest`; Billing's current Nest tests prove foundation wiring/readiness, not funds. JSON files under `tests/parallel/B` are declarative specifications, not executable acceptance suites; no W05-B/provider runner exists.
Existing real-infra gate: `pnpm test:integration` requires an already provisioned `CW_CONTEXT_FILE` and compiled Catalog/Communications/Reporting artifacts; its eight foundation suites use concurrency one and 180000 ms per-test timeout, may reset their own allocated slices and explicitly exclude payments/browser/production readiness.
Full existing gate: `pnpm acceptance:preflight` / `pnpm acceptance:run`; E must allocate and serialize the actual scope, retain all mandatory CI and add reviewed executable W05-B domain/DB/broker/provider/app gates. Existing acceptance cannot be relabeled finance acceptance.
Frontend commands exist individually for customer-web/operator-web/admin-web: `pnpm --filter @carwash/<app> typecheck` and `build`; root build/typecheck do not cover them. `pnpm test:f010:browser` exercises golden reference parity tooling, not real money/backend consumer journeys.
F010 registry fixes widths 320/390/430/768/1024/1440, height 900, DPR1, ar-SY/Asia/Damascus, fixed time, channel threshold 8 and allowed diff ratio 0. Preserve baselines; do not loosen tolerances or count skips/fixtures as success. This packet starts no runtime resources; future execution follows E's accepted isolated allocation and gates.

## Source pointers

Task: `upload/Pasted markdown(20261005-184809).md`; source rules: `AGENTS.md`, `docs/VERIFICATION.md`, `architecture/service-catalog.json`, `architecture/adr/F001-monorepo-and-data-ownership.md`, `architecture/parallel-contract-release.json`.
Finance: `docs/parallel/B/W04/ENTRY_READINESS.md`, `CASH_JOURNEY_AND_DURABILITY.md`, `W05_CONTRACT_PACKET.md:89,148,159,171,193,279,290`; existing `tests/parallel/B/W04/cash-custody-acceptance.spec.json` is explicitly NOT_RUN_SPECIFICATION_ONLY.
Runtime: `services/billing/prisma/schema.prisma:22`, `services/wallet/prisma/schema.prisma:22`, both `src/app.module.ts:15`, `services/billing/src/domain/ledger.ts:11`, `services/billing/src/application/index.ts`, `packages/contracts/src/identity.ts:22,25`; provisioning replay blanket DML: `infra/postgres/provision.sh:99,106`.
Design: `docs/design/DESIGN_LOCK.md`, both reference manifests, ADR0004; customer payments HTML:218–289; technician HTML:239–266,345–352; admin HTML:110–112. Approved reference behavior is demo-only evidence, not provider/finance implementation.
Gate limits: root/service/app `package.json`, `scripts/run-integration-tests.mjs`, `scripts/run-nest-tests.mjs`, `scripts/f010/browser-acceptance.mjs`, `docs/parallel/E/W01/GATE_MANIFEST.json`; W05 requests: `docs/parallel/E/W04/W05_CONTRACT_REQUESTS.md` are REQUESTED/UNACCEPTED.
