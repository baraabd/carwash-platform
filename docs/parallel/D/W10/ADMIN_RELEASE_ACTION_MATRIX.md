# W10-D — Full-scope admin release action matrix

**PROPOSAL_ONLY / NO_GO.** Analysis source: main `8bfa805d033cb29373c33886bf71bce4885a2f67`,
tree `9288ac9a1320221f309ce33b571a057f5ec2ea57`, branch
`proposal/w10-D-full-scope-certification-entry`, inspected 2026-10-06.
This observation is **not BASE_W10 or a release candidate**. No candidate SHA/tree,
deployed images/environment/migration manifest, accepted full-scope review or
staging bundle was supplied. The W01 bootstrap lease is **expired per the task**;
the stale registry condition does not revive it. Missing accepted W10 base/owner
contracts independently blocks dependent product writes.

This delegated work writes only this matrix and reads source. Product runtime,
provider, DB/broker, browser, migration, staging and acceptance tests were not run.
Root's separate source/guard/scanner/foundation diagnostics belong in the W10
source observation/handoff; they do not certify these product actions. All action
groups below remain **NO_GO**. A merged proposal, green foundation job or written
runbook cannot become release, deployment or team-readiness evidence.

## Authority and classification

Read AGENTS and the full W10 task; required design/architecture/ownership/
verification documents and registered references are unchanged from inspected
W09 `b47390c8ce04b2674e9222918bcd4e03fa5aed24` by scoped read-only comparison.
The [W01 full source/copy/action inventory](../W01/ADMIN_SURFACE_MATRIX.md),
[W07 complete action/required-gap matrix](../W07/ADMIN_ACTION_MATRIX.md),
[W08 security/accessibility cases](../W08/ADMIN_SECURITY_ACCESSIBILITY_MATRIX.md)
and [W09 entry/evidence packet](../W09/STAGING_ENTRY_AND_W10_PACKET.md) remain
required cross-references. Nothing in their unresolved scope is waived.

`A:n` = exact line n of `design/reference/approved/washgo-admin-prototype.html`;
`G:n` = `packages/contracts/src/gateway.ts`; `I:n` =
`packages/contracts/src/identity.ts`. A remains 40,310 bytes, blob
`301e247267b8d68d11d084ce8cc458b59f7d5e2e`, SHA-256
`b13353195e914a7572ad033040d2a5112973e3eeabf2a584aa23282cd1ca8273`.
F010 registry/provenance freezes these prototype bytes and Arabic/RTL shape;
it does not approve missing production/detail/error/recovery or full English/LTR
states. Historical authority conflict is DEC-D-18 in
[DECISIONS](../W01/DECISIONS.md); other finance/privacy/consent/provider/grant/
metric/location decisions there remain open.

Every row's **I/L/C/entry** tuple is explicit and independent:

| Code used in rows | Exact classification / current meaning |
| --- | --- |
| FO | Implementation **FOUNDATION_ONLY**: actual reusable technical code/model at its stated scope. This is not a product action implementation. |
| NI | Implementation **NOT_IMPLEMENTED**: no actual admin/owner product integration for this action; registered local/inert/simulated controls are not backend behavior. |
| S | Local observation **CURRENT_SOURCE_STATIC_VERIFIED**: source bytes/symbols/absence inspected at the analysis SHA only. Product local execution is NOT_RUN. S is not a browser, DB, provider or authorization test PASS. |
| U | Candidate verification **CANDIDATE_UNVERIFIED**: candidate/artifact/environment and case results absent. Historical source-bound artifacts cannot close it. |
| B | Entry **ENTRY_BLOCKED**: BASE_W10, accepted owner schema/client/scoped auth/design/current producer and allocated evidence inputs missing; verdict **NO_GO**. |

STATIC means display fixture; INERT means no effective handler; LOCAL means
prototype DOM/navigation only; SIMULATED means experimental toast only. HINT is
a subtitle/count; W07-required means a carried task requirement, without approved
interactive design. **All product rows have production/English approval pending**
even when the registered layout/control is approved. No required query/editor/
export is silently added as approved. No current absent grant/URL is invented.

Census retained: **17 screens, 17 sidebar buttons, 58 static buttons (36 handler
bound/22 inert), eight static fields, five modal types/16 dynamic fields, eight
modal triggers = five page triggers + three dashboard shortcuts, and five jumps**.
The 87 product groups below group related actions, not distinct test assertions.
Each listed member, modal field/trigger, navigation destination, state, negative
actor and concrete example needs its own actual case/result in the W10 acceptance
specification. A family PASS cannot conceal an untested member.

## Current foundation facts and exact transport

`architecture/parallel-contract-release.json:20–27,87–93,494–502,709–715`
still publishes W01/INTEGRATION_PENDING, BASE_W02=null, no BASE_W10, no accepted
next-wave contracts/clients and false business/staging acceptance.

| Foundation row / immutable source | Actual code/data/API/event boundary | Owner / missing dependency | I/L/C/entry; retest |
| --- | --- | --- | --- |
| FND-D10-01 — admin boot: apps/admin-web/src/index.ts:1–12; index.html:10–14; server.mjs:12–58 | businessReady=false, technical static assets, readiness503; no 17-screen port/router/provider connection/persisted action or metrics/live map/export. | D app; E allocation/gateway; A/B/C/D real owners. Existing package scripts build/typecheck/test:runtime are technical-scope commands, not product proof. | FO/S/U/B; D app + owners, E final candidate. |
| FND-D10-02 — Identity: I:3–39; services/identity/src/domain/auth-policy.ts:21–48; application/identity-auth.service.ts:339–476; prisma/schema.prisma:31–89 | Real account/challenge/session/refresh/audit foundation; live ACTIVE/bound session/revocation/expiry/authVersion checks, current actor recheck on role/status commit and target-session revocation. Refresh old-token replay revokes session. | E owns existing auth. Guest/member/object/purpose/market/step-up and continuing owner authority are unaccepted; owner checks required at read/commit/replay/status/reconnect/download. | FO/S/U/B; E trust/provider, owners scope + D consumer. |
| FND-D10-03 — Gateway: G:133–206; apps/api-gateway/src/infrastructure/identity-client.ts:24–74; application/gateway.service.ts:45–101; domain/policy.ts:22–58; infrastructure/http-client.ts:5–72 | Live Identity then exact route-grant checks; query strings rejected; UUID syntax only; key validated/forwarded, one bounded HTTP attempt/no redirects. No durable business idempotency/status lookup or private export transport. | E transport; authoritative owners persist/authorize. Routing discovery does not implement an upstream product endpoint. | FO/S/U/B; E + each producer/D consumer. |
| FND-D10-04 — contracts/events/persistence: packages/contracts/src/registry.ts:4–32; event-contracts/src/registry.ts:14–29; api-clients/src/index.ts:1–2; services/{support,reviews,configuration}/prisma/schema.prisma:22–28; services/{reporting,communications}/src/inbox/consumer.runner.ts:107–135 | contracts0.0.2 exports Identity V1 foundation/Gateway V1 routing only; event-contracts0.0.2 has foundation.probe.created.v1 runtime and booking.confirmed.v1 contract-only; api-clients0.0.1 empty. D markers/probe Inbox/effects are not cases, moderation, conversations, delivery, config versions, reports/exports or recovery models. | D owns its product models/history; A/B/C supply real owners; E publishes reviewed contracts/clients. General P2002/23505→DUPLICATE catch remains static risk in both D inbox/prisma-inbox.store.ts:44–58; no reproduced repair is claimed. | FO/S/U/B; D store/projection/source fixes, E platform/candidate. |

