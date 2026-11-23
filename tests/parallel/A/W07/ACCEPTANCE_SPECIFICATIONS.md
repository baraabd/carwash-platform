# W07-A acceptance specifications — all 36 families UNEXECUTED

This is an A-local acceptance proposal, not an executable test suite, accepted contract, independent approval or release decision. No business test, build, database, broker, browser, provider or money operation was run. Actual source/document diagnostic results are recorded in the W07 source observation and PR handoff. Every family below is **UNEXECUTED**; unavailable prerequisites remain named blockers, not successful skips.

## Immutable source and entry truth

- Inspected source: `f01e87f4619414960e9e39c65e523a3250fbcbaf`; tree: `2266f157ad2480855011d5da59e00e5b0cf1f68f`; worktree: `/workspace/scratch/6a9547568741/carwash-w07a-source`.
- Task input: `/workspace/scratch/6a9547568741/upload/Pasted markdown(20261006-142205).md`. Main observations from older task text are historical. Neither the inspected SHA nor an externally merged proposal is an accepted `BASE_W07`.
- [Release registry](../../../../architecture/parallel-contract-release.json) remains W01 `INTEGRATION_PENDING`, `BASE_W02: null`, no accepted next-wave contracts, no business clients and no `BASE_W07`. The inherited A intake row is stale relative to merged A packets; it does not prove A's packet is missing or accepted.
- Packages at source: `@carwash/contracts` 0.0.2, `@carwash/event-contracts` 0.0.2, `@carwash/api-clients` 0.0.1. [Client source](../../../../packages/api-clients/src/index.ts) still exports an empty skeleton. Identity foundation HTTP and Gateway discovery do not implement the business operations described here.
- A's Customer/Vehicle/Geo services remain foundation shells: [Customer composition](../../../../services/customer/src/app.module.ts), [Vehicle composition](../../../../services/vehicle/src/app.module.ts), [Geo composition](../../../../services/geo/src/app.module.ts). Their sole Prisma model is `ServiceMarker`; technical database health is not business readiness. No business migration IDs are invented here.
- Existing migration inventory is exactly Customer `20260920000000_sprint_02_foundation`; Vehicle `20261005060000_w01_foundation`; Geo `20261005060000_w01_foundation`. Future business migrations must be owner-local, append-only and individually named once real source exists.
- Read-only source comparison `78adaa2d0436f9e0fc6697a36f3f0bd7a521ad8b..f01e87f4619414960e9e39c65e523a3250fbcbaf` found no changed paths in A app/services, contracts/API clients, C014 scripts or its focused unit file. Merged W06 documentation adds proposals, not those missing runtimes.
- C014 is already merged session-demo work. [Booking entry](../../../../apps/customer-web/src/state/bookingEntry.ts) prepares local drafts; repeat at line122 copies a session snapshot and uses an illustrative current slot. It creates no real Booking/payment. W07 must not duplicate C014 or treat those defaults/history copies as real offers.
- [W06 specifications](../../../../tests/parallel/A/W06/ACCEPTANCE_SPECIFICATIONS.md) remain 28 UNEXECUTED families. [W06-to-W07 contract packet](../../../../docs/parallel/A/W06/W07_CONTRACT_REQUESTS.md) is review input, not a frozen client or policy approval. Its candidate field names, endpoints, grants, state codes and events require E/owner acceptance.

## Required evidence for each family

Record the exact target/head/candidate/tree and built-source digest, accepted package/schema versions, approved design/copy/policy/publication refs, owner and child gate, actual command, allocated environment, source of each authoritative fact, artifacts, result and any blocker/skip. Domain fixtures may test pure decisions but cannot close real DB/HTTP/Identity/broker/full-journey requirements. Provider tests inspect only the owner's allocated data; consumers use published clients/HTTP/events, never peer Prisma or database access.

Money, currency/precision/rounding, dates/timezone, allowed plan actions, proration/refund rules, capacity deadlines, promotion quota/budget, pagination bounds and performance budgets must come from actual approved contracts/policies. This draft selects none. Real provider operations/live money/refunds require their applicable explicit authorization; an allocated authorized sandbox can supply integration evidence only for its stated environment.

## Proposed acceptance families

