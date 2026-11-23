# W04-A — W05 electronic-payment, cancellation and rescheduling requests

Status: **PROPOSED / NOT ACCEPTED / NOT IMPLEMENTED / TESTS UNEXECUTED**. Packet `w04-a-w05-customer-finance-change/0.1.0`; all wire V1 names below are candidate review vocabulary, not published packages. The W04 cash parent is entry-blocked; this handoff does not start W05 or claim its contracts frozen.

## 1. Observed source and accepted-contract gap

Observed `main@1ec9d8aebf4470a2815471116643fa6ebe0d5a95`, tree `9f04d674056041bbc810a62e4cc7f275c32581b8`. Existing W03 packets are merged proposals, not provider acceptance.

- `architecture/parallel-contract-release.json` still has `BASE_W02:null`, `acceptedNextWaveContracts:[]`, no published BASE_W04/review/package release; stale A intake metadata does not undo merged A packets.
- `packages/contracts/src/registry.ts` publishes Identity/Gateway only; packages remain contracts/event-contracts `0.0.2`, api-clients `0.0.1`; `packages/api-clients/src/index.ts` exports nothing. Strict `booking.confirmed.v1` remains contract-only with exactly `{bookingId,customerId}` data.
- `services/{billing,booking,scheduling,media}/prisma/schema.prisma` contain only `ServiceMarker`; Billing `src/app.module.ts` sets BUSINESS_READY=false. No electronic/cancellation/rescheduling product provider exists here. `apps/customer-web/src/widgets/order-handoff/orderHandoffViewModel.ts` explicitly defers QR/proof/cancellation and is session-only.
- Authoritative F001 catalog/ADR separates Pricing quotes, Billing obligations/receipts/refunds/postings, Scheduling capacity, Booking lifecycle/durable saga, Media private proof, D delivery/projections/policy and E auth/ingress/shared publication. Gateway/apps own none of these business facts; Wallet is no additional checkout method or inferred customer stored value.

Reconciliation inputs, **all unaccepted**:

| Exact source pointer                                                                                                                                     | W05 consequence                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `B/W03/CONTRACT_DELTA_REQUESTS.md` §W03 intent distinction; `B/W03/W04_CONTRACT_PACKET.md` §§money/identity/recovery                                     | W03 unpaid internal financial intent is distinct from W05 provider-backed intent; B opaque revisions versus C/D integers and money vocabularies need E closure                 |
| `B/W01/FUTURE_FINANCE_CONTRACTS.md:33–37`, `future-finance-contracts.schema.json` PaymentIntent/ProofSubmit/SettlementVerify/RefundReserve/RefundResolve | Preserve closed draft request fields; the new customer read models and proposed extensions below cannot silently widen these drafts                                            |
| `B/W01/PROVIDER_ACCEPTANCE.md` §§dossiers/uniqueness/refunds; `POLICY_DECISIONS.md` B-02/03/05/06/11/12/15                                               | Actual provider documents, merchant access, environment, money/refund/guest/retention policy remain missing; repository absence does not imply provider APIs do not exist      |
| `C/W03/CAPACITY_AND_RECOVERY_PROPOSAL.md` §§hard capacity/durable coordinator                                                                            | Only Scheduling constraints commit/release capacity; fenced Booking steps/keys/outcomes survive restart; rescheduling needs fresh quote/current capacity and immutable history |
| `D/W03/W04_CONTRACT_REQUESTS.md` §§schema closure/delivery; `E/W03/COMMAND_EVENTS_AND_RECOVERY.md` §§crash/compensation                                  | Current-authority scoped replay, owner receipts and independent delivery facts; unknown external outcomes remain reconciliable; late money never revives expired capacity      |
| `E/W03/TOPOLOGY_AND_W04_REQUESTS.md` §§activation/observables                                                                                            | Business queues/ACLs/bindings and safe owner observables precede activation; probe topology is insufficient                                                                    |

All relative peer pointers above are under `docs/parallel/`. Approved customer HTML payment functions and DESIGN_LOCK §5 require method-specific QR after order/amount/recipient fixation, copy/save/enlarge behavior and proof→review, never proof→received money. Cancellation prototype is local; exact production pending/error/refund/rescheduling copy and changed-price confirmation design require approval. No provider URL/QR syntax, phone-derived official QR, price, merchant account, fee or refund duration is guessed.

