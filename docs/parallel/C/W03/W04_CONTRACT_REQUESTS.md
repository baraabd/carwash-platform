# W03-C — W04 operations contract delta

Status: **PROPOSED / NOT ACCEPTED**. No W04 work starts. This extends [W01 operational requests](../W01/CONTRACT_REQUESTS.md), sections 6–8, and [W02 administrative beneficiary rules](../W02/W03_CONTRACT_PROPOSAL.md). E publishes exact shared versions/clients/permissions/ACLs only after provider/consumer review. Existing strict Identity/Gateway/event contracts remain unchanged; do not widen `booking.confirmed.v1` or reuse a foundation probe as a business event.

## Domain authority and minimum proposed shapes

All requests below use current authenticated/delegated actor, accepted Idempotency-Key and expected aggregate revision. UUID/revision/UTC/exact money rules must follow the single accepted profile; times are server instants, not client authority. Each response includes authoritative aggregate ref/revision/state, operation receipt and separate audit/freshness where applicable. No endpoint exists for these proposals yet.

| Proposed surface / owner | Request data for review | Result / independent facts |
| --- | --- | --- |
| Dispatch claim / C | `{bookingRef,reservationRef,resourceRefs,eligibilityRef,expectedAssignmentRevision?}` | Assignment ref/state/fencing revision; claims only valid current reservation and eligible resource combination |
| Dispatch accept/refuse / C | `{assignmentRef,expectedRevision,decision,reasonCode?}` | Versioned acceptance/refusal; assigned actor/team authority rechecked, not inferred from booking status |
| Dispatch release/reassign / C | `{assignmentRef,expectedRevision,targetResourceRefs?,reasonCode}` | Released/new assignment refs and stable outcome; old actor fenced, active-work reassignment safety policy required |
| Booking Work travel/arrive/start / C | `{workRef,expectedRevision,assignmentRef,intendedTransition}` | Work/phase revision and prerequisite result; current fenced assignment, current authorization and accepted payment/execution policy |
| Booking Work checklist / C | `{workRef,expectedRevision,assignmentRef,definitionRef,itemResults}` | Exact accepted checklist revision/history; no unchecked UI tick promotes phase |
| Booking Work Media attachment / C with Media | `{workRef,expectedRevision,assignmentRef,purpose,objectRef}` | Bound evidence refs only after actual Media safety/purpose/current authority; photos do not verify money |
| Booking Work deliver / C | `{workRef,expectedRevision,assignmentRef,checklistRef,evidenceRefs,reasonCode?}` | Work outcome separate from Booking/payment/cash/custody; incomplete/revoked prerequisites reject |
| Billing cash collection/ledger / B | `{bookingRef,workRef,assignmentRef,obligationRef,amount,evidenceRefs?,collectedAt}` | B-authoritative collection/financial posting refs and verification state; B freezes canonical Money and partial/mismatch policy |
| Wallet custody handover request / B | `{collectionRefs,holderRef,recipientRef,amount,expectedRevision,reasonCode?}` | Pending custody request ref and ledger-reference reconciliation, not company receipt |
| Wallet custody acknowledgment/status / B | `{handoverRef,expectedRevision,decision,reasonCode,evidenceRefs?}` / authorized read | B-approved distinct receiver/verifier and durable accepted/rejected/discrepancy outcome; actor cannot acknowledge its own handover by role name alone |

B owns final finance/custody schemas, approved holders/purposes, monetary precision, reconciliation and reversal policies. C contributes work/assignment relationships through public APIs. Wallet is no second ledger or fourth checkout method; no payroll/customer funding/marketplace scope is added. Approved UI methods remain cash/ShamCash/Syriatel Cash; Paymera remains a separate owner/provider decision.

Every mutation requires actor+contract+operation+target scoped identity, canonical semantic fingerprint, conflict on changed payload, replayable receipt with original expiry, current authorization on replay and approved retention/tombstones. Durable business uniqueness survives receipt cleanup. Compensation/release uses its own command identity. Provider deadlines/retries/unknown-outcome lookup and bounded DLQ/reconciliation are explicit acceptance requirements, not numerical defaults chosen here.

## Administrative actor semantics

W04 admin create consumes W03's separate create-on-behalf protocol: initiating authenticated administrator stays distinct from beneficiary and service delegate, with current market/object scope, reason and immutable audit. Assign/reassign commands likewise derive actor server-side and validate current reservation/eligibility/assignment versions. No admin total override, customer impersonation, bypass of consent or blanket `operations.dispatch` authorization for unrelated finance/roster edits. D requests exact production form/error/confirmation designs; prototype forms do not approve new flows.

## Location ownership conflict requiring explicit confirmation

W03 task requests **Workforce** for the approved technician location record, subject to W01 ownership confirmation. The merged W01-C proposal instead requested **Booking-owned active Work location**; that was never accepted. Do not silently implement both or let a catalog shorthand settle the decision.

Request E/product/C/A/D confirm one authoritative owner before BASE_W04. The task's intended candidate is Workforce-owned technician location, with Booking/Dispatch supplying current Work/assignment/phase authority through accepted contracts. Booking stores only permitted refs/freshness, not a competing location history. If another ownership decision is approved, publish the explicit record and corresponding contract/common base before dependent writes.

Candidate command: `{operatorRef,expectedLocationRevision,workRef,assignmentRef,consentRef,sequence,capturedAt,position:{latitude,longitude,accuracyMeters}}`. Actor is server derived; validate current assigned technician/active phase, finite ranges, bounded age/accuracy/rate and current consent. Location revision is independent of Work revision; update never advances Work. Denied permission, terminal/reassigned Work, expired authority or revoked consent refuses publication. Precise coordinates/retention/sample cadence require approved inputs, not prototype Riyadh coordinates or rendering timezone.

Candidate scoped read: `{workRef,knownLocationRevision?}` → `{state,locationRevision,capturedAt?,expiresAt?,position?,precisionPolicyRef,sourceRef}` with explicit unavailable/stale/denied behavior. A customer reads only its own accepted booking purpose; D operations only approved market/work scope; no public fleet tracking, background/always-on promise or unrelated worker browsing. Agree minimum precision, stale threshold, deletion/retention and approved copy. Events invalidate a bounded view with refs/revisions only, not broadcast precise location history.

## Events and real acceptance

Request Dispatch claim/accepted/released/reassigned and Booking Work phase/outcome events, plus B collection/custody transitions and bounded customer/admin projection events. Freeze exact IDs/schema versions/data with E; each includes owner aggregate ref/revision, safe outcome/time/correlation and authorized producer ACL. No phone/address/document/private URL in events. Outbox+state and inbox+effect are atomic; replay/gaps never reassign twice or create another financial posting. D projections report source/freshness and cannot overwrite authoritative states.

Queue narrow Dispatch → Booking Work binding → Media Work-purpose → full Work, then B cash/custody providers and A/C/D journey consumers. Workforce location provider depends on the confirmed real Work/assignment authority; split binding before location consumer to avoid cycles. Prove direct owner current auth, fenced reassignment races, phase/media/checklist invariants, location consent/staleness/revocation, stable financial receipts, distinct holder/receiver and crash/compensation recovery before actual customer/operator/admin journeys. Schemas/fixtures are not live B/D endpoint examples; publish sanitized captures only after actual provider acceptance.