- **W07-A-001 — Accepted entry, design and complete scope inventory — UNEXECUTED**
  Require E's immutable verified BASE_W07, reviewed versioned Subscription/entitlement/Pricing-promotion/Wallet/rebooking/A-admin contracts and clients, current ownership, actual grants and allocated gate manifest. Resolve affected missing subscription/promotion/admin/English/production screens and copy against real approval records; deadline pressure does not approve them.
  Reconcile task scope, W01 feature matrix, C001 source actions/routes and W06 handoff. Each approved feature has a source, owner, producer and executable integrated gate; preserve seven separate booking decisions, guest and optional plate. Unapproved required states stay named blockers; do not silently remove required work. Explicit user expiry of E's bootstrap lease prevents stale registry text from authorizing E product writes.

- **W07-A-002 — Real owner data, migration upgrades and HTTP contract conformance — UNEXECUTED**
  On E-allocated isolated databases/roles, prove each changed owner's real clean-install and previous-supported-schema upgrade, constraints, durable operations/effects/audit/outbox, recovery and accepted compatibility. Verify service readiness reflects actual business dependencies, not SELECT1 or ServiceMarker presence.
  Exercise accepted real routes through Gateway with current Identity and owner object authorization; reject unknown/forbidden fields and invalid exact Money/revisions/publications. Keep all service schemas/data separate. Existing foundation migration or controller tests cannot close this business family.

- **W07-A-003 — Approved subscription discovery, plan publication and beneficiary — UNEXECUTED**
  Read genuine current plans with immutable plan/price/policy/eligibility references, exhausted/expired/withdrawn offers, partial/unavailable source and authorized beneficiary. Distinguish the initiating admin/member from the subscription beneficiary; internal Wallet/custody holders are not automatically customer beneficiaries.
  Test current plan replacement between discovery and purchase, foreign plan/beneficiary IDs, guest scope where approved and unavailable required inputs. Never invent plan price, entitlement count, geography, duration, renewal product or a local fixture as a live offer.

- **W07-A-004 — Real purchase and activation with independent financial facts — UNEXECUTED**
  Create the accepted durable B purchase-intent binding before allocation, bind beneficiary/plan/current genuine quote/policy and explicit price consent, then exercise real permitted payment and Subscription peers. Payment proof, callback delivery, navigation or pending intake cannot activate a plan.
  Inspect actual verified credit independently of eligible allocation/posting and actual activation effects; unmatched received money stays received-unallocated, not zero/outstanding-paid or Wallet funding. Duplicate eligible delivery/activation creates one intended entitlement effect. Show pending/reconciliation/exhausted/cancelled states from owners, not client arithmetic.

- **W07-A-005 — Purchase timeout, reload and restart recovery — UNEXECUTED**
  Lose replies before and after financial/activation commits, interrupt the app/provider/coordinator, reload and query with current authority using the original operation identity. Exercise partial allocation/activation and actual rejected versus UNKNOWN outcomes.
  Reconcile genuine receipts/effects after restart without a second purchase, second payment, fabricated cancellation or optimistic unit/balance increase. Late settlement must not revive expired capacity; provider event/delivery identity is not interchangeable with a payment's evolving status or final financial identity.

- **W07-A-006 — Remaining washes, eligibility and subscription history — UNEXECUTED**
  Read owner-backed available/reserved/consumed units, actual plan state/eligibility and immutable linked purchase/Booking/effect history across reload and pagination. Test delayed/duplicate/out-of-order events, gaps, missing peers and stale projection/source disagreement.
  Expose asOf/quality and pending operations honestly; null/unavailable is not zero units, active plan or authority to consume. A cannot infer entitlement from paid UI, Wallet balance, a count cache or an illustrative order. Historical consumed units remain immutable under correction or retirement.

- **W07-A-007 — Concurrent final-wash reservation and consumption — UNEXECUTED**
  Race two real Booking attempts against one remaining accepted unit using B/C's published reservation and command-bound consume authority. Repeat after lost replies, duplicate event delivery and owner restart; include different keys for the same business effect.
  Inspect owner constraints/fences and actual receipts: at most the permitted entitlement use, truthful loser/pending outcome, no negative units or double credit. Capacity/Booking/payment/entitlement remain distinct. Cached remaining count or expected Subscription revision alone does not fence the race.

