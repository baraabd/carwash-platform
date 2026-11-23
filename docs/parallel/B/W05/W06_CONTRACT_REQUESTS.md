# W05-B — W06 confirmed postings, internal Wallet and Subscription handoff

Status: **PROPOSED_NOT_ACCEPTED / NO IMPLEMENTATION / TESTS UNEXECUTED**. Request `w05-b-w06-posting-wallet-entitlement/0.1.0`; candidate V1/new-major labels below are review inputs, not accepted contracts, npm versions or permission to start W06. This packet is the current W05-B finance task's narrow next-wave handoff; it does not alter the separate A draft or move W07 privacy fulfillment into W06.

## 1. Immutable observed source, owners and predecessor gaps

Pinned observed main `3ce756cd39a9b0c1013043cee0ca1bb183466da7`, tree `cc3517ec85525c7310fe340397506ef6be3fe0a9`, fresh observed-source worktree `carwash-w05b-source`. Current task expiry overrides stale conditional bootstrap metadata; missing accepted base independently blocks product writes.

- `architecture/parallel-contract-release.json`: BASE_W02=null, acceptedNextWaveContracts=[], no accepted BASE_W05/BASE_W06/release source/package publication. Contracts/event-contracts remain0.0.2, api-clients0.0.1 exports empty; HTTP exports Identity/Gateway only, strict booking.confirmed.v1 contract-only and foundation probe event. Billing/Wallet/Subscription schemas remain ServiceMarker-only; their BUSINESS_READY flags are false.
- F001 catalog/ADR: Billing alone owns verification, immutable receipts/refunds and balanced journal; Wallet posting-backed internal movements/balances/holds, never second ledger; Subscription owned customer plan/entitlement; C Booking durable orchestration, Scheduling capacity, Dispatch/Work current authority; D safe projections/notifications/scoped review/support/policy; E auth/Gateway/shared publication. App or Reporting state never authorizes financial/entitlement mutations.
- Approved choices remain cash/ShamCash/Syriatel Cash. Wallet is not checkout/funding/withdrawal, payroll, provider marketplace or a fourth method. Exact internal holder/purpose remains B-07/B-08; customer plan/activation/units/expiry/cancel/refund B-09. No automatic renewal debit or capacity booking.

Source reconciliation, all **unaccepted**:

| Pointer under docs/parallel                                                                  | Required W06 delta                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `B/W04/W05_CONTRACT_PACKET.md:148` and §§transitions/events/eligibility                      | Independently proved final merchant credit survives unmatched amount/currency/reference/Booking; separate allocation/receipt/posting/refund outcomes; proof/review/navigation never makes money or Work eligibility |
| `B/W01/FUTURE_FINANCE_CONTRACTS.md:38–41`; `future-finance-contracts.schema.json:336–458`    | Closed Wallet reserve/resolve and Subscription reserve/resolve exist only as reservations. Credit/capture/activation/reversal have no existing accepted schemas; request explicit additions                         |
| `B/W01/OWNERSHIP_AND_STATES.md`; `B/W04/CASH_JOURNEY_AND_DURABILITY.md` §§allocation/custody | Billing journal immutability/balance, posting-linked custody/residual amounts; one cash receipt/handover/settlement is not three revenues                                                                           |
| `C/W04/W05_CONTRACT_REQUESTS.md`                                                             | Current Booking/Work/capacity/assignment fences and independent compensation; late money cannot revive expired/canceled resources                                                                                   |
| `D/W04/W05_CONTRACT_REQUESTS.md` §§read/event/delivery                                       | Closed pending/review/refund/correction states, safe source/checkpoint vectors and scoped recipients; projection or notification is not authority                                                                   |
| `E/W04/W05_CONTRACT_REQUESTS.md`; `E/W03/TOPOLOGY_AND_W04_REQUESTS.md`                       | Shared schema/money/revision/method/grant/error/route compatibility and real durable business topology precede activation                                                                                           |

Provider dossiers remain documentation/access pending in repository evidence; no new provider protocol, sandbox, exchange rate, endpoint/signature/finality capability is asserted. Required W05 external evidence and W04 cash acceptance are predecessor blockers, not supplied by this handoff. B-02/03/05/06/07/08/09/11/14/15 remain explicit applicable inputs.

## 2. Candidate closed common profile and authority

