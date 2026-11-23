# W06 producer sequence and W07 contract requests

**REQUESTED / NOT_ACCEPTED / NOT_IMPLEMENTED.** Exact next package versions,
wire names and BASE_W06/BASE_W07 are unpublished. Names below label semantic
families, not exported endpoints or accepted event versions.

## Proposed children and dependency barriers

| Proposed child                               | Accountable writer                 | Required accepted predecessor                                                                       | Acceptance boundary                                                                                                                                 |
| -------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| W06-E-ENTRY-RECONCILIATION                   | E with A–D and Product             | Real predecessor business/provider evidence, owner decisions and independently reviewed release     | Publish the actual W06 source and contracts only after predecessor/candidate/result-target gates.                                                   |
| W06-B-BILLING-LINKAGE                        | B                                  | Current Identity/grants and real verified Billing obligations/credits/refunds                       | Owned DB, postings, immutable allocation/operation status, authorization and constraints; no Wallet shadow ledger.                                  |
| W06-B-WALLET-PROVIDER                        | B                                  | Accepted Billing linkage and approved holders/purposes                                              | Own balance/hold partitions, capture/release/reconciliation, race constraints, migration/HTTP/contracts; no automatic customer funding or payroll.  |
| W06-B-SUBSCRIPTION-PROVIDER                  | B                                  | Accepted plan/beneficiary/policy and Billing linkage                                                | Own activation/entitlement reserve/consume/release/correction with real DB races and owner audit.                                                   |
| W06-C-FLEET-PROVIDER                         | C                                  | Approved fleet/team/van/equipment/employment scope and current grants                               | Workforce eligibility independent of capacity and assignment; real ownership/current eligibility/constraint tests.                                  |
| W06-D-SUPPORT-REVIEW-COMMUNICATION-PROVIDERS | D, split by domain                 | Accepted Booking/work/current audience/consent and C Media purpose authority                        | Narrow owner provider children with actual DB/HTTP/Identity/Media tests; no consumer cycle or fixture acceptance.                                   |
| W06-E-PRIVACY-AUTHORITY                      | E with approved coordinator        | Product-approved workflow, subject/request/task linkage, guest/delegation and retention obligations | Identity current authority/revocation and secure export linkage; approval determines intake-only versus owner fulfillment.                          |
| W06-OWNER-PRIVACY-EXECUTORS                  | Each owner, separate children      | Accepted authority/task/status/result/retention/export contracts                                    | Each real owner executes its own authorized work; no cross-database deletion. Resolve B's W07 reservation against A's W06 request before execution. |
| W06-C-BOOKING-BENEFIT-COORDINATOR            | C                                  | Accepted real Billing, Wallet, Subscription, Scheduling and Dispatch providers                      | Durable original child identities, UNKNOWN reconciliation and policy compensation; full integrated acquisition/cancel/refund journey.               |
| W06-E-TECHNICAL-RECOVERY                     | E shared layer; B/D owner adapters | Accepted event/receipt/revision/replay topology and owner defect closures                           | Isolated real crash/broker/DB tests; recovery identity/audit/bounds, owner-local storage and current grants.                                        |
| W06-A-C-D-APP-CONSUMERS                      | A customer, C operator, D admin    | Merged real owners, coordinator and approved production screen states                               | Full affected journeys before consumer acceptance; static prototype controls cannot substitute.                                                     |
| W06-E-COMBINED-ACCEPTANCE                    | E                                  | All applicable children plus retained W05 acceptance                                                | Latest-target candidate, mandatory CI, real W06 cases and independent review; resulting target checked before BASE_W07.                             |

These are dependency proposals, not already opened child PRs or scheduled work.
Each implementation branch starts from its accepted common source, never an
unmerged peer branch. A provider proves its narrow real capability first;
consumer/full-flow acceptance then uses that merged provider. Parent state stays
INTEGRATION_PENDING until combined required effects and journeys pass.

