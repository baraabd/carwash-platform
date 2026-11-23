# W06-A acceptance specifications — all families UNEXECUTED

Task W06-A; Lane A; Lane-local proposal, not an accepted contract or runner.
Observed main: `78adaa2d0436f9e0fc6697a36f3f0bd7a521ad8b`.
Observed tree: `c5bd3137ef9d4e0ab7b70b9646e126f10e011883`.
Observed source audit: `/workspace/scratch/6a9547568741/carwash-platform`; proposal worktree: `/workspace/scratch/6a9547568741/carwash-w06a-source`.
Attachment: `upload/Pasted markdown(20261006-134245).md`.
Every family below is **UNEXECUTED**. No unit/build/DB/broker/browser/provider test ran in this audit.
Document/source diagnostics and their actual results are recorded in the [checkpoint](../../../../docs/parallel/A/W06/CHECKPOINT.md) and [source observation](../../../../docs/parallel/A/W06/source-observation.json). They do not execute these acceptance families.
Agent QA is not independent approval. Source proposals and previous CI counts never establish W06 acceptance.

## Current source truth

- The release registry remains W01 INTEGRATION_PENDING, BASE_W02 null, no BASE_W06, no accepted next-wave contracts [S1].
- Existing shared versions are contracts0.0.2/event-contracts0.0.2/api-clients0.0.1; business clients export an empty skeleton.
- Customer/Vehicle/Geo each have only ServiceMarker; app.module.ts:15 business readiness is false [S2–S4].
- Each runtime wires HealthModule and Prisma without product controllers; application/domain/ports are empty foundation exports.
- No real profile/consent/preferences/address/garage/coverage/privacy/chat/review/wallet producer exists in these A services.
- Customer app dependencies include React/router, no accepted business API-client integration [S5].
- AccountRoute:18–24 marks controls deferred except address-sheet and garage entry; accountViewModel:51–63 preserves profile/help/privacy/motion/export/reset plus demo merchant/payment controls [S6].
- Address/garage interactions and profile/contact updates are session-only; CustomerSessionProvider:35–39 promises no network/storage/durable booking/payment [S7].
- initialSessionState:24–27 uses deterministic fixtures as its only data source; reload does not prove durable preferences.
- Home ResultTeaser is a disabled illustrated comparison entry; OrdersRoute remains a placeholder; tracking/payment are C014 handoffs only.
- C014 PR41 merge is present as commit69d81a83a3409d0693272efeb19ebeb9805750f5; no duplicate C014 work is needed.
- C014's pure confirmation creates one unpaid memory snapshot; post-reload handoff is explicit not-found, not an actual Booking [S8].
- A app/service/shared-client/C014 paths have no delta from3ce756cd… to this observed target; newer packets did not implement these capabilities.
- Actual versions observed now: Node24.19.0 and pnpm11.25.0; source pins are Node24.21.0/pnpm10.32.1. This audit did not run verify-toolchain.
- Current task explicitly expires E bootstrap product permission; stale verified-BASE_W02 leases do not override permanent A ownership.

## Exact A migration inventory

| Service  | Actual sole migration ID            | Actual model/table             | W06 implication                       |
| -------- | ----------------------------------- | ------------------------------ | ------------------------------------- |
| Customer | 20260920000000_sprint_02_foundation | ServiceMarker / service_marker | No durable customer business data     |
| Vehicle  | 20261005060000_w01_foundation       | ServiceMarker / service_marker | No durable owned garage records       |
| Geo      | 20261005060000_w01_foundation       | ServiceMarker / service_marker | No real service-zone/address provider |

No new migration is proposed as implemented. Future business upgrades require actual accepted prior business data plus fresh-database cases; marker creation alone cannot prove a W06 business upgrade. Schema mirrors and new append-only SQL must agree; no db-push/reset/old-migration rewrite.

## Proposed acceptance families — every one UNEXECUTED

- **W06-A-001 — Entry release, scope and producer sequence — UNEXECUTED**
  Inspect actual immutable BASE_W06, closed Wallet/Subscription/Billing, Media/Booking, Support/Reviews/Communications, profile/consent/privacy and Identity/client versions, policy/retention/participant approvals, owner grants and E runner/allocation. Sequence narrow binding/authority providers before effects and app consumers; use merged producers, no moving peer branch or private DTO/DB import.
  Require full source/tree/contracts/policy/evidence provenance and current independent target/candidate records. Missing base/approved action or producer blocks dependent implementation; proposal merge/static inventory is not release acceptance.