## 2. Candidate common profile, ownership and authorization

```ts
type UUID = string; // canonical UUIDv4 candidate, compatible with current ingress validator
type UTC = string; // strict valid YYYY-MM-DDTHH:mm:ss.sssZ; server instants
type Revision = number; // positive safe integer candidate, not yet E's common decision
type OpaqueVersion = string; // bounded immutable Catalog/Pricing/B publication version
type Ref<O extends string> = { owner: O; id: UUID; revision: Revision };
type QuoteRef = { owner: 'pricing'; id: UUID; revision: OpaqueVersion };
type Money = { amountMinor: string; currency: string; currencyPolicyRevision: OpaqueVersion };
type MoneyFacts = { money: Money; minorUnitExponent: number; policyRef: Ref<'configuration'> };
type BeneficiaryRef = { contextId: UUID; revision: Revision };
type OperationV1 = {
  schemaVersion: 1;
  operationRef: Ref<'billing' | 'booking' | 'scheduling'>;
  outcome: 'PENDING' | 'SUCCEEDED' | 'REJECTED' | 'RECONCILIATION_REQUIRED';
  evaluatedAt: UTC;
  reasonCode: string | null;
};
```

Money is canonical nonnegative integer minor-unit text, no leading zero except `0`, floats/signs/exponents/mixed-currency sums. Exponent/currency/bounds/rounding/tax/policy come from approved owner inputs; delta direction is separate, no negative-money workaround. Proposed numeric financial entity revisions follow the existing closed future-finance drafts; reconcile B's broader opaque ref proposal via explicitly published types/adapters or new majors, never coercion. Policy/entity/quote/event/delivery revisions are distinct.

- Member or real guest credential binds the same validated beneficiary through Booking, Billing, Media and change operations. Current Identity/member security exists; guest capability/recovery/claim still requires E's real provider. A name/phone/order ID/proof/receipt or admin creator never grants ownership. B `ACCOUNT/GUEST` versus C `CUSTOMER/GUEST` needs an accepted mapping.
- Actor/service delegation is server-derived; every owner rechecks live revocation, audience, beneficiary/object/purpose and scoped jurisdiction. Candidate grants for review: `billing.payment-intents.create:self`, `billing.payment-proofs.submit:self`, `billing.payment-views.read:self`, `bookings.cancel:self`, `bookings.reschedule:self`; none exist by assertion. Admin/on-behalf and verifier/refund grants are separate, audited, never customer impersonation.
- Cookie commands need accepted exact-Origin/CSRF; reads/Media grants/replays/resume need current authorization. Principal changes clear private UI caches and cancel old requests. Guest expiry uses accepted recovery, not phone-match access; claim/link replay does not broaden another guest's objects.

## 3. CP-A-W05-01 — Intent, QR, proof and truthful financial reads

Canonical candidate commands remain B's reserved `billing.payment-intent.v1`, `billing.proof-submit.v1`, `billing.settlement-verify.v1`; exact public/internal routes and clients belong E/B publication. Customer “sham” maps to draft Billing “shamcash” only through a reviewed exported adapter; “syriatel” is retained. Paymera remains an explicit owner/provider decision, no invented fourth method.

