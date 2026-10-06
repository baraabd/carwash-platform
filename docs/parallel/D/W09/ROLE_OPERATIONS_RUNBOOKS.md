# W09-D — Proposed role operations runbooks

**PROPOSED / NOT_ACCEPTED / REHEARSAL_BLOCKED / NOT_RUN.** Observation: main
`b47390c8ce04b2674e9222918bcd4e03fa5aed24`, tree
`c8a1f2f9e84f6298f1b044a8e8cec2549f33c15f`, branch
`proposal/w09-D-staging-operations-entry`, inspected 2026-10-06. This is a
conditional procedure for review, not a deployable operations interface or
evidence that a team is trained or ready. This delegated work performed no
product/staging journey, restore, rollback, provider/money/message action,
product runtime or acceptance test. Root's separate local source, foundation,
guard and scanner diagnostics belong in [HANDOFF](HANDOFF.md); they establish
no product/staging acceptance.

`architecture/parallel-contract-release.json:20–27,87–93,494–502` has BASE_W02=null,
no BASE_W09, no accepted next-wave contracts and no business/staging acceptance.
The W01 bootstrap lease is expired per the W09 task. Missing accepted W09 base
and owner contracts independently block dependent app/service source writes.
Required authority/design documents, references and relevant product source are
unchanged from inspected W08 `f0b76221c1a1991ba78327c019f0b4a0a7c53dff` by scoped
read-only Git comparison. Dependent product writes remain unauthorized.

## Source and entry boundary

Use the complete [W07 action inventory](../W07/ADMIN_ACTION_MATRIX.md),
[W01 source/state inventory](../W01/ADMIN_SURFACE_MATRIX.md) and
[W08 security/accessibility matrix](../W08/ADMIN_SECURITY_ACCESSIBILITY_MATRIX.md)
for all actions, five modals and 17 permission families; no approval is added.
`A:n` below denotes line n of
`design/reference/approved/washgo-admin-prototype.html`; its blob remains
`301e247267b8d68d11d084ce8cc458b59f7d5e2e`, SHA-256
`b13353195e914a7572ad033040d2a5112973e3eeabf2a584aa23282cd1ca8273`.
F010 freezes prototype bytes; full production/English states remain pending
under DEC-D-18 in the [decision register](../W01/DECISIONS.md). Missing detail,
decision/private-viewer/recovery/moderation states require approval. Prototype
save/search toasts never prove a write.

Before enabling a step, E must supply accepted base/contracts; retained deployed
source/tree/images/configuration and migration state; populated prior dataset;
approved existing staging namespace/accounts/resources/slot; journey/fault scope,
abort points, tested restore/rollback commands and approved recovery limits.
E/project operations must provide real on-call contacts, acknowledgement path and
decision authority. These inputs are **unavailable**; no contacts/SLA are invented.

`apps/admin-web/src/index.ts:1–12` and `index.html:10–14` are technical boot only,
businessReady=false. Support/Reviews/Configuration have empty domain skeletons
and ServiceMarker data; Communications/Reporting apply FoundationProbeCreatedV1
probe effects (`services/{communications,reporting}/src/inbox/consumer.runner.ts:107–135`).
`packages/api-clients/src/index.ts` exports no client. Health is not business recovery.

## Existing grants and screen routing

`packages/contracts/src/identity.ts:3–39` exports seven roles and fourteen
permissions; `services/identity/src/domain/auth-policy.ts:21–48` unions explicit
role grants. Operations has **operations.dispatch**; Finance has **billing.read,
billing.refund**; Support has **support.cases.read, support.cases.write**;
reviewer has **verification.review**. A role label in Settings is not authority.
A multi-role account needs its actual current grants. Super-admin has only the
exported vocabulary, not unpublished domain actions. Operations or Support alone
cannot confirm/settle/refund money or moderate customer reviews.

These `/api/v1` Gateway descriptors do not prove upstream product implementation:
`packages/contracts/src/gateway.ts:133–206`.