- **W06-A-002 — Real owner databases, migration/upgrade and constraints — UNEXECUTED**
  On E-allocated separate Customer/Vehicle/Geo DBs and runtime/migration roles, migrate fresh and real accepted predecessor data; exercise raw SQL ownership/uniqueness/revisions and concurrent command/receipt/outbox transactions, restart and privilege denial. Compare schema and append-only migrations.
  Require correct durable records and rollback under actual DB faults, no cross-owner access or corrupted historical Booking snapshots. Foundation health/marker tests and in-memory fixtures cannot satisfy this family.

- **W06-A-003 — Durable profile versus Identity credentials — UNEXECUTED**
  Update approved profile/contact under current authority/revision, race updates, lose response/restart/reload and test invalid normalization and unavailable policy. Verify customer contact changes do not change login email/password/OTP assurance or another account's credential.
  Require one durable authorized profile operation, truthful validation/conflict/recovery and current owner reads after reload. Identity credential/reset/suspension actions remain E-owned; no phone match silently claims a member/guest profile.

- **W06-A-004 — Addresses, garage and Geo snapshot boundaries — UNEXECUTED**
  Create/update/archive approved own address/vehicle records through real APIs; exercise optional plate, maximum/duplicate/revision policy, foreign refs, concurrent changes and approved Geo zone/serviceability/map/manual fallback. Rebook after record/zone revision or retirement.
  Require durable own books and current serviceability with honest unavailable status; original order/quote/address/vehicle snapshots remain immutable. Deleting a saved record never deletes historical Booking or locally recomputes accepted prices/capacity.

- **W06-A-005 — Preferences/motion durability and asynchronous recovery — UNEXECUTED**
  Persist only approved preferences/motion under current customer revision; test reload/new session, failed save, response loss, out-of-order stale replies, actor change, unmount and conflict refresh. Compare selected state with actual current owner result.
  Require pending/failed/committed distinctions, original operation reuse and no stale principal reply overwriting another user's preferences. Device reduced-motion preference retains precedence; a UI toggle is not permission for marketing/media use.

- **W06-A-006 — Two guests, member isolation and cross-user denial — UNEXECUTED**
  Use two real purpose-limited guests and two members; substitute profile/vehicle/address/wallet/case/message/review/media/privacy IDs, expired/revoked capabilities and claim/transfer refs. Test current session/authVersion/audience/object/purpose before command/read/replay/download.
  Require no cross-user data/effects, concealed safe failures and accepted guest recovery without phone-based ownership or localStorage grants. Preserve guest Booking and optional plate while refusing unsupported account actions honestly.

- **W06-A-007 — Consent purpose, withdrawal and queued use — UNEXECUTED**
  Submit/withdraw approved consent under explicit purpose/policy version with real owner DB; race queued marketing/delivery/grant processing and proof/service-evidence reads, re-consent revisions and response loss. Inspect actual consent/audit and downstream decision evidence.
  Require distinct necessary service evidence versus optional marketing consent, no preselection or blanket consent, and current withdrawal enforcement. A consent event/rebuild cannot resume withdrawn marketing or republish private photos; no invented consent owner/channel/retention period.

- **W06-A-008 — Privacy action approval, intake and status meaning — UNEXECUTED**
  For each approved export/reset/deletion scope, authenticate requester/current assurance, display approved consequences, submit stable operation and retrieve coordinator/status after lost response/reload. Test foreign IDs, altered scope, duplicate keys and policy unavailable.
  Require request-received/pending/processed/partly-fulfilled/retained/failed states distinct from owner effects. Intake approval never claims deletion/export completion; automated fulfillment cannot be replaced with intake-only when the approved task requires actual actions.

- **W06-A-009 — Exact per-owner effects, partial failure and targeted retry — UNEXECUTED**
  Exercise actual relevant owners' approved Customer/Vehicle/Geo/Identity/Booking/Billing/Wallet/Subscription/Media/Support/Reviews/Communications/Reporting actions as applicable; inject one owner outage/failure and loss after committed action, then restart and retry only failed/unknown tasks using original identities.
  Inspect exact retained/deleted/anonymized/exported records, purpose/action/policy revisions, evidence refs and current status for every required owner. Successful owners must not repeat effects; partial/unknown never becomes global complete or zero remaining merely because an event/read is absent.