All objects reject unknown properties/majors/enums after reviewed publication. Fields below are required unless `?` or `null` is explicit; numeric limits/closed policy codes and cross-field guards must be published together. Candidate scalar choices do not settle B opaque revisions versus C/D integers.

```ts
type UUID = string; // canonical UUIDv4 candidate, compatible with current ingress
type UTC = string; // exact valid YYYY-MM-DDTHH:mm:ss.sssZ; authoritative server instant
type Revision = number; // positive safe entity/aggregate integer candidate; no opaque coercion
type OpaqueVersion = string; // bounded immutable publication/policy token where owner requires it
type Owner =
  | 'billing'
  | 'wallet'
  | 'subscription'
  | 'booking'
  | 'scheduling'
  | 'dispatch'
  | 'workforce'
  | 'identity';
type Ref<O extends Owner> = { owner: O; id: UUID; revision: Revision };
type PolicyRef = { id: UUID; revision: OpaqueVersion; contentHash: string };
type Money = { amountMinor: string; currency: string; currencyPolicyRevision: OpaqueVersion };
type MoneyFacts = { money: Money; minorUnitExponent: number; policyRef: PolicyRef };
type BeneficiaryRef = { contextId: UUID; revision: Revision };
type OperationV1 = {
  schemaVersion: 1;
  operationId: UUID;
  owner: 'billing' | 'wallet' | 'subscription';
  state: 'PENDING' | 'SUCCEEDED' | 'REJECTED' | 'RECONCILIATION_REQUIRED';
  resourceRefs: Ref<Owner>[];
  reasonCode: string | null;
  evaluatedAt: UTC;
};
type QualityV1 = {
  asOf: UTC | null;
  sourceRefs: Ref<Owner>[];
  state: 'CURRENT' | 'STALE' | 'PARTIAL' | 'UNAVAILABLE';
};
```

Exact canonical nonnegative integer-minor strings, no leading zero except0, float/sign/exponent/mixed-currency arithmetic. Mutation amounts/hold units positive; zero meaningful only for actual owner read facts. Currency/exponent/bounds/rounding/accounting classification come from accepted immutable policy, never SYP/SAR sample defaults. UTC commit versus provider/capture observation times distinct; appointments/local day use approved Asia/Damascus display, no client clock decision or expiry extension.

- Server binds initiating member/guest/admin/service, beneficiary, collector, holder and independent receiver separately. Every provider validates audience/delegation/current Identity/session/grant and its own resource/purpose/market relationships; caller IDs/actor headers, phone or admin creator grant no ownership. Guest provider/recovery/claim must be E/A/C accepted predecessor; no cross-guest credit/receipt/plan transfer by phone match.
- New submit/reconcile/posting-read/wallet-credit/reserve/resolve/subscription-activate/reserve/resolve/correct grants need exact E-reviewed audiences and object scope. C Booking service may request scoped transitions, never arbitrary balances/journal lines. Operator assignment grants no merchant verification/refund or treasury approval; customer cannot fund, capture, approve or see team balances. Maker/checker thresholds and roles remain approved inputs. Cookie commands require exact Origin/CSRF.

## 3. W06-B-01 — Confirmed Billing facts, allocation and posting queries

```ts
interface ReceivedCreditV1 {
  schemaVersion: 1;
  creditRef: Ref<'billing'>;
  verificationRef: Ref<'billing'>;
  merchantAuthorityRef: Ref<'billing'>;
  received: MoneyFacts;
  providerOccurredAt: UTC;
  recordedAt: UTC;
  allocationState: 'UNALLOCATED' | 'PARTIAL' | 'MATCHED' | 'MISMATCH' | 'DISPUTED';
  allocationRefs: Ref<'billing'>[];
  recognition: 'CLASSIFICATION_PENDING' | 'POSTED';
  postingRefs: Ref<'billing'>[];
}
interface AllocationV1 {
  schemaVersion: 1;
  allocationRef: Ref<'billing'>;
  creditRef: Ref<'billing'>;
  obligationRef: Ref<'billing'>;
  beneficiaryRef: BeneficiaryRef;
  allocated: MoneyFacts;
  state: 'PENDING' | 'CONFIRMED' | 'DISPUTED' | 'REVERSED';
  postingRefs: Ref<'billing'>[];
  policyRef: PolicyRef;
}
interface ConfirmedPostingV1 {
  schemaVersion: 1;
  postingRef: Ref<'billing'>;
  journalRef: Ref<'billing'>;
  sourceRef: Ref<'billing'>;
  sourceKind:
    | 'RECEIVED_CREDIT'
    | 'ALLOCATION'
    | 'REFUND'
    | 'CASH_RECEIPT'
    | 'CUSTODY_TRANSFER'
    | 'HOLD_CAPTURE'
    | 'ENTITLEMENT_FINANCE'
    | 'CORRECTION';
  amount: MoneyFacts;
  relatedCreditRef: Ref<'billing'> | null;
  allocationRef: Ref<'billing'> | null;
  reversesPostingRef: Ref<'billing'> | null;
  policyRef: PolicyRef;
  postedAt: UTC;
}
interface ConfirmedJournalV1 {
  schemaVersion: 1;
  journalRef: Ref<'billing'>;
  businessEffectId: UUID;
  lines: { lineId: UUID; accountRef: Ref<'billing'>; side: 'DEBIT' | 'CREDIT'; money: Money }[];
  reversesJournalRef: Ref<'billing'> | null;
  policyRef: PolicyRef;
  committedAt: UTC;
}
```