E01–E08 below are existing W07 document labels, **not accepted new contracts**.
Public prefix is `/api/v1`.

| Existing descriptor / source | Exact existing grant and upstream owner | Missing finer scope/provider |
| --- | --- | --- |
| E01 POST /admin/dispatch/:id (G:133–140) | operations.dispatch; required key; Booking /internal/v1/booking/:id/dispatch | C Dispatch assignment owner versus current Booking routing needs E/C freeze; no manual/list/reassign/cancel/reschedule schema. |
| E02 GET /admin/billing (G:143–148) | billing.read; Billing /internal/v1/billing/summary | No financial detail/proof/search/verification/settlement/status schema/provider. |
| E03 POST /admin/billing/:id/refund (G:151–157) | billing.refund; required key; Billing /internal/v1/billing/:id/refund | No accepted request/approve/execute separation, allowance/provider/status/replay contract. |
| E04 GET /admin/support (G:159–166) | support.cases.read; Support /internal/v1/support/cases | support.cases.write vocabulary (I:24) has no Gateway write route or actual case provider. |
| E05 POST /admin/reviews/:id (G:168–174) | verification.review; required key; Workforce /internal/v1/workforce/:id/review | **C verification is not D Reviews moderation/publication**; no private dossier/work activation provider. |
| E06 POST /admin/accounts/:id/status (G:177–184) | identity.accounts.suspend; Identity strict {status} ACTIVE/SUSPENDED | Account access is not Workforce eligibility; reason/revision/purpose/step-up fields are not added by D. |
| E07 POST /admin/accounts/:id/roles (G:186–193) | identity.roles.assign; Identity strict {roles} of seven coarse roles | No arbitrary permission/market/MFA/Configuration editor. |
| E08 GET /admin/overview (G:206) | Both billing.read + support.cases.read; E02/E04 composition | Not Dashboard/Reporting or all-domain aggregation/freshness policy. |

Role union is current source, not a Settings fixture: Operations =
operations.dispatch; Finance = billing.read/billing.refund; Support =
support.cases.read/write; reviewer = verification.review. Super-admin has only
the fourteen exported permissions. Operations/Support-only must be denied money
commands and Reviews moderation. Self/customer and assigned-technician grants
do not authorize arbitrary staff/beneficiary access.

## Required evidence profiles — all currently absent / NOT_RUN

Every product row requires **P + V**; added profile letters identify the extra
case evidence. Row “retest” names responsibility, not supplied contacts or approval.

| Profile | Required real candidate-bound proof / blockers to close |
| --- | --- |
| P — product/authority/persistence | Accepted strict schema/version/client, current actor/guest/service/object/purpose/market/assignment scope; real owner DB/migration/constraints and HTTP provider/consumer; durable receipt/revision/audit/outbox, same original key/fingerprint/replay/conflict/lifetime/status/unknown/compensation, reload and concurrent/foreign/revoked/forged-role denial. No fixture/private DTO/peer DB fallback. |
| V — approved design/interaction | Exact action/copy/state approval including missing production/English; canonical pinned Linux reference/candidate/diff all six widths, keyboard/AT/modal/focus/announcements, RTL/LTR and normal/reduced motion; separate Windows/device evidence. W08 AX-D08-01..08 static/historical debt is not fresh reproduction or waiver. |
| F — financial/benefit/resource truth | Real exact Money/currency/precision/time policy, actual B provider provenance/verification/audit; separate received/allocated/refunded/custody/company-settled and benefit/capacity/assignment facts. Same original uncertain operation, capped unresolved refund exposure, last-unit/funds/promo races and independent compensation. Proof/work completion/ACK is not money. |
| X — private/export/privacy | Current purpose/object/version/processing/scan/quarantine/expiry/retention/legal hold; job/query/download/replay authorization and private artifact digest; field minimization/injection/resource bounds/revocation/cache/tab/restore suppression. Customer CSV section authority A; D export/coordinator is unaccepted, not owner reassignment. |
| H — history/report/recovery | Independent permitted source snapshots/high-water/frontiers/gaps/corrections per currency, current privacy masks; fenced new generation/catch-up/atomic cutover, real DB/broker interruption/duplicate/hash-conflict/restore/rollback and measured RPO/RTO under approved profile. Rebuild never resends messages or reissues finance/Booking commands. |
| N — communications/consent | Accepted channel/provider/template/purpose/current consent/recipient/member/guest binding at enqueue/send/read/reconnect/fanout; ordered cursor/hash/gap/recovery and dedup original external intent. Submission/delivery/browser receipt/read differ; OTP proves no SMS/general provider ability. |

P/X/N/H carry SEC-D08-01..08 in the W08 matrix and all W09 runbook/recovery cases
forward. Required real three-app journeys include technician correction→work
eligibility, cash→collection/custody/company settlement, electronic proof/refund,
subscription/promotion, fleet restriction, Support remedy, Reviews moderation and
scheduled notification. Each scope action and each example needs actual evidence,
not a mock-only family result.

## All 17 screen action groups

Each source field separates registered prototype behavior from the required
missing action. Each row's unmet-design/provider field is a blocker, not approval.
Names use A:141–142; Dashboard initially welcomes Ahmed; Disputes initially uses
مركز النزاعات. Common production/English, current auth and evidence gates apply
to every group. No page-specific search/filter/export is approved merely because
it is absent; only carried required/visible/hinted scope is listed.

### dashboard — لوحة التحكم / Dashboard

| Action ID / every retained action in group | Exact source / prototype versus required gap | Authoritative owner / actual grant boundary | Unmet design/contract/persistence blocker | Evidence / retest owner; I/L/C/entry |
| --- | --- | --- | --- | --- |
| ACT-D10-dashboard-01 — Read five KPIs, revenue/bookings chart, status/service mix; date/period/query/drill-down | A:73–85 STATIC; no date/period handler; AG-01, W07 dashboard row | D Reporting; all source owners; E08 is not this query | Metric units/currency/time, parameters, source vector/loading/partial/stale/error absent; production/EN pending | H; D + sources; E candidate; **NI/S/U/B — NO_GO** |
| ACT-D10-dashboard-02 — Read technician map/current positions and recent bookings | A:89–90 STATIC; marker/detail read absent; AG-01, W07 dashboard row | C Workforce location + C Booking/Dispatch; D view; no grant | Location purpose/phase/precision/freshness/current assignment and map/detail states absent; production/EN pending | P H; C/D; E candidate; **NI/S/U/B — NO_GO** |
| ACT-D10-dashboard-03 — Read real technical health and technician/refund/dispute pending work | A:94–96 STATIC; pending jumps JUMP-D10-03..05; AG-01, W07 dashboard row | E observability; C Workforce/B Billing/D Support; E08 limited | Real health versus business readiness, bounded pending dossiers/revisions and denial states absent; production/EN pending | H; E/C/B/D; E candidate; **NI/S/U/B — NO_GO** |

### bookings — الحجوزات / Bookings