Before benefit/capture consumers, accept a narrow C-owned Booking/work intent,
binding and current capture/eligibility authority provider where required by the
B schemas. That producer must not depend on the full benefit saga it enables.
Likewise split D case/message/review binding from private Media/financial effect
consumers. E and owners must explicitly sequence these producer slices to break
cycles; a local intent/grant fixture cannot close the dependency.

## Exact C peer intake

Draft PR66 at `5f5d1064e237e17f26f85d1200c12770d7b93264` proposes C.1 Booking
benefit/hold coordination then C.2 Workforce fleet/readiness. Its three C
documents and 24 declarative families are BLOCKED_NOT_RUN. This intake is not an
accepted base, contract or source implementation. Review child producer bindings
with C before opening implementation children; do not silently reorder C's work.

C reserves D's full fleet browser flow for W07, but W06 still requires real
scoped admin HTTP → Scheduling → Dispatch → independent operator execution.
Future browser work cannot waive those W06 cases or the task's other required
support/review/privacy/communication journeys. Resolve execution-wave overlaps
before acceptance. Fleet contracts also need explicit team/member/van/equipment
interval authority, interval/timezone/local-day rules, setup/travel buffers,
multi-resource locking, leave/maintenance precedence and current assign/accept/
start fences. Half-open intervals are C's proposal, not an accepted E default;
active-work suspension/maintenance behavior needs Product/C approval.

## Contract release profile required for every family

Freeze authoritative owner and consumers; contract ID/version and strict parser;
required/nullable/unknown fields; authenticated actor and subject/object/purpose
binding; owner IDs and revisions; exact amount/currency/unit/rounding and server
time/expiry/policy semantics where relevant. Money and revision profiles currently
conflict across proposals; no representation or policy default is accepted here.

Freeze actor/service/operation-scoped idempotency, canonical fingerprint,
cross-key business uniqueness, replayable durable result, retention and status
lookup. A repeated key with different data conflicts; a transport timeout leaves
the original operation UNKNOWN until authoritative reconciliation. Publish typed
errors, deadlines, retry classification, local audit/outbox boundaries, semantic
compensation, compatibility/rollout and producer/consumer conformance tests.