Candidate `billing.confirmed-posting.read.v1`, `billing.credit-allocation.read.v1`, scoped journal/history/status/catch-up reads; no consumer command to author arbitrary Billing entries. POSTED/CONFIRMED require actual immutable journal/posting refs and approved matching; journal has nonempty approved-account lines balanced per currency, unique source business effect. Classification of unallocated genuine credit remains approved accounting input; no suspense account invented. CLASSIFICATION_PENDING may have no posting refs yet, but never deletes established received-credit evidence.

- `(provider,approved recipient merchant,external transaction ID)` identifies one verified credit; signature/finality/wrong merchant may prevent establishment, unlike a mismatch after genuine receipt. Allocation has separate uniqueness and limits; no double obligation allocation or split unless explicitly approved. Unallocated/disputed credit is not paid, available Wallet funds, Subscription activation or Work eligibility. No inferred outstanding0 or automatic funding.
- Linked immutable correction/reversal journals preserve original receipt/credit/allocation. Confirmed refund + active reserved/in-flight/UNKNOWN refunds cannot exceed approved refundable cap; timeout never frees allowance. Wallet/Subscription consume only eligible posting/allocation mappings under current policy; Accounting/Booking—not projection event arrival—decide disposition.

## 4. W06-B-02 — Wallet credit, approved internal holders and holds/capture

```ts
interface ApprovedHolderV1 {
  schemaVersion: 1;
  holderRef: Ref<'wallet'>;
  kind: 'APPROVED_TECHNICIAN' | 'APPROVED_TEAM' | 'APPROVED_TREASURY';
  authorityRef: Ref<'identity' | 'workforce'>;
  purposePolicyRef: PolicyRef;
  state: 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
}
interface WalletCreditV1 {
  schemaVersion: 1;
  creditBusinessId: UUID;
  holderRef: Ref<'wallet'>;
  expectedWalletRevision: Revision;
  confirmedPostingRef: Ref<'billing'>;
  allocationRef: Ref<'billing'> | null;
  purposePolicyRef: PolicyRef;
}
interface WalletHoldReserveV1 {
  schemaVersion: 1;
  balanceHolderId: UUID;
  purposePolicyRevision: OpaqueVersion;
  bookingId: UUID;
  expectedRevision: Revision;
  money: Money;
} // unchanged closed W01 draft fields
interface WalletHoldResolveV1 {
  schemaVersion: 1;
  holdId: UUID;
  expectedRevision: Revision;
  action: 'CONSUME' | 'RELEASE';
  billingPostingIds: UUID[];
} // nonempty unique for BOTH actions
interface BillingHoldCaptureV1 {
  schemaVersion: 1;
  captureBusinessId: UUID;
  holdRef: Ref<'wallet'>;
  captureAuthorityRef: Ref<'wallet'>;
  expectedHoldRevision: Revision;
  expectedFinancialRevision: Revision;
  bookingRef: Ref<'booking'>;
  purposePolicyRef: PolicyRef;
  requested: Money;
  authorizationRef: Ref<'booking'>;
}
interface WalletCaptureAuthorityV1 {
  schemaVersion: 1;
  authorityRef: Ref<'wallet'>;
  captureBusinessId: UUID;
  holdRef: Ref<'wallet'>;
  bookingRef: Ref<'booking'>;
  bound: MoneyFacts;
  policyRef: PolicyRef;
  state: 'CLAIMED' | 'CONSUMED' | 'RELEASED' | 'RECONCILIATION_REQUIRED';
  billingOperationRef: Ref<'billing'> | null;
  operation: OperationV1;
}
interface WalletHoldViewV1 {
  schemaVersion: 1;
  holdRef: Ref<'wallet'>;
  holderRef: Ref<'wallet'>;
  bookingRef: Ref<'booking'>;
  purposePolicyRef: PolicyRef;
  held: MoneyFacts;
  state:
    | 'HELD'
    | 'CAPTURE_PENDING'
    | 'PARTIALLY_CAPTURED'
    | 'CAPTURED'
    | 'RELEASE_PENDING'
    | 'RELEASED'
    | 'DISPUTED'
    | 'RECONCILIATION_REQUIRED';
  captured: MoneyFacts | null;
  released: MoneyFacts | null;
  billingPostingRefs: Ref<'billing'>[];
  expiresAt: UTC | null;
  operation: OperationV1;
  quality: QualityV1;
}
interface WalletSnapshotV1 {
  schemaVersion: 1;
  holder: ApprovedHolderV1;
  purposePolicyRef: PolicyRef;
  posted: MoneyFacts | null;
  held: MoneyFacts | null;
  available: MoneyFacts | null;
  movementRefs: Ref<'wallet'>[];
  postingRefs: Ref<'billing'>[];
  quality: QualityV1;
}
```