| Action ID / every retained action in group | Exact source / prototype versus required gap | Authoritative owner / actual grant boundary | Unmet design/contract/persistence blocker | Evidence / retest owner; I/L/C/entry |
| --- | --- | --- | --- | --- |
| ACT-D10-bookings-01 — List/search booking or customer; filter status/date | A:100 INERT query fields; A:144–146 STATIC rows; AG-02, W07 bookings row | C Booking; no admin query grant/client; self reads are not staff access | Scope-bound query/cursor, current lifecycle/owner revisions, empty/partial/stale/error absent; production/EN pending | P; C/D; E candidate; **NI/S/U/B — NO_GO** |
| ACT-D10-bookings-02 — Read booking detail/history and independent work/payment/capacity/assignment facts | A:100 subtitle HINT; no row/detail control; AG-02, W07 bookings row | C Booking/Scheduling/Dispatch/Workforce; B Billing; no detail grant | Dossier, attempt/fence/work binding, immutable snapshots/current-owner outcomes absent; production/EN pending | P H F; C/B/D; E candidate; **NI/S/U/B — NO_GO** |
| ACT-D10-bookings-03 — Create manual booking | A:100 LOCAL + حجز يدوي; MODAL-D10-04 at A:153; AG-02, W07 bookings row | C Booking coordinator; A Customer/Vehicle/Geo; B Catalog/Pricing/Billing; no staff-create grant | Beneficiary/address/payment/quote/capacity/explicit confirmation and partial recovery absent; production/EN pending | P F; A/B/C/D; E candidate; **NI/S/U/B — NO_GO** |
| ACT-D10-bookings-04 — Assign/reassign and resolve dispatch exceptions | A:100 subtitle HINT; no assignment control; AG-02, W07 bookings row | C Dispatch; E01 operations.dispatch routes to Booking; exact E/C binding pending | Current work grant/resources/intervals, expected revisions, conflict/unknown/reassign states absent; production/EN pending | P; C/D/E; E candidate; **NI/S/U/B — NO_GO** |
| ACT-D10-bookings-05 — Cancel with reason, independent compensation and historical correction | A:100 subtitle HINT; no cancel control; AG-02, W07 bookings row | C Booking/Scheduling/Dispatch; B finance/benefits; no cancel grant | Allowed lifecycle/fence, audit, late payment and compensation scope/states absent; retained W05 requirement; production/EN pending | P F H; C/B/D; E candidate; **NI/S/U/B — NO_GO** |
| ACT-D10-bookings-06 — Reschedule using current quote/availability and safe alternate-slot failure | A:100 subtitle HINT; no reschedule control; AG-02, W07 bookings row | C Booking/Scheduling/Dispatch; A/B current inputs; no reschedule grant | Current revisions/new slot, failed alternate/unknown/recovery and immutable old snapshot absent; production/EN pending | P F; A/B/C/D; E candidate; **NI/S/U/B — NO_GO** |

### customers — الزبائن / Customers

| Action ID / every retained action in group | Exact source / prototype versus required gap | Authoritative owner / actual grant boundary | Unmet design/contract/persistence blocker | Evidence / retest owner; I/L/C/entry |
| --- | --- | --- | --- | --- |
| ACT-D10-customers-01 — List/scoped search/filter and current customer summaries | A:102 STATIC list/KPIs; no search/filter control; AG-03, W07 customers row | A Customer; no admin customer query grant | Bounded query/snapshot, purpose/foreign-subject denial, loading/empty/stale/error absent; production/EN pending | P; A/D; E candidate; **NI/S/U/B — NO_GO** |
| ACT-D10-customers-02 — Read dossier/profile, cars/addresses, subscriptions and service history | A:102 subtitle HINT; no dossier controls; AG-03, W07 customers row | A Customer/Vehicle/Geo; B Subscription; C Booking; no staff dossier grant | Per-owner fieldsets/revisions/relationship, current/private/historical detail states absent; production/EN pending | P H; A/B/C/D; E candidate; **NI/S/U/B — NO_GO** |
| ACT-D10-customers-03 — Create/edit customer and customer-vehicle records | A:102 no authoring control; W07-required authoring; AG-03, W07 customers row | A Customer/Vehicle; no admin authoring grant; self grants remain self-only | Accepted forms/current beneficiary/entity revisions, separate partial saves/history and conflicts absent; production/EN pending | P; A/D; E candidate; **NI/S/U/B — NO_GO** |
| ACT-D10-customers-04 — Read/update marketing preferences; privacy intake/status/per-owner fulfillment | A:102 no consent/privacy controls; W07/W06 retained gap; AG-03, W07 customers row | A Customer consent; each section owner; coordinator unaccepted; E grants absent | Purpose/legal hold/retention/restore suppression and partial/blocked owner results absent; production/EN pending | P X H; A/all/D/E; E candidate; **NI/S/U/B — NO_GO** |
| ACT-D10-customers-05 — Customer CSV request/query/download | A:102 INERT تصدير CSV; AG-03, W07 customers row | A owns authoritative Customer CSV section; D Reporting export/coordinator proposal unaccepted; C Media bytes | Export field/scope/privacy policy, job/artifact/expiry/denied/download states and grant absent; production/EN pending | X; A/D/C/E; E candidate; **NI/S/U/B — NO_GO** |

### technicians — الفنيون / Technicians

| Action ID / every retained action in group | Exact source / prototype versus required gap | Authoritative owner / actual grant boundary | Unmet design/contract/persistence blocker | Evidence / retest owner; I/L/C/entry |
| --- | --- | --- | --- | --- |
| ACT-D10-technicians-01 — List/search/scoped dossier and current eligibility | A:104 STATIC table/counts; dossier/search absent; AG-04, W07 technicians row | C Workforce; Identity access separate; no staff query/private dossier grant | Current personnel/application/revision/work grant/status, foreign/revoked and stale/empty states absent; production/EN pending | P; C/D/E; E candidate; **NI/S/U/B — NO_GO** |
| ACT-D10-technicians-02 — Invite/create/onboard technician | A:104 LOCAL + إضافة فني; MODAL-D10-01; AG-04, W07 technicians row | C Workforce application/personnel; E Identity; A Geo; no accepted invitation command | Invitation versus application, duplicate identity/market/success/error and access/work separation absent; production/EN pending | P; C/D/E; E candidate; **NI/S/U/B — NO_GO** |
| ACT-D10-technicians-03 — View private identity/vehicle verification documents | A:104 three document-status HINTS; no viewer; AG-04, W07 technicians row | C Media object/version/scan; C Workforce review purpose; no private viewer grant | Upload/processing/quarantine/finalized/expiry/denied/audit/retention states absent; production/EN pending | X P; C/D/E; E candidate; **NI/S/U/B — NO_GO** |
| ACT-D10-technicians-04 — Review joining requests; approve/reject/request corrections and audit | A:104 three INERT مراجعة buttons; AG-04, W07 technicians row | C Workforce; E05 verification.review; not D Reviews | Real dossier/case revision, reason/decision/correction/history and competing-review states absent; production/EN pending | P; C/D/E; E candidate; **NI/S/U/B — NO_GO** |
| ACT-D10-technicians-05 — Activate/revoke work eligibility; separately suspend/reactivate login | A:104 activation/suspend absent; W07 retained requirement; AG-04, W07 technicians row | C Workforce work grant; E06 identity.accounts.suspend only account ACTIVE/SUSPENDED | Current work eligibility propagation versus account access, expected revisions and denied states absent; production/EN pending | P; C/D/E; E candidate; **NI/S/U/B — NO_GO** |
| ACT-D10-technicians-06 — Manage shifts/team/resources/coverage; read performance and review history | A:104 subtitle HINT; controls absent; AG-04, W07 technicians row | C Workforce/Scheduling/Dispatch; A Geo; D safe Reviews/Reporting; no finer grant | Current resource/shift/coverage revisions, operational effects and immutable performance/audit states absent; production/EN pending | P H; C/A/D; E candidate; **NI/S/U/B — NO_GO** |