- **W06-A-010 — Retention/legal holds, backups and non-resurrection — UNEXECUTED**
  Apply genuinely approved retention exceptions/legal holds, active work/cases and immutable financial history; test object purge/anonymization outcomes, backup treatment, projection/cache/search invalidation and rebuilding/replaying old events. Inspect each actual policy action and its evidence.
  Require exact retained categories/reasons and permitted completion wording; processed-with-retention does not mean all data deleted. Backups/unavailable purge remain explicit per policy; no invented legal deadline or wipe of posted journals, and no replay restores erased/redacted PII or revoked consent.

- **W06-A-011 — Authorized export artifacts and truthful scope — UNEXECUTED**
  Obtain actual per-owner snapshot/asOf/approved fields and build/finalize authorized private export artifact; test missing owner, partial generation, checksum/content mismatch, worker crash, supersession, expired/revoked download and failed partial-object cleanup.
  Inspect actual allowed subject records/third-party redaction/artifact checksum and action evidence. Prototype JSON-without-photos is not automatically full subject-access fulfillment; show business export versus approved privacy scope, retained records and genuine partial outcome.

- **W06-A-012 — Reset semantics preserve submitted work — UNEXECUTED**
  Run approved unsent draft/preferences reset separately from saved-record removal and coordinated deletion; lose response/reload with submitted Booking/payment/refund/privacy/chat operations outstanding. Attempt blanket browser reset as if it deleted peer DBs.
  Require only approved effects and preserved submitted operation/recovery refs and immutable history. Reset cannot undo an executed peer/provider effect, erase custody, release capacity or authorize a new duplicate payment/message/privacy task.

- **W06-A-013 — Revocation and stale privacy worker/download replies — UNEXECUTED**
  Revoke requester/reviewer/service authority between intake/worker claim/read/commit/export download; switch accounts during slow results and replay. Verify current audience/object/purpose decisions and accepted commit-validity semantics through real Identity/coordinator/owners.
  Require unauthorized new actions/downloads refused, stale result fences and safe current recovery owner. Revocation does not erase already committed factual effects or relabel an unknown action failed; retry/reconcile only under accepted current authority.

- **W06-A-014 — Server Wallet visibility and event-derived quality — UNEXECUTED**
  Fetch actual B approved holder/purpose balance/history and consume duplicate/out-of-order/gapped/corrected events with source checkpoints; race reload/reconnect and source outage. Attempt viewing staff/team balances or treating unallocated merchant credit/proof as customer available value.
  Require exact accepted Money/currency and authoritative eligible Billing links, safe beneficiary fieldsets, visible asOf/current/stale/partial/unavailable quality. Missing source is unknown, never0/paid; events/projections never supply command authority or a fourth checkout/stored-value product.

- **W06-A-015 — Financial history, refund cases and UNKNOWN independence — UNEXECUTED**
  Display matched allocation/receipt versus received-unallocated/disputed credit, custody unsettled, refund reserved/partial/confirmed/failed/UNKNOWN, and owner correction after lost responses. Query actual Billing/Wallet and Support case facts without client amount arithmetic.
  Require immutable original receipt/history, exact confirmed versus reserved/residual facts and current recovery refs. Refund request/provider acceptance is not money returned; cancellation/custody settlement or missing projection cannot make an unpaid/reset/refunded claim.

- **W06-A-016 — Approved Wallet actions and benefit/entitlement races — UNEXECUTED**
  Exercise only approved holder/purpose/customer actions using real B Wallet/Subscription/Billing grants and C Booking; race last available partition/unit, hold expiry/capture/consume/release/correction, pending/UNKNOWN financial outcome and restart. Bind actual owner refs/revisions and operation identities.
  Require no double use/optimistic allowance restoration, no capture from stale read and no release of operation-bound claimed money while Billing UNKNOWN. Benefit reserve/activation is not capacity or automatic debit; unsupported holder/policy/action stays unavailable without inventing funding/withdrawal or customer plans.