New `wallet.credit-apply.v1` is an explicit delta request, not existing API or arbitrary money argument. Wallet fetches actual confirmed eligible Billing posting, current holder-purpose mapping and any required matched allocation; one approved `(posting,holder,purpose,effect)` applies once under accepted partition policy. Credit maps existing journal value, no new income/second ledger. B-07/B-08 approve actual holders, authority refs, classifications/availability equation/residual partitions and closed purpose codes; enumerating holder kinds is not provisioning/approval.

- Reserve against owner-local reconciled available partition and current revision; no double use across holds, custody allocations or handovers. Stale/missing/gapped posting source refuses dependent writes; unavailable balance=null, not0 or settled. Purpose-specific W04 custody holds do not authorize general/customer Wallet holds.
- “Capture” needs one accepted semantic mapping: propose W01 `CONSUME` only after independently authorized B confirmed capture/posting effect, then close Wallet movement once; if semantics differ publish a new contract. Partial capture/release/expiry/prior correction, fee treatment and availability impact are B policy decisions; enum presence grants nothing. Expiry worker cannot consume/release raced captured hold or renew original expiry through replay.
- **Closed-V1 trap:** existing `wallet.hold-resolve.v1` requires nonempty unique Billing posting IDs for RELEASE too. Preserve it; do not omit refs, send [] or manufacture a journal solely to satisfy parser. If approved no-financial-effect release needs no posting, request E/B action-discriminated new schema/major or separate release contract with real current release-authority/operation/policy refs, explicitly preserving old readers. The no-posting path stays blocked until that decision is accepted.
- New `billing.hold-capture.v1` is a reviewed internal effect-provider request using BillingHoldCaptureV1; requested Money is a consistency assertion against current approved hold/source allocation/policy, not authority or a new checkout charge. Billing owns capture/correction/refund journals; Wallet current hold binding is a narrow authority provider, then Billing produces actual effect, then Wallet resolves against it. Failure after Billing commit leaves pending/reconciliation, not lost journal or optimistic available balance. Post-capture correction/reversal is linked new effect, never reopening/releasing consumed money by deleting hold. Custody reconciliation remains distinct from customer refunded/paid facts.
- Request a narrow durable `wallet.capture-authority.v1` provider before Billing capture. It atomically claims the current hold for one captureBusinessId/Booking/exact amount/policy and binds the authorized Billing operation; expected revisions or a cached hold read alone cannot close the expiry/release race. Billing validates that command-bound authority under the accepted execution protocol. Wallet cannot expire/release the claimed partition while the corresponding Billing effect is pending/UNKNOWN; reconcile the same operation before closing authority or restoring availability. Authority release, financial confirmation and final hold resolution are distinct facts. E/B must publish current authorization/commit fences, revocation/deadlines and crash/lookup semantics; no lease duration or distributed transaction is invented.

## 5. W06-B-03 — Subscription activation, entitlement reserve/consume/release/reversal

