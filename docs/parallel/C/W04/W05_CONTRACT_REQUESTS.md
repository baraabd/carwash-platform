# W04-C — W05 cancellation/reschedule and recovery requests

Status **PROPOSED / NOT ACCEPTED**. No W05 implementation or real refund is authorized. E publishes provider/consumer-reviewed schemas, parsers, versions, clients/routes/permissions and immutable next base. Preserve existing Identity/Gateway and strict Booking event compatibility; use separately reviewed events for guest/new states rather than silently widening old payloads.

| Proposed owner command | Request semantic fields | Result / invariants to freeze |
| --- | --- | --- |
| Booking cancellation intent / C | `{bookingRef,expectedRevision,reasonCode,policyRef}` plus current self/guest/scoped admin actor | Durable operation and desired terminal outcome with independent reservation/assignment/Work/payment/custody recovery states; cancellation request is not proof all effects reversed |
| Booking reschedule intent / C | `{bookingRef,expectedRevision,newQuoteRef,newHoldRef,locationRef?,policyRef,reasonCode}` | Versioned attempt and immutable old/new snapshots; Pricing/A/Scheduling revalidate. Accept atomic owner-local commit/release and durable compensation protocol before claiming old slot retained/released |
| Scheduling release/replace / C | `{reservationRef,expectedRevision,bookingOperationRef,reasonCode,newHoldRef?}` | Stable owner terminal/replace outcome; no oversold gap/double release or revival of expired hold. Exact safe retain-old/acquire-new sequence needs accepted policy |
| Dispatch/Work quiesce/cancel / C | `{assignmentRef,workRef,expectedRevisions,reasonCode,bookingOperationRef}` | Current fence and safe stopped/rejected/recovery outcome; active physical work cannot be forcibly reassigned/cancelled by a stale projection |
| Billing refund/correction request / B | `{obligationRef,receiptRefs,expectedRevisions,bookingOperationRef,reasonCode,policyRef}` | Authorized request/approval/provider operation states and immutable linked posting refs, not success from C/client. B freezes amount/eligibility/proration/evidence rules |
| Wallet custody correction/release / B | `{handoverRef,expectedRevision,billingCorrectionRef?,bookingOperationRef,reasonCode}` | Pending/disputed/reconciled outcome linked to actual B facts; customer refund does not silently erase treasury custody history |

Use accepted canonical Money and per-owner revision types by reference; no float/default price/currency/refund fee. Actor/beneficiary/service delegation remain separate, with current object/market scope and admin reason audit. Guest expiry/recovery never transfers ownership merely by knowing phone/order ID. Intent/operation/key fingerprint includes approved refs/revisions/policy/reason, stable actor+operation+target scope and durable business uniqueness. Same request replays after current authorization; changed payload conflicts; retries/status queries retain original provider identity and expiry. Retention/tombstone/deadline/budget values require explicit approval.

## Terminal precedence and races requiring owner agreement

- Commit versus hold expiry is Scheduling's authoritative transaction decision; late payment does not revive capacity or Booking.
- Delivery/completion fact and accepted collection/settlement remain historical facts. A later cancellation request cannot erase them; permitted post-delivery correction/refund path requires B/C policy.
- Cancellation and start/deliver/reschedule contend on Booking/Work revisions plus current Dispatch execution-authority protocol. Define which commands refuse or enter recoverable pending; no chronological arrival order of independent events establishes precedence.
- Expired/cancelled desired Booking state does not negate money accepted later. B owns verified late-payment disposition/refund, C records durable compensation/request outcomes and never claims payment reversal from local rejection.
- Reschedule is not in-place editing of price/address/history. Decide cancellation fees, quote honoring, hold deadlines, required consent, resource/assignment release and policy snapshots before coding.
- Broker reversal-first/settlement-first/old/gapped events reconcile through current owner reads; immutable receipts and Work audit stay intact. No global event order, distributed rollback or exactly-once network promise.

Each local state/audit/receipt/outbox commits together; each inbox/effect commits before ACK. Unknown provider result records PENDING/RECOVERY_REQUIRED under exact accepted enum and resumes via authorized owner operation lookup. Compensation has stable distinct key and owner outcome; failure remains visible. Publish reference-only cancellation/reschedule/compensation/refund-request/outcome events with owner ID/revision/causal operation/time, no private proof/contact/location.

To A/D: freeze approved customer/admin request, pending, denied, expired, recovery and final views with independent financial/custody states and source freshness. To B: exact refund/late-payment/correction/holder authority and immutable posting/custody links. To E: accepted contract/client/config/error mapping, guest/admin grants, broker ACLs and run allocation. To C: safe Scheduling/Dispatch/Work fences and persisted saga. Requests are reviewable documents, not sent messages or approvals.

Prove real owner DB/HTTP/Identity and concurrent cancel/start/deliver/reschedule/expiry/payment races, stale/revoked/foreign actors, duplicate/restart/unknown outcome and failed compensation first; then actual A/C/D journey with B providers before full consumer acceptance. Live provider refunds/money require separate applicable authorization. No fixture, image or navigation closes that gate.