- **W06-A-017 — Support cases, contact methods and refund visibility — UNEXECUTED**
  Create/replay approved own service/refund/privacy case through real Support and owner bindings; lose acknowledgment, add permitted evidence, query after reload, test foreign case/contact/refund fields and unavailable approved communication channel.
  Require stable case identity and intake/status separate from B refund execution/confirmation and owner fulfillment. Only actual accepted contact channels/copy are offered; Identity email OTP is not evidence of SMS/WhatsApp capability or merchant operation authority.

- **W06-A-018 — Conversation participants and retention approval — UNEXECUTED**
  Bind current beneficiary, approved assigned operator/team and scoped support by real Booking/Dispatch/Support authority; test arbitrary participant nomination, old-assignee visibility, reassignment, support-entry audit, current retention-policy approval and internal staff-note separation.
  Require current object/purpose membership at read/send/reconnect and only safe Communications participant views. Public Identity bindings/other participants' scopes remain private; broad admin/finance/operator role alone never grants transcript or attachment access.

- **W06-A-019 — Chat/case reload, lost reply and ordered recovery — UNEXECUTED**
  Send/read-marker under stable message/operation identity, lose reply, crash/restart/reload/reconnect and deliver duplicate/reordered/hash-conflicting/gapped events or expired replay cursor. Test revocation/reassignment while queued/private delivery and ambiguous external notification status.
  Require one durable message, monotonic visible sequence/read markers, honest retained-range/snapshot/freshness status and same-operation reconciliation. Provider accepted/delivered/read are distinct; no new-key blind resend or old membership granting buffered private delivery.

- **W06-A-020 — Chat/case private attachments and purpose separation — UNEXECUTED**
  Use actual binding-first Media reserve/upload/process/scan/finalize/message-or-case-link APIs; test foreign object/version, unsafe/quarantined content, proof reuse for chat, revoked recipient, reassignment and expired scoped download. Revoke access between grant and later retrieval.
  Require current recipient/object/purpose authorization and real private bytes, approved file/content bounds and audit. No arbitrary storage key/provider URL fetch, public/signed URL broadcast, transcript/proof leakage or attachment grant from client IDs alone.

- **W06-A-021 — Verified review eligibility and object authorization — UNEXECUTED**
  Query actual C completed-service/beneficiary eligibility and D approved review scope; test incomplete/foreign/cancelled/corrected/unavailable completion, current guest policy, altered rating/text/booking IDs and expired/revoked subject.
  Require an eligible actual service before submission, safe unavailable state and exact author relationship. Session stage/demo progress, payment proof, KYC reviewer role or receipt alone never grants verified-review eligibility or edits another customer's review.

- **W06-A-022 — Review duplicate protection, moderation and reload — UNEXECUTED**
  Race same service/beneficiary review with same key, different keys, changed payload, edit/withdraw/moderation/publication and correction; lose response/restart/reload and replay aggregate events with raw hash conflict/gap. Inspect real SQL uniqueness and moderation/audit.
  Require one approved logical review, submitted/pending/published/hidden/rejected/withdrawn distinctions and one aggregate correction. Preserve rating truth; moderation does not rewrite stars or reveal private subject/media data; stale/unavailable sources cannot claim public approval.

- **W06-A-023 — Private service Media processing, expiry and denied access — UNEXECUTED**
  Load actual approved private service evidence by Booking/Work attempt/angle/purpose/version; test foreign subject, current relationship change, scan/quarantine/deletion/retention, expiry/revocation mid-fetch and expired grant after reload. Inspect actual storage/process/checksum/access evidence.
  Require current authorization for every retrieval and safe missing/unavailable states without permanent public URLs or cross-user caches. Marketing consent is separate from necessary service evidence; cached render/late reply cannot reveal another user's images after account/scene change.

- **W06-A-024 — Genuine before/after pairs, missing pair and scene race — UNEXECUTED**
  Fetch same real service attempt and same approved angle before/after; test neither/one/both images, failed second fetch, differing attempt/version, rapid interior/exterior selection and old-scene delayed response. Inspect image provenance and comparison state.
  Require honest pair/missing/expired labels; never combine a real photo with illustrative art or another service as a real result. Missing-pair controls and refresh/recovery follow approved behavior; illustrations remain explicitly illustrations, not fallback proof of successful service.

