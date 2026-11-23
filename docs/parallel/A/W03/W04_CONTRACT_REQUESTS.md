# W03-A — Proposed W04 customer order/read/update/cash/media/cancellation contracts

Status: **PROPOSAL_ONLY / NOT ACCEPTED / NOT IMPLEMENTED / TESTS UNEXECUTED**. Proposal identifier `w03-a-w04-customer-operations/0.1.0`; candidate wire majors below are `V1`, not published npm versions. This is one wave ahead of W03: it requests post-confirmation customer operational reads and their producer/consumer proofs. It does not repeat or implement the already-merged A/W02 W03 quote/slot/confirmation packet.

## 1. Source truth and reconciliation boundary

Observed source: `main@82e7402ed9ab6cc4f565f423441cd0655f2d627a`, tree `050b4b8a03be2bc671cbaa00151ea7105891e2d4`. Source documents inspected include the new W03-A task, A/B/C/D W02 packets, E release registry, service schemas, current customer routes/handoff and approved references. A merged proposal is not an accepted API, common base or provider.

- `architecture/parallel-contract-release.json` still records `BASE_W02:null`, no accepted next-wave business release and no accepted guest contract. There is no published verified `BASE_W03`. Current packages remain `@carwash/contracts@0.0.2`, `@carwash/event-contracts@0.0.2`, `@carwash/api-clients@0.0.1`; the client package still exports an empty module. HTTP registry contains Identity V1 foundation and Gateway V1 routing; events are foundation probe plus contract-only strict `booking.confirmed.v1`.
- PR46 A/W02 is merged into this observed source. The older E intake entry marking A requested/not-received is stale intake metadata, not proof that PR46 is absent, and merge still does not publish accepted contracts or BASE_W03. Old wave lease metadata is not reused as current-wave authority; current task expiry and E allocation must be applied.
- Present ingress is a concrete W04 dependency: `apps/api-gateway/src/domain/policy.ts::routeMatch` rejects every URL containing `?`; `gateway.service.ts::verifiedHeaders` forwards no conditional version/ETag headers, and upstream statuses >=300 (including304) are mapped to faults. `infrastructure/http-client.ts` buffers bounded JSON until completion under one timeout, while the controller returns JSON with only approved cookies/cache-control, not upstream ETag/stream headers. Query/cursor/filter forwarding, conditional reads/preconditions and SSE/WebSocket are therefore **not supported by present Gateway**. E must accept explicit bounded adapters and tests before candidate lists/updates traverse ingress; Media bytes need separately accepted signed-object fetch/origin policy, not this JSON proxy.
- `apps/customer-web/src/features/orders/index.tsx` renders a `ShellPlaceholder`. Tracking/payment routes render C014 `OrderHandoff`, explicitly a session-only receipt/handoff. `customerSession.ts` uses demo `OrderStage=-1|0|1|2|3|4`; its payment starts `cash_due` or `awaiting_transfer`. No real order list, live technician map, receipt, QR, settlement, cancellation, published review or private completion-media integration follows from C014.
- Current Booking/Billing/Dispatch/Scheduling/Media schemas have `ServiceMarker` only. Communications/Reporting have foundation probe inbox/effects, not product notifications/read models. No real W04 producer evidence is present in these proposal merges.
- F001 catalog/ADR remains ownership authority: Booking owns lifecycle and orchestration; Scheduling capacity; Dispatch assignments; Workforce work eligibility/resources; Billing obligations/financial postings/cash receipt; Wallet approved Billing-backed custody/holds; Media private objects; Communications delivery/conversations; Reporting its projections; Customer/Vehicle/Geo owner data. C's proposed Work execution and active-task location belong to Booking, not a new service or Geo address/tracking database. Gateway/admin/customer UI owns none of those facts.
- Approved customer `washgo-payments-interactive.html::STATUS` has five milestones: request received, technician assigned, on the way, washing, completed; canceled is separate. Approved technician `washgo-technician-interactive.html::PHASES` has six work phases: task, road, before wash, care, after wash, handover. These are reference presentation facts, not accepted server transitions.

Peer reconciliation required before publication:

| Source-visible proposal                          | W04 requirement retained; remaining decision                                                                                                                                                                                                                                                                 |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B/W02 `CONTRACT_DELTA_REQUESTS.md` CR-B-02/03/04 | Immutable line quantity/unit/description/calculation evidence; separate actor/beneficiary; current guest/delegation; current Gateway key syntax. B opaque version refs versus C/D positive integer entity revisions, money exponent/policy fields, key-target scope and TTL/deadline rules remain unresolved |
| B/W02 `W03_CONTRACT_PACKET.md`                   | Pricing validation and Billing obligation remain distinct from payment/journal/cash receipt; replay cannot extend quote validity. W04 reads consume actual future accepted obligation/receipt provider, not recreate money                                                                                   |
| B/W01 `FUTURE_FINANCE_CONTRACTS.md`              | `billing.cash-record.v1`, cash reversal, Wallet custody handover/acceptance and their events are W04 reservations only. Owner independently verifies assigned actor/amount/policy and company acceptance; no live money operation is authorized here                                                         |
| C/W02 `W03_CONTRACT_PROPOSAL.md`                 | Same validated beneficiary context across quote/hold/Booking; administrative actor distinct from beneficiary; separate create-on-behalf command. Customer own reads authorize the beneficiary, not the admin who originally created the booking; actual Work/assignment/cash facts remain independent        |
| C/W02 `PREWORK_REQUEST.md`                       | Media each purpose needs its actual resource-binding authority, scanner/processing and current scoped grants. Work evidence purposes wait for real Work binding; generic clean-file status is insufficient booking/customer access                                                                           |
| D/W02 `W03_CONTRACT_REQUESTS.md` REQ-03          | Typed market/object-scoped Booking lists/details, fieldsets, cursor/generation/freshness and independent financial references. Reporting projections are visibly stale/partial and never authorize source commands; Communications/channel replay is not Reporting global business truth                     |
| C/W01 §7/C-D06 and approved references           | Pending ShamCash technician fixture can close into unpaid follow-up, while customer simulation blocks service before verification. **Work-start/unpaid-closure/collection prerequisites remain an explicit B/C/product policy conflict**, not resolved by storing independent statuses                       |