```ts
interface IntentRequestV1 {
  schemaVersion: 1;
  obligationId: UUID;
  expectedRevision: Revision;
  method: 'shamcash' | 'syriatel';
} // unchanged closed B draft; no browser amount/recipient override
interface IntentViewV1 {
  schemaVersion: 1;
  intentRef: Ref<'billing'>;
  obligationRef: Ref<'billing'>;
  bookingRef: Ref<'booking'>;
  method: 'shamcash' | 'syriatel';
  amount: MoneyFacts;
  state: 'ISSUED' | 'PENDING_EXTERNAL' | 'EXPIRED' | 'CANCELLED' | 'RECONCILIATION_REQUIRED';
  issuedAt: UTC;
  expiresAt: UTC;
  instructions: InstructionsV1 | null;
  quality: FinancialQualityV1;
}
interface InstructionsV1 {
  recipientPublicationRef: Ref<'billing'>;
  instructionVersion: OpaqueVersion;
  mode: 'MANUAL_TRANSFER' | 'PROVIDER_INTENT';
  recipientLabel: string;
  recipientDisplayRef: string;
  qr: { payload: string | null; displayObjectRef: Ref<'media'> | null };
  policyRef: Ref<'configuration'>;
}
interface ProofRequestV1 {
  schemaVersion: 1;
  obligationId: UUID;
  providerTransactionHint?: string;
  mediaObjectId?: UUID;
} // at least one, closed B draft bounds
interface ProofViewV1 {
  schemaVersion: 1;
  reviewRef: Ref<'billing'>;
  obligationRef: Ref<'billing'>;
  state: 'SUBMITTED' | 'IN_REVIEW' | 'NEEDS_INFORMATION' | 'REJECTED' | 'RESOLVED';
  submittedAt: UTC;
  resolvedAt: UTC | null;
  verifiedPaymentRef: Ref<'billing'> | null;
  reasonCode: string | null;
}
interface FinancialQualityV1 {
  asOf: UTC | null;
  sourceRef: Ref<'billing'> | null;
  availability: 'CURRENT' | 'STALE' | 'UNAVAILABLE';
}
interface ElectronicPaymentViewV1 {
  schemaVersion: 1;
  bookingRef: Ref<'booking'>;
  obligationRef: Ref<'billing'>;
  intent: IntentViewV1 | null;
  proofReviews: ProofViewV1[];
  state:
    | 'DUE'
    | 'REVIEW_PENDING'
    | 'PARTIAL'
    | 'VERIFIED'
    | 'LATE_PAYMENT_REVIEW'
    | 'DISPUTED'
    | 'UNAVAILABLE';
  verifiedReceiptRefs: Ref<'billing'>[];
  outstanding: MoneyFacts | null;
  refunds: RefundViewV1[];
  quality: FinancialQualityV1;
  nextCursor: string | null;
}
```

Candidate null guards: CURRENT financial quality requires non-null asOf/sourceRef; stale/unavailable never implies DUE or VERIFIED. VERIFIED requires nonempty verified receipt refs backed by Billing postings; empty proofReviews is not evidence of no money.
Billing derives obligation/booking/beneficiary/amount/current recipient and actual approved adapter. ISSUED requires usable current approved instructions; pending/unavailable cannot synthesize QR. Exactly one accepted QR representation is present; instructions mode/capabilities must match actual documented provider support. Static/manual QR does not reserve funds or prove transfer; intent expiry cannot prevent a later external transfer. Recipient revision changes require explicit owner revalidation, never silently redirect an existing transfer.

- Existing ProofRequest lacks intent/revision fields. For W05 decide whether obligation binding is sufficient; if intent-specific/fenced proof is required, publish a separately reviewed request/version rather than append to the closed B V1 draft. Transaction hint is advisory; image purpose `PAYMENT_PROOF` needs real Billing intent/obligation binding → Media private reservation/upload/scan/process/finalize → Billing proof attachment.
- Media verifies current object/purpose/beneficiary/classification, bounded content/checksum and processed display access. CLEAN image is not financial verification; quarantine/revocation prevents use. Reviewer/customer grants differ; proof bytes/URLs never enter generic events, analytics or public cache. Retention/deletion/legal-hold/export rules remain undecided.
- `billing.settlement-verify.v1` is privileged B verification using provider+merchant+external transaction uniqueness, independent evidence and observed exact Money/time; a customer cannot call it. One external credit cannot fund two obligations without approved allocation. Proof RESOLVED may be rejected/unmatched and does not imply VERIFIED; VERIFIED requires actual B receipt/posting proof.
- Intent/proof response lost → authorized same-key replay/outcome lookup; never duplicate charge/proof by changing key. Reload/deep link uses current owner snapshots. Changing method after an intent/proof requires an explicit supersession/late-transfer policy and version; it is not a local toggle deleting prior evidence.

## 4. CP-A-W05-02 — Cancellation, late payment and refunds