- **W06-A-025 — Comparison pointer, keyboard, play/pause, zoom and scenes — UNEXECUTED**
  On actual authorized pairs, exercise mobile drag/pointer cancellation/scroll, slider keyboard endpoints/RTL semantics, play then pause/reset, approved zoom/expanded view and scene selection. Close/reopen during animation and async image loads; test bounding and stable accessible values.
  Require approved control geometry/focus/labels, actual selected scene, cancellation of obsolete animation/replies and predictable pause/reset without navigation or photo mixing. Do not force-click blocked/missing-pair controls or loosen assertions to get success.

- **W06-A-026 — Motion, focus return and device interaction — UNEXECUTED**
  Exercise system reduced motion versus approved persisted motion preference, play/reveal fallback, account/support/privacy/comparison sheets, keyboard tab/escape/return, touch/short viewport and reload. Perform actual Windows/device interaction separately from Linux canonical capture.
  Require device preference precedence, no automatic motion under reduce, correct focus target/return after failure/close and accessible RTL announcements. Static CSS/source assertions or one desktop browser cannot close device/gesture/focus evidence.

- **W06-A-027 — Seven-step/demo retirement and W07 compatibility handoff — UNEXECUTED**
  Reconcile full C001 inventory/AccountRoute actions: finish each approved account capability or retain explicit dependency; keep seven separate Booking steps, guest, optional plate and repeat-booking new quote/capacity validation. Check merchant-QR/payment-tour demo controls against exact approved production safety/copy decisions.
  Submit W07 subscription purchase/manage/freeze/cancel/entitlement, promotion eligibility/redemption, repeat quote/compensation and admin Customer/Vehicle list/detail/update/archive plus Geo zone version/publish/retire requests with current role+object scope, minimal pagination/audit/expected revisions and historical snapshots. No unilateral new screen/method, omitted required scope or W07 implementation.

- **W06-A-028 — Builds, canonical visual/flow evidence and final target gate — UNEXECUTED**
  Run actual customer build/typecheck and affected real-peer HTTP/DB/broker/restart/browser cases through E's accepted allocated manifest; capture Linux canonical reference/candidate/diff/Arabic RTL/accessibility at locked widths and separate Windows/device behavior. Bind source/tree/contracts/policy/environment/artifacts/commands/results and every blocked/skipped family.
  Require all approved capabilities implemented or explicitly blocked, real reload persistence/current permissions and per-owner privacy effects; intake/fixtures/old green head do not accept full flow. E serializes latest-target+exact-head candidate, independent review, unchanged refs and actual resulting-target checks; no automatic merge/deploy/next-wave or real provider/money operation.

## Actual existing commands versus missing W06 entrypoints

These are source-derived commands, **not commands executed by this audit**.