E chooses accepted schemas, closed fields, routes/grants, clients, revision adapters, retention/deadlines and package semver at the W03→W04 barrier. No C/B/D producer DTO or private implementation is copied into app code by this packet.

## 2. Proposed common profile and permissions

The following is exact candidate vocabulary for review, not exported code. Entity revisions are proposed positive safe integers; immutable Catalog/Pricing publication revisions remain proposed opaque bounded strings. This intentionally preserves their distinct meanings; E must accept typed adapters rather than lossy coercion. Current Identity UUID validator accepts versions1–5; propose UUIDv4 IDs until compatible expansion is accepted.

```ts
type UUID = string; // canonical UUIDv4 candidate
type UTC = string; // exact valid YYYY-MM-DDTHH:mm:ss.sssZ
type EntityRevision = number; // safe integer >= 1
type OpaqueVersion = string; // canonical nonempty bounded owner version
interface EntityRefV1 {
  id: UUID;
  revision: EntityRevision;
}
interface PricingRefV1 {
  quoteId: UUID;
  revision: OpaqueVersion;
}
interface PolicyRefV1 {
  configurationId: UUID;
  version: EntityRevision;
  contentHash: string;
}
interface MoneyV1 {
  amountMinor: string;
  currency: string;
  currencyPolicyRevision: OpaqueVersion;
  // canonical nonnegative integer decimal; no number/sign/exponent/fraction,
  // no leading zero except '0'; approved code/policy/bounds; B/W02 vocabulary
}
interface AmountFactsV1 {
  money: MoneyV1;
  minorUnitExponent: number;
  policyRef: PolicyRefV1;
  // exponent integer from approved policy, not a hardcoded SYP/default scale
}
type SourceOwner =
  | 'booking'
  | 'scheduling'
  | 'dispatch'
  | 'workforce'
  | 'billing'
  | 'wallet'
  | 'media'
  | 'configuration';
// Workforce/public-identity and Configuration policy facts use their own
// source refs when included; neither is implied current by Booking revision.
interface SourceFactV1 {
  owner: SourceOwner;
  ref: EntityRefV1 | null;
  asOf: UTC | null;
  quality: 'CURRENT' | 'STALE' | 'UNAVAILABLE' | 'NOT_APPLICABLE';
}
interface ViewQualityV1 {
  evaluatedAt: UTC;
  sources: SourceFactV1[];
}
```

- Customer `customerId`, Identity account/guest subject and Booking beneficiary context are distinct server-bound IDs. Browsers never nominate subject/owner/scope by body/header/query. A name/phone/plate/display `WG-*` code is not ownership. Member/guest credentials, revocation, recovery/claim and lifetime need the real E provider; claiming a guest must not accidentally expose another guest's cached order/media/stream.
- Candidate grants for E review: `bookings.read:self` reused only after owner semantics accepted; purpose-bound `work.progress.read:self`, `billing.receipts.read:self`, `media.service-evidence.read:self`, `bookings.cancellation.read:self`, `communications.order-updates.read:self`. These names are **proposed**, not existing grants. Staff/operator/admin reads use separate current assignment/case/market/object fieldsets, never expanded customer routes or `super-admin` shortcuts.
- Every owner verifies signed accepted credential/delegation, current Identity/session/capability and its own beneficiary/resource relationship. Service identity and delegated user identity are separate; tokens/actor headers/producer strings supplied by the browser are not trusted. Cookie writes require accepted exact Origin/CSRF. Fresh authorization applies to reads, cached receipts, stream resume and Media grants, not only initial login.
- Amounts are Billing/Pricing owner facts with exact exponent/policy; frontend never calculates posted payment/custody/refund truth. Historical service/vehicle/location/price snapshots stay immutable; live states have independent owner revisions. Dates/appointments carry `Asia/Damascus` and UTC instants, cancellation/receipt/expiry use server time. Declared collection time and authoritative server recording time are distinct.
- Proposed closed body/query/error bounds and exact-null rules are finalized with E. New enum/field values cannot silently widen strict accepted V1 parsers. The types above cannot be promoted by copying them into `packages/contracts` or changing only a package version.

## 3. CP-A-W04-01 — Customer order list and detail projections

Authority/provider: C Booking owns own-booking list/detail and immutable snapshots. “Order” is customer terminology for Booking; no new Customer order DB or Gateway-owned projection is requested. B financial, C Dispatch/Work/Media, D notification facts are read through accepted owner interfaces. Gateway may compose bounded safe owner responses; it never runs a business saga.

Candidate routes:

| Operation                                                                 | Candidate request                                                                                        | Candidate response / invariant                                                                                                              |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/customer/bookings` → Booking `GET /internal/v1/booking/mine` | `{bucket:'ACTIVE'\|'PAST',cursor:null\|string,limit:number}`; propose default20/max50, pending E/product | `CustomerOrderPageV1`; derive owner from verified beneficiary, no arbitrary customerId; scope/filter/generation-bound cursor                |
| `GET /api/v1/customer/bookings/:id` → Booking own-detail                  | no ownership claims; optional accepted conditional revision header                                       | `CustomerOrderDetailV1`; concealed404 for missing/not-owned; safe fieldset excludes internal actor/grant/financial-case/crew private data   |
| Existing app `/order/:id`, `/pay/:id`                                     | Booking UUID deep link only after live integration is accepted                                           | Loads accepted owner view; missing/forbidden/unavailable/expired guest are different safe UI states; no session/demo fallback for a real ID |

```ts
type LifecycleV1 =
  | 'PENDING_CONFIRMATION'
  | 'CONFIRMED'
  | 'CANCELLATION_PENDING'
  | 'CANCELLED'
  | 'COMPLETED'
  | 'REJECTED'
  | 'RECOVERY_REQUIRED';
type CustomerMilestoneV1 = 'RECEIVED' | 'ASSIGNED' | 'ON_THE_WAY' | 'CARE_STARTED' | 'COMPLETED';
interface ConfirmedCustomerOrderSummaryV1 {
  schemaVersion: 1;
  bookingRef: EntityRefV1;
  displayCode: string | null;
  lifecycle: Exclude<LifecycleV1, 'PENDING_CONFIRMATION' | 'REJECTED'>;
  latestProvenMilestone: CustomerMilestoneV1 | null;
  appointment: { startsAt: UTC; endsAt: UTC; timezone: 'Asia/Damascus' } | null;
  vehicle: {
    type: 'sedan' | 'suv' | 'large' | 'pickup';
    displayName: string;
    plate: string | null;
  };
  service: { definitionId: string; definitionVersion: OpaqueVersion; labelAr: string };
  price: AmountFactsV1;
  payment: CustomerPaymentFactsV1;
  cancellation: CustomerCancellationViewV1;
  quality: ViewQualityV1;
}
// Candidate confirmed-history branch only. A separate strict pending/rejected
// branch and discriminator must be accepted before such records enter this page.
type CustomerOrderSummaryV1 = ConfirmedCustomerOrderSummaryV1;
interface CustomerOrderPageV1 {
  schemaVersion: 1;
  generation: UUID;
  asOf: UTC;
  bucket: 'ACTIVE' | 'PAST';
  nextCursor: string | null;
  items: CustomerOrderSummaryV1[];
  counts: { active: number; past: number } | null;
  countsQuality: 'CURRENT' | 'STALE' | 'UNAVAILABLE';
}
interface CustomerOrderDetailV1 extends ConfirmedCustomerOrderSummaryV1 {
  snapshotSchemaVersion: 1;
  quoteRef: PricingRefV1;
  immutableSelection: {
    vehicleRef: EntityRefV1 | null;
    addressRef: EntityRefV1 | null;
    vehicle: { type: string; name: string; plate: string | null; color: string | null };
    location: {
      label: string;
      addressText: string;
      accessNote: string;
      geoRevision: EntityRevision;
    };
    contact: { name: string; phone: string; verification: 'UNVERIFIED' };
    lineEvidenceRef: PricingRefV1; // future accepted B immutable quantity/unit/adjustment view
    policyRefs: PolicyRefV1[];
  };
  tracking: CustomerTrackingViewV1;
  cash: CustomerCashFactsV1 | null;
  completion: CustomerCompletionMediaV1;
}
```

Fields requiring semantic guards: totals/exponent/policy consistency; exact service snapshot version; own contact/access note only; missing `price` provider must be explicit unavailable rather than zero or reconstructed fixture amount. Required price fields describe confirmed historical snapshot; a pending/rejected record without that snapshot needs a discriminated pending/rejected schema or excludes itself from this page under accepted policy—E/C must settle, never fabricate it. `counts` optional truth is a single source page/count evaluation, not a client count inferred from one limited page.

The concrete schema above is a confirmed-history candidate; it does not claim a complete successful page for price-less pending/rejected records. The provider must select an explicit accepted inclusion rule or publish their separate discriminated branch before any customer use. ACTIVE/PAST mapping is a **review decision**: propose completed/canceled/rejected terminal work→PAST, pending/confirmed/cancel-pending/recovery→ACTIVE. Completed-but-cash-due can be PAST with visible financial follow-up; unpaid must not hide a completed service. `CANCELLED` does not imply refund complete. Preserve approved current/past tabs and card actions; exact production empty/loading/error/stale/payment-follow-up copy and newly pending states require approval. No global sort/filter/PII search is exposed by this customer list.

List generation/cursor binding and source vector are read consistency facts, not cross-service atomic snapshot claims. Changing generation returns an accepted cursor conflict requiring refresh. Compose failures mark the affected source unavailable; critical auth failure denies the entire read. Refetch may not overwrite newer order/receipt revisions or local unsent draft/edit state.

## 4. CP-A-W04-02 — Tracking, assignment/work facts and versioned updates

Authority/providers: Dispatch current assignment; Booking proposed Work and its execution milestones/active-task location; Workforce current identity/eligibility; D Communications notification transport; E ingress/auth/clients. A renders facts. It cannot progress work with a customer button, animate a demo vehicle as live, infer assignment from confirmation, or treat a phone call/GPS point as a completed phase.

```ts
interface CustomerTrackingViewV1 {
  schemaVersion: 1;
  bookingRef: EntityRefV1;
  assignment: {
    ref: EntityRefV1 | null;
    state: 'UNASSIGNED' | 'ASSIGNED' | 'RELEASED' | 'UNKNOWN';
    assignedAt: UTC | null;
    publicTechnician: { displayName: string } | null;
  };
  work: {
    ref: EntityRefV1 | null;
    phase: 'TASK' | 'ROAD' | 'BEFORE' | 'CARE' | 'AFTER' | 'HANDOVER' | null;
    state: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'STOPPED' | 'UNKNOWN';
    phaseRevision: EntityRevision | null;
    startedAt: UTC | null;
    completedAt: UTC | null;
  };
  latestProvenMilestone: CustomerMilestoneV1 | null;
  timeline: { milestone: CustomerMilestoneV1; occurredAt: UTC; sourceRef: EntityRefV1 }[];
  location: {
    state: 'NOT_REQUESTED' | 'CURRENT' | 'STALE' | 'UNAVAILABLE' | 'WITHHELD';
    coordinates: { longitude: string; latitude: string } | null;
    sampledAt: UTC | null;
    receivedAt: UTC | null;
    expiresAt: UTC | null;
    precisionMeters: number | null;
    policyRef: PolicyRefV1 | null;
  };
  contact: {
    state: 'AVAILABLE' | 'NOT_ASSIGNED' | 'FORBIDDEN' | 'UNAVAILABLE';
    conversationRef: EntityRefV1 | null;
  };
  quality: ViewQualityV1;
}
interface CustomerOrderUpdateV1 {
  schemaVersion: 1;
  updateId: UUID;
  deliveryCursor: string;
  bookingId: UUID;
  sourceOwner: SourceOwner;
  sourceRef: EntityRefV1;
  occurredAt: UTC;
  kind: 'BOOKING' | 'ASSIGNMENT' | 'WORK' | 'PAYMENT' | 'CASH' | 'MEDIA' | 'CANCELLATION';
}
interface CustomerUpdatePageV1 {
  schemaVersion: 1;
  streamGeneration: UUID;
  nextCursor: string;
  state: 'CURRENT' | 'GAP' | 'REBUILDING' | 'UNAVAILABLE';
  items: CustomerOrderUpdateV1[];
}
```

Candidate bounded `GET /api/v1/customer/order-updates?cursor=<opaque>&limit=<bound>` → D Communications authorized notification/update journal. This is a **requested invalidation transport**, not an existing endpoint, accepted SSE/WebSocket protocol or broker access from browser. Present Gateway rejects this query URL and has no conditional/stream forwarding; publish the explicit E adapter before this request can be live. Start with accepted bounded polling + owner refetch if E/D choose it; realtime transport is a separately reviewed adapter with equivalent auth/replay/failure semantics. Stream cursors bind beneficiary+market+session/capability generation/filter, not client owner IDs. Server strips update entries no longer authorized. A revoked/expired guest/session stops delivery and clears owned UI caches; admin stream has separate scope/fieldset, operator stream current assignment only.

Updates contain minimal refs and invalidation kind, no phone/precise location/media URL/quote totals. Client discards old source revisions/duplicate updateId and cancels old-principal requests; reads actual owner detail for new facts. A delivery cursor is D-owned transport position, **not** Booking revision, RabbitMQ delivery tag or global business commit sequence. Gap/expired cursor/generation change→resnapshot accepted owner views and establish new stream cursor; cannot assert missing work never happened. Snapshot+subscribe race requires accepted watermark/bounded replay protocol; if absent, keep visible freshness and periodic source reconciliation rather than claiming lossless updates.

Reference mapping: C's six phases do not become six customer booking screens or a guessed new customer timeline. Keep five approved timeline milestones as last **proven** achievements, alongside accepted finer work phase. BEFORE/AFTER/HANDOVER are not automatically CARE_STARTED or COMPLETED; Work declares actual care start and completion. Once Work moves to AFTER, stale “currently washing” narrative is not permitted merely because the last milestone is CARE_STARTED. Exact phase status/copy requires approval while preserving timeline visuals. Assignment release/reassignment does not erase prior timeline/audit and never exposes prior worker's contact after access expires.

Live location comes only from current approved active-task/assignment/consent/freshness policy. GPS denied/offline/stale/no consent must render unavailable/withheld/timestamped last data as permitted, without background/continuous tracking claims. Raw coordinates/precision retention and recipient visibility are policy blockers; Geo estimate or illustrative map position cannot substitute. Contact action opens only an accepted participant-authorized conversation; no unrestricted technician phone disclosure is requested. Full chat send/retention features remain separately scoped D ownership.

## 5. CP-A-W04-03 — Cash receipt facts, independently of work and custody

Authority/provider: B Billing owns receipt/posting/correction and customer-facing outstanding amount; B Wallet owns approved company custody. C Work authorizes who may collect under the accepted work/assignment/payment rule. Customer views are read-only; neither customer confirmation nor a worker/customer button/screenshot fabricates receipt.

```ts
interface CustomerPaymentFactsV1 {
  obligationRef: EntityRefV1 | null;
  method: 'cash' | 'sham' | 'syriatel';
  state:
    | 'DUE'
    | 'PENDING_REVIEW'
    | 'VERIFIED'
    | 'PARTIAL'
    | 'REFUND_PENDING'
    | 'REFUNDED'
    | 'DISPUTED'
    | 'UNAVAILABLE';
  outstanding: AmountFactsV1 | null;
  asOf: UTC | null;
  sourceRef: EntityRefV1 | null;
}
interface CustomerCashReceiptV1 {
  schemaVersion: 1;
  receiptRef: EntityRefV1;
  bookingRef: EntityRefV1;
  obligationRef: EntityRefV1;
  postingRef: EntityRefV1;
  amount: AmountFactsV1;
  declaredCollectedAt: UTC;
  recordedAt: UTC;
  effectiveState: 'RECORDED' | 'REVERSAL_PENDING' | 'REVERSED' | 'DISPUTED';
  reversalRef: EntityRefV1 | null;
}
interface CustomerCashFactsV1 {
  schemaVersion: 1;
  obligationRef: EntityRefV1;
  state:
    'DUE' | 'PARTIAL' | 'RECORDED' | 'REVERSAL_PENDING' | 'REVERSED' | 'DISPUTED' | 'UNAVAILABLE';
  receipts: CustomerCashReceiptV1[];
  nextCursor: string | null;
  outstanding: AmountFactsV1 | null;
  quality: ViewQualityV1;
}
```

Candidate `GET /api/v1/customer/bookings/:id/cash-receipts` resolves current Booking beneficiary then B `/internal/v1/billing/obligations/:id/customer-receipts` through accepted delegation. HTTP query receives Booking ID; browser cannot select a foreign obligation/customer. List is bounded/scope-bound; response contains only owned money/ref/time/status. Posting proof required for RECORDED; original receipt amount/time/posting remain immutable, reversal is a linked new owner record. UI uses Billing's outstanding/partial state, never locally subtracts amounts from multiple currencies or reverses a receipt.

Partial/over/underpayment acceptance, collector binding, correction permissions/reasons, collection-vs-work phase prerequisite and customer receipt/document terminology remain B/C/product decisions. Enumerating PARTIAL is not authorization to collect a partial amount. Cash receipt recorded is not company custody accepted. Customer view does not expose holder/team internal balance, treasury evidence or cash handover controls. Admin/operator companion views may show custody separately under B Wallet grants; handover request→pending, independent company acceptance→reconciled settled. Customer copy cannot assert “company received” from technician collection alone.

Electronic methods stay truthful pending/unavailable until actual B provider/verification accepted in their scheduled wave. W04 cash-view acceptance neither introduces payment intent/proof upload/settlement/refund execution nor adds Paymera as a fourth method. If an authorized electronic source later exists, its facts can populate the published supported view major; no simulated success or fourth method is invented.

## 6. CP-A-W04-04 — Private completion-media reads and comparison

Authority/providers: Booking Work links immutable evidence objects to actual booking/work attempt/phase/angle; Media owns bytes/quarantine/scan/processing/classification/read grants/revocation/retention. Customer owns this booking under current E/C beneficiary context. An object ID, CLEAN result, technician account role or public-looking URL alone grants no access.

```ts
interface CompletionMediaItemV1 {
  evidenceRef: EntityRefV1;
  workRef: EntityRefV1;
  objectRef: EntityRefV1;
  phase: 'BEFORE' | 'AFTER';
  angle: 'EXTERIOR' | 'INTERIOR';
  state: 'PENDING' | 'AVAILABLE' | 'WITHHELD' | 'REVOKED' | 'UNAVAILABLE';
  capturedAt: UTC | null;
  releasedAt: UTC | null;
  processingPolicyRef: PolicyRefV1;
}
interface CustomerCompletionMediaV1 {
  schemaVersion: 1;
  workRef: EntityRefV1 | null;
  state: 'NOT_COMPLETED' | 'PROCESSING' | 'PARTIAL' | 'AVAILABLE' | 'WITHHELD' | 'UNAVAILABLE';
  evidenceRevision: EntityRevision | null;
  items: CompletionMediaItemV1[];
  quality: ViewQualityV1;
}
interface CompletionReadGrantV1 {
  schemaVersion: 1;
  grantId: UUID;
  objectRef: EntityRefV1;
  purpose: 'SERVICE_EVIDENCE';
  bindingRef: EntityRefV1;
  url: string;
  expiresAt: UTC;
  disposition: 'inline';
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  sha256: string;
}
```

Candidate Booking `GET /bookings/:id/completion-media` returns refs/status only. Candidate Media `POST /objects/:id/read-grants` requests `{expectedRevision,purpose:'SERVICE_EVIDENCE',workBindingRef}` under current beneficiary delegation and accepted CSRF/key rules. Media verifies actual Work evidence link, scan/processed object/current policy; returns a short-lived HTTPS capability with accepted allowlisted origin/disposition/size/expiry, not a permanent public object/store key. File formats/grant lifetime are policy proposals and must match accepted scanner/processing support. No raw-original/EXIF/person/plate exposure by default; processed display variant and access policy are explicit provider semantics.

Expired grant renewal is a new authorized grant operation, not replay of an old expired secret URL. Same-key request replays the originally issued grant/expiry under current auth, not a longer-lived token; clients must distinguish grant renewal from retry of unknown issuance. Raw grant URLs/tokens never enter durable browser cache/logs/analytics/general notifications. Revocation/identity loss stops new grants; downloaded/cached bytes cannot be claimed magically erased. Define expiry/revocation/object-fetch enforcement and broker/processor outage behavior before production acceptance.

Compare only authorized actual BEFORE+AFTER for the **same Work attempt and angle**; no cross-vehicle, cross-attempt or actual+illustration pairing. Missing/quarantined/revoked counterpart shows partial/pending/withheld approved state, not synthetic “after” imagery. Switching angle, slider, zoom/play/pause and reduced-motion remain approved presentation; progress/completion or payment status does not authorize marketing reuse. Reviews/rating posting and receipt/PDF export are separate owner/sprint contracts, not completion-media reads. No customer upload-as-technician control is introduced by W04.

## 7. CP-A-W04-05 — Cancellation display and compensation facts

Authority/providers: C Booking cancellation intent/decision/saga; Scheduling release; Dispatch release; B Billing obligation/refund/correction; optional accepted Wallet/Subscription compensation. This packet requests read/display contract and a future capability indication, **not permission to implement cancellation/refund financial commands in A**.

```ts
interface CustomerCancellationViewV1 {
  schemaVersion: 1;
  requestRef: EntityRefV1 | null;
  state:
    | 'NONE'
    | 'REQUESTED'
    | 'CANCELLING'
    | 'CANCELLED'
    | 'REJECTED'
    | 'BLOCKED'
    | 'RECOVERY_REQUIRED';
  requestedAt: UTC | null;
  decidedAt: UTC | null;
  reasonCode: string | null;
  policyRef: PolicyRefV1 | null;
  capability: { allowed: boolean; reasonCode: string | null; evaluatedAt: UTC };
  compensation: {
    capacityRelease: 'NOT_REQUIRED' | 'PENDING' | 'RELEASED' | 'FAILED' | 'UNKNOWN';
    assignmentRelease: 'NOT_REQUIRED' | 'PENDING' | 'RELEASED' | 'FAILED' | 'UNKNOWN';
    billing: 'NOT_REQUIRED' | 'PENDING_REVIEW' | 'PENDING' | 'COMPLETED' | 'FAILED' | 'UNKNOWN';
    sourceRefs: SourceFactV1[];
  };
}
```

`capability.allowed` is a current owner decision under accepted work/cancellation policy, not a front-end `stage<3` rule copied from demo. If command later separately accepted, revalidate with expected revision and fresh policy; displaying allowed never authorizes a stale write. Request accepted≠booking canceled; Bookings declares CANCELLED only under its own approved transition. Compensation/refund pending remains visible independently; financial refund completed only from verified B owner result, never canceled status or screenshot. Work in progress/reassignment safety and deadline/fee/refund rules require explicit policy, not invented automatic stopping or zero fee.

Candidate read includes REQUESTED/CANCELLING/RECOVERY_REQUIRED and safe customer reason; internal notes/provider exceptions/worker safety details are not disclosed by generic serialization. Release failures and late payment are recoverable saga outcomes; late settlement cannot revive released capacity. Rebooking after cancellation copies historical selection into an **unsent** fresh draft and revalidates current quote/geography/capacity; it never reuses an old hold/price or edits prior snapshots.

## 8. Failure, idempotency, events, timeouts and compatibility requests

- Reads/list/detail/tracking/cash/media metadata/cancellation use no mutation key. Idempotency applies to owner financial/work/cancel mutations when accepted, Media grant issuance if accepted, notification subscriptions if durable, not an arbitrary GET. Recommended current Gateway key syntax `[A-Za-z0-9_-]{16,128}`. E must reconcile B's actor+operation scope versus C/D target/context scope: propose stable actor/service+operation+logical command identity, with beneficiary/target/revisions/policy in fingerprint; never changing beneficiary turns a reused key into another effect. Add `commandId` only if E publishes it compatibly.
- Same-key same canonical command returns recorded status/result/IDs, even after lifecycle changes, while rechecking current authorization; changed payload conflicts. Terminal business rejection replay, pending concurrent duplicate, response/tombstone lifetime and post-expiry unique business refs must be accepted. No numerical TTL/deadline from prior proposals becomes policy here. Unknown write result→same-key/status recovery, never new receipt/booking/payment under new key. Receipt replay cannot renew Media grant, restart work, extend quote or silently re-collect cash.
- Proposed safe errors: malformed/unknown fields400; auth/guest expired401; scope/CSRF403; concealed object404; revision/key conflict, cursor/generation expired409; lifecycle/phase/receipt/grant not ready422 as E maps; throttling429; provider/policy/unavailable503; deadline/unknown outcome504. E preserves Identity/Gateway V1 and publishes allowlisted owner reason/state/operation adapters. No raw phone/address/proof URL/provider stack or claimed payment success in errors. Unsupported enum/major degrades feature rather than guesses a state.
- C/B/D owner transactions persist state+receipt+audit and **accepted** outbox effects; consumers commit Inbox+projection before ACK. Proposed A-facing events include `booking.customer-view-changed.v1`, `booking.work-updated.v1`, `billing.cash-recorded.v1`, `billing.cash-reversed.v1`, accepted Media availability/revocation and cancellation-result events. Names are requests, not registry entries. Preserve envelope `{eventId,eventType,schemaVersion,producer,occurredAt,correlationId,aggregateVersion,data}`; data contains minimal booking/resource/source refs/status, no private content. Broker ACL identifies producer. Existing strict `booking.confirmed.v1` is untouched; guest context/new fields require separately accepted event/version/adapter.
- Notifications consume events only after real resource authority/provider acceptance. Duplicate event bytes no side effect; same eventId different payload→integrity refusal/DLQ; old revision does not regress; missing revisions trigger bounded authorized owner snapshot/replay. D notification cursor is not broker/global sequence; Reporting rebuild never resends business notifications, collects cash or invokes work/cancel commands. Source availability/freshness is observable separately from projection status.
- E publishes bounded response/page/update sizes, cancellation/receipt/private-media fieldsets and owner/internal-client budgets compatible with ingress. Owner reads may retry transiently within original budget; no blind Gateway write retry. Offline customer state is visibly last-known and never expands permission; reconnect/reload resnapshots current owner state without replaying a confirmation/collection. App abort/generation guards reject late replies from older booking/principal/revision.
- Required publication: contracts/event-contracts/API clients plus strict runtime parsers, separate customer/operator/admin view exports, OpenAPI/AsyncAPI registry, version/error/auth adapters, accepted public/internal routes, service audiences/current grants/broker ACLs, environment origins, processor/storage ports, image/CI and actual allocated resource/gate manifest. Manifests/root/CI/infra remain E-owned. State-policy business rules stay in owners. Current package versions or a successful document check proves none of these exist.

## 9. All-three-app scenario IDs and expected customer states

These IDs are **candidate shared scenario names**, not existing runner/test IDs. E/B/C/D review canonical actor/booking/market/work/obligation/object fixtures and source versions before publication. Values are sanitized test fixtures only; no demo sample is promoted to actual Aleppo geography, prices or merchant credentials. Every row is **UNEXECUTED**.

| Scenario ID                          | Operator app action/fact (C)                                                    | Admin app action/fact (D with owners)                                       | Expected customer state (A)                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| W04-XAPP-01-CASH-CONFIRMED           | No assignment/work yet                                                          | Own market booking visible; financial obligation unpaid                     | ACTIVE received; cash DUE; no invented technician/location/media                                                               |
| W04-XAPP-02-ASSIGN                   | Current eligible assignment accepted                                            | Dispatch owner assignment ref/revision visible                              | ASSIGNED only from accepted Dispatch fact; own technician safe name, permitted contact only                                    |
| W04-XAPP-03-ROAD                     | Assigned Work enters ROAD                                                       | Authorized work revision/location freshness visible                         | Proven ON_THE_WAY; current map only with approved consent/source; no demo moving pin                                           |
| W04-XAPP-04-BEFORE                   | Work arrives/BEFORE evidence captured but quarantine pending                    | Private Media scan/link status                                              | Last proven milestone retained; exact BEFORE phase; no premature washing/completion or quarantined customer image              |
| W04-XAPP-05-CARE                     | Authorized Work declares care started                                           | Actual current phase/case/work ref                                          | CARE_STARTED/current care; no payment or collection implied                                                                    |
| W04-XAPP-06-AFTER                    | AFTER evidence processed for same attempt/angle                                 | Current Work/Media revisions, no auto-finance                               | Actual AFTER phase with pending handover; not COMPLETED solely because two images exist                                        |
| W04-XAPP-07-HANDOVER                 | Handover/completion under approved work/cash rule                               | Completed work separate from collection/custody                             | COMPLETED only from Work/Booking authority; unpaid cash may remain DUE; real media AVAILABLE/PARTIAL independently             |
| W04-XAPP-08-CASH-RECORDED            | Current collector sends approved same-key collection                            | Billing receipt/posting verified; Wallet company custody pending separately | Cash RECORDED/outstanding from B; no “company accepted” claim, no work transition inferred                                     |
| W04-XAPP-09-CUSTODY-ACCEPT           | Worker requests handover, cannot approve own settlement                         | Authorized treasury accepts/reconciles or flags mismatch                    | Receipt unchanged; no customer balance product; internal settled vs pending never confused with collection                     |
| W04-XAPP-10-CASH-REPLAY              | Offline duplicate collection same key; changed amount variant                   | B one receipt/changed-fingerprint conflict                                  | One financial effect/receipt after refresh, exact source amount; error never credited as success                               |
| W04-XAPP-11-CASH-REVERSAL            | Prior collector views correction, no edit old receipt                           | Authorized B linked reversal/dispute                                        | Receipt immutable plus REVERSED/DISPUTED current effect; outstanding recomputed by B, not app                                  |
| W04-XAPP-12-MEDIA-PARTIAL            | Only one actual angle/phase available                                           | Media retained quarantine/revocation reason in permitted view               | PARTIAL/PROCESSING, no actual+illustration or other attempt/angle comparison                                                   |
| W04-XAPP-13-MEDIA-REVOKE             | Assignment/Work evidence access released/revoked                                | Media revoke and privacy rule                                               | New grants denied/withheld; old URL expires under policy; no proof all cached copies vanished                                  |
| W04-XAPP-14-CANCEL-PENDING           | Work not started or approved cancellable state                                  | Booking intent/saga pending, source releases pending                        | REQUESTED/CANCELLING, still honest lifecycle; no canceled/refunded claim before owner outcomes                                 |
| W04-XAPP-15-CANCELLED-REFUND-PENDING | Assigned work released under policy                                             | Booking canceled, Billing refund review/pending                             | PAST canceled, financial refund pending separately; old images/contact subject to accepted policy                              |
| W04-XAPP-16-CANCEL-BLOCKED           | Work in progress safety rule prevents automatic stop                            | Owner blocked/rejected current cancellation reason                          | BLOCKED/REJECTED safe reason; existing progress shown; no optimistic cancellation or forced worker stop                        |
| W04-XAPP-17-UPDATE-GAP               | Progress continues during customer disconnect                                   | D cursor generation/gap/source freshness visible                            | Reconnect/resnapshot latest facts; no order duplication or synthetic skipped-stage history                                     |
| W04-XAPP-18-GUEST-ISOLATION          | Assigned operator sees only its actual work                                     | Wrong market/customer/admin grants denied                                   | Other guest/detail/receipt/media/cursor404/denied; expired own guest requires accepted recovery, no phone-match access         |
| W04-XAPP-19-ADMIN-ON-BEHALF          | Work linked to validated beneficiary context                                    | Creator admin actor remains distinct; current beneficiary scope audited     | Actual beneficiary sees own booking; creator's personal customer account gets no ownership; quote/hold/context mismatch denied |
| W04-XAPP-20-ELECTRONIC-PENDING       | Work start/closure obeys approved B/C prerequisite, not prototype contradiction | Pending Sham/Syriatel verification remains separate                         | PENDING_REVIEW/unavailable execution with approved copy; no fake paid/cash replacement/Paymera method                          |
| W04-XAPP-21-OUTAGE-RELOAD            | Actual state persists while required owner unavailable                          | Source/projection stale/unavailable explicit                                | Safe stale/unavailable state and preserved unsent data; reload never seeds fixtures or reissues confirm/collection             |
| W04-XAPP-22-REBOOK                   | No work/assignment created from customer repeat click                           | Historical immutable snapshot unchanged                                     | Fresh unsent seven-step draft; requires new quote/coverage/slot/confirmation; price/hold/history not reused                    |

Scenario traces must bind one booking/beneficiary context across all app consumers and record separate owner refs/revisions/UTC timestamps/contract majors, source vectors, current actor/assignment/purpose and policy inputs. Customer demo `stage` numbers are not the cross-app oracle. Accepted transition/policy contradictions keep affected rows blocked, not skipped-success.

## 10. Provider-first gate order and required tests

Proposed child ordering, accepted with E before source implementation:

1. Real C Booking/Dispatch/Work binding and current beneficiary/assignment/public progress read provider; actual DB/auth/HTTP/revisions. Work binding/evidence authority can be accepted before Media-dependent final Work completion.
2. Real C Media WORK_BEFORE/WORK_AFTER purpose consumer against merged Work binding, then Work execution/evidence transitions against merged Media. D Communications update transport/owner relationship reads after real Booking/Dispatch/Work producers; notification/projection fixtures cannot substitute.
3. B cash-record/correction provider verifies current merged Work/Dispatch/obligation authority and approved policy. If final Work completion requires a receipt, split **Work execution/facts provider → cash provider → Work financial-completion consumer** instead of mutually dependent indivisible PRs. B Wallet custody provider/consumer follows real Billing receipts and independent treasury policy.
4. A own-booking/tracking/cash/private-media/cancellation consumers and D/C corresponding operator/admin consumers use merged providers; complete affected actual three-app scenario journeys before each consumer PR merge. Parent W04 integration remains pending until all required combined-source evidence exists. This is a next-wave proposal, not authorization to start W04 now.

Required test evidence beyond row traces:

- Real DB append-only upgrade preserves foundation/historical sentinels and acknowledged facts; process/container restart; two-principal/two-guest/current role+purpose+object/market isolation; expired/revoked delegation; admin actor≠beneficiary; optional plate/one-time unsaved vehicle/address retained.
- HTTP/schema negative cases: unknown fields/major/enum, wrong ref/revision/beneficiary, cursor scope/generation and source-vector inconsistency, private field redaction, duplicate/missing pending refs, mixed currency/exponent/policy, unsafe amounts; no guessed fallback state.
- Cash owner concurrency/reassignment/phase rule, exact amount/partial policy, duplicate offline/restart command, lost response, reversal immutable references, custody pending/self-approval denial/treasury mismatch. Financial current auth is real; UI tests cannot prove journal/posting/reconciliation.
- Media actual bytes/scanner/processor/storage, quarantine/failure/revocation/wrong-work/angle/attempt, safe processing/EXIF policy, grant expiry/renewal/idempotency/authorization race, no URL cache/log/notification; object ownership rechecked, no public/deep-link bypass. Compare slider/play/zoom/reduced-motion uses two real permitted display objects.
- Notification/broker crash around outbox/inbox/ACK, duplicate/hash-conflict/stale/gap/unknown-major, stream resume snapshot race, corrected/reversed/reassigned data, projection rebuild without command side effects; revoked principal never receives buffered private updates.
- UI real-provider list empty/loading/own-error/stale/partial states, pending command/source failure, tab counts/cursors, back/deep links/reload, late reply after logout/scope/booking switch; live and demo modes explicitly separated; canonical reference/candidate/diff at mandated widths plus keyboard/focus/RTL/reduced motion and separate Windows/device evidence.

All tests remain **UNEXECUTED** in this read-only packet. E must publish actual scripts, accepted environment/ports/DB-role/queue/object/browser/evidence namespaces and exclusive heavy slot. No imagined acceptance command, passing static/schema fixture or old green source closes these business/three-app/media/financial gates. Numerical input/retention/deadline/recovery/performance decisions, real Aleppo data, guest recovery and production copy remain visible named owner blockers.

Contract-analysis handoff: no product code or migration introduced/applied, no DB/broker/browser/device/provider/financial operation, no owned running process/container handles. The containing lane-local draft PR submits this proposal; actual root checks are recorded in CHECKPOINT.md. Next action is affected-owner/E review and compatible contract publication before verified BASE_W04; dependent W03 implementation still separately requires its missing verified BASE_W03 and actual producers.