- **W07-A-008 — Entitlement reserve, consume, release and expiry fences — UNEXECUTED**
  Exercise each accepted real trigger and state transition, including expiry/release versus claimed consumption and UNKNOWN Booking/consume outcome. Bind effects to actual beneficiary, Booking intent/Booking and original reservation/operation; test foreign refs and changed fingerprints.
  Reserve is neither consumption nor capacity/payment. Claimed UNKNOWN effects cannot be freed by expiry/release into reusable units; actual consumed effects require an approved linked correction, never ordinary release. Use accepted operation recovery and durable dedup after replay-cache expiry, without guessed TTLs.

- **W07-A-009 — Failed/cancelled booking compensation and partial recovery — UNEXECUTED**
  Fail current Geo/quote/capacity/Booking/payment/entitlement steps at real committed boundaries; cancel under current policy and race success against cancellation. Inspect C coordination and each B/C owner effect, then restart and resume only unresolved original operations.
  Definite failed eligible work releases only the approved outstanding reservation; completed/consumed work is not undone by missing reply. UNKNOWN remains quarantined/reconciliation until actual outcome. No cross-owner DB rollback, invented Booking to release a pre-confirmation intent, or automatic historical order cancellation.

- **W07-A-010 — Freeze/resume versus in-flight and final-unit use — UNEXECUTED**
  Exercise approved plan freeze/resume with current revision/policy and genuine C in-flight reservations; race management against reserve/consume/expiry and run lost-reply/restart cases. Test unauthorized beneficiary and revoked action authority on retry/status.
  Require accepted B/C command-bound management fencing and truthful separate plan/Booking/entitlement consequences. Exercise a delayed worker holding pre-management authority after freeze/cancel becomes effective: the exact approved claim/fence/reconciliation protocol must prevent stale use or expose its already-committed consequence. A cached reservation list, expected plan revision or existing SUSPENDED enum is insufficient. Effective dates, extensions and eligibility changes follow actual policy, not guessed freeze duration or retroactive history rewrites.

- **W07-A-011 — Plan cancellation and financial/Booking consequence separation — UNEXECUTED**
  Cancel unused/partially used/held plans under actual approved policy, including concurrent Booking commit, freeze and cancellation duplicates. Observe effective plan changes, affected entitlement reservations, actual C Booking changes and actual Billing refund operations separately.
  Plan cancellation alone proves neither Booking cancellation nor refund. Partial/UNKNOWN outcomes preserve their original operations and original consumed service/payment/posting history. UI exposes owner-confirmed consequences and recovery rather than promising immediate cancellation/refund or restored units.

- **W07-A-012 — Refund, dispute and entitlement correction caps — UNEXECUTED**
  With authorized real financial peers, exercise permitted refund initiation/status/partial confirmation/failure/UNKNOWN, late settlement, duplicate verification and approved dispute/correction paths. Use immutable original paid/allocation/effect references, exact Money and owner-enforced remaining refundable cap under concurrent attempts.
  Pending/UNKNOWN refund cannot restore cash, available units or release a financial reservation. Received credit, allocation, refund, entitlement and custody facts remain independent; cash custody/unsettled status is not electronic receipt or refund completion. No live funds operation occurs without applicable authorization.

- **W07-A-013 — Expiry and renewal only where actually approved — UNEXECUTED**
  Test accepted source-clock expiry at boundary/timezone, current publication changes and queued/in-flight bookings with the exact approved grandfathering/revalidation policy. Expired or exhausted states cannot be relabeled usable by a stale Home card or local date arithmetic.
  If renewal is approved, test a genuine new current offer/quote and explicit required consent, dedup/recovery and financial consequences; otherwise record the missing decision instead of implementing automatic debits. Renewal, extension and consumed-history rules are not inferred from discovery UI.

- **W07-A-014 — Member/guest isolation and current authorization throughout — UNEXECUTED**
  Use two members and two real approved guest credentials to attempt purchase/manage/reserve/redeem/history/status across foreign beneficiaries/resources; test linkage, expiry, revocation, delegated scope change and stale cached replies on reload.
  Check current role plus object/purpose/scope on new command, retry, status and private receipt access; safe concealment prevents existence/PII leakage. Old keys/grants/cursors are not authorization. Guest policy must be accepted rather than treating C014's session state as guest identity.