```ts
interface CancellationRequestV1 {
  schemaVersion: 1;
  bookingRef: Ref<'booking'>;
  expectedBookingRevision: Revision;
  reasonCode: string;
  observedPaymentRef: Ref<'billing'> | null;
}
interface CancellationViewV1 {
  schemaVersion: 1;
  bookingRef: Ref<'booking'>;
  operation: OperationV1;
  state: 'REQUESTED' | 'CANCELLING' | 'CANCELLED' | 'REJECTED' | 'RECOVERY_REQUIRED';
  capacity: 'UNCHANGED' | 'RELEASE_PENDING' | 'RELEASED' | 'UNKNOWN';
  financial:
    'NO_RECEIVED_MONEY' | 'REVIEW_PENDING' | 'REFUND_PENDING' | 'REFUND_COMPLETE' | 'UNKNOWN';
  refunds: RefundViewV1[];
  policyRef: Ref<'configuration'>;
  evaluatedAt: UTC;
}
interface RefundViewV1 {
  schemaVersion: 1;
  refundRef: Ref<'billing'>;
  paymentRef: Ref<'billing'>;
  amount: MoneyFacts;
  state:
    'REVIEW_PENDING' | 'RESERVED' | 'SUBMITTED' | 'UNKNOWN' | 'CONFIRMED' | 'DEFINITIVELY_FAILED';
  requestedAt: UTC;
  resolvedAt: UTC | null;
  reversalPostingRef: Ref<'billing'> | null;
  reasonCode: string | null;
  quality: FinancialQualityV1;
}
```

Candidate `booking.cancel.v1` is C's durable coordinator; browser payment ref is a consistency hint, never truth/authority. Work/cancellation eligibility, deadlines/fees and partial compensation require approved B/C policy; do not port prototype `stage<3`. Rejected request leaves prior booking facts; REQUESTED/CANCELLING is not CANCELLED. Scheduling releases only its reservation; Dispatch/Work safety and optional entitlement compensation use their owners, separate keys/fences/receipts. No customer finance command or peer-row rollback.

- Separate B `billing.refund-reserve.v1` from `billing.refund-resolve.v1` using preserved closed draft fields. Reserve allowable verified-payment amount atomically against concurrent refunds; no proof-only refund and no over-refund. UNKNOWN external execution retains reserved allowance until independent definitive resolution; “timed out” cannot release allowance and invite a duplicate payout.
- CONFIRMED requires non-null resolvedAt/reversalPostingRef, independent provider/bank evidence and linked immutable reversal posting; DEFINITIVELY_FAILED releases allowance only under verified failure policy. Refund request/reservation/navigation/notification is not returned money. Partial refunds remain exact allocations and leave unresolved remainder visible; original receipt is immutable.
- Cancellation and settlement race on separate owner states. If transfer verifies after quote/intent/hold/booking expiry or cancellation, record money once as LATE_PAYMENT_REVIEW, preserve canceled/expired capacity facts and follow approved refund/reallocation/manual-review policy. Deliberate new capacity/quote/customer confirmation uses a new operation; no automatic resurrection.
- Compensation failures show RECOVERY_REQUIRED plus independent financial/capacity truth; canceled order with pending refund remains visible. Ambiguous cancellation/refund replies show pending lookup, preserve history and disable conflicting repeats; D support/admin cases coordinate through authorized owner commands, not Reporting or images.

## 5. CP-A-W05-03 — Rescheduling contract freeze request

C Booking owns change intent/saga/history; C Scheduling replacement availability/hold/reservation; B Pricing quote and Billing financial delta/allocation/refunds. Request **owner-reviewed freeze before BASE_W05**, not an accepted freeze in this packet. Preserve existing vehicle/location/beneficiary/service snapshots unless separately approved scope changes; reschedule is not rebook or mutation of historical quote.