| Requested family                              | Authority and consumers                                                            | Required request/result semantics                                                                                                                                                                                                                                     |
| --------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Billing linkage/status                        | B Billing → Wallet, Subscription, Booking, Support, Reporting                      | Obligation/allocation/posting/operation IDs, immutable amount/policy/revision, independently verified result, UNKNOWN status and correction links. Received money, allocation, settlement and refund remain distinct.                                                 |
| Wallet holder/balance/hold/capture/release    | B Wallet → C Booking and permitted A/C/D consumers                                 | Approved holder/purpose, original operation/hold and balance revision, available/held/capture-claimed partitions, authoritative Billing link and terminal/reconciling result. Custody handover is not customer spend.                                                 |
| Subscription lifecycle/benefit                | B Subscription → C Booking and permitted A/C/D consumers                           | Approved plan/beneficiary/unit/expiry, original reserve/consume identity, eligibility/revision/policy, terminal correction and auditable restoration linkage. Subscription alone owns entitlement counters.                                                           |
| Booking benefit compensation                  | C Booking → Billing/Wallet/Subscription/Scheduling/Dispatch                        | Persistent saga/child IDs, original snapshot, current resource facts, timeout/UNKNOWN/resume and separate compensation receipts. A refund does not imply benefit restoration or capacity renewal.                                                                     |
| Workforce fleet/current grants                | C Workforce → Scheduling, Dispatch, operator, permitted admin/reporting            | Team/van/equipment/shift identity/revision, grant purpose/effective interval, eligibility reason and current revocation. Customer Vehicle and Geo do not own operating fleet.                                                                                         |
| Support binding/evidence/remedy               | D Support with C Media/B Billing → A/D consumers                                   | Case/subject/work binding, purpose-specific evidence/current grant, case revision/decision identity, authorized owner remedy request/status. Support cannot declare refunded from its own state.                                                                      |
| Review eligibility/moderation/publication     | D Reviews with C completed-work/A subject/C Media → A/D consumers                  | Actual completion/beneficiary/window/rule, review business uniqueness and revision, author/moderator authority, visibility/redaction and correction contribution. Workforce verification reviews remain a distinct route/domain.                                      |
| Communications membership/intent/delivery     | D with A consent/C assignment/E Identity/C Media → A/C/D                           | Current recipient/purpose/membership, immutable logical intent/attempt/provider identity, sequence/read revision, accepted/delivered/read/UNKNOWN distinctions, consent/reassignment revocation and no resend on historical replay.                                   |
| Privacy authority/request/owner result/export | E Identity + approved coordinator + every owner + C Media → A/D                    | Request/subject/object/purpose/task IDs, authenticated linkage/current auth revision, approved operation/obligation version, owner result/retained reason/copy scope, private export manifest/finalization/grant and completion aggregation. Receipt is not deletion. |
| Reporting history/rebuild/export              | D Reporting with all real owner providers/C Media/E Identity → permitted consumers | Owner-complete history/snapshot cursor and revisions, projection application/generation, correction/redaction, stable source high-water, bounded rebuild/status and pinned private export. Projections confer no source mutation authority.                           |
| Customer/Vehicle/Geo admin/current reads      | A → D admin/C Booking/E routing                                                    | Subject/object ownership and revisions, current contact/consent, optional plate and approved removal, versioned actual service geography and recovery/status. Preserve historical Booking snapshots.                                                                  |
| Catalog/Pricing/promotion/rebooking           | B with D approved policy/C Booking/A current subject/vehicle/geo → A/D             | Versioned exact quote/eligibility/redemption/remaining uses/policy/expiry, atomic last-use constraint and correction. Rebooking obtains a new quote and resources; historical prices remain historical.                                                               |
| Task-location authority/current read          | E+C resolve, proposed C Booking Work → A/C/D/Reporting                             | Decide Booking-versus-Workforce authority first; work/actor binding, independent location revision, approved phase/consent/precision/freshness/retention. Geo remains advisory.                                                                                       |

## Compatibility conflicts requiring explicit decisions

- B's closed Wallet resolve draft requires nonempty posting IDs for RELEASE as
  well as CONSUME. C proposes optional Billing outcome refs. Accept an
  action-specific replacement or separate no-posting release contract with
  dual-reader/version tests. Do not fabricate postings or relax old V1 silently.
- Strict booking.confirmed.v1 remains `{bookingId,customerId}`. It lacks the
  benefit/work/policy revisions requested here; accept a separate compatible
  family rather than add fields to the existing strict reader.
- Existing `/admin/reviews/:id` is Workforce verification, not Reviews moderation.
  E publishes a reviewed owner/permission/route map after real provider acceptance.
- B reserves finance privacy execution for W07 while A asks for W06 fulfillment.
  Product/A/B/D/E must freeze execution wave and obligations; intake cannot
  silently stand in for required completed fulfillment.
- Current Identity authVersion/session checks are reusable foundation authority;
  generic administrative permission is not a resource/purpose grant or automatic
  guest subject linkage. Guest/delegated recovery must be explicitly accepted.

## Privacy barrier

Accept coordinator identity and exact workflow first. For intake-only approval,
prove receipt/status authorization and deny a completed-deletion claim. For
automated fulfillment approval, accept each owner executor and copies/holds/
retention/result contract, then execute and aggregate every required result.
Export READY requires an approved complete/partial manifest and secure finalized
object, not merely a queued job. Recheck current authority at worker start,
publication and download; session revocation does not itself erase owner data.
Required retained financial history stays under Billing/owner policy; no invented
retention period or legal interpretation is published.
