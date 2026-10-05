# W04-C — Real cash-cycle provider and integration proposal

Status **PROPOSED / NOT ACCEPTED**; no BASE_W04 or product implementation. [Checkpoint](CHECKPOINT.md) records immutable source and actual limits. Reuse the approved [W01 inventory](../W01/TECHNICIAN_INVENTORY.md), [operations blueprint](../W01/OPERATIONS_BLUEPRINT.md) and [W03 W04 request](../W03/W04_CONTRACT_REQUESTS.md) as proposals, not live contracts. This packet closes new W04 sequencing/authority questions without repeating those schemas.

## Eight local stages, six presentation phases, distinct facts

| Approved presentation / local stage | Authoritative production fact and sensitive recheck |
| --- | --- |
| المهمة / assigned, accepted | Dispatch offer/current assignment/acceptance, independently confirmed Booking/reservation and current Workforce eligibility; acceptance creates no payment fact |
| الطريق / route | Booking Work travel command under current assignment fence; contact/Geo route requires object scope. Arrival is operator assertion unless genuine accepted verification exists |
| قبل الغسيل / before | Work arrived plus current assigned operator and approved photo consent; clean finalized Media-before refs/policy, never local demo illustration |
| العناية / wash | Work start/checklist snapshot and expected Work revision; current eligibility/reserved resources/assignment and accepted execution/payment prerequisites |
| بعد الغسيل / after | Required checklist complete and clean finalized Media-after refs; finish transaction records execution/audit/outbox only |
| التسليم / handoff, closed | Work delivered or separately deferred/released attempt; Billing collection/due and Wallet custody states remain independent. Normal completion is not a deferred unwashed task |

Retain all six labels and approved views/sheets/artwork; do not derive a server enum from the local stage. Optional plate stays optional. A delivery can coexist with unpaid/uncollected financial facts under the accepted policy, and recorded cash is not company custody settlement. The reference's pending electronic-payment start/close conflict still needs B/product policy; this cash task cannot silently resolve electronic execution policy.

## Dispatch/Work/Media boundary and race closure

Dispatch owns persisted offers/attempts/assignment/fencing, with local unique active-assignment constraint per task, one-winner compare-and-swap acceptance and approved resource interval exclusion. Scheduling remains capacity authority; no Dispatch write manufactures a reservation. Workforce supplies current eligibility/resources. Booking owns Work and durable coordination, not Dispatch's tables.

Recheck current Identity/object authority, eligibility and reservation at assign/accept/start and policy-defined sensitive transitions. Independent HTTP read followed by local write has a reassignment/revocation race: **a cached fence check alone is insufficient**. Request a frozen Dispatch↔Work execution-authority/quiescence protocol: command-bound fence/lease or equivalent conditional authority, persisted operation IDs and refusal/wait/recovery before reassigning active Work. Accepted expiry/clock/max-age and revocation safety policy must bound in-flight authority. No cross-service atomic transaction or instant global revocation is claimed. Booking locally fences attempts and constrains approved one-active-Work per operator/resource; Dispatch must not activate conflicting assignment while old execution authority remains valid.

Work Binding Provider precedes Media Work-purpose consumer. It provides current Work/Booking/beneficiary/assignment/purpose authority without calling Media; Media then binds upload/finalize/read to exact resource revisions and actual bytes. Full Work validates accepted checklist snapshot and clean available evidence, rechecks stale/replaced/revoked objects and commits Work/audit/receipt/outbox atomically. Interrupted upload/local preview cannot advance phase. Quarantine is denied to business readers; scanner/processor access is separate exact-job technical authority.

Foreground task location belongs **Workforce under this task's instruction**. Workforce consumes actual active Work/assignment authority, persists consent/revision/captured time/accuracy and publishes minimum approved scoped view with staleness/unavailable/offline states. A customer sees only its own booking; another operator/customer is denied. No permission means no fabricated marker. Manual route/phone controls must not start background tracking, fake ETA or GPS-verified arrival. Exact cadence/precision/retention/consent policy and visible additions still need approval; source prototype is not operational Geo.

## Financial authority and recovery

C requests B's accepted `billing.cash-record.v1`, Wallet handover/status and independent treasury acceptance. Amount/remaining due comes from current authorized Billing facts; operator declares an explicit collection, not an arbitrary authoritative total. Named obligation/Work/assignment/collection revisions and stable business identity must survive duplicate/offline submission. Same key/fingerprint replays; changed body conflicts, and new-key duplicate business collection cannot post twice. B owns partial/over/shortage and closed-Work collection policy.

The full drill orders delivery before collection. B/C must freeze permitted terminal-Work collection authority: historical assignment reference alone is not a perpetual collector grant, while requiring only an active assignment may wrongly reject approved late collection. Publish current scoped late-collector authority, accepted Work-state/amount/reason checks and reassignment/revocation rules before implementation.

Wallet request allocates approved receipt/posting refs to approved holder/purpose/recipient, preventing overlapping handovers of the same cash. Request is pending. Distinct currently authorized company/treasury actor records independent evidence; Billing creates authoritative settlement receipt/postings under policy; Wallet settles only after reconciled B refs. Failed/lost Billing acknowledgment remains pending/reconciliation-required, never optimistic settled. No receipt/handover/settlement triple-counting as revenue or technician earnings. Admin itself owns no money tables.

Execution, collection, handover and acceptance each persist own command receipt/audit/outbox; broker consumers persist inbox/effect before ACK. Lost replies query/replay original operation, not blind new-key resubmission. Changed-ID duplicate financial business effect and same-ID changed bytes are separately tested. Corrections are linked B reversals/Wallet reconciliation, never deletions or peer rollback. Projections retain source revisions/as-of and explicit partial/stale/unavailable quality; reads cannot authorize sensitive commands.

## Proposed child and coordinated drill queue

1. E prerequisite release: verified BASE_W04, reconciled IDs/enum/Money/grants/delegation/route/error clients, actual W03 producers, run resources and approved policies/designs.
2. C Dispatch provider, then Booking Work binding provider: real DB/constraint/Identity/current authority/fenced race/restart conformance, independent of future UI/Media.
3. C Media Work-purpose consumer, then full Work and Workforce foreground-location consumers: actual binding/media/assignment authority, private bytes/policy/state/recovery gates.
4. D Communications/Reporting producers and B cash/treasury then Wallet custody providers: actual C authority and owned DB/broker/finance gates. Wallet cannot be accepted with a fake Billing producer.
5. A/C/D real app consumers, then E serialized complete cash drill. Actual affected journey passes before consumer merge; every mandatory candidate/resulting-main check/review remains required.

**Coordinated scenario request, not a booked slot:** E reserves a lane/wave/run identity with actual ports/DB roles/queues/private objects/scanner/browser outputs and heavy-slot lease; A/B/C/D confirm accepted provider SHAs and runnable app URLs/builds. Record one guest intent, optional empty plate, approved cash quote/hold/Booking/reservation, assignment/Work/checklist and Media refs, collection/receipt/postings, handover and independent treasury/settlement refs. Use synthetic private test data, not live money/customer documents. [Drill specification](../../../../tests/parallel/C/W04/acceptance-specifications.md) gives ordered assertions. No time/participant acceptance or business IDs are fabricated here.

Capture pinned Linux reference/candidate/diff across all execution phases, actual keyboard/sheet/focus/reduced-motion/camera-denial/reconnect flows and approved English LTR. Required production/error/custody states beyond reference remain explicit approval blockers. A/customer and D/admin are real consumers; one missing app or cash provider blocks Day 3 parent acceptance. E publishes actual commands/versions/resources; C edits no reserved metadata or other owner's implementation.