| Existing route | Existing permission and actual boundary |
| --- | --- |
| POST /admin/dispatch/:id | operations.dispatch, required key; Booking upstream /internal/v1/booking/:id/dispatch. E/C must reconcile Dispatch ownership. |
| GET /admin/billing | billing.read; Billing summary descriptor only. |
| POST /admin/billing/:id/refund | billing.refund, required key; refund/status/provider schemas absent. |
| GET /admin/support | support.cases.read; no case provider or support.cases.write route. |
| POST /admin/reviews/:id | verification.review; required key; Workforce verification review, **not D Reviews moderation**. |
| POST /admin/accounts/:id/status; POST /admin/accounts/:id/roles | identity.accounts.suspend; identity.roles.assign; strict {status} ACTIVE/SUSPENDED or {roles}, independent of work eligibility/configuration. |
| GET /admin/overview | Both billing.read and support.cases.read; Billing+Support composition only, not the all-domain Dashboard. |

All **17** registered screens remain carried forward and **BLOCKED / NOT_RUN**
for real operational use. Names are the exact A:141–142 dictionary; initial
Disputes heading is `مركز النزاعات` at A:124 before dictionary translation.
“None” means no accepted admin route/grant/provider for the stated product
family; it does not request a new permission spelling.

| Screen ID — exact Arabic / English name | Operational owner / current access limit |
| --- | --- |
| dashboard — لوحة التحكم / Dashboard | D Reporting, owner source facts and E technical health; overview requires both grants above and supplies no dashboard authority. |
| bookings — الحجوزات / Bookings | C Booking/Scheduling/Dispatch/Workforce; operations.dispatch descriptor only. Manual booking, search/detail, reassignment, cancellation/rescheduling providers/states absent. |
| customers — الزبائن / Customers | A Customer/Vehicle/Geo, linked C/B history; none. CSV control is inert; customer self-grants do not grant access to another customer. |
| technicians — الفنيون / Technicians | C Workforce eligibility/verification and Media; reviewer verification.review descriptor only; Identity account access is separate. |
| services — الخدمات والباقات / Services & Packages | B Catalog definitions and Pricing money/versioned quotes; none for admin creation/edit/publication. |
| fleet — الأسطول والمركبات / Fleet & Vehicles | C Workforce service vans/teams/equipment; C Scheduling/Dispatch consume current restrictions; none. A Vehicle owns customer cars; no new Fleet service. |
| payments — المدفوعات / Payments | B Billing, C Media private proof; billing.read/refund descriptors only; verification, collection/settlement and search/detail families absent. |
| wallets — المحافظ / Wallets | B Wallet internal holders/holds/movements/custody; linked B Billing financial facts; none. |
| subscriptions — الاشتراكات / Subscriptions | B Subscription benefits, Billing purchase/allocation, C Booking consumption; none. |
| promotions — العروض والكوبونات / Promotions | B Pricing rules/quotes/usage, Catalog product inputs; none. |
| coverage — المناطق والتغطية / Areas & Coverage | A Geo geography, C Scheduling capacity/Workforce resources; none. |
| live — الخريطة الحية / Live Map | C Workforce current permitted location with E/C accepted binding; D display only; none. Static markers are not live telemetry. |
| reviews — التقييمات / Reviews & Ratings | D Reviews eligible-service moderation; none. verification.review belongs to Workforce. |
| disputes — النزاعات / Disputes | D Support cases/remedy requests; support.cases.read descriptor and unconnected write vocabulary only; no financial authority. |
| notifications — الإشعارات / Notifications | D Communications intents/attempts/conversations, A consent and owner membership; none. Prototype Sent/Scheduled copy is static. |
| reports — التقارير والتحليلات / Reports & Analytics | D Reporting projections/checkpoints/export, every source owner and C private bytes; none. PDF control is inert. |
| settings — الإعدادات / Settings | D Configuration effective versions; E Identity grants/account state separately; Identity status/roles routes do not publish policy. No Configuration grant/provider. |

## Operations — conditional procedures

Case labels below are proposed documentation, not APIs or passed cases. Use only
accepted real owner clients/states; absent providers keep the procedure BLOCKED.