### services — الخدمات والباقات / Services & Packages

| Action ID / every retained action in group | Exact source / prototype versus required gap | Authoritative owner / actual grant boundary | Unmet design/contract/persistence blocker | Evidence / retest owner; I/L/C/entry |
| --- | --- | --- | --- | --- |
| ACT-D10-services-01 — Read package/add-on definitions, duration and compatibility detail | A:106 STATIC cards/add-ons; detail absent; AG-05, W07 services row | B Catalog definitions/durations/compatibility; no admin read/detail grant | Published current revisions/list/detail and unavailable/stale states absent; production/EN pending | P; B/D; E candidate; **NI/S/U/B — NO_GO** |
| ACT-D10-services-02 — Create/edit packages/add-ons; enable/disable and compatibility/duration | A:106 LOCAL + باقة جديدة; MODAL-D10-05; other authoring absent; AG-05, W07 services row | B Catalog; no authoring grant | Full accepted authoring forms/revisions/validation/resource effects and historical preservation absent; production/EN pending | P; B/D; E candidate; **NI/S/U/B — NO_GO** |
| ACT-D10-services-03 — Create/edit price versions and compose separate Catalog/Pricing outcomes | A:106 prices STATIC; MODAL-D10-05 price field; AG-05, W07 services row | B Pricing money/quotes; Catalog separate; no price-admin grant | Money/currency/rounding/effective policy and partial/unknown operation recovery absent; production/EN pending | P F; B/D; E candidate; **NI/S/U/B — NO_GO** |
| ACT-D10-services-04 — Publish/activate/version/history/forward rollback | A:106 lifecycle absent; W07 retained gap; AG-05, W07 services row | B Catalog/Pricing; D Configuration applicable policy; no publish grant | Prerequisite approvals/current revisions/adoption/history and no retroactive quote rewrite absent; production/EN pending | P H; B/D; E candidate; **NI/S/U/B — NO_GO** |

### fleet — الأسطول والمركبات / Fleet & Vehicles

| Action ID / every retained action in group | Exact source / prototype versus required gap | Authoritative owner / actual grant boundary | Unmet design/contract/persistence blocker | Evidence / retest owner; I/L/C/entry |
| --- | --- | --- | --- | --- |
| ACT-D10-fleet-01 — List/detail/create/edit service vehicles and equipment | A:108 STATIC table; INERT + مركبة خدمة; AG-06, W07 fleet row | C Workforce vans/equipment/teams; A Vehicle only customer cars; no Fleet service/grant | Approved forms/current resource revisions/owner persistence and denial states absent; production/EN pending | P; C/D; E candidate; **NI/S/U/B — NO_GO** |
| ACT-D10-fleet-02 — Assign team; manage maintenance/availability and shift/resource intervals | A:108 maintenance/team HINT; controls absent; AG-06, W07 fleet row | C Workforce; C Scheduling/Dispatch consumers; no finer resource grant | Active-assignment/interval fencing, maintenance conflict/current eligibility and partial effects absent; production/EN pending | P; C/D; E candidate; **NI/S/U/B — NO_GO** |
| ACT-D10-fleet-03 — Read water/energy/maintenance/ready metrics | A:108 STATIC percentages/counts/dates; AG-06, W07 fleet row | C Workforce authoritative resource facts; telemetry source unaccepted | Missing versus measured values, source/time/units/freshness and real operator/capacity effect absent; production/EN pending | H P; C/D; E candidate; **NI/S/U/B — NO_GO** |

### payments — المدفوعات / Payments

| Action ID / every retained action in group | Exact source / prototype versus required gap | Authoritative owner / actual grant boundary | Unmet design/contract/persistence blocker | Evidence / retest owner; I/L/C/entry |
| --- | --- | --- | --- | --- |
| ACT-D10-payments-01 — Search/filter/list/detail payments, obligations and original operation status | A:110 STATIC totals/rows; detail/query absent; AG-07, W07 payments row | B Billing; E02 billing.read only summary descriptor; fine scope absent | Accepted query/detail/status/receipt schema, exact Money/merchant/booking relations and partial/unknown states absent; production/EN pending | P F; B/D/E; E candidate; **NI/S/U/B — NO_GO** |
| ACT-D10-payments-02 — Read proof queue/private evidence and review history | A:110 بانتظار التحقق HINT; no viewer/queue; AG-07, W07 payments row | B Billing review; C Media current object-purpose bytes; no review/private grant | Scan/quarantine/replacement/expiry/current case/reviewer/evidence revisions and audited viewer absent; production/EN pending | P X F; B/C/D; E candidate; **NI/S/U/B — NO_GO** |
| ACT-D10-payments-03 — Approve/reject electronic verification and independently received/allotted funds | A:110 fixture مؤكد only; decision absent; AG-07, W07 payments row | B Billing server verification/audit; Operations/Support alone denied | Maker/checker policy, real provider finality/current authorization/duplicate reviewer/late-money states absent; production/EN pending | P F; B/D/E; E candidate; **NI/S/U/B — NO_GO** |
| ACT-D10-payments-04 — Request/approve/execute partial/full refund; status/retry/escalation | A:110 refund-count HINT; no refund control; AG-07, W07 payments row | B Billing; E03 billing.refund; finer approval/execute/current scope absent | Captured-source/cumulative unresolved allowance, original identity/provider/query/audit and unknown/noncommit states absent; production/EN pending | P F; B/D/E; E candidate; **NI/S/U/B — NO_GO** |
| ACT-D10-payments-05 — Approve actual cash collection/company settlement; correlate custody | A:110 Cash محصل STATIC; settlement HINT; AG-07, W07 payments row | B Billing collection/allocation/treasury; B Wallet physical custody separate; no collect/settle grant | Independent work/collector/receipt/holder/company facts, Money, discrepancy and current finance audit absent; production/EN pending | P F; B/C/D; E candidate; **NI/S/U/B — NO_GO** |
| ACT-D10-payments-06 — Daily match/reconcile receipts, verification, refunds and settlements | A:110 INERT مطابقة اليوم; AG-07, W07 payments row | B Billing; D derived Reporting; no reconciliation grant/provider | Independent per-currency totals/source coverage/original corrections and unresolved disposition absent; production/EN pending | F H; B/D; E candidate; **NI/S/U/B — NO_GO** |

### wallets — المحافظ / Wallets

| Action ID / every retained action in group | Exact source / prototype versus required gap | Authoritative owner / actual grant boundary | Unmet design/contract/persistence blocker | Evidence / retest owner; I/L/C/entry |
| --- | --- | --- | --- | --- |
| ACT-D10-wallets-01 — Read holder/purpose balances, custody/movements/handover detail | A:112 STATIC custody/settled/pending cards only; AG-08, W07 wallets row | B Wallet approved holders/purposes; C Workforce holder identity; no wallet grant | Real available/held/claimed/custody partitions, original Billing backing/source coverage and views absent; production/EN pending | P F; B/C/D; E candidate; **NI/S/U/B — NO_GO** |
| ACT-D10-wallets-02 — Reserve/claim/capture/release; resolve/correct original unknown hold/movement | A:112 no action; W07 retained wallet requirement; AG-08, W07 wallets row | B Wallet own transaction; B Billing eligible posting/noncommit; no wallet command | Last-funds constraints, current grant/fingerprint/fence, durable unknown exposure/recovery schema absent; production/EN pending | P F; B/D; E candidate; **NI/S/U/B — NO_GO** |
| ACT-D10-wallets-03 — Review physical handover/custody discrepancy versus company settlement | A:112 custody/handover HINT; no review/action; AG-08, W07 wallets row | B Wallet physical custody; B Billing collection/treasury separately | Independent physical/holder/company receipts and audited linked correction; no balance edit/second revenue absent; production/EN pending | F H; B/D; E candidate; **NI/S/U/B — NO_GO** |