```ts
interface SubscriptionActivateV1 {
  schemaVersion: 1;
  activationBusinessId: UUID;
  subscriptionIntentRef: Ref<'subscription'>;
  expectedRevision: Revision;
  beneficiaryRef: BeneficiaryRef;
  planPolicyRef: PolicyRef;
  eligibleAllocationRef: Ref<'billing'>;
  confirmedPostingRefs: Ref<'billing'>[];
}
interface EntitlementReserveV1 {
  schemaVersion: 1;
  subscriptionId: UUID;
  bookingId: UUID;
  expectedRevision: Revision;
  units: number;
} // positive bounded integer; closed W01 request
interface EntitlementResolveV1 {
  schemaVersion: 1;
  reservationId: UUID;
  expectedRevision: Revision;
  action: 'CONSUME' | 'RELEASE';
  bookingId: UUID;
  policyRevision: OpaqueVersion;
} // closed W01 request
interface SubscriptionCorrectionV1 {
  schemaVersion: 1;
  correctionBusinessId: UUID;
  subscriptionRef: Ref<'subscription'>;
  expectedRevision: Revision;
  originalActivationRef: Ref<'subscription'>;
  originalEffectRefs: Ref<'subscription'>[];
  billingReversalRefs: Ref<'billing'>[];
  compensationRef: Ref<'booking'> | null;
  policyRef: PolicyRef;
  reasonCode: string;
}
interface EntitlementReservationV1 {
  schemaVersion: 1;
  reservationRef: Ref<'subscription'>;
  subscriptionRef: Ref<'subscription'>;
  bookingRef: Ref<'booking'>;
  units: number;
  state:
    | 'RESERVED'
    | 'CONSUME_PENDING'
    | 'CONSUMED'
    | 'RELEASE_PENDING'
    | 'RELEASED'
    | 'CORRECTION_PENDING'
    | 'RECONCILIATION_REQUIRED';
  effectRefs: Ref<'subscription'>[];
  operation: OperationV1;
}
interface SubscriptionViewV1 {
  schemaVersion: 1;
  subscriptionRef: Ref<'subscription'>;
  beneficiaryRef: BeneficiaryRef;
  planPolicyRef: PolicyRef;
  activationRef: Ref<'subscription'> | null;
  state:
    | 'PENDING_ACTIVATION'
    | 'ACTIVE'
    | 'SUSPENDED'
    | 'EXPIRED'
    | 'CANCELLED'
    | 'RECONCILIATION_REQUIRED';
  units: { available: number; reserved: number; consumed: number } | null;
  effectiveAt: UTC | null;
  expiresAt: UTC | null;
  allocationRefs: Ref<'billing'>[];
  postingRefs: Ref<'billing'>[];
  correctionRefs: Ref<'subscription'>[];
  quality: QualityV1;
}
interface EntitlementCorrectionViewV1 {
  schemaVersion: 1;
  correctionRef: Ref<'subscription'>;
  originalEffectRefs: Ref<'subscription'>[];
  state: 'PENDING_REVIEW' | 'APPLIED' | 'REJECTED' | 'RECONCILIATION_REQUIRED';
  restoredUnits: number | null;
  removedUnits: number | null;
  billingReversalRefs: Ref<'billing'>[];
  policyRef: PolicyRef;
  operation: OperationV1;
}
```

Activation/reversal/correction are **new** `subscription.activate.v1` / `subscription.effect-reverse.v1` review requests, absent from old future-finance schemas. Narrow real plan/intent binding must precede Billing allocation consumers; immutable actual approved plan/price/unit/expiry policy plus eligible matched confirmed posting—not proof, review navigation or unallocated merchant credit—authorizes one activation. Effective/expiry derived server-side; no invented Basic/Premium/Fleet parameters or new customer screen from illustrative admin inventory.

- Entitlement units are positive bounded integers on reserve and nonnegative exact owner counts on views. Current owned active plan/expiry and SQL constraints atomically protect final units under concurrent bookings; reserve is not consume/payment/capacity. C and B must freeze actual consume trigger, cancellation/no-show/completed-work/renewal/freeze/proration/partial refund policy; no guessed proportional unit restoration.
- Consume/release binds same Booking/reservation/current revisions/policy and actual approved operational prerequisite. Duplicate/stale release cannot resurrect consumed units; unknown outcome keeps owner pending and queries same operation. Rebook/renewal does not automatically reserve slot or debit funds; new capacity/quote/customer confirmation remains C/A's approved path.
- Refund/dispute/financial reversal and entitlement adjustment are separate accepted outcomes. Correction appends immutable linked effect and approved restored/removed units; existing consumption/service history stays auditable. Active reservations/expired benefits/partially used plans need exact B/C treatment; pending/UNKNOWN refund cannot restore entitlement optimistically. APPLIED correction requires actual non-null derived counts/current audit/effect; unavailable views use units=null, never fabricated zero/full allowance.