- **W07-A-015 — Promotion validity, eligibility and explicit rejection — UNEXECUTED**
  Evaluate genuine current promotions across Home, package choice and quote using approved publication/timezone/beneficiary/market/service/date rules. Test not-yet-valid/expired/boundary/ineligible/retired offers, source unavailability, stale eligibility and changed rules before submission.
  Show accepted safe rejection/recovery codes consistently; UNAVAILABLE is not INELIGIBLE or zero discount. Eligibility consumes no quota, quote calculation is not redemption, and old Home marketing copy is not current price/policy authority.

- **W07-A-016 — Promotion/subscription combinability and immutable quote — UNEXECUTED**
  Test the actual approved stacking/inclusion/exclusion rules with packages/add-ons/entitlements and current selection; reject noncombinable offers without silently dropping required consent. Prices/discounts/units and final bill come from a genuine immutable server quote.
  Verify exact accepted currency/precision/rounding and line-level allocation through relevant UI stages. A never recomputes a trusted discount, converts unavailable benefit to zero, or broadens eligible scope. Repricing after actual reserve uses a fresh accepted quote and explicit changed-price consent.

- **W07-A-017 — Promotion last-quota/budget/per-beneficiary race — UNEXECUTED**
  Race competing real eligible attempts for the final permitted quota/budget/per-beneficiary use, across devices and distinct operation keys. First establish the accepted narrow real Booking-intent/quote/beneficiary binding, then use B's atomic reserve and genuine C command-bound redemption authority.
  Inspect actual durable owner constraints and effect receipts; neither eligibility nor cached quote exhausts/guarantees quota. REDEEM requires an actual Booking and actual effect refs; failure/UNKNOWN cannot fabricate refs or exceed accepted usage rules. Numeric limits and budget policy remain approved inputs.

- **W07-A-018 — Redemption versus release/expiry and lost result — UNEXECUTED**
  Race promotion REDEEM against expiry/release and Booking cancellation, lose the redeem response after commit, restart and reconcile the same operation. Exercise authorized pre-confirmation RELEASE with the same real intent binding and C release authority; no fabricated Booking ID.
  UNKNOWN claimed redemption keeps quota unavailable until resolved; expiry, cached Booking status or a new key cannot free/reuse it. Cancel/refund does not automatically restore redemption. Permanent business dedup outlives response-cache cleanup; conflicts return truthful same-operation recovery without double effect.

- **W07-A-019 — Stale offers and exact changed-price reconfirmation — UNEXECUTED**
  Change actual Catalog/Pricing/promotion/plan/Geo/availability publications during editing, after reserve and before final confirmation; expire the quote or invalidate eligibility. Obtain current owner-backed selection/quote/capacity before submission and render the actual affected breakdown.
  Require frozen explicit mapping/rebind/supersede/invalidation semantics between the initial quote bound to the real intent/promotion reservation and the newly priced quote after reserve. Test changed beneficiary/selection/price/promotion, old-binding reuse and loss/restart during the transition; do not assume replacing quoteRef preserves valid reservation/commit authority. Missing published semantics blocks dependent writes.
  Require explicit consent to the exact new immutable quote under approved copy and current policy; an old consent or final-bill navigation is insufficient. Refusal leaves no automatic Booking/payment/entitlement use and follows accepted reservation compensation, retaining UNKNOWN recovery refs.

- **W07-A-020 — Consistent server receipt and immutable history — UNEXECUTED**
  Compare genuine Home/package/quote/final-bill/receipt snapshots for the same accepted offer/quote, including discount, entitlement contribution, adjustments and exact Money; distinguish offer estimates from actual final receipt. Test partial/unavailable lines, late financial resolution and approved correction.
  Receipt references the real Booking/quote/publications/allocation/effects; it cannot claim received-paid from proof/navigation or silently substitute current price into an old order. Historical receipts retain time-specific immutable values; current catalog/promotion changes require a new quote for new work.