### subscriptions — الاشتراكات / Subscriptions

| Action ID / every retained action in group | Exact source / prototype versus required gap | Authoritative owner / actual grant boundary | Unmet design/contract/persistence blocker | Evidence / retest owner; I/L/C/entry |
| --- | --- | --- | --- | --- |
| ACT-D10-subscriptions-01 — List/detail/create/edit plans and applicable versions | A:114 STATIC offers; INERT + خطة اشتراك; AG-09, W07 subscriptions row | B Subscription; B Catalog/Pricing benefit inputs; no plan-admin grant | Plan/editor/effective terms/current revisions and publication/error states absent; no automatic recurring debit approval; production/EN pending | P; B/D; E candidate; **NI/S/U/B — NO_GO** |
| ACT-D10-subscriptions-02 — Read subscriber/remaining units; renew/freeze/resume/cancel/correct | A:114 subtitle HINT; no subscriber/action; AG-09, W07 subscriptions row | B Subscription entitlements; B Billing money independently; no benefit-admin grant | Beneficiary/term/history/expiry/policy, real activation and permitted correction states absent; production/EN pending | P F H; B/D; E candidate; **NI/S/U/B — NO_GO** |
| ACT-D10-subscriptions-03 — Reserve/use/release/compensate benefits through actual Booking | A:114 no operation; W07 retained consumer requirement; AG-09, W07 subscriptions row | B Subscription; C Booking accepted attempt/fence; no consumer/status family | Last-unit concurrency, unknown claim preservation and separate refund/benefit restoration absent; production/EN pending | P F; B/C/D; E candidate; **NI/S/U/B — NO_GO** |

### promotions — العروض والكوبونات / Promotions

| Action ID / every retained action in group | Exact source / prototype versus required gap | Authoritative owner / actual grant boundary | Unmet design/contract/persistence blocker | Evidence / retest owner; I/L/C/entry |
| --- | --- | --- | --- | --- |
| ACT-D10-promotions-01 — List/detail/create/edit rules; activate/disable/expiry/limits/eligibility/stacking/audience | A:116 STATIC coupons; LOCAL + عرض جديد; MODAL-D10-02; AG-10, W07 promotions row | B Pricing promotions; D policy/derived usage; no promotion-admin grant | Complete rule/form/version/consent/activation/validation/conflict states absent; production/EN pending | P N; B/D; E candidate; **NI/S/U/B — NO_GO** |
| ACT-D10-promotions-02 — Validate fixed-Money versus percent; use current quote and explicit acceptance | A:116 STATIC amounts; MODAL-D10-02 type/value; AG-10, W07 promotions row | B Pricing; B Catalog product inputs; no price/promo command profile | Exact Money/currency/bounds/rounding/effective quote and changed-quote states absent; production/EN pending | P F; B/D/A; E candidate; **NI/S/U/B — NO_GO** |
| ACT-D10-promotions-03 — Read usage; reserve/use/release/restore allowance and audit corrections | A:116 usage counters STATIC; actions absent; AG-10, W07 promotions row | B Pricing atomic limits/counters; C Booking; D Reporting derived | Last-use/budget races, original attempts/unknown exposure and independent cancellation/refund correction absent; production/EN pending | P F H; B/C/D; E candidate; **NI/S/U/B — NO_GO** |

### coverage — المناطق والتغطية / Areas & Coverage

| Action ID / every retained action in group | Exact source / prototype versus required gap | Authoritative owner / actual grant boundary | Unmet design/contract/persistence blocker | Evidence / retest owner; I/L/C/entry |
| --- | --- | --- | --- | --- |
| ACT-D10-coverage-01 — List/select/detail/create/edit zones/boundaries | A:118 INERT + منطقة and four area buttons; AG-11, W07 coverage row | A Geo service zones/geofences; no Geo admin grant | Exact Aleppo geography/boundary forms/publication/current revision/denied states absent; production/EN pending | P; A/D; E candidate; **NI/S/U/B — NO_GO** |
| ACT-D10-coverage-02 — Check location/serviceability/travel and independent capacity/hours | A:118 subtitle/map HINT; controls absent; AG-11, W07 coverage row | A Geo advisory; C Scheduling capacity/Workforce resources; D policy | Current owner revisions, manual location option, interval/boundary/stale/unknown decision states absent; production/EN pending | P; A/C/D; E candidate; **NI/S/U/B — NO_GO** |
| ACT-D10-coverage-03 — Read map/capacity percentages with current source and usable detail | A:118 STATIC Service Zones and 92/76/81/64%; AG-11, W07 coverage row | A/C authoritative source; D derived view; no metric/map query grant | Metric unit/time/freshness and map/detail controls/accessible alternative absent; no availability inferred; production/EN pending | H V; A/C/D; E candidate; **NI/S/U/B — NO_GO** |

### live — الخريطة الحية / Live Map

| Action ID / every retained action in group | Exact source / prototype versus required gap | Authoritative owner / actual grant boundary | Unmet design/contract/persistence blocker | Evidence / retest owner; I/L/C/entry |
| --- | --- | --- | --- | --- |
| ACT-D10-live-01 — Track permitted teams/vehicles/active bookings; marker/detail/map controls | A:120 STATIC five markers, ● Live, 600px Riyadh map; A:89; AG-12, W07 live row | C Workforce location/resources + C Booking/Dispatch; task/phase binding E/C pending; D view | Actual authorized points, precision/observedAt/current relationship and map/detail/stale states absent; production/EN pending | P X V; C/D/E; E candidate; **NI/S/U/B — NO_GO** |
| ACT-D10-live-02 — Subscribe/reconnect/drop stale/duplicate points and enforce revocation/privacy expiry | A:120 no network/subscription; W07/SEC-D08-03; AG-12, W07 live row | C current location facts; E transport/current grants; no location/socket family | Per-phase/purpose/grant/time bounds, offline/gap/reassignment/reconnect and retention states absent; production/EN pending | P H; C/D/E; E candidate; **NI/S/U/B — NO_GO** |

### reviews — التقييمات / Reviews & Ratings

| Action ID / every retained action in group | Exact source / prototype versus required gap | Authoritative owner / actual grant boundary | Unmet design/contract/persistence blocker | Evidence / retest owner; I/L/C/entry |
| --- | --- | --- | --- | --- |
| ACT-D10-reviews-01 — Read rating aggregates, moderation queue/detail/current review content | A:122 STATIC three metrics; reads/queue absent; AG-13, W07 reviews row | D Reviews; C eligible completion; A author/guest binding; no Reviews grant | Real verified published revisions/private fieldset/query/detail/denied/stale states absent; production/EN pending | P H; D/C/A/E; E candidate; **NI/S/U/B — NO_GO** |
| ACT-D10-reviews-02 — Moderate/publish/hide/restore/retract/appeal with immutable decision history | A:122 needs-review HINT; no decision; AG-13, W07 reviews row | D Reviews; E05 verification.review is Workforce only | Current moderator/review revision, reason/audit/retention/appeal/concurrent decision states absent; no rewriting stars/text; production/EN pending | P H; D/E; E candidate; **NI/S/U/B — NO_GO** |
| ACT-D10-reviews-03 — Validate submission uniqueness/eligible service/edit/withdrawal and correct aggregates | A:122 no submission flow; W07/W06 retained requirement; AG-13, W07 reviews row | D Reviews; C current completion/correction; A author/attribution consent | Incomplete/foreign/expired guest, accepted edit window/current eligibility and replay/correction outcomes absent; production/EN pending | P H; A/C/D/E; E candidate; **NI/S/U/B — NO_GO** |