```ts
interface ReschedulePrepareV1 {
  schemaVersion: 1;
  bookingRef: Ref<'booking'>;
  expectedBookingRevision: Revision;
  desiredWindow: { startsAt: UTC; endsAt: UTC; timezone: 'Asia/Damascus' };
}
interface ReschedulePlanV1 {
  schemaVersion: 1;
  changeRef: Ref<'booking'>;
  bookingRef: Ref<'booking'>;
  beneficiaryRef: BeneficiaryRef;
  oldReservationRef: Ref<'scheduling'>;
  availabilityRef: Ref<'scheduling'>;
  replacementHoldRef: Ref<'scheduling'>;
  replacementQuoteRef: QuoteRef;
  replacementAmount: MoneyFacts;
  oldSlotPolicyRef: Ref<'configuration'>;
  financialPlan: RescheduleFinanceV1;
  requiresChangedPriceConsent: boolean;
  planHash: string;
  expiresAt: UTC;
  operation: OperationV1;
}
interface RescheduleConfirmV1 {
  schemaVersion: 1;
  changeRef: Ref<'booking'>;
  expectedBookingRevision: Revision;
  expectedChangeRevision: Revision;
  replacementHoldRef: Ref<'scheduling'>;
  replacementQuoteRef: QuoteRef;
  planHash: string;
  priceConsent: {
    accepted: true;
    quoteRef: QuoteRef;
    amount: MoneyFacts;
    policyRef: Ref<'configuration'>;
  };
}
interface RescheduleFinanceV1 {
  schemaVersion: 1;
  oldObligationRef: Ref<'billing'>;
  replacementObligationRef: Ref<'billing'> | null;
  financialPlanRef: Ref<'billing'>;
  direction: 'UNCHANGED' | 'PAYMENT_DUE' | 'REFUND_REVIEW';
  delta: MoneyFacts | null;
  state: 'PLANNED' | 'PENDING' | 'APPLIED' | 'RECONCILIATION_REQUIRED';
  paymentAllocationRefs: Ref<'billing'>[];
  refundRefs: Ref<'billing'>[];
}
interface RescheduleViewV1 {
  schemaVersion: 1;
  changeRef: Ref<'booking'>;
  bookingRef: Ref<'booking'>;
  state:
    | 'PREPARING'
    | 'AWAITING_CONFIRMATION'
    | 'COMMITTING'
    | 'RESCHEDULED'
    | 'REJECTED'
    | 'COMPENSATING'
    | 'RECOVERY_REQUIRED';
  oldReservationRef: Ref<'scheduling'>;
  replacementReservationRef: Ref<'scheduling'> | null;
  effectiveAppointment: { startsAt: UTC; endsAt: UTC; timezone: 'Asia/Damascus' };
  capacityOutcome: 'OLD_PRESERVED' | 'SWAP_COMMITTED' | 'RELEASE_PENDING' | 'UNKNOWN';
  financialPlan: RescheduleFinanceV1 | null;
  operation: OperationV1;
  historyRef: Ref<'booking'>;
}
```

Candidate interfaces: `booking.reschedule-prepare.v1` (durable command, not mutation hidden in GET), `booking.reschedule-confirm.v1`, `booking.reschedule-status.v1`; Scheduling replacement availability read/hold/swap/release and B `billing.reschedule-delta-plan.v1` plus separately accepted apply/compensate commands. No such accepted delta/swap provider exists. Exact routes/results/enums/required-null guards need B/C/E publication.

The populated `ReschedulePlanV1` is returned only after successful preparation for customer confirmation, with its operation outcome `SUCCEEDED`. Pending/rejected preparation returns `OperationV1` or a separately reviewed discriminated branch; it must not fabricate quote/hold/financial references. Where CancellationRequest, ReschedulePrepare or RescheduleConfirm repeats an expected revision, it must equal the corresponding Booking/change reference's `revision`. Confirm's expected Booking revision is checked against the Booking reference bound in the durable change plan; its expected change revision matches `changeRef.revision`. Quote publication, policy and financial revisions remain distinct; incompatible duplicate values reject before effects.