- **W07-A-021 — Repeat completed and cancelled orders with explicit confirmation — UNEXECUTED**
  Enter repeat through real history, completion and Home for owned completed/cancelled snapshots, preserving the original order and permitted copied details. Reacquire current Catalog, Price, Geo and Scheduling and then follow the existing seven decisions with explicit new confirmation.
  Assert entry itself creates no Booking, debit, capacity hold unless explicitly allowed by the accepted fresh-hold protocol, entitlement use or historical cancellation. Never reuse old slot/price/payment/entitlement/consent as current authority; reject foreign or unavailable history with safe recovery.

- **W07-A-022 — Deleted saved records and historical details — UNEXECUTED**
  Repeat an owned historical order after saved Vehicle/address archive/delete, account scope change or privacy action; test absent optional plate and unavailable/redacted historical fields. Copy only currently permitted snapshot details under accepted policy, without resurrecting saved records or private revoked data.
  Resolve real current Vehicle/Customer ownership/serviceability and missing-input flow. Save choices require separate current authorized operations; historical save flags are not fresh consent. Original receipts/required retained snapshots remain unchanged, subject to actual approved privacy retention/action evidence.

- **W07-A-023 — Retired/changed packages and add-ons — UNEXECUTED**
  Repeat after actual package/add-on retirement, revised compatibility/vehicle category or service definition; include unknown/unsupported historical identifiers and source outages. Fetch current eligible choices and genuine quote rather than blank-draft defaults or dropping items silently.
  Display approved unavailable/replacement/reconfirmation behavior with explicit permitted new selection. A fixture fallback, old price or renamed current package cannot masquerade as the historical service. Original package/publication/receipt snapshot stays immutable.

- **W07-A-024 — Unavailable addresses and changed Geo coverage — UNEXECUTED**
  Repeat/resume after current address deletion, actual zone retirement/boundary or coverage-version change, denied coordinates and unavailable Geo provenance. Revalidate actual approved Aleppo serviceability and any real fee/travel/capacity inputs with permitted manual recovery.
  A copied written address, prototype pin/Riyadh default or prior eligible snapshot cannot establish present serviceability. Require approved new-address/zone/price consent where applicable; no automatic substitute geography, historic zone mutation or partial coverage declared live.

- **W07-A-025 — Fully booked dates, stale slots and held-operation recovery — UNEXECUTED**
  Repeat/resume with a past/fully booked date or slot lost between refresh and commit, including two concurrent consumers, expired holds and lost confirmation reply. Query real Scheduling/Booking for actual available options and accepted reservation/hold state.
  No illustrative earliestSlot or stale historical appointment is production availability. Show genuine none/offline/conflict recovery, reacquire an allowed new option with consent, and retain original UNKNOWN operation/hold refs without duplicate Booking or freeing a claimed slot prematurely.

- **W07-A-026 — Home resume/follow-up, help and production fallback boundary — UNEXECUTED**
  Exercise real active/resumable/unknown/completed/cancelled order Home entries, history/completion navigation and approved help/error/empty states under reload, offline and missing peers. Resume validates missing/stale input instead of bypassing seven decisions; follow-up requires a currently authorized real order.
  Inspect production boot/adapters/error paths for unintended initialSession/catalog/order/payment/geo fixture fallback. Keep any explicit demo boundary truthful and approved; business endpoints fail safely with honest unavailable status. Session C014 copy/save/navigation is not persisted production data or financial success.

- **W07-A-027 — Real admin Customer/Vehicle role, purpose and foreign objects — UNEXECUTED**
  Through D's real admin app and E's actual Gateway/Identity transport, call A's owner HTTP list/detail/update/archive with accepted role-to-grant mapping and current customer/vehicle/market/task/case-purpose scope. Exercise forbidden roles, foreign objects, revoked/delegated scope, CSRF where applicable and tampered grants.
  A role name, super-admin label, general support/finance/dispatch grant or visible button supplies no blanket PII/object authority. Separate approved contact-search/unmask purpose and audit; reject credential/role/consent/beneficiary/owner transfer/financial/Booking edits and unauthorized bulk search.