### disputes — النزاعات / Disputes (initial heading مركز النزاعات)

| Action ID / every retained action in group | Exact source / prototype versus required gap | Authoritative owner / actual grant boundary | Unmet design/contract/persistence blocker | Evidence / retest owner; I/L/C/entry |
| --- | --- | --- | --- | --- |
| ACT-D10-disputes-01 — List/search/filter/detail/triage/assign/priority; case timeline/history | A:124 STATIC two cases; no row/query/actions; AG-14, W07 disputes row | D Support; E04 support.cases.read; write vocabulary unconnected | Current assigned staff/requester/case revision, scope/cursor/create/decision/history states absent; production/EN pending | P H; D/E; E candidate; **NI/S/U/B — NO_GO** |
| ACT-D10-disputes-02 — Read private evidence/staff notes; permitted replies and escalation | A:124 evidence/decisions HINT; no dossier/reply; AG-14, W07 disputes row | D Support/Communications; C Media/current Booking participants; finer purpose grants absent | Private scan/fieldsets/object authority, staff-only notes/membership and durable reply/evidence states absent; production/EN pending | P X N; D/C/E; E candidate; **NI/S/U/B — NO_GO** |
| ACT-D10-disputes-03 — Resolve/reopen nonfinancial case; request owner remedy/refund and track independently | A:124 open/in-review STATIC; no resolution/refund tool; AG-14, W07 disputes row | D Support receipt; B Billing separate E03 finance; C lifecycle remedies | Concurrent resolution/original remedy/status/partial unknown/audit and case-versus-money result absent; production/EN pending | P F H; D/B/C/E; E candidate; **NI/S/U/B — NO_GO** |
| ACT-D10-disputes-04 — Privacy intake/status and per-owner retained/blocked/partial fulfillment | A:124 no privacy flow; W07/W06 retained scope; AG-14, W07 disputes row | D Support intake; all data owners incl B financial privacy; coordinator unaccepted | Current requester/task/object authority, legal hold/retention/export/restore suppression and owner-result states absent; production/EN pending | X H; all owners/D/E; E candidate; **NI/S/U/B — NO_GO** |

### notifications — الإشعارات / Notifications

| Action ID / every retained action in group | Exact source / prototype versus required gap | Authoritative owner / actual grant boundary | Unmet design/contract/persistence blocker | Evidence / retest owner; I/L/C/entry |
| --- | --- | --- | --- | --- |
| ACT-D10-notifications-01 — List/read delivery detail/history/attempts and actual monitoring | A:126 three INERT Sent 1,204 / Sent 18 / Scheduled rows; AG-15, W07 notifications row | D Communications intents/attempts; E grants; provider profile absent | Accepted/submitted/delivered/browser receipt/read/failure distinct with actual provenance/detail absent; production/EN pending | P N H; D/E; E candidate; **NI/S/U/B — NO_GO** |
| ACT-D10-notifications-02 — Compose/send using current template/version/channel/purpose and audience preview | A:126 LOCAL + إشعار جديد; MODAL-D10-03 at A:153; AG-15, W07 notifications row | D Communications; A current consent/recipients; C relationship; no send/bulk grant | Template allowlist/injection/preview/limits/current marketing consent and actual confirm/send states absent; production/EN pending | P N; D/A/C/E; E candidate; **NI/S/U/B — NO_GO** |
| ACT-D10-notifications-03 — Schedule/edit/cancel; opt-out/current membership before enqueue and actual send | A:126 Scheduled HINT; no schedule/cancel controls; AG-15, W07 notifications row | D Communications; A consent; E approved channel/trust | Accepted clock/deadline/revision/queued consent/cancel-race/revocation and recovery states absent; production/EN pending | P N; D/A/E; E candidate; **NI/S/U/B — NO_GO** |
| ACT-D10-notifications-04 — Recover failure/outage/unknown original provider intent without duplicate send | A:126 failures/retry absent; W07/W09 SUP-D09-03; AG-15, W07 notifications row | D Communications; E infrastructure; authorized channel account owner; no retry/status client | Durable original identity/query/finality/current authorization and approved channel capability absent; OTP not SMS proof; production/EN pending | P N H; D/E; E candidate; **NI/S/U/B — NO_GO** |
| ACT-D10-notifications-05 — Read/send conversations; ordered cursor/reconnect/fanout with current membership | A:126 no conversation UI; W07/W06 and SEC-D08-03 scope; AG-15, W07 notifications row | D Communications binding proposed; C current relationships; E private identity mapping; no member/guest grant | Guest expiry/reassignment/staff revoke/private notes/object purpose, gaps/hash/replay/history and full states absent; production/EN pending | P N X; D/C/A/E; E candidate; **NI/S/U/B — NO_GO** |

### reports — التقارير والتحليلات / Reports & Analytics

| Action ID / every retained action in group | Exact source / prototype versus required gap | Authoritative owner / actual grant boundary | Unmet design/contract/persistence blocker | Evidence / retest owner; I/L/C/entry |
| --- | --- | --- | --- | --- |
| ACT-D10-reports-01 — Query/date/filter/drill-down operational/financial/quality/utilization; audit search | A:128 STATIC three metrics/chart; no builder/query; AG-16, W07 reports row | D Reporting; source owners; E08 not Reporting; no report/audit grant | Metric definitions/Money/time boundaries/purpose/source-vector/cursor/partial/stale/error states absent; production/EN pending | P H F; D/all/E; E candidate; **NI/S/U/B — NO_GO** |
| ACT-D10-reports-02 — Request/query/download scoped CSV/PDF/private exports | A:128 INERT تصدير PDF; Customer CSV at A:102; AG-16, W07 reports row | D Reporting admin export proposal; A Customer CSV section authority; coordinator unaccepted; C Media bytes | Fields/purpose/current job/download grants, scanned bytes/digest/expiry/redaction/injection and state approval absent; production/EN pending | X; D/A/C/all/E; E candidate; **NI/S/U/B — NO_GO** |
| ACT-D10-reports-03 — Refresh/reconcile historical cancellations/refunds/moderation/privacy corrections | A:128 no history/freshness; W07 retained requirement; AG-16, W07 reports row | D Reporting derived; each owner authoritative history/snapshots | Independent per-currency source totals/gaps/asOf/coverage/current mask and correction lineage absent; production/EN pending | H F; D/all/E; E candidate; **NI/S/U/B — NO_GO** |
| ACT-D10-reports-04 — Rebuild/catch-up/restart/atomic generation switch and restore reconciliation | A:128 no rebuild/control; W07/W08/W09; AG-16, W07 reports row | D own projection/checkpoints; E orchestrates restore; no rebuild grant/provider | Bounded accepted history/manifest/frontier/fresh fence/privacy masks/cutover/recovery commands and measured results absent; production/EN pending | P H; D/all/E; E candidate; **NI/S/U/B — NO_GO** |