- Toolchain/config: `node scripts/verify-toolchain.mjs`; config-only mode excludes actual runtime mismatch.
- Mandatory reference guard before/after any authorized change: `node scripts/check-design-reference.mjs --base-ref 78adaa2d0436f9e0fc6697a36f3f0bd7a521ad8b`; registered-reference check: `node scripts/f010/reference-registry.mjs --base-ref 78adaa2d0436f9e0fc6697a36f3f0bd7a521ad8b`.
- Actual inventory/boundary diagnostics: `node scripts/c001/customer-behavior-manifest.mjs`; `node scripts/c002/check-feature-boundaries.mjs`.
- Existing A source/session units: `node --test --test-reporter=spec tests/unit/c0*.test.mjs`; focused legacy confirmation: `node --test --test-reporter=spec tests/unit/c014-booking-confirmation.test.mjs`. These test fixture/session behavior, not W06 DB/authorization/provider journeys.
- Actual app commands: `pnpm --filter @carwash/customer-web typecheck`; `pnpm --filter @carwash/customer-web build`; dev/preview also exist. Root build/typecheck do not cover customer-web.
- Each of `@carwash/customer`, `@carwash/vehicle`, `@carwash/geo` has generate/build/build:tests/typecheck/migrate:deploy/start. Use only after approved dependencies/isolated resource allocation; generated outputs are not authority to alter reserved manifests or peer tracked source.
- Vehicle/Geo have `pnpm --filter @carwash/vehicle test:runtime` and `pnpm --filter @carwash/geo test:runtime`; Customer has no test:runtime. The 27 defined Nest cases across these services are foundation wiring/configuration/HTTP health, including ready503, not product DB/guest tests.
- Existing global `pnpm test:nest` compiles/runs all services; `pnpm test:integration` requires a real CW_CONTEXT_FILE and allocated slices, is concurrency1 and may reset only those test slices. It covers foundation probe DB/broker, not W06 customer products.
- Existing C014 browser entrypoint is `node scripts/c014/browser-acceptance.mjs` after build, allocated preview origin and Playwright Chromium; it compares session transitions and records candidate-only handoffs, not real checkout/tracking/media/chat/privacy. C014_ORIGIN/C014_EVIDENCE_DIR are actual env inputs.
- C014 summary currently prefers GITHUB_SHA over explicit C014_SOURCE_SHA at script:65. Bind actual built source externally; a PR workflow SHA/old artifact name alone is not candidate provenance. This is a static existing-harness observation, not an executed failure or duplicate C014 sprint.
- F010 `pnpm test:f010:browser` exercises reference tooling, not live customer data; canonical widths320/390/430/768/1024/1440,height900,DPR1,ar-SY,Asia/Damascus,reduce,fixed time,channel threshold8,allowed diff ratio0 remain locked [S9].
- Any W06-A domain/DB/migration/auth/broker/Media/privacy/chat/review/Wallet/browser runner is **PROPOSED_ENTRYPOINT_MISSING** until E publishes the exact executable command/dependencies/run allocation and owner-approved gates. No test:w06 script or A W06 runtime runner exists here; documentary cases cannot be executed as JSON and called accepted.

## Immutable source pointers

[S1]: https://github.com/baraabd/carwash-platform/blob/78adaa2d0436f9e0fc6697a36f3f0bd7a521ad8b/architecture/parallel-contract-release.json#L20
[S2]: https://github.com/baraabd/carwash-platform/blob/78adaa2d0436f9e0fc6697a36f3f0bd7a521ad8b/services/customer/prisma/schema.prisma#L22
[S3]: https://github.com/baraabd/carwash-platform/blob/78adaa2d0436f9e0fc6697a36f3f0bd7a521ad8b/services/vehicle/prisma/schema.prisma#L22
[S4]: https://github.com/baraabd/carwash-platform/blob/78adaa2d0436f9e0fc6697a36f3f0bd7a521ad8b/services/geo/prisma/schema.prisma#L22
[S5]: https://github.com/baraabd/carwash-platform/blob/78adaa2d0436f9e0fc6697a36f3f0bd7a521ad8b/apps/customer-web/package.json#L6
[S6]: https://github.com/baraabd/carwash-platform/blob/78adaa2d0436f9e0fc6697a36f3f0bd7a521ad8b/apps/customer-web/src/features/account/accountViewModel.ts#L51
[S7]: https://github.com/baraabd/carwash-platform/blob/78adaa2d0436f9e0fc6697a36f3f0bd7a521ad8b/apps/customer-web/src/state/CustomerSessionProvider.tsx#L35
[S8]: https://github.com/baraabd/carwash-platform/blob/78adaa2d0436f9e0fc6697a36f3f0bd7a521ad8b/apps/customer-web/src/state/bookingConfirmation.ts#L33
[S9]: https://github.com/baraabd/carwash-platform/blob/78adaa2d0436f9e0fc6697a36f3f0bd7a521ad8b/docs/design/f010-reference-manifest.json#L33

Other exact sources: AGENTS.md; docs/customer/C001_BEHAVIOR_INVENTORY.md and C014_BOOKING_CONFIRMATION.md; customer-web features/account/AccountRoute.tsx:18, home/components/HomeShowcase.tsx:34, orders/index.tsx:3, widgets/order-handoff/OrderHandoff.tsx:18; apps/customer-web/src/app/initialSession.ts:24; services/{customer,vehicle,geo}/src/app.module.ts:15 and their test/*.nest.spec.ts:38; root/service package.json; scripts/run-nest-tests.mjs and run-integration-tests.mjs; scripts/c014/browser-acceptance.mjs:65; docs/parallel/A/W05/W06_CONTRACT_REQUESTS.md is an unaccepted proposal, not current W06 publication.