| Case / screen / required authority | Ordered triage, safe action and owner escalation | Evidence required for closure |
| --- | --- | --- |
| OP-D09-01 Onboarding/corrections → eligibility — Technicians, Fleet & Vehicles, Areas & Coverage | 1. Refresh Workforce application/review/resource revision, separate Identity access and current Media processing/object-purpose authority. 2. Through an accepted correction flow, preserve history and request the missing document; never bypass quarantine. reviewer verification.review is not an Operations grant or activation contract. 3. C Workforce decides eligibility/work grant and shift/resource restrictions; C Scheduling/Dispatch/operator must consume the result. Escalate review/grant to C Workforce, documents to C Media, account denial to E. | Review/correction/grant receipts and revisions; protected object/version/disposition reference; denied/revoked reviewer checks and actual operator eligibility. Completed steps or ACTIVE account is insufficient. Missing states: A:104 / W07 AG-04/06. |
| OP-D09-02 Dispatch exception — Bookings, Fleet & Vehicles, Live Map, Areas & Coverage | 1. Read current Booking attempt/fence, Scheduling capacity/expiry and Workforce eligibility/resource restrictions. 2. Once accepted, use expected revisions and the original operation; resolve unknown outcome before reassigning. Never act from stale Reports/markers or revive expired capacity/old assignments. 3. Escalate lifecycle to C Booking, assignment to C Dispatch, capacity to C Scheduling, late money to Finance. operations.dispatch alone supplies no reassign/status contract; Work execution binding needs E/C acceptance. | Original operation/current owner receipts, conflict/unknown/compensation and real admin→operator→customer restriction checks. Manual/cancel/reschedule remedies retain current quote/capacity, approved reason and immutable history requirements. |

## Finance — conditional procedures

Latest B [recovery procedures](../../B/W08/RECOVERY_AND_OPERATIONS.md)
(13–19,60–67) and [W09 restore handoff](../../B/W08/W09_RESTORE_HANDOFF.md)
(133–143) keep
**Billing collection/allocation/refund/company settlement** independent from
**Wallet holder movements/physical custody/handover**. Wallet is neither a
second ledger nor a fourth checkout method. These owner packets remain proposals;
no wire states or finance permissions are inferred.

| Case / screen / required authority | Ordered triage, safe action and owner escalation | Evidence required for closure |
| --- | --- | --- |
| FIN-D09-01 Failed electronic verification — Payments, Bookings | 1. Obtain accepted B/E detail/review authority and current C Media proof access; billing.read supplies only a coarse summary descriptor. 2. Compare obligation, exact Money/currency, merchant/environment and original operation with Billing's authenticated decision. Proof, navigation, HTTP success or provider ACK is not credit. Preserve rejected/pending/unknown observations; requery the original operation under the accepted protocol. 3. Escalate provider/finality to B and authorized provider account owner, processing to C Media, late capacity to C. | Verification/capture/allocation receipts, independent money/outcome, private-read audit and discrepancy. Operational words are not new wire enums. ShamCash/Syriatel capabilities are unaccepted; Paymera needs owner decision, and Card fixture approves nothing. |
| FIN-D09-02 Unsettled cash — Payments, Wallets, Technicians | 1. Compare independent Billing collection/allocation/company settlement against Wallet holder/purpose movements, physical declaration and accepted handover. Work completion, collection, custody and company receipt differ. 2. Preserve unexplained/unknown differences per currency; an eventual correction needs current authority, original references, revision, audit and one effect. Collect/custody/settle grant/provider is absent. 3. Escalate money to B Billing, custody to B Wallet, collector/task to C Workforce/work owner, classification to accounting authority. | Independent receipts/custody lineage, protected physical references, difference/disposition and holder authority. Available/held/claimed, custody and settled partitions stay separate; no manual balance/ledger edit, fabricated credit or double revenue. |
| FIN-D09-03 Refund escalation — Payments, Disputes, Subscriptions, Promotions | 1. B checks eligible original capture, exact route/currency and cumulative confirmed plus unresolved reserved refund exposure. billing.refund exists; approval/execute separation and provider/status schema are unaccepted. 2. Use one authorized original operation; preserve unknown allowance through expiry/revocation until definitive fenced noncommit or confirmed return. 3. Escalate refund/provider to B Billing, holds/custody to B Wallet, units to Subscription, allowance to Pricing and remedy history to D Support. Case closure does not refund; benefits/promotion restoration is independent. | Current grant, source/revision/original fingerprint, approval/execution audit, provider provenance, capped concurrent-refund and customer/admin result. Pending submission is not confirmed return or settlement. |

