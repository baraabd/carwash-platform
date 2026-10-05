# W03 command/event dependencies and durable recovery proposal

Source: `82e7402ed9ab6cc4f565f423441cd0655f2d627a`.
All proposed operations below need owner/consumer review and an accepted common
base. Descriptive names do not define an exported HTTP path or wire schema.

## Existing source and authoritative allocation

F001's current `architecture/service-catalog.json` separates Scheduling capacity,
Booking orchestration, Dispatch assignment, Workforce eligibility and Billing
financial authority. Older grouped architecture prose and
`docs/sql/booking-capacity.draft.sql` are not authority to put capacity in Booking
or execute a draft migration.

Pricing, Scheduling, Booking, Billing, Workforce and Media each have only
ServiceMarker in their Prisma schema and BUSINESS_READY=false in app.module.ts.
Booking lifecycle/overlap, Billing journal balance and Catalog quote helpers are
unconnected pure prototypes. There are no domain receipts, snapshots, holds,
cash obligations, review cases, product outboxes or durable coordinator.

| Service / permanent owner | Existing migration ID               | Missing W03 authority                                              |
| ------------------------- | ----------------------------------- | ------------------------------------------------------------------ |
| Pricing / B               | 20261005060000_w01_foundation       | Immutable quote, current validation/binding and exact money        |
| Scheduling / C            | 20261005060000_w01_foundation       | Capacity constraints, hold/expiry/commit/release                   |
| Booking / C               | 20260920000000_sprint_02_foundation | Durable intent, order, snapshots, receipts and saga                |
| Billing / B               | 20260920000000_sprint_02_foundation | Independent cash-due obligation and authorized compensation        |
| Workforce / C             | 20260920000000_sprint_02_foundation | Binding, private-document decisions, audit and current eligibility |
| Media / C                 | 20260920000000_sprint_02_foundation | Private classified object, scan/finalize/read and purpose grants   |

These are existing histories, not migrations added by this proposal.

## Command/event dependency table

| Provider → consumer                                                | Needed command/fact                                                                        | Authority, recovery and current status                                                                                                          |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity E + Customer A → every owner                              | Verified actor, beneficiary, guest/service scope and live revocation                       | Member security exists. Guest/delegation absent; phone/order/customer ID or actor headers alone confer no authority.                            |
| Customer/Vehicle/Geo A → Pricing/Scheduling/Booking                | Ownership-safe vehicle/address snapshots and versioned serviceability                      | Product APIs absent. Optional plate and unsaved one-time input preserved. Serviceability receipt versus compute-only semantics requires review. |
| Configuration D → A/B/C                                            | Immutable policy publication, effective time and adoption references                       | Publication, adoption and transaction policy are separate facts; never rewrite a historical snapshot.                                           |
| Catalog/Pricing B → Scheduling/Booking/Billing                     | Server quote, exact revision, duration, money and current validity                         | Validation read is not exclusive binding or consumption. Quote single-use/release/revocation semantics are unresolved.                          |
| Workforce C → Scheduling/later Dispatch                            | Current resources, shift and eligibility facts                                             | Approval, Identity account status and work eligibility are independent; define freshness/revocation race policy.                                |
| Scheduling C → Booking/customer time selection                     | Availability, hold, commit, release and authorized outcome lookup                          | Availability is advisory. Only owner DB constraints commit allocation; expiry and late outcome need fencing.                                    |
| Narrow Booking intent/binding C → Billing B                        | Real durable beneficiary/operation reference before coordinator completion                 | Proposed cycle split; needs accepted B/C/E contract. No fake Booking reference or finished-coordinator prerequisite.                            |
| Billing B → Booking C                                              | Cash-obligation creation/status/cancellation                                               | Derive amount from authoritative Pricing. Obligation is not receipt, received money, custody or settlement.                                     |
| Booking C → customer A/admin D/operator C                          | Self-create, separately authorized on-behalf operation, status/cancel/reschedule           | Persist provider steps/keys/outcomes/deadlines. Transport/Gateway owns no saga or business database.                                            |
| Workforce Binding C → Media C → Workforce Review C → D/C consumers | Real draft-case authority, private processing, then approve/correct/reject and eligibility | Binding provider does not call Media. Each other Media purpose waits for its own real authority producer.                                       |
| Later Dispatch/Work C + finance B → app consumers                  | Assignment, execution, evidence, collection and custody                                    | W04 requests only; booking creation implies none of these effects.                                                                              |

Evidence: `docs/parallel/A/W02/W03_CONTRACT_REQUESTS.md`,
`docs/parallel/B/W02/W03_CONTRACT_PACKET.md`,
`docs/parallel/B/W01/FUTURE_FINANCE_CONTRACTS.md`,
`docs/parallel/C/W02/W03_CONTRACT_PROPOSAL.md`,
`docs/parallel/C/W02/PREWORK_REQUEST.md`,
`docs/parallel/D/W02/W03_CONTRACT_REQUESTS.md`.

## Required semantic review

B proposes opaque string revisions; C/D propose positive safe integers. Entity,
policy publication, snapshot and event sequence revisions need distinct meaning.
B's amountMinor/currency/currencyPolicyRevision/minorUnitExponent differs from
C's minorUnits/currency and D's exponent/currencyPolicyVersion. Accept lossless
wire vocabulary/adapters with the owners; no currency, scale, rounding, tax,
price, duration or numeric lifetime is selected here.