### settings — الإعدادات / Settings

| Action ID / every retained action in group | Exact source / prototype versus required gap | Authoritative owner / actual grant boundary | Unmet design/contract/persistence blocker | Evidence / retest owner; I/L/C/entry |
| --- | --- | --- | --- | --- |
| ACT-D10-settings-01 — Read/edit market/timezone/currency/hold/delay policy draft | A:130 four native DOM fields: Riyadh/Stockholm; SAR/USD/SYP; 10/20 minutes; AG-17, W07 settings row | D Configuration versioned policy; enforcing domain owners; no Configuration grant | Real approved market/currency/time/limits, namespace/current version/validation and full English forms absent; production/EN pending | P; D/all/E; E candidate; **NI/S/U/B — NO_GO** |
| ACT-D10-settings-02 — Validate/approve/publish/activate/adopt/version/history/forward rollback | A:130/157 SIMULATED حفظ التغييرات; no persistence; AG-17, W07 settings row | D Configuration; all owners enforce accepted versions; no publication family | Current CAS/adoption prerequisites/audit/unknown/stale/concurrent/rollback and immutable historical state absent; production/EN pending | P H; D/all/E; E candidate; **NI/S/U/B — NO_GO** |
| ACT-D10-settings-03 — Read roles; suspend/reactivate account, assign roles; finer scope/MFA/separation | A:130 four INERT role-count buttons; no editor; AG-17, W07 settings row | E Identity E06/E07 actual strict commands; broader grant/MFA/market governance unaccepted | Real account/current session role truth, authorized UI/self-denial/privilege separation/audit and exact new policy states absent; production/EN pending | P; E/D; E candidate; **NI/S/U/B — NO_GO** |

## Shared controls, five exact jumps, three shortcuts and all modal fields

These are carried product UI groups, not extra service-owned actions. Five page
modal triggers plus three dashboard shortcuts cover the original eight triggers.
Every modal uses CTRL-D10-07; exact local closing/toast behavior is preserved as
reference, without fabricated validation, durable save or message/financial effect.

### Shared controls

| Group ID / exact control or fields | Source / prototype behavior | Owner / permission boundary | Missing production/English/design/provider behavior | Evidence / retest; I/L/C/entry |
| --- | --- | --- | --- | --- |
| CTRL-D10-01 — All 17 sidebar destinations: dashboard/bookings/customers/technicians/services/fleet/payments/wallets/subscriptions/promotions/coverage/live/reviews/disputes/notifications/reports/settings | A:37–61,147–149 LOCAL show(id) | D presentation; E current auth + each owner scope | Source closes menu and smoothly scrolls only; URL/deep-link/history/permission-filtered nav/denied/session states absent | V P; D/E/all; E candidate; **NI/S/U/B — NO_GO** |
| CTRL-D10-02 — Mobile ☰ open/close/resize/menu navigation | A:67,150 LOCAL; CSS A:28–29 | D UI; E session | Preserve 1250/900/620 breakpoints, 260/270px sidebar; focus/expanded/controls/outside/Escape/reduced-motion states absent | V; D; E candidate; **NI/S/U/B — NO_GO** |
| CTRL-D10-03 — EN ↔ AR language/direction | A:68,141–142,151 LOCAL dictionary/root/global placeholder only | D; product/design approve copy | Full production EN/LTR absent; most subtitles/rows/forms remain Arabic; no parity from toggle | V; D/design; E candidate; **NI/S/U/B — NO_GO** |
| CTRL-D10-04 — Global booking/customer/technician search and result selection | A:67,158 SIMULATED بحث تجريبي: / Prototype search: + query | D composition; A/C owner searches; E current query/auth | Results/empty/loading/detail/keyboard/current scope absent; Gateway policy:22–29 rejects query strings | P V; A/C/D/E; E candidate; **NI/S/U/B — NO_GO** |
| CTRL-D10-05 — ♢ notification badge 3/read/unread drawer | A:15,68 INERT glyph/badge | D Communications; no notification grant | Drawer/current unread/read/access states and provider absent; no approved page connection inferred | P N V; D/E; E candidate; **NI/S/U/B — NO_GO** |
| CTRL-D10-06 — Ahmed ▾ profile/account/logout/session/MFA access | A:62,68 INERT/profile fixtures | E Identity actual auth; D UI; new MFA/scope absent | Real current principal/menu/logout/expiry/switch and finer-governance states absent | P V; E/D; E candidate; **NI/S/U/B — NO_GO** |
| CTRL-D10-07 — Shared modal open, ✕/إلغاء/backdrop close and حفظ | A:136,152–157 LOCAL close; SIMULATED Prototype saved / تم الحفظ في النموذج التجريبي | D UI; each MODAL owner commits | No form validation/receipt/persistence; initial/trap/restore/Escape/dialog/loading/conflict/unknown states absent; reopen discards input | P V; D/modal owner/E; E candidate; **NI/S/U/B — NO_GO** |
| CTRL-D10-08 — Toast/status, focus, motion, charts/maps/tables alternatives and all denial/recovery states | A:137,156–158 ordinary 2s toast; CSS A:15–29; AX-D08-01..08 | D UI/design; every owner truthful outcome | No live-status/production error announcements; static a11y debts vs fresh reproduction separate; all 17 screens/5 modals need real cases | V P; D/design/E; E candidate; **NI/S/U/B — NO_GO** |

### Five navigation jumps

| Group ID / exact control or fields | Source / prototype behavior | Owner / permission boundary | Missing production/English/design/provider behavior | Evidence / retest; I/L/C/entry |
| --- | --- | --- | --- | --- |
| JUMP-D10-01 — عرض الكل → bookings | A:90,149 LOCAL | C Booking + D | Navigation only; does not fetch or filter pending rows | V P; C/D; E candidate; **NI/S/U/B — NO_GO** |
| JUMP-D10-02 — إنشاء تقرير → reports | A:95,149 LOCAL | D Reporting | Navigation only; no report created; actual reports action rows remain required | V H; D; E candidate; **NI/S/U/B — NO_GO** |
| JUMP-D10-03 — 3 طلبات فنيين جديدة → technicians | A:96,149 LOCAL | C Workforce + D | Static count; no query/filter/dossier/approval | V P; C/D; E candidate; **NI/S/U/B — NO_GO** |
| JUMP-D10-04 — 2 طلبات استرداد → payments | A:96,149 LOCAL | B Billing + D | Static count; no filtered query/refund/financial authority | V F; B/D; E candidate; **NI/S/U/B — NO_GO** |
| JUMP-D10-05 — 3 نزاعات مفتوحة → disputes | A:96,149 LOCAL | D Support | Static count; no filtered case query/decision | V P; D/E; E candidate; **NI/S/U/B — NO_GO** |

### Three creation shortcuts

| Group ID / exact control or fields | Source / prototype behavior | Owner / permission boundary | Missing production/English/design/provider behavior | Evidence / retest; I/L/C/entry |
| --- | --- | --- | --- | --- |
| CREATE-D10-01 — + إضافة فني → technician modal | A:95,154 LOCAL; MODAL-D10-01 | C Workforce + E Identity + D | Open only; no invitation/verification/work grant | V P; C/E/D; E candidate; **NI/S/U/B — NO_GO** |
| CREATE-D10-02 — إنشاء عرض → promotion modal | A:95,154 LOCAL; MODAL-D10-02 | B Pricing + D | Open only; no persisted campaign/quote/use allowance | V P; B/D; E candidate; **NI/S/U/B — NO_GO** |
| CREATE-D10-03 — إرسال إشعار → notification modal | A:95,154 LOCAL; MODAL-D10-03 | D Communications + A consent + E | Open only; no consent-based audience/provider send | V N; D/A/E; E candidate; **NI/S/U/B — NO_GO** |