## Support — conditional procedures

| Case / screen / required authority | Ordered triage, safe action and owner escalation | Evidence required for closure |
| --- | --- | --- |
| SUP-D09-01 Customer dispute — Disputes, Customers, Bookings, Payments | 1. Verify current case/customer/guest relationship and purpose; support.cases.read/write vocabulary lacks a working case provider/write route. 2. Record minimal complaint/history and independent Booking/work/Billing facts using accepted clients; private evidence requires C Media current authority. Request owner remedies; close a case separately from pending remedy, without changing money, eligibility or Booking history. 3. Escalate profile/consent to A, service/evidence to C, money/benefits to B, access to E and case history to D Support. | Case revision, guest/task binding, protected evidence refs and durable case/decision/remedy receipts. Missing owner outcomes remain partial/unknown; no contact/plate/location dump. |
| SUP-D09-02 Review moderation — Reviews & Ratings, Disputes, Reports & Analytics | 1. Verify C eligible completion, current author/moderator object scope, revision and accepted policy. 2. D Reviews preserves history and owns the decision; Reporting reflects it once under retention rules. verification.review and /admin/reviews/:id are Workforce only; Support moderation grant/provider is absent. 3. Escalate moderation/policy to D Reviews/product authority, completion to C and access to E; do not change work/payment or conceal unresolved evidence. | Eligibility, current authority, reason/revision/audit, independent customer/admin visibility and duplicate/reordered/restored corrections. Missing queue/detail/decision/English states: A:122 / W07 AG-13. |
| SUP-D09-03 Notification failure — Notifications, Settings, Reports & Analytics | 1. Read actual intent/template/purpose, attempts/original provider operation, current consent and membership. Static Sent/Scheduled and OTP do not prove delivery; submitted, delivered, read and unknown differ. 2. Recheck scope/consent before owner-permitted original-intent retry; report/replay must not resend. Stop unsupported provider/channel, without alternate customer contact. 3. Escalate attempts to D Communications, consent to A, relationship to C, routing to E/channel account owner, effective policy to D Configuration. | Intent/attempt/consent/template revisions, permitted aggregate, authenticated provider outcome and one external effect. No raw payload/endpoint. Missing composer/failure/history/grants/provider: A:126 / W07 AG-15. |

## Shared failure and recovery rules

Source abbreviations here: Identity service =
`services/identity/src/application/identity-auth.service.ts`; Gateway service,
policy and HTTP client = `apps/api-gateway/src/application/gateway.service.ts`,
`src/domain/policy.ts` and `src/infrastructure/http-client.ts` respectively.

1. **Revoked/unavailable access:** Identity rechecks current session/account/
   authVersion (:380–400); role/status changes recheck the actor and revoke target
   sessions (:437–475). Gateway checks current grants (:45–51). Owners must also
   authorize object/purpose/revision on commit, status/replay, reconnect and
   export/private download. Stop privileged work; hide private data, fence late
   responses across tabs/principals and clear sensitive drafts/cache/object URLs/
   subscriptions through the accepted client. Reauthentication never auto-replays
   a write. Consumed refresh-token replay revokes its session (:339–378); tab
   coordination is unpublished, so blind refresh retry is unsafe.
2. **Unknown original operation:** Gateway only validates/forwards keys (policy
   :55–58; service :70–72), and HTTP client makes one attempt (:5–72). Preserve
   original identity/fingerprint; obtain accepted owner status under current
   authorization. Retry only the owner-permitted same intent/key/revision within
   its accepted lifetime; changed meaning conflicts. Business status/replay/
   repair clients are absent. Escalate unknown, without a new effect/key.