- Prepare binds narrow real change/beneficiary intent before Pricing/Scheduling calls. Availability is advisory with current zone/hours/resources/shift/service-duration refs; replacement hold is current, expiring and bound to same change/quote/beneficiary. No plausible slot fixture, original expired quote reuse or price calculation in app. Old hold/booking revision changes invalidate plan/consent.
- Changed price is explicit owner amount/quote/version shown to customer for acceptance before confirm; confirmation binds plan hash and exact current refs/Money/policy, recorded server-side. Changed quote/policy/hold/expiry or concurrent cancel/change returns conflict/reprepare and requires fresh confirmation. A consent boolean alone cannot authorize an unrelated new amount or automatic debit.
- **Proposed preservation preference, awaiting C/B/product decision:** keep old committed slot until a replacement can commit. Scheduling must specify atomic local swap/overlap/exclusion and expected old/new revisions versus an explicit durable release sequence; Booking cannot promise cross-service atomicity. Define payment prerequisites, temporary double occupancy and assignment/Work eligibility; no release-first policy selected silently.
- Reschedule view reports the old effective appointment under OLD_PRESERVED and replacement appointment only under actual SWAP_COMMITTED; UNKNOWN reports honest last-confirmed facts/freshness, not a guessed successful swap.
- Before swap commit, reject/expired/unavailable replacement preserves old reservation and releases unused new hold through Scheduling. After an actual swap/release, failure cannot claim old slot restored: reacquire it as a new capacity operation only if available/approved, otherwise show effective appointment and RECOVERY_REQUIRED. Release/financial compensation acknowledgment loss uses original operation lookup; stale workers are fenced.
- Billing computes delta from authoritative old/new immutable quote/obligation/payment allocations and policy, not frontend subtraction. UNCHANGED requires delta=null; PAYMENT_DUE/REFUND_REVIEW require positive same-policy Money. Currency/policy migration, fees, paid/unpaid/partial receipts, excess/underpayment and already-reserved refund treatment need explicit accounting rules. No automatic credit, stored value or refund success.
- Increased amount creates approved extra obligation/intent and payment prerequisite; decreased amount triggers approved allocation/refund review. Payment-due, refund-pending and capacity outcome remain separate. Verified late payment to superseded intent is reconciled once to permitted allocation/refund/manual review, never silently applied twice or reopening the prior slot. Cancellation racing change has one accepted winner/fence and compensates losing effects.

## 6. Cross-cutting replay, deadlines, events and compatibility

- Proposed ingress key syntax retains `[A-Za-z0-9_-]{16,128}`. E must reconcile B/C/D actor/operation/target scopes. Fingerprint binds verified actor/delegate, beneficiary, contract major/operation/business target, expected refs/revisions, method, proof hash/reference, quote/Money/policy/plan hash/consent/reason; excludes bearer secrets, transport IDs and signed URLs. Arrays need accepted ordering/set semantics. Same key+meaning replays original receipt/IDs/expiry under current authorization; changed meaning conflicts.
- Business uniqueness survives replay cleanup: external provider+merchant transaction, one accepted financial allocation, refund allowance, change generation and active reservation constraints. Pending concurrent duplicate returns accepted pending/lookup outcome. Replay/tombstone/guest/intent/hold/proof/grant/outcome lifetimes, deadlines, skew and retry exhaustion remain named E/owner decisions; no numerical defaults are adopted from foundation or old drafts.
- Timeout/connection loss after any command is UNKNOWN, not definitive failure. Persist step identity before invocation; query/replay same authorized key and exact body within original budget. Compensation has distinct stable command identity/fence and remains durable on failure. No blind new-key provider intent, refund payout, replacement booking or capacity release retry; SQL rollback cannot undo external money/storage effects.
- Proposed error mapping for review: malformed/unknown fields400; expired/revoked auth401; CSRF/scope403; concealed object404; revision/key/plan/cursor conflict409; ineligible state/media/policy/expiry422; throttle429; owner/policy unavailable503; deadline/unknown outcome504. Exact safe reason/recovery discriminator is exported, no provider stacks/PII/QR secret/proof URL. Unknown major/enum renders unavailable, never paid/refunded/rescheduled by guessing.
- Candidate owner events: B `billing.payment-intent-created.v1`, `billing.proof-submitted.v1`, verified/payment outcome, refund-reserved/confirmed/failed; C cancellation/reschedule outcome. B's `billing.payment-confirmed.v1` versus newer `billing.payment-verified.v1` needs one explicit accepted name/version. Do not widen strict `booking.confirmed.v1` or publish foundation probes as product facts.
- Candidate event data V1 `{operationRef,bookingRef,resourceRef,policyRef,outcome,occurredAt}`; B financial variants add obligation/payment/refund/posting refs and Money only where authorized consumer requires it; C change adds old/new reservation and quote refs. Discriminated terminal variants require actual owner receipts, pending fields nullable. E closes envelope/schema/producer ACL; no raw contact, QR, proof or external transaction secret in broadcasts.
- Owner state+receipt+audit+outbox and consumer Inbox+effect/ACK have accepted local atomic boundaries. Duplicate/hash conflict, old/gapped revision and source rebuild are explicit; rebuild never charges/refunds/reschedules/resends notifications. D notification recipient/purpose/current membership and Reporting freshness remain independent from payment/booking authority.
- Existing Identity/Gateway/events and cash consumers retain strict semantics. Publish separate new view/request majors/adapters where required; unknown properties cannot silently extend closed prior drafts. Current Gateway rejects query URLs, buffers JSON, lacks conditional/precondition/stream header forwarding and maps >=300 to faults; E must publish bounded query/status/precondition/error/guest adapters before these candidate lists/reads can pass ingress. Private object bytes use separately authorized storage transport.