## 6. W06-B-04 — Sequencing, reconciliation reads and source corrections

```ts
interface FinanceQueryV1 {
  schemaVersion: 1;
  kind:
    | 'CREDIT'
    | 'ALLOCATION'
    | 'POSTING'
    | 'WALLET'
    | 'HOLD'
    | 'SUBSCRIPTION'
    | 'ENTITLEMENT'
    | 'CORRECTION'
    | 'OPERATION';
  resourceId: UUID;
  knownRevision: Revision | null;
  fieldset: 'BENEFICIARY' | 'ASSIGNED_OPERATOR' | 'SCOPED_FINANCE';
  purposeCode: string;
  cursor: string | null;
  limit: number;
}
interface ReconciliationViewV1 {
  schemaVersion: 1;
  operation: OperationV1;
  sourceRefs: Ref<Owner>[];
  checkpointVector: { owner: Owner; aggregateId: UUID; revision: Revision }[];
  missingRefs: Ref<Owner>[];
  discrepancyRef: Ref<'billing' | 'wallet' | 'subscription'> | null;
  state: 'CURRENT' | 'WAITING_SOURCE' | 'GAP' | 'DISPUTED' | 'REPAIR_PENDING' | 'UNKNOWN';
  quality: QualityV1;
}
type FinanceOutcome =
  | 'CREDIT_RECORDED'
  | 'ALLOCATION_CONFIRMED'
  | 'POSTING_CONFIRMED'
  | 'CREDIT_APPLIED'
  | 'HOLD_RESERVED'
  | 'HOLD_CONSUMED'
  | 'HOLD_RELEASED'
  | 'ACTIVATED'
  | 'ENTITLEMENT_RESERVED'
  | 'ENTITLEMENT_CONSUMED'
  | 'ENTITLEMENT_RELEASED'
  | 'CORRECTION_APPLIED'
  | 'PENDING'
  | 'REJECTED'
  | 'RECONCILIATION_REQUIRED';
interface FinanceEventDataV1 {
  operationId: UUID;
  resourceRef: Ref<'billing' | 'wallet' | 'subscription'>;
  sourceRefs: Ref<Owner>[];
  policyRef: PolicyRef;
  outcome: FinanceOutcome;
  committedAt: UTC;
}
```

Every concrete query/event closes bounded limits, its subset of the candidate FinanceOutcome enum, exact owner/family discriminants and required/null guards in E exports before publication; invalid owner/outcome/reference combinations are rejected, not an open success state. Owner snapshot/history/operation reads recheck current object/purpose; fieldset requested by caller cannot widen grant. Unallocated-credit merchant reconciliation is scoped B finance access, not another customer's receipt lookup; journal/account/external evidence details excluded from customer/operator fieldsets.

- Candidate events: `billing.confirmed-posting.v1`, received-credit/allocation/correction; `wallet.credit-applied.v1`, hold-reserved/consumed/released/corrected; Subscription activated/entitlement reserved/consumed/released/reversed. Exact names remain review requests; catalog `billing.payment-confirmed.v1` versus future `billing.payment-verified.v1` requires explicit accepted mapping/version. Old closed payment-verified payload only policyRevision/paymentId/obligationId/postingId cannot silently receive richer refs.
- Proposed financial variant adds credit/allocation/receipt/posting/original-reversal refs and exact Money only to authorized consumer fieldsets; Wallet variant holder/purpose/hold/movement/actual Billing refs; Subscription variant owned subscription/activation/reservation/effect/Booking refs and exact units. Reference-only private events omit proof/hints/account secrets/contact/location/full external transaction identifiers. Stable existing envelope/eventId/producer/UTC/correlation/aggregateVersion remains; no widening strict booking.confirmed.v1.
- Each owner transaction commits effect/operation receipt/audit/outbox; Inbox/original-byte hash/owned effect/checkpoint commits before ACK. Same event/bytes no effect; changed bytes integrity quarantine, old revisions never regress, gap/missing/reversal-before-credit remains WAITING_SOURCE/REPAIR_PENDING via authorized retained source reads. No global cross-service ordering or exactly-once network claim.
- Billing confirmed posting precedes eligibility-dependent Wallet credit/Subscription activation; source causal refs prove it, arrival order does not. Correction/refund feeds preserve original journals; Wallet/Subscription reconcile their accepted mappings once. D rebuild never collects/refunds/activates/restores units/resends messages; source owner audit is authority. Replay cannot resurrect expired capacity, confirmed cancellation or erased/redacted presentation.