3. **Private document denied/unavailable:** C Media must verify current object/
   version/purpose, processing/quarantine, expiry/revocation and retention/legal
   hold. Escalate protected references, never bytes/signed URLs/public screenshots.
   Financial privacy remains required W06 scope; W07 carries compatibility.
4. **Stale Dashboard/Reports:** inspect generation/asOf, contiguous frontiers,
   source coverage/gaps and accepted currency/time definitions. Show partial/
   unavailable, not zero or money confirmation. Owner APIs decide outcomes.
   D rebuild requires bounded history, current privacy masks, fresh fence/
   generation, catch-up/reconciliation and atomic activation; it cannot resend
   messages or rerun Booking/refunds.
5. **Blocked provider:** retain dependency/error/original operation; E recovers
   infrastructure, owner reconciles business facts. Health/ACK/probe is insufficient.
   D Inbox broadly maps P2002/23505 to DUPLICATE
   (`services/{communications,reporting}/src/inbox/prisma-inbox.store.ts:44–58`);
   this is a static finding, not a reproduced failure or safe redrive. No peer DB
   queries, manual ledger edits, queue/receipt deletion, shared reset or invented CLI.

## Evidence, escalation and recovery closure

Capture protected incident evidence through the eventual accepted mechanism:
case/run label, exact source/tree/images/configuration/contracts/migrations,
namespace/account class, UTC bounds, current authorization, owner revision/
original-operation/fingerprint reference, observed outcome/error/asOf/coverage,
expected invariant/deviation, redacted artifact/audit hashes, owner/disposition
and acknowledgement. Exclude secrets, raw private evidence/messages/signed URLs
and unnecessary contact/location fields. Contacts, approvals and measurements
remain **NOT_AVAILABLE**.

E orchestrates later interruption/duplicate/outage/restore/rollback. D must prove
preserved case/review history, Communications intents/attempts/effect identities,
Configuration versions/adoption, Inbox receipts and Reporting generations/
checkpoints. Reapply current authority/consent/deletion/legal holds before serving
restored data; fence surviving old workers with an accepted fresh incarnation.
Reconcile independent per-currency Billing, Wallet custody, C lifecycle/capacity
and A data via owner APIs/events. Measure elapsed recovery/loss against accepted
RPO/RTO; none is measured. Process restart/checklist cannot prove history,
deduplication, revisions or private-access safety.

Escalation maps responsibilities; real contacts/abort authority/tested commands
must be published before rehearsal. Prerequisites remain the
[D W09 contract requests](../W08/W09_OPERATIONS_CONTRACT_REQUESTS.md),
[A staging/support request](../../A/W08/W09_STAGING_HANDOFF.md),
[B populated restore/reconciliation request](../../B/W08/W09_RESTORE_HANDOFF.md),
[C operational probes](../../C/W08/W09_OPERATIONAL_HANDOFF.md), and
[E deployment/recovery entry](../../E/W08/W09_REHEARSAL_AND_CONTRACT_REQUESTS.md).
All are proposals, not accepted operational access or commands.

Preserve the customer seven steps vehicle/care/place/time/contact/payment/review,
guest booking, optional plate, original Arabic/RTL visuals and approved motion;
required English/LTR and missing states need their decision/evidence. Cash,
ShamCash and Syriatel Cash remain the approved UI methods; real financial truth
is server-owned. Late payment cannot revive expired capacity; new booking
revalidates current catalogue/price/availability and keeps historical snapshots.
Subscription/promotion and fleet-restriction real three-app journeys remain
required even when these triage procedures focus on exceptions.

**Completion boundary:** this proposal is the only file written by this delegated task.
Eight role cases, shared failures and real journeys/recovery are BLOCKED / NOT_RUN;
no source fix, migration, product/staging acceptance test, rehearsal, measured
recovery or team readiness is claimed, and runtime handles are none for this
delegated work. Separate local diagnostics remain in HANDOFF. E must accept
entry/contracts/procedures
and serialize real provider→consumer staging evidence before parent acceptance
or accepted BASE_W10 handoff.