- **W07-A-028 — Admin pagination, minimum disclosure and cursor revocation — UNEXECUTED**
  Use genuine scoped list/detail/search with closed accepted fields, stable sort/tie-break/source snapshot and approved bounds. Test pagination at duplicates/boundaries, changes between pages, tampered/reused cursor and actor/filter/masking/scope-generation changes.
  Reject invalid/revoked cursor without foreign counts/existence leakage; keep masked/minimal results and safe approved audits/logs. WITHHELD contact/plate/geometry must be null, absent optional plate stays absent, and unmask needs current field-purpose authority. No unrestricted joins/history/treasury facts in A detail.

- **W07-A-029 — Admin edits/archive, revisions, dedup and historical preservation — UNEXECUTED**
  Race approved Customer/Vehicle patches and archives at the same real revision, retry same-key exact requests after lost commit reply, conflict changed meaning and race current C in-flight work using accepted relationship-check/command fences. Check actual durable before/after revisions and protected audit receipts.
  One allowed concurrent transition wins or returns truthful pending; no overwrite/lost update. Omitted fields remain unchanged; null clears only approved nullable fields. Archive removes approved future saved choice but is neither privacy deletion, automatic cancellation nor history rewrite. New booking revalidates archived Vehicle/current profile while existing snapshots remain correct.

- **W07-A-030 — Geo draft editing and content-bound validation/version — UNEXECUTED**
  Through D/E real transport, create/edit only authorized actual A Geo drafts; test current revision conflicts and approved CRS/precision/bounds/rings/holes/topology/boundary/overlap/provenance and actual service data. Reject invalid or unavailable geometry without invented immutable version/receipt.
  A validated version needs actual receipt/time/version/hash bound to exact current draft content and approved validation policy. Edit invalidates prior validation; stale receipt/content reuse cannot publish. Decimal candidate representations, map pixels or syntax-only validation are not approved provider data/geometry compatibility.

- **W07-A-031 — Geo publication, retirement and cross-owner adoption — UNEXECUTED**
  Race publication against another version/edit/retire with expected current publication and actual authorized B/C readiness receipts for exact version. Exercise adoption failure, lost transition reply/restart and scheduled activation only if approved; observe actual server effective transition and genuine history.
  Failed/pending adoption cannot become live guessed coverage. Retirement preserves historical Booking/quote/price/Geo snapshots, blocks or revalidates new selections by approved policy and handles existing unexpired quotes/holds through accepted B/C rules. Replacement is explicit approved consent; rollback is a new forward audited publication, not history edits. Geometry access remains currently authorized.

- **W07-A-032 — Durable events, projections and compatibility recovery — UNEXECUTED**
  Exercise actual owner commit/outbox and consumer inbox/broker failures before/after delivery/ack, duplicate IDs with same versus conflicting payload hash, out-of-order/gapped versions, replay-cache expiry, restart and authorized source resync. Verify only genuine transitions emit minimal accepted events with correct audience/version.
  No duplicate activation/redemption/use/refund/publication/archive, old event resurrection or stale projection write authority. Preserve closed published DTOs/strict booking.confirmed.v1 and immutable old readers; any necessary new major/client fix is E-published before affected consumers resume. Safe event/log payloads exclude contacts, plate, private bytes and grants.

- **W07-A-033 — Full approved customer/operator/admin parity, including W06 — UNEXECUTED**
  At the combined gate, execute every approved customer feature against real peers and trace it to source/owner/evidence; execute C operator and D admin roles in the affected full journeys before those consumer children merge. Preserve current assignment/Booking/Workforce/Media/financial authority boundaries, cash custody and truthful independent work/payment/entitlement states.
  Carry all 28 W06 families into the explicit integration matrix: durable account/guest isolation/consent; privacy intake versus exact approved per-owner effects, partial retry/retention/backups/export/revocation; server Wallet events and UNKNOWN; Support/participants/current-private attachments/chat reload; verified review eligibility/duplicate/moderation; authorized expiry/missing genuine before-after pair/scene/pointer/keyboard/play-pause/zoom/motion/focus. They remain blocked until their real producers and approvals exist; a document row or fixture test is not full parity.