### Five modal fieldsets — all 16 fields

| Group ID / exact control or fields | Source / prototype behavior | Owner / permission boundary | Missing production/English/design/provider behavior | Evidence / retest; I/L/C/entry |
| --- | --- | --- | --- | --- |
| MODAL-D10-01 — technician / إضافة فني جديد: الاسم الكامل input محمد أحمد; رقم الهاتف input +966...; منطقة العمل select شمال الرياض/شرق الرياض (3) | A:153; page trigger A:104 + CREATE-D10-01 | C Workforce/E Identity/A Geo; E05 does not invite/activate | Exact field layout registered; full application/invitation/region/duplicate/correction/eligibility states absent (AG-04) | P V; C/E/A/D; E candidate; **NI/S/U/B — NO_GO** |
| MODAL-D10-02 — promotion / إنشاء عرض جديد: كود العرض input WASH20; نوع الخصم select نسبة مئوية/قيمة ثابتة; القيمة input 20 (3) | A:153; page trigger A:116 + CREATE-D10-02 | B Pricing; no promotion-admin grant | Exact field layout registered; distinct percent/Money/rules/dates/limits/audience/activation/conflicts absent (AG-10) | P V F; B/D; E candidate; **NI/S/U/B — NO_GO** |
| MODAL-D10-03 — notification / إرسال إشعار: الجمهور select جميع الزبائن/الفنيون; العنوان input; الرسالة textarea rows=4 (3) | A:153; page trigger A:126 + CREATE-D10-03 | D Communications/A consent/C participants/E identity; no send grant | Exact fields registered; current purpose/template/channel/bounded audience/preview/consent/send/recovery absent (AG-15) | P V N; D/A/C/E; E candidate; **NI/S/U/B — NO_GO** |
| MODAL-D10-04 — booking / إنشاء حجز يدوي: الزبون input; السيارة input; الباقة select غسيل خارجي/غسيل كامل/Premium; الموعد datetime-local input (4) | A:153; page trigger A:100 | C Booking/A beneficiary+address/B quote+money/C capacity; no manual-create grant | Exact fields registered; no address/payment/ownership/quote/capacity/complete confirmation/unknown states (AG-02) | P V F; A/B/C/D/E; E candidate; **NI/S/U/B — NO_GO** |
| MODAL-D10-05 — service / إضافة باقة: اسم الباقة input; السعر input; المدة بالدقائق input (3) | A:153; page trigger A:106 | B Catalog definition/duration and Pricing Money separately; no authoring grant | Exact fields registered; currency/compatibility/version/effective publish/partial compensation states absent (AG-05) | P V F; B/D; E candidate; **NI/S/U/B — NO_GO** |

## Invalidation, ownership and no-go disposition

Current source has no network/storage/download/real mutation in A; generated
fixtures (A:144–146), health labels, dollar/SAR examples, Riyadh maps, static
custody totals and local saved toasts are reference copy, not persisted or
reconciled operation. Preserve exact copy until decisions approve visible changes.
No actual current release-candidate metric, position, customer CSV/PDF, save,
received funds, delivery or team contact is invented.

Latest B boundary is retained: Billing owns verification/collection/allocation/
immutable journal/refund/company treasury settlement; Wallet owns approved
posting-backed holder partitions/holds/movements and independent physical custody/
handover. Compare their actual receipts; one company receipt does not settle a
holder or become a second revenue posting. Unknown claims remain unavailable
until accepted definite noncommit with late-execution fencing or linked confirmed
effect. C Workforce owns fleet service resources, A Vehicle customer cars; C
Workforce work grant, Identity account role and Media processed private bytes are
independent. Work-execution/attempt and task-location binding still needs explicit
E/C acceptance. Support requests a Billing remedy, never mutates money; Reports
are derived; Reviews moderation never repurposes verification.review.

Required decisions remain design/state/English, finance/retention/consent/grants/
MFA/separation, markets/Money/time, actual providers including unresolved Paymera,
source metrics/freshness/location and numerical recovery/performance limits.
Cash/ShamCash/Syriatel Cash are approved UI methods; Wallet internal and Card
fixture do not add a fourth method. Preserve seven customer steps vehicle/care/
place/time/contact/payment/review, guest booking/optional plate, Arabic/RTL SVG/
focus/motion; operator remains apps/operator-web. Late money cannot revive expired
capacity; rebooking revalidates current catalogue/price/availability with immutable
historical snapshots. W06 financial privacy fulfillment stays required; W07
compatibility does not defer it.

D owns app and D provider/source fixes/retests; A/B/C own their authoritative
providers/data/private bytes; E owns current trust/transport/published packages
and serialized candidate/mandatory gates. Provider-first accepted children precede
consumers. Required owners fix each failure, then D reruns actual affected admin/
three-app cases and E reruns candidate/resulting-target gates. Proposed owner
labels are not independent review, contacts or operational readiness.

A later source, dependency/contract/client, schema/migration, worker/image,
configuration/key-policy, permission/retention, design/profile or environment
change invalidates affected evidence. Case references and artifacts must bind
actual accepted base, latest target, head, candidate/tree, digests, versions,
migration/prior dataset, run/attempt/account scope, command/output/result and
approved profile. E recomputes latest-target+head, preserves every mandatory gate,
obtains eligible independent review, verifies unchanged refs and verifies actual
resulting target after any authorized merge. Even with unchanged product code,
old green results do not certify this new head or an absent deployed candidate.

Available source commands include admin build/typecheck/test:runtime in
apps/admin-web/package.json:7–13; root verify:release remains a **foundation**
alias, and scripts/acceptance.mjs:437–448 excludes browser/payment/production
readiness. Command presence is S, not execution. E must publish actual candidate
gate commands/resources; no build/local/product/candidate PASS is claimed here.
Root retains any actual local diagnostic outputs separately.

Crosslinks: [W10 acceptance specification](../../../../tests/parallel/D/W10/ACCEPTANCE_SPEC.md),
[W09 role procedures](../W09/ROLE_OPERATIONS_RUNBOOKS.md),
[W09 service recovery](../W09/SUPPORTING_SERVICES_RECOVERY_RUNBOOK.md),
[W09 unresolved entry](../W09/STAGING_ENTRY_AND_W10_PACKET.md),
[B recovery/custody boundary](../../B/W08/RECOVERY_AND_OPERATIONS.md) and
[E W10 candidate requests](../../E/W09/RC_AND_W10_REQUESTS.md).
W09 merged proposals/specifications delivered no real rehearsal result or new
runtime. Current restore/candidate/provider/delivery limits and contacts remain
unavailable; written procedures cannot close them.

**Coverage: 66 action groups across all 17 screens + 21 control groups
(8 shared, 5 jumps, 3 shortcuts, 5 modal types) = 87 product groups, with four
separate foundation rows. All are NO_GO for full launch.** No source/private DTO/
DB/migration/shared contract edit, product runtime/test/provider/GitHub operation or
acceptance approval was performed by this delegated work. This artifact is
reviewable carry-forward, not completed W10 parent certification. Every missing
required row, state/copy approval, real provider, security/recovery or mandatory
candidate gate blocks full-scope acceptance.