## 7. Idempotency, lifetimes, deadlines and app state mapping

- Candidate ingress key `[A-Za-z0-9_-]{16,128}`. E freezes owning service+contract major+current initiating actor/delegation+operation+business target scope. Canonical fingerprint binds beneficiary/internal holder/purpose, expected refs/revisions, approved Money/units/policy, source posting/allocation, plan, correction/original effect/compensation and meaningful capture time; array order/set/duplicates explicit. Exclude secrets/signed URLs/trace/request IDs. Same key/meaning replays original outcome/refs/expiry after current authorization; changed meaning409; concurrent pending returns same accepted operation.
- Unique posting business effects, `(sourcePosting,holder,purpose,effect)`, activation business identity and Booking/reservation/entitlement effect dedup survive replay-cache cleanup. Old key expiry cannot authorize duplicate financial value. Replay/tombstone, financial audit/evidence retention, hold/benefit/grant lifetimes, command/query/skew/retry/exhaustion budgets remain named B/E/product inputs; adopt no foundation/default numbers.
- Timeout/5xx/disconnection after command is UNKNOWN. Persist step identity before call, then same-key/exact-body or current-authorized operation/provider lookup; no new credit/capture/refund/activation identity, optimistic allowance/unit release or new payment prompt. Distinct durable compensation keys/fences/receipt refs survive restart. Partial source/owner outcomes remain visible; only owners repair their effects, no peer DB rollback.
- Proposed safe errors400 request/unknown field;401 expired/revoked;403 scope/CSRF;404 concealed object;409 revision/key/source identity;422 policy/state/amount/currency/eligibility;429 throttle;503 unsupported/unavailable policy/source;504 deadline/UNKNOWN. Publish closed reason/recovery enums (`SAME_OPERATION`, `SOURCE_REFRESH`, `OWNER_REVIEW`, `NONE`) and safe operation refs, no provider exceptions/PII. Current Gateway lacks Wallet/Subscription owners, bounded query/precondition/conditional/stream adapters; E must publish exact routing/auth/error/client changes, not assume present ingress works.

Mappings below require A/C/D/product approval of exact production copy; **requested, not already approved**:

| Owner facts                                                        | Customer A                                                 | Operator C                                                   | Admin D                                                                      |
| ------------------------------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Intent/proof/review pending, no verified matching allocation       | Pending/review, never paid/benefit-active                  | No inferred financial prerequisite                           | Separate review/provider UNKNOWN and current recovery owner                  |
| Genuine merchant credit unallocated/mismatch                       | Only owned safe review/disposition; no paid/outstanding0   | No inferred Work/Wallet entitlement                          | Received-credit truth and allocation discrepancy separately, no erase        |
| Matched verified allocation/posting, internal custody unsettled    | Receipt/paid fact, no treasury claim                       | Assigned-work facts and approved holder pending custody      | Original journal plus separate holder/handover/settlement, no triple revenue |
| Wallet hold/capture or activation pending/UNKNOWN                  | Only approved own benefit facts; never new balance method  | Scoped internal hold/recovery, no optimistic available value | Posting-linked pending source/operation/discrepancy                          |
| Refund reserved/in-flight/UNKNOWN; Subscription adjustment pending | Refund/benefit pending, original receipt retained          | Work completion retained; no unit/cash reset                 | Reserved allowance and separate correction refs, no refunded success         |
| Independent confirmed refund and applied entitlement correction    | Exact confirmed refunded amount/approved benefit outcome   | Accepted current phase unaffected by UI assumption           | Immutable reversal/correction and residual/partial effects                   |
| Late money after expired/canceled Booking or unavailable source    | Honest compensation/unknown state, no restored appointment | No automatic Work restart                                    | Verified financial truth + C expired resources/recovery plan                 |

## 8. Proposed W06 provider/consumer gates and E release requests

Every case is **UNEXECUTED**, not a claimed passing fixture or provider acceptance:

| ID                           | Required actual proof                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| W06-B-G01 CREDIT-ALLOCATION  | Genuine final merchant receipt versus unmatched amount/currency/ref/unknown Booking; immutable credit retained, no auto allocation/funding/activation; wrong merchant/unproven finality denied; duplicate/split-policy limit                                                                                                                                                                                                   |
| W06-B-G02 POSTING-CORRECTION | Real balanced-per-currency journal/unique business effect; original/reversal immutable; concurrent partial refund caps/UNKNOWN allowance; wrong-policy/ref/role denied; restart/outbox receipt atomicity                                                                                                                                                                                                                       |
| W06-B-G03 WALLET-CREDIT      | Approved internal holders/purposes/current grants; one referenced eligible posting applies once; stale/gap/unallocated source refuses; no cross-holder/guest leak, second ledger/fourth method/payroll                                                                                                                                                                                                                         |
| W06-B-G04 HOLD-CAPTURE       | Concurrent final available partition, hold versus handover, atomic capture-authority claim before Billing effect; lost reply/restart then expiry/release while Billing UNKNOWN keeps claimed partition unavailable until same-operation reconciliation; capture/correction race and actual posting prerequisite; V1 release requires nonempty refs and no invented posting; new no-posting release only if separately accepted |
| W06-B-G05 ACTIVATION         | Real approved plan/intent/beneficiary and eligible allocation; two guest/member isolation, unique activation, proof/unallocated/pending/late canceled resource cannot activate or book/debit automatically                                                                                                                                                                                                                     |
| W06-B-G06 ENTITLEMENT        | Last-unit reserve race; current expiry/plan/revocation, correct consume trigger, release after consume rejected, cancel/reschedule/refund/partial-plan correction, immutable consumed history and no optimistic restored units                                                                                                                                                                                                 |
| W06-B-G07 DELIVERY-REPAIR    | Duplicate/hash conflict/old/gap/refund-before-credit events, missing refs, crash around commit/publish/ACK, source lookup/checkpoints and D rebuild no external effects; queue/binding/ACL activation conformance                                                                                                                                                                                                              |
| W06-B-G08 THREE-APP          | Real A/C/D owned pending/review/receipt/custody/refund/benefit outcomes across reload/disconnect/deep link; current-authority source assertions and approved visuals/RTL/focus/reduced motion; no fixture closure of integration                                                                                                                                                                                               |

Sequence: E accepted predecessor auth/contracts/policies/resources + business topology → B immutable confirmed-posting/eligible allocation provider → narrow real Wallet hold/capture-authority claim and Subscription plan/intent bindings → B Wallet credit and Billing capture effects/Subscription activation/reserve/resolve/correction providers → C Booking reserve/consume/compensate against merged producers → A/C/D consumers with complete affected actual journeys before merge. Split capture/financial or plan/activation cycles into binding→financial facts→final consumer, not mutually dependent indivisible PRs. Parent remains INTEGRATION_PENDING until combined gates pass.
E publishes exact closed contracts/event-contracts/API clients/parsers/version matrix, OpenAPI/AsyncAPI, Money/revision/method adapters, internal/public routes and current grants/delegation, broker producer/subscriber topology/ACL/DLQ/catch-up, accepted run ports/DB roles/queue/object/browser/evidence names and impact/mandatory CI scripts. B requests shared dependencies/schema/migration privileges only; no reserved-file edits/private DTO imports/peer DB access. Actual owned DB migration/upgrade/HTTP/Identity/constraint/restart and broker evidence are distinct from provider external evidence and browser proof.
B's existing privacy-fulfillment family is reserved for W07. A's separate #61 request for W06 per-owner fulfillment creates an explicit scheduling/schema dependency for A/B/D/E review: publish any accepted reprioritization and action/outcome mapping before that consumer work, rather than silently defer required scope. This B task implements neither wave's privacy fulfillment; W06 preserves object auth/private evidence/redaction/retention prerequisites and immutable posted history without adding export/delete/anonymize endpoints. No provider secrets, real merchant details or invented legal/provider deadlines. Proposal handoff: B documentation/specifications only, no product/shared source, business test/DB/broker/provider/money operation or owned runtime handles. Actual local diagnostics/submission are in [CHECKPOINT.md](CHECKPOINT.md). Next action is B/C/D/E owner-policy review and accepted compatible release before verified BASE_W06; source proposals do not freeze contracts or close current W05 acceptance.