- **W07-A-034 — Explicit app builds and canonical/device/accessibility evidence — UNEXECUTED**
  Run actual customer build/typecheck plus affected operator/admin commands through their owners and E's allocated manifest; root build/typecheck alone omit those frontends. Preserve locked references and Arabic RTL/seven steps, motion preference, focus return, keyboard and touch navigation, optional plate and guest, approved rejection/pending/changed-price states and low-bandwidth/offline recovery.
  Capture pinned Linux reference/candidate/diff at locked widths320/390/430/768/1024/1440,height900,DPR1,ar-SY,Asia/Damascus and approved deterministic source/time/motion settings; supply separate Windows/device interaction/accessibility evidence. Do not regenerate goldens, change tolerances or force-click blocked UI. Hash/inventory guards alone prove neither pixels nor backend/device behavior; bind the served bundle to candidate source rather than trusting an environment label.

- **W07-A-035 — W08 threat/race/performance/accessibility and bundle handoff — UNEXECUTED**
  Produce explicit next-wave cases for object/purpose/cursor/privacy/proof/media attacks, all last-unit/quota/publication/price/recovery races, real load/concurrency/browser/device accessibility, and measured production bundle/dependency/version inventory. Include actual approved English references, missing decisions, owners and proposed gate artifacts.
  Performance targets, maximum concurrency, numeric bundle budgets and timing are approved inputs, not invented acceptance thresholds. Freeze any final reviewed contract compatibility fix with E before BASE_W08, without moving-branch dependence or automatically starting W08 implementation.

- **W07-A-036 — Latest-target candidate, independent review and truthful parent gate — UNEXECUTED**
  E serializes the latest target plus exact child head/tree candidate, all mandatory and affected integrated/security/design/migration/owner gates, genuine required independent review and unchanged-ref validation. Recompute when target/head/config/evidence changes and verify checks on the actual resulting target; old PR-head green runs are insufficient.
  Keep W07-A parent INTEGRATION_PENDING until every task-listed and risk-derived case passes on combined real source with approved inputs. Record blocked/unexecuted/skipped families and environment limits explicitly. Same-login peer review is agent QA, not independent approval. No full-scope/DONE/BASE_W08/deployment assertion is authorized by this draft.

## E-gated producer-first children

Use the canonical proposed child sequence in [W07 README](../../../../docs/parallel/A/W07/README.md). E must agree scopes, real provider/consumer gates and common published contracts before coding. Narrow Geo draft/validation primitives precede the separate publication provider, which consumes actual B/C readiness; neither depends on final D admin UI. Missing predecessor producers remain explicit required dependencies.

## Existing source commands versus missing W07 gates

These commands exist at inspected source. [Source observation](../../../../docs/parallel/A/W07/source-observation.json) and the PR handoff record actual source/document diagnostics; business builds/typechecks/domain/integration/browser commands remain **NOT_RUN**. E must publish the exact allocated invocation/resources and mandatory suite for actual candidates. A-D may not edit reserved package/config/manifests to manufacture a command.