## 7. Required provider/consumer proofs and E publication

All cases below are **UNEXECUTED proposed gate IDs**, with real merged producers required before A/C/D consumer acceptance:

| ID                        | Provider invariant and actual customer/operator/admin expectation                                                                                                                                                    |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W05-PC-01 INTENT-QR       | Owned member/guest obligation; distinct approved ShamCash/Syriatel instructions/amount/recipient revisions; no QR until usable approved source; no customer merchant edit or unsupported provider capability         |
| W05-PC-02 PROOF           | Hint-only/image-only/both; actual private bytes/scan/classification/binding; quarantine/foreign object denied; submission stays review, not paid; proof lost response replays one review                             |
| W05-PC-03 VERIFY          | Privileged genuine independent verification; mismatch/partial/duplicate/conflicting external transaction; one posting; customer denied; operator Work follows accepted payment prerequisite, not prototype conflict  |
| W05-PC-04 LATE-CANCEL     | Payment before/during/after cancellation or expiry; expired capacity unchanged; verified money once, explicit refund/reallocation review; all three apps show independent authoritative facts                        |
| W05-PC-05 REFUND          | Concurrent partial allowance/over-refund denied; provider unknown retains reservation; lost response/restart/replay; definite failure versus confirmed reversal; no refunded copy before B evidence                  |
| W05-PC-06 RESCHEDULE      | Fresh quote/availability/hold and changed-price confirmation; price/hold expiry, occupied slot, same/overlapping window, revoked eligibility, stale booking/change revision and duplicate confirm; history immutable |
| W05-PC-07 CHANGE-RECOVERY | Crash/lost result at every prepare/commit/financial/release step; old slot preserved before swap; post-swap restoration never fabricated; payment delta/refund pending separate; concurrent cancel/change fenced     |
| W05-PC-08 AUTH-CATCHUP    | Two members/two guests/wrong market/revoked guest/claim isolation; reload/deep link/disconnect/cursor gap/out-of-order updates; no stale-principal receipt/proof/QR access or repeat external effect                 |

Split acyclic children: E accepted guest/contracts/route/resource release → C narrow real Booking/change-intent binding → B obligation/intent purpose authority → C Media Billing-purpose consumer → B proof attachment/verification/refund/delta providers → C cancellation/reschedule coordinator → A/C/D real app consumers and complete affected journey before merge. Scheduling replacement providers may proceed in parallel where their accepted prerequisites are independent. Required financial prerequisite may split plan/facts provider from final coordinator; fixtures never replace actual DB/HTTP/auth/storage/broker/provider evidence.
E publishes exact contracts/event-contracts/api-clients exports/parsers, OpenAPI/AsyncAPI/version compatibility, accepted actor/guest/service grants and all routes/error/deadline/key policies; owner broker exchanges/queues/bindings/ACLs/catch-up precede activation. Request explicit shared dependencies/config/CI/append-only migration privileges, isolated run ports/DB roles/object/browser namespaces and heavy slot; A edits none of these reserved files.
Require real owned migration/upgrade/constraints/restart/current-auth tests, external adapter protocol and unknown-outcome conformance, broker crash/hash/gap recovery and full three-app owner-outcome traces. Preserve approved QR save/copy/enlarge and proof/cancellation behavior, keyboard/focus/RTL/reduced motion; rescheduling/new-price/pending/refund copy/design decisions are explicit. Canonical reference/candidate/diff uses locked viewport matrix; separate Windows/device evidence. No live money/provider/refund execution authorized here.
This handoff adds lane-local proposal documentation only; no product code, migration/provider/browser/DB/broker operation or owned running handles. Root diagnostic commands/results are recorded in [CHECKPOINT.md](CHECKPOINT.md). Missing verified BASE_W04 blocks W04 implementation; accepted provider inputs and reviewed publication before verified BASE_W05 block W05. Next action is B/C/D/E/product reconciliation, not declaring contracts frozen or beginning another wave.