Review quote validation versus bind/consume, expiry boundary/skew, hold duration,
resource/travel constraints, idempotency retention/tombstones and business
uniqueness, current authorization on replay, compensation deadlines, unknown
outcome errors, and on-behalf/reviewer jurisdiction. Cash confirmation and
execution-before-electronic-verification policy also remains unresolved: the
technician prototype permits unpaid follow-up while customer simulation blocks
execution. Separate state columns do not decide that policy.

`booking.confirmed.v1` remains strict contract-only:
`data: {bookingId, customerId}`, positive safe-integer aggregateVersion and strict
UTC/envelope validation. Do not add guest/finance/capacity/evidence fields,
substitute a guest ID, or widen its meaning silently. Review an additive compatible
event/customer mapping where necessary. api-clients still exports an empty module.

## Crash windows and required recovery

| Failure boundary                                             | Required durable observable and recovery                                                                                                                                            |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Before owner transaction commit                              | Neither receipt, mutation, audit nor outbox partial effect survives.                                                                                                                |
| State versus receipt/outbox write                            | Claim/fingerprint, local business effect, audit and durable outcome/outbox must share the accepted local transaction boundary; pending operations have an explicit persisted state. |
| Owner commits, first HTTP response lost                      | Outcome unknown. Same authorized key/body or operation lookup returns original resource; restart and replay cannot create another order. Changed body conflicts.                    |
| Provider outcome lost before Booking records it              | Persist attempted step/key first, query owner receipt, then resume. Never create another hold/obligation under a new key.                                                           |
| Relay lease acquired, process dies                           | Reclaim after accepted lease expiry with stale-worker fencing; cover the final allowed attempt and durable exhausted-work reconciliation.                                           |
| Broker accepts, confirm lost                                 | Republish immutable event identity/payload; consumer deduplication tolerates duplicates.                                                                                            |
| Confirm received, relay dies before finalization             | Same duplicate window; no mark-before-publish. Real fault injection is needed beyond resetting a published flag.                                                                    |
| Return/NACK/timeout/closed channel                           | Publication stays unconfirmed and recoverable; bound attempts and record terminal/reconciliation status.                                                                            |
| Consumer dies before local commit                            | Roll back Inbox and effect together; no ACK.                                                                                                                                        |
| Consumer commits, dies before ACK                            | Redelivery verifies winning Inbox identity/hash; one local effect survives.                                                                                                         |
| Concurrent event identity with changed bytes                 | Integrity rejection; do not classify every unique violation as a proven duplicate.                                                                                                  |
| Old/gapped event revision                                    | Never regress authority; detect gaps and reconcile with authorized producer state/history and recorded checkpoint.                                                                  |
| External storage/scanner/financial operation outcome unknown | Persist attempt identity and reconcile provider result; SQL rollback cannot undo an external effect.                                                                                |

## Compensation and integrated observables

Booking owns durable process recovery; Scheduling alone releases capacity and
Billing alone cancels/reverses an obligation under approved policy. Each
compensation has its own durable key, fingerprint, generation/fence and receipt.
An uncertain create result is reconciled before cancellation. A failed release
or financial compensation stays visibly pending and recoverable. Never delete
peer rows, manufacture a successful release or infer rollback from timeout.

Expired/revoked quote or hold cannot regain validity because a late payment or
message arrives. Reacquiring capacity versus refund/manual review requires the
actual owner policy. Historical quote/booking snapshots remain immutable.

Collect authorized owner observations for: quote/revision/policy snapshot;
booking/operation uniqueness and saga generation; committed capacity or
released/expired hold; independent cash due; local audit/outbox and each consumer
Inbox/effect; safe correlation/causation; actual compensation/recovery state.
Test-only owner assertion endpoints or owner-owned DB assertions require review;
Gateway never reads product tables, and no peer Prisma client is imported.

## Acyclic child sequence after real entry acceptance

1. Accept W02 guest/object access, A ownership/Geo, D policy, B Catalog/Pricing and
   C Workforce Binding → Media → Workforce Review/Eligibility providers.
2. Accept the W03 contract/resource release and real BASE_W03. Missing exports
   require reviewed E pre-work plus a new common base before affected consumers.
   Before activating any new business publisher, accept E's declared durable
   topology/ACL/bindings and producer/subscriber activation conformance. This
   prerequisite applies before every relevant provider broker gate below.
3. Accept real Pricing validation/binding and Scheduling providers. Resolve the
   Billing reference contract with a narrow durable C intent/binding provider,
   independent of final Booking, capacity commit and payment success.
4. Accept B cash-obligation/status/compensation provider against those real
   producers. Scheduling and Billing narrow gates need not wait for app consumers.
5. Accept C Booking coordinator against merged real providers, including every
   lost-response, race, expiry, compensation and restart case.
6. Accept E's full-stack route/transport conformance and A/D/C app consumers
   against those providers; each includes its complete affected real W03 journey.
7. Run the combined latest-target barrier and resulting-target checks with
   independent review. Only then publish accepted W04 contracts and BASE_W04.

Provider fixtures never close the parent. Once implementation begins, the parent
remains INTEGRATION_PENDING until all task-listed combined cases pass.