| Existing command                                                                                                                              | Actual scope/limit                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm verify:toolchain`; `pnpm verify:toolchain:config`                                                                                       | Runtime/config verifier. Source `.nvmrc` pins Node24.21.0 and root packageManager pins pnpm10.32.1. Config-only is not runtime verification or a substitute for a mismatch.                                                                        |
| `pnpm check:design-reference`; `pnpm check:f010-references`; `pnpm test:design-lock`                                                          | Existing reference/registry/lock guards. Run guards before/after edits under E's scope; they do not prove React pixels or business flow.                                                                                                           |
| `node scripts/c001/customer-behavior-manifest.mjs`; `node scripts/c002/check-feature-boundaries.mjs`                                          | Source action/route/reference/ownership inventory and feature import boundaries, not runtime parity.                                                                                                                                               |
| `node --test --test-reporter=spec tests/unit/c0*.test.mjs`; `node --test --test-reporter=spec tests/unit/c014-booking-confirmation.test.mjs`  | Existing source/session diagnostics; C014 explicit demo. Their existence/count cannot prove W07 integrations.                                                                                                                                      |
| `pnpm --filter @carwash/customer-web typecheck`; `pnpm --filter @carwash/customer-web build`                                                  | Actual customer scripts, build is TypeScript noEmit plus Vite; no business flow proof.                                                                                                                                                             |
| `pnpm --filter @carwash/operator-web typecheck`; `pnpm --filter @carwash/operator-web build`; corresponding `@carwash/admin-web` commands     | Actual frontend scripts through respective C/D owners/E allocation. Both apps' `test:runtime` is technical boot evidence, not full customer/operator/admin parity.                                                                                 |
| `pnpm --filter @carwash/customer typecheck`; `pnpm --filter @carwash/vehicle typecheck`; `pnpm --filter @carwash/geo typecheck`               | Real existing owner package scripts, currently foundation-only. Each also has generate/build/build:tests/migrate:deploy/start; database commands require E-allocated owner resources.                                                              |
| `pnpm --filter @carwash/vehicle test:runtime`; `pnpm --filter @carwash/geo test:runtime`                                                      | Existing Nest foundation runtime tests; Customer has no package test:runtime script. Not admin business/DB recovery suites.                                                                                                                        |
| `pnpm check:migrations`; `pnpm test:contracts`; `pnpm test:nest`; `pnpm test:integration`; `pnpm acceptance:preflight`; `pnpm acceptance:run` | Existing migration/public-event/foundation runners. Integration requires actual allocated context; its foundation probe tests are not missing W07 business cases. Do not run against another lane's resources or rename foundation acceptance W07. |
| `pnpm test:f010:browser`; `node scripts/c014/browser-acceptance.mjs`                                                                          | Existing locked-reference browser and demo confirmation harnesses. C014 does not compare full production payment/tracking; actual served-bundle/candidate provenance and affected approved journeys require separate evidence.                     |

**PROPOSED_ENTRYPOINT_MISSING:** W07 real Subscription/entitlement/promotion/Pricing/Booking peer tests; real admin-to-A HTTP/pagination/revision/Geo lifecycle suites; new owner migration/upgrade/DB constraints; W07 broker/fence/restart tests; full current customer/operator/admin parity including all W06 families; production entrypoint fallback inspection; and affected canonical/app/device/accessibility/approved performance suite. No W07 manifest publishes exact executable commands/resources here. Their future names/counts/results must be recorded only after E and owners create and accept actual runnable source.

## Source anchors

- [Locked customer behavior inventory](../../../../docs/customer/C001_BEHAVIOR_INVENTORY.md), [parity manifest](../../../../docs/customer/customer-parity-manifest.json), [C014 scope](../../../../docs/customer/C014_BOOKING_CONFIRMATION.md), [current session entry behavior](../../../../apps/customer-web/src/state/bookingEntry.ts).
- [W06 proposed subscription/management requirements](../../../../docs/parallel/A/W06/W07_CONTRACT_REQUESTS.md), [promotion intent/redemption fences](../../../../docs/parallel/A/W06/W07_CONTRACT_REQUESTS.md), [real repeat requirements](../../../../docs/parallel/A/W06/W07_CONTRACT_REQUESTS.md).
- [Proposed admin purpose/minimization/retirement](../../../../docs/parallel/A/W06/W07_CONTRACT_REQUESTS.md), [Geo validation/adoption/history](../../../../docs/parallel/A/W06/W07_CONTRACT_REQUESTS.md), [durable operations/events/compatibility](../../../../docs/parallel/A/W06/W07_CONTRACT_REQUESTS.md). These are unaccepted proposals, not implemented guarantees.
- [W06 privacy partial completion/retention](../../../../docs/parallel/A/W06/ACCOUNT_REQUESTS_AND_RETENTION.md), [W06 support/review/private comparison boundaries](../../../../docs/parallel/A/W06/SUPPORT_REVIEW_PRIVATE_MEDIA.md), [complete 28 UNEXECUTED W06 families](../../../../tests/parallel/A/W06/ACCEPTANCE_SPECIFICATIONS.md).
- [Actual root scripts](../../../../package.json), [customer app scripts](../../../../apps/customer-web/package.json), [operator app scripts](../../../../apps/operator-web/package.json), [admin app scripts](../../../../apps/admin-web/package.json), [F010 canonical settings](../../../../docs/design/f010-reference-manifest.json).

All **36 W07-A families remain UNEXECUTED**. This proposal provides no independent acceptance authority and does not mark any predecessor, W07 parent or next-wave base accepted.
