# W06-A — early W07 customer commerce and scoped administration requests

Status: **PROPOSED / NOT ACCEPTED / NOT IMPLEMENTED / GATES UNEXECUTED**. Candidate packet `w06-a-w07-customer-commerce-admin/0.1.0`; candidate wire major V1 is an owner/E review request. A proposes requirements only; B/C/D/E authority and publication remain theirs.
Observed source: `main@78adaa2d0436f9e0fc6697a36f3f0bd7a521ad8b`, tree `c5bd3137ef9d4e0ab7b70b9646e126f10e011883`. No moving/private peer DTO, provider API or published acceptance is assumed.

## 1. Entry audit and retained W06 prerequisites

- `architecture/parallel-contract-release.json` still has `BASE_W02:null`, `acceptedNextWaveContracts:[]`; it publishes no accepted BASE_W06/BASE_W07 or product release. Historical requested-not-received intake flags do not erase now-merged A/B/C/D/E W05 proposals.
- `@carwash/contracts@0.0.2` / `@carwash/event-contracts@0.0.2` are Identity/Gateway/probe/strict contract-only Booking foundation; `@carwash/api-clients@0.0.1` exports nothing. Customer/Vehicle/Geo/Wallet/Subscription/Media/Support/Reviews remain marker-only; Communications inbox/probe is not customer chat.
- Current member Identity is not an accepted guest issuance/recovery/claim provider. Account prototype local JSON export/reset and session garage/address controls do not fulfill server privacy operations or approve customer stored value.
- `apps/api-gateway/src/domain/policy.ts` rejects query strings. Current verified-header, JSON-only upstream/controller and status handling do not publish bounded queries, expected-revision/conditional forwarding, 304, SSE or private byte transport. New lists/status/downloads cannot be assumed to traverse present ingress.

| Existing proposal source                                        | W06 predecessor truth retained; no acceptance inferred                                                                                                                                                                          |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `A/W05/W06_CONTRACT_REQUESTS.md` §§3–6                          | Profile/consent, conditional owned benefits, real completed-service reviews, purpose-private media, per-owner privacy outcomes and viewer-safe chat capabilities; no other participant Identity subjects/scopes in public views |
| `B/W05/W06_CONTRACT_REQUESTS.md` §§3–7                          | Received merchant credit, allocation, immutable posting, internal custody, entitlement and refunds are independent facts; V1 hold release still requires nonempty actual posting IDs                                            |
| `C/W05/W06_CONTRACT_REQUESTS.md`                                | Current Booking/assignment/Workforce and B authority precede reserve/consume/compensation; no optimistic unit restoration or caller-created Media purpose                                                                       |
| `D/W05/W06_CONTRACT_REQUESTS.md`                                | Support/refund intake is not B financial execution; Reviews differs from KYC; send/provider acceptance/delivery/read differ; current participant/object/purpose grants                                                          |
| `E/W05/W06_CONTRACT_REQUESTS.md` §§Privacy, owner map, sequence | Approved coordinator and per-owner action/retention map, actual executor/status/export evidence, projection/Media/provider-copy/backup handling; acknowledgment is not fulfillment                                              |

W06 reset must distinguish unsent local draft reset, an approved saved-record archive, and financial/submitted-history erasure. Keep safe submitted operation references needed for UNKNOWN recovery. Export artifact delivered can coexist with other retention/anonymization work pending; aggregate completion needs every required approved owner result, not intake, token revocation or a global browser reset.
Privacy/coordinator/retention/legal-hold/copy guarantees remain decisions. B's old W07 reservation cannot silently substitute for W06 approved fulfillment; any priority/scope reconciliation needs explicit owner/E acceptance, without reopening a completed decision.
Current customer/operator/support participation, private internal notes, historic membership bounds, attachment grants and retained transcript rules must come from purpose owners and approved policy. Account consent does not grant tracking, refund posting, review eligibility or Media marketing reuse.

## 2. Candidate common closed wire profile

Every object below rejects unknown fields/majors after publication. All fields are required unless `?` or `| null` is written. Candidate enums describe wire alternatives, not approved business transitions. `ApprovedCode` values/limits remain publication inputs; an unavailable allowlist/policy blocks the dependent action rather than admitting arbitrary codes.

```ts
type UUID = string; // canonical UUIDv4 candidate; current ingress accepts UUID versions1–5
type UTC = string; // strict valid YYYY-MM-DDTHH:mm:ss.sssZ; authoritative server instant
type Revision = number; // positive safe entity revision; no opaque-token coercion
type PublishedVersion = string; // bounded immutable owner publication token
type ApprovedCode = string; // membership in exact owner/E published allowlist required
type Owner =
  | 'customer'
  | 'vehicle'
  | 'geo'
  | 'catalog'
  | 'pricing'
  | 'billing'
  | 'wallet'
  | 'subscription'
  | 'booking'
  | 'scheduling'
  | 'dispatch'
  | 'workforce'
  | 'media'
  | 'support'
  | 'reviews'
  | 'communications'
  | 'reporting'
  | 'configuration'
  | 'identity';
type Ref<O extends Owner = Owner> = { owner: O; id: UUID; revision: Revision };
type Publication<O extends Owner = Owner> = {
  owner: O;
  id: UUID;
  version: PublishedVersion;
  contentHash: string;
};
type PolicyRef = Publication<'configuration'>;
type Money = { amountMinor: string; currency: string; currencyPolicyRevision: PublishedVersion };
type MoneyFacts = { money: Money; minorUnitExponent: number; policyRef: PolicyRef };
type Quality = {
  state: 'CURRENT' | 'STALE' | 'PARTIAL' | 'UNAVAILABLE';
  evaluatedAt: UTC;
  sourceRefs: Ref[];
  publicationRefs: Publication[];
};
type Operation = {
  schemaVersion: 1;
  operationId: UUID;
  owner: Owner;
  state: 'PENDING' | 'APPLIED' | 'REJECTED' | 'UNKNOWN' | 'RECONCILIATION_REQUIRED';
  reasonCode: ApprovedCode | null;
  resourceRefs: Ref[];
  publicationRefs: Publication[];
  recordedAt: UTC;
  evaluatedAt: UTC;
};
type Beneficiary = { contextId: UUID; revision: Revision }; // issued/resolved owner binding, not a caller subject
interface OperationLookupV1 {
  schemaVersion: 1;
  operationId: UUID;
} // owner is the published route, not caller-selected
```

CURRENT quality requires actual applicable source/publication refs; source absence is UNAVAILABLE, never a default zero/success. APPLIED requires actual owner effect/resource refs; reason codes reveal only the permitted view. Request target refs carry expected current revisions; they are compared, not trusted caller assertions.
Entity revision, publication version, policy token, sequence/cursor and idempotency receipt are distinct. B/C/D candidates use different revisions; E must publish lossless adapters or new majors, not force private parsers. Exact Money uses canonical nonnegative integer minor-unit text; approved currency/exponent/bounds/rounding required. No floats, assumed two decimals, guessed prices, FX/default currency or mixed-currency sums.
Server time governs eligibility/expiry/commit; client/merchant observation time is separately labeled. Appointment/local-day display uses approved Asia/Damascus context; campaign timezone and inclusive/exclusive boundaries require B policy. No numerical TTL, replay, retention, deadline, geometry precision, list bound or fee is selected here.
Each owner checks current E member/service/delegated credential or accepted guest capability, audience, beneficiary/resource/purpose/market and revocation. Phone, plate, known ID, admin creator and caller headers grant no object authority. Guest expiry/recovery/claim/purchase entitlement policy must be accepted; no phone-match migration. Cookie commands need approved Origin/CSRF; replay/download/list pages reauthorize. Principal changes discard late responses and private caches.

## 3. W07-A-01 — Subscription purchase, management and entitlement (B provider)

B W05 has proposed activation/reserve/resolve/correction but no closed customer purchase/intent-creation/manage/freeze/cancel command. Activation is not purchase. `B/W01/POLICY_DECISIONS.md:B-09` still requires approved actual plans, price/units/expiry/renewal/proration/reservations/cancel/refund rules and UI. Basic/Premium/Fleet examples are not parameters.

```ts
interface SubscriptionPurchaseV1 {
  schemaVersion: 1;
  purchaseBusinessId: UUID;
  beneficiary: Beneficiary;
  planRef: Publication<'subscription'>;
  priceQuoteRef: Ref<'pricing'>;
  priceConsent: { quoteRef: Ref<'pricing'>; total: MoneyFacts };
  paymentMethod: ApprovedCode;
  policyRef: PolicyRef;
}
interface SubscriptionPurchaseViewV1 {
  schemaVersion: 1;
  purchaseRef: Ref<'subscription'>;
  operation: Operation;
  planRef: Publication<'subscription'>;
  total: MoneyFacts;
  billingIntentRef: Ref<'billing'> | null;
  receivedCreditRefs: Ref<'billing'>[];
  allocationRefs: Ref<'billing'>[];
  postingRefs: Ref<'billing'>[];
  activationRef: Ref<'subscription'> | null;
  subscriptionRef: Ref<'subscription'> | null;
  quality: Quality;
}
interface SubscriptionListV1 {
  schemaVersion: 1;
  beneficiary: Beneficiary;
  cursor: string | null;
  limit: number;
}
interface SubscriptionDetailV1 {
  schemaVersion: 1;
  beneficiary: Beneficiary;
  subscriptionId: UUID;
}
interface SubscriptionManageV1 {
  schemaVersion: 1;
  subscriptionRef: Ref<'subscription'>;
  action: 'FREEZE' | 'RESUME' | 'CANCEL';
  reasonCode: ApprovedCode;
  policyRef: PolicyRef;
}
interface SubscriptionManageViewV1 {
  schemaVersion: 1;
  operation: Operation;
  subscriptionRef: Ref<'subscription'>;
  action: SubscriptionManageV1['action'];
  effectiveAt: UTC | null;
  entitlementEffectRefs: Ref<'subscription'>[];
  affectedReservationRefs: Ref<'subscription'>[];
  bookingOperationRefs: Ref<'booking'>[];
  refundOperationRefs: Ref<'billing'>[];
  quality: Quality;
}
interface SubscriptionViewV1 {
  schemaVersion: 1;
  subscriptionRef: Ref<'subscription'>;
  planRef: Publication<'subscription'>;
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
  pendingOperationRefs: Ref<'subscription'>[];
  quality: Quality;
}
interface SubscriptionPageV1 {
  schemaVersion: 1;
  items: SubscriptionViewV1[];
  nextCursor: string | null;
  evaluatedAt: UTC;
}
```

- Candidate families `subscription.purchase.v1`, `purchase-status.v1`, `self-list/detail.v1`, `manage.v1`, `manage-status.v1`. List/detail require own current beneficiary; closed limit/sort/cursor bounds and masking follow the published pagination profile below, not guessed defaults. The admin beneficiary resolver separates initiator from recipient. Internal holder/custody is never customer beneficiary by default.
- Purchase validates immutable approved plan and current genuine plan price quote; explicit price consent is a consistency assertion, not client pricing authority. Before electronic/cash allocation, create a narrow durable B-owned real intent binding to beneficiary/plan/quote/policy. Payment protocol remains existing cash/ShamCash/Syriatel Cash only with E's exact published code mapping; no fourth method, Wallet funding/withdrawal/payroll or automatic renewal debit.
- Pending purchase can expose real quote/intent refs but cannot require activation/posting success. Empty financial arrays mean no established fact in this view, not received funds=0; PARTIAL/UNAVAILABLE quality forbids conclusions. APPLIED purchase requires actual approved activation/subscription effects, not proof upload, unmatched credit or review navigation.
- Independently proved merchant credit survives allocation mismatch; an unmatched amount/currency/ref does not erase receipt, prove outstanding=0 or fund a Wallet. Matched eligible confirmed allocation/posting and actual approved plan authorize activation once; no source reference invented to satisfy schema.
- FREEZE/RESUME/CANCEL are requests evaluated against current revision/policy and real C active/in-flight Booking reservations. Existing SUSPENDED state does not establish freeze semantics. Effective date, extension/proration/refundable cap, partially consumed plans, reserved/UNKNOWN effects and cancellation permissions are owner decisions.
- B/C must publish command-bound management fencing: a cached reservation list or expected subscription revision alone cannot close freeze/cancel versus last-unit reserve/consume. Block/claim/reconcile affected effects under accepted protocol; no assumed cross-service transaction or lock lifetime.
- Subscription cancellation does not silently cancel Booking or refund money. Report actual B entitlement changes, C Booking changes and B Billing refund operations separately, including partial/UNKNOWN results. Original consumed service/payment/posting history remains immutable. Pending/UNKNOWN refund cannot restore units or cash optimistically.
- Reuse only accepted B entitlement reserve/resolve schemas and Booking-bound authority. Reserve is not consume, payment or capacity; consume/release/reversal requires approved real trigger. Consumed reservation cannot be released to fabricate units; correction appends linked original-effect refs. Old V1 Wallet release needs actual nonempty posting IDs; any no-posting release needs accepted discriminated new schema/major.

## 4. W07-A-02 — Promotions eligibility and redemption (B Pricing/Catalog)

Existing B promotion-publication proposal and optional quote promotion code do not define eligibility/reservation/redemption. Quote discount calculation does not reserve a quota or redeem. `B-10` dates/timezone/stacking/budget/max uses/per-beneficiary rules/inclusions/commit/expiry remain open; publication must specify actual authority split within B.

```ts
interface PromotionEligibilityV1 {
  schemaVersion: 1;
  beneficiary: Beneficiary;
  code: string;
  selectionRef: Ref<'pricing'>;
  quoteRef: Ref<'pricing'> | null;
}
interface PromotionEligibilityViewV1 {
  schemaVersion: 1;
  state: 'ELIGIBLE' | 'INELIGIBLE' | 'UNAVAILABLE';
  promotionRef: Publication<'pricing'> | null;
  policyRef: PolicyRef | null;
  quoteRef: Ref<'pricing'> | null;
  evaluatedAt: UTC;
  expiresAt: UTC | null;
  reasonCode: ApprovedCode | null;
  quality: Quality;
}
interface PromotionReserveV1 {
  schemaVersion: 1;
  reservationBusinessId: UUID;
  beneficiary: Beneficiary;
  promotionRef: Publication<'pricing'>;
  quoteRef: Ref<'pricing'>;
  bookingIntentRef: Ref<'booking'>;
  policyRef: PolicyRef;
}
interface PromotionResolveV1 {
  schemaVersion: 1;
  reservationRef: Ref<'pricing'>;
  action: 'REDEEM' | 'RELEASE';
  bookingIntentRef: Ref<'booking'>;
  bookingRef: Ref<'booking'> | null;
  authorityRef: Ref<'booking'>;
  policyRef: PolicyRef;
}
interface PromotionReservationViewV1 {
  schemaVersion: 1;
  reservationRef: Ref<'pricing'>;
  state: 'RESERVED' | 'REDEEMED' | 'RELEASED' | 'EXPIRED' | 'RECONCILIATION_REQUIRED';
  operation: Operation;
  quoteRef: Ref<'pricing'>;
  bookingIntentRef: Ref<'booking'>;
  bookingRef: Ref<'booking'> | null;
  expiresAt: UTC | null;
  effectRefs: Ref<'pricing'>[];
  quality: Quality;
}
```

- Candidate `pricing.promotion-eligibility.v1`, `promotion-reserve.v1`, `promotion-resolve.v1`, `promotion-status.v1`. Codes have approved normalization/bounds, are not authorization or unbounded campaign enumeration. Eligibility failure reports a safe reason without leaking another beneficiary's usage or global campaign counters.
- B calculates immutable accepted quote money/discount breakdown under actual promotion policy; client cannot submit discount/percentage/free-service claim. ELIGIBLE requires non-null actual publication/policy; UNAVAILABLE cannot become INELIGIBLE or zero discount silently. Eligibility read itself consumes no quota.
- Reserve atomically enforces accepted quota/budget/per-beneficiary limits and current allowed subscription stacking; binds one real narrow Booking intent/quote/beneficiary. C/E need a binding-first provider before reserve to avoid invented circular “Booking already confirmed” prerequisites.
- REDEEM requires non-null actual bookingRef and command-bound C commit authority. RELEASE may have bookingRef=null before confirmation, but must bind the actual same bookingIntentRef and current C release authority; no confirmed Booking is invented merely to release. authorityRef denotes the action-specific accepted authority, not a cached status or caller approval.
- Redemption requires actual command-bound C commit authority under accepted race/fence protocol, not a cached Booking status. Redeem once against the reservation; expiry/release cannot race an in-flight/UNKNOWN redeem into reusable quota. Resolve UNKNOWN with same operation; cancellation/refund does not automatically restore a redeemed promotion.
- B owns quota/effect accounting and linked correction policy. A/D projection may display pending/conflict/expired/recovery; neither can decrement counters, promise refunded usage or silently retry under a new identity.
- A REDEEMED reservation view requires a non-null actual bookingRef and nonempty actual owner effectRefs bound to that reservation/authority. RESERVED or an accepted resolve command never implies redemption; PENDING/UNKNOWN cannot invent effect references to satisfy this guard.

## 5. W07-A-03 — Repeat Booking uses fresh current facts (C/B/A)

`apps/customer-web/src/state/bookingEntry.ts:118–151` currently copies historical choices into an unsent draft requiring confirmation. Illustrative catalog cost is not Pricing. `B/W02/W03_CONTRACT_PACKET.md` quote validation/new quote and `B/W02/CONTRACT_DELTA.md` retirement forbid reuse of old immutable price as a new offer.

```ts
interface RepeatPrepareV1 {
  schemaVersion: 1;
  sourceBookingRef: Ref<'booking'>;
}
interface RepeatDraftV1 {
  schemaVersion: 1;
  sourceBookingRef: Ref<'booking'>;
  draftId: UUID;
  currentCustomerRef: Ref<'customer'> | null;
  currentVehicleRef: Ref<'vehicle'> | null;
  currentGeoRef: Publication<'geo'> | null;
  selection: { packageRef: Publication<'catalog'> | null; addonRefs: Publication<'catalog'>[] };
  unavailableChoiceCodes: ApprovedCode[];
  quality: Quality;
}
interface RepeatQuoteRequestV1 {
  schemaVersion: 1;
  draftId: UUID;
  beneficiary: Beneficiary;
  selectionRef: Ref<'pricing'>;
  geoRef: Publication<'geo'>;
  vehicleRef: Ref<'vehicle'> | null;
  oneTimeVehicleRef: Ref<'booking'> | null;
  promotionReservationRef: Ref<'pricing'> | null;
  entitlementReservationRef: Ref<'subscription'> | null;
}
interface RepeatQuoteViewV1 {
  schemaVersion: 1;
  state: 'READY' | 'NEEDS_INPUT' | 'UNAVAILABLE';
  quoteRef: Ref<'pricing'> | null;
  total: MoneyFacts | null;
  expiresAt: UTC | null;
  reasonCodes: ApprovedCode[];
  quality: Quality;
}
```

- Candidate `booking.repeat-prepare.v1` returns authorized historical choices only, not a Booking, hold, payment or units effect. Customer/Vehicle refs can be absent/archived; require current choice or accepted unsaved one-time vehicle data, not silent historical legal ownership.
- READY requires actual current quote/total/expiry and valid current Catalog/Pricing/Geo/vehicle sources; NEEDS_INPUT or UNAVAILABLE may have null total, never a successful price-required schema with invented zero. Exactly one saved/one-time vehicle binding when required. Retired/unavailable package/add-on/zone yields explicit replacement/input, not silent substitution.
- Resolve the quote/reservation cycle explicitly: initial actual fresh quote with promotionReservationRef=null (and no unapproved effect) → current B eligibility and reserve bound to that quote/real intent → Pricing revalidated quote bound to the actual reservation → explicit current price confirmation and C commit. Any reprice/expiry/policy conflict preserves or releases the actual reservation only under B/C accepted rules, not a synthetic pre-quote reservation.
- Validate coverage/travel, serviceability, approved benefit/promotion and fresh Scheduling capacity/hold via accepted predecessor contracts. B/C decide reservation acquisition order; preparation/eligibility reads do not reserve money, quotas, units or slots.
- Explicit customer acceptance of actual new price plus accepted quote/slot/hold revisions precedes current C confirm. Changed price, expired quote or missing capacity requires visible fresh confirmation; no auto-confirm/rebook/debit from historic Booking or prior consent. Original Booking snapshots remain unchanged.
- On failed/UNKNOWN confirm preserve submitted operation/hold/reservation refs, query C/B owners, and compensate only actual effects using their approved protocol. No new Booking/key/payment prompt before resolution; old historical order is never canceled to compensate repeat.

## 6. W07-A-04 — Customer/Vehicle administration (A providers, D consumer)

The A W02 minimum exact-ID operational lookup is not broad management. New list/detail/approved update/archive requires owner/E grants and object/purpose scopes; customer own saved-record controls remain distinct. F001 catalog/ADR owns Customer and Vehicle here; A requests contracts, not D implementation rights.

```ts
type AdminSearch =
  | { kind: 'IDS'; ids: UUID[] }
  | { kind: 'NAME_PREFIX'; value: string }
  | { kind: 'CONTACT_EXACT'; value: string }
  | { kind: 'PLATE_EXACT'; value: string };
type ScopeTicket = { id: UUID; revision: Revision }; // server-issued approved market/case/task/purpose binding
interface CustomerListV1 {
  schemaVersion: 1;
  scopeTicket: ScopeTicket;
  search: Exclude<AdminSearch, { kind: 'PLATE_EXACT' }> | null;
  includeArchived: boolean;
  cursor: string | null;
  limit: number;
}
interface VehicleListV1 {
  schemaVersion: 1;
  scopeTicket: ScopeTicket;
  customerId: UUID | null;
  search: Exclude<AdminSearch, { kind: 'CONTACT_EXACT' }> | null;
  includeArchived: boolean;
  cursor: string | null;
  limit: number;
}
interface CustomerAdminViewV1 {
  schemaVersion: 1;
  customerRef: Ref<'customer'>;
  status: 'ACTIVE' | 'ARCHIVED';
  name: string;
  contactDisplay: string | null;
  contactVisibility: 'MASKED' | 'UNMASKED' | 'WITHHELD';
  preferences: { motion: ApprovedCode | null; locale: ApprovedCode | null } | null;
  createdAt: UTC;
  updatedAt: UTC;
  quality: Quality;
}
interface VehicleAdminViewV1 {
  schemaVersion: 1;
  vehicleRef: Ref<'vehicle'>;
  customerRef: Ref<'customer'>;
  status: 'ACTIVE' | 'ARCHIVED';
  type: 'sedan' | 'suv' | 'large' | 'pickup';
  displayName: string;
  plateDisplay: string | null;
  plateVisibility: 'MASKED' | 'UNMASKED' | 'WITHHELD';
  color: string | null;
  createdAt: UTC;
  updatedAt: UTC;
  quality: Quality;
}
interface CustomerPageV1 {
  schemaVersion: 1;
  items: CustomerAdminViewV1[];
  nextCursor: string | null;
  evaluatedAt: UTC;
}
interface VehiclePageV1 {
  schemaVersion: 1;
  items: VehicleAdminViewV1[];
  nextCursor: string | null;
  evaluatedAt: UTC;
}
interface AdminDetailV1 {
  schemaVersion: 1;
  scopeTicket: ScopeTicket;
  resourceId: UUID;
}
interface CustomerAdminUpdateV1 {
  schemaVersion: 1;
  scopeTicket: ScopeTicket;
  customerRef: Ref<'customer'>;
  patch: {
    name?: string;
    contactPhone?: string | null;
    motion?: ApprovedCode;
    locale?: ApprovedCode;
  };
  reasonCode: ApprovedCode;
}
interface VehicleAdminUpdateV1 {
  schemaVersion: 1;
  scopeTicket: ScopeTicket;
  vehicleRef: Ref<'vehicle'>;
  patch: {
    type?: VehicleAdminViewV1['type'];
    displayName?: string;
    plate?: string | null;
    color?: string | null;
  };
  reasonCode: ApprovedCode;
}
interface AdminArchiveV1 {
  schemaVersion: 1;
  scopeTicket: ScopeTicket;
  targetRef: Ref<'customer' | 'vehicle'>;
  reasonCode: ApprovedCode;
  policyRef: PolicyRef;
}
interface AdminMutationViewV1 {
  schemaVersion: 1;
  operation: Operation;
  targetRef: Ref<'customer' | 'vehicle'>;
  auditRef: Ref<'customer' | 'vehicle'>;
  quality: Quality;
}
```

- Candidate `customer.admin-list/detail/update/archive.v1`, `vehicle.admin-list/detail/update/archive.v1`. Detail rechecks role plus specific customer/vehicle/market/task/case purpose. Existing operations.dispatch/billing.read/support.cases.read grants do not authorize these actions; super-admin is not a blanket object/PII policy.
- Existing Identity roles are customer/technician/operations/finance/support/reviewer/super-admin; assigning any role grants no proposed permission automatically. E/product must approve exact role-to-new-grant mapping. Candidate grant families for review are customer.admin.read/update/archive, vehicle.admin.read/update/archive, customer.contact.search/read:purpose and geo.admin.read/write/publish/retire; their names and audience/market/task scopes are unfrozen.
- Search alternatives above are proposed bounded allowlist, not all granted operations. Contact exact search/unmask requires separate accepted approved operational purpose, audit and field scope. Phone/plate not globally unique identities; name-prefix/plate search disclosure rules remain owner decisions. No unrestricted bulk search, raw filters/joins, PII dump or arbitrary fieldset request.
- Null preferences or a null motion/locale means actual value unavailable/withheld, not a guessed default; quality marks PARTIAL/UNAVAILABLE appropriately and dependent edits must use approved current source/policy.
- contactVisibility/plateVisibility=WITHHELD requires the corresponding display=null. MASKED exposes only the approved masked representation; UNMASKED requires the actual current field-purpose grant. An optional absent plate remains absent, not a fabricated identifier.
- Server restricts every result to current object scope and minimal masked data; absence/null does not reveal nonexistent versus concealed object. Broad usage/Subscription/finance/Booking/Support history needs separate current owner contract, never A DB joins or customer detail carrying treasury facts.
- Cursor is opaque/tamper-resistant, binds actor/delegation/scope generation/filter/sort/masking/source snapshot, and expires under accepted policy. Publish fixed stable sort/tie-break/consistency and limit bounds; changed scope/filter rejects cursor. No guessed 20/50 limits, total-count disclosure or regex query.
- Patch omission means unchanged; null clears only approved nullable fields; nonempty approved patch required. No role/credential/consent/beneficiary transfer/owner transfer/balance/entitlement/Booking edits. Contact change stays unverified unless actual current Identity evidence exists; profile contact does not change login credentials or historic Booking contact.
- Vehicle uses existing proposed four types, optional plate/color, no inferred registry verification or global plate uniqueness. Exact normalization/text bounds and allowed admin patches require owner/product approval. Responses show actual owner revision, not optimistic success.
- Archive removes eligible future saved choices under accepted active-work policy; it is not privacy deletion, cascade cancellation or history rewrite. C relationship-check/fencing for in-flight Booking must be an accepted narrow provider, not cached lookup. Refusal/pending/UNKNOWN preserves actual work and submitted operation; unarchive/transfer is outside this request until separately accepted.
- Record audit actor/delegation, safe object/purpose ticket, before/after owner revisions, changed field names, reason/policy, receipt/time; sensitive values in approved protected audit only. Audit retention/download/unmask authority must be published, no contact/plate/cursor in ordinary logs.

## 7. W07-A-05 — Geo create/edit/version/publish/retire (A provider)

A W02/W03 coverage/travel proposal does not approve zone management or real Aleppo data. Geo owns coverage/publication/provenance; Pricing owns fees, Scheduling capacity/hours and Workforce eligibility remain C. F001 names and source owner refs are authoritative; map pixels/GPS in prototype or Riyadh defaults are not zone data.

```ts
type Position = [string, string]; // canonical decimal longitude,latitude; approved CRS/precision/bounds required
type Polygon = { type: 'Polygon'; rings: Position[][] };
type MultiPolygon = { type: 'MultiPolygon'; polygons: Position[][][] };
type Geometry = Polygon | MultiPolygon; // explicit candidate decimal geometry; not claimed GeoJSON number compatibility
interface GeoCreateV1 {
  schemaVersion: 1;
  scopeTicket: ScopeTicket;
  zoneBusinessId: UUID;
  name: string;
  marketCode: ApprovedCode;
  geometry: Geometry;
  provenanceRef: Publication<'geo'>;
  policyRef: PolicyRef;
}
interface GeoEditV1 {
  schemaVersion: 1;
  scopeTicket: ScopeTicket;
  draftRef: Ref<'geo'>;
  patch: { name?: string; geometry?: Geometry; provenanceRef?: Publication<'geo'> };
  reasonCode: ApprovedCode;
}
interface GeoVersionV1 {
  schemaVersion: 1;
  scopeTicket: ScopeTicket;
  draftRef: Ref<'geo'>;
  expectedActivePublication: Publication<'geo'> | null;
  policyRef: PolicyRef;
}
interface GeoVersionViewV1 {
  schemaVersion: 1;
  versionRef: Publication<'geo'> | null;
  draftRef: Ref<'geo'>;
  state: 'VALIDATED' | 'INVALID' | 'PENDING' | 'UNAVAILABLE';
  validationReasonCodes: ApprovedCode[];
  validatedAt: UTC | null;
  validationReceiptRef: Ref<'geo'> | null;
  dependencyRefs: Ref[];
  quality: Quality;
}
interface GeoPublishV1 {
  schemaVersion: 1;
  scopeTicket: ScopeTicket;
  versionRef: Publication<'geo'>;
  expectedActivePublication: Publication<'geo'> | null;
  validationReceiptRef: Ref<'geo'>;
  consumerReadinessRefs: Ref<'pricing' | 'booking' | 'scheduling'>[];
  effectiveAt: UTC;
  policyRef: PolicyRef;
}
interface GeoRetireV1 {
  schemaVersion: 1;
  scopeTicket: ScopeTicket;
  zoneRef: Ref<'geo'>;
  publicationRef: Publication<'geo'>;
  reasonCode: ApprovedCode;
  replacementPublication: Publication<'geo'> | null;
  effectiveAt: UTC;
  policyRef: PolicyRef;
}
interface GeoListV1 {
  schemaVersion: 1;
  scopeTicket: ScopeTicket;
  marketCode: ApprovedCode;
  includeRetired: boolean;
  cursor: string | null;
  limit: number;
}
interface GeoAdminViewV1 {
  schemaVersion: 1;
  zoneRef: Ref<'geo'>;
  draftRef: Ref<'geo'> | null;
  activePublication: Publication<'geo'> | null;
  state: 'DRAFT' | 'PUBLISHED' | 'RETIRED' | 'PENDING' | 'RECONCILIATION_REQUIRED';
  name: string;
  marketCode: ApprovedCode;
  effectiveAt: UTC | null;
  operation: Operation | null;
  quality: Quality;
}
interface GeoPageV1 {
  schemaVersion: 1;
  items: GeoAdminViewV1[];
  nextCursor: string | null;
  evaluatedAt: UTC;
}
interface GeoDetailViewV1 {
  schemaVersion: 1;
  zone: GeoAdminViewV1;
  geometry: Geometry | null;
  geometryVisibility: 'AVAILABLE' | 'WITHHELD' | 'UNAVAILABLE';
  provenanceRef: Publication<'geo'> | null;
}
```

- Candidate `geo.admin-list/detail/create/edit/version/publish/retire.v1`; detail uses AdminDetailV1 under the Geo route; list uses the closed GeoListV1 market/scope/retired/cursor/limit fields and same audited minimization rules, detail optionally reads geometry only under current zone purpose grant. Product approves actual create/edit/publish/retire role separation; no admin button alone grants publication.
- Decimal coordinate representation is candidate only; E/A must reconcile predecessor coordinate parsers and immutable publication format with lossless adapter/new major. Publish CRS, bounds/precision, closed rings/holes/min vertices, winding/topology/self-intersection/boundary/overlap semantics, manual fallback and trusted provenance/provider capability. No numeric precision selected or real provider integration asserted.
- `version` validates a draft at expected revision and produces immutable content/hash plus actual validation receipt. VALIDATED requires non-null versionRef, validatedAt and validationReceiptRef bound to the exact current draft content/hash and approved validation policy, not merely successful syntax parsing. PENDING/INVALID/UNAVAILABLE allow null versionRef/receipt/time without a successful publication claim; invalid draft findings do not fabricate an immutable validated version. Editing makes old validation inapplicable; publishing requires actual current validation bound to content.
- Readiness refs must be actual authorized owner receipts for exact version/approved dependency contract; arbitrary client refs or event arrival do not activate B/C readiness. Validation/cross-owner adoption failure leaves draft or pending, never live partially guessed coverage. E must publish activation/adoption/recovery ordering; no distributed atomic transaction promised.
- Publish compares expected current publication (null means create only), prevents competing live publications, records actual effective server transition and emits receipt. Scheduled activation, if approved, needs durable due-time rechecks/current policy and reconciliation; request time is not observed live time.
- Retire prevents eligible new selections under approved effective rules, without modifying old Booking/quote/price/coverage snapshots or silently canceling work. Existing unexpired quote/hold treatment and replacement-zone consent need B/C policy. Replacement optional ref is not automatic address/price substitution.
- Historical bookings retain actual immutable Geo version/hash and their time-specific eligibility/quote snapshots even after draft edits/retirement. Rollback, if approved, is a new forward publication/operation with audit, not edit/delete of published history. No erasure of required provenance via archive/privacy shortcut.
- GeoDetail geometryVisibility=WITHHELD or UNAVAILABLE requires geometry=null. AVAILABLE requires non-null actual authorized geometry and its approved provenanceRef bound to the returned exact version; a visibility code alone is not a source or disclosure grant.

## 8. Durable operations, events and compatibility

- Commands persist stable business/operation identity before provider calls. E publishes key format/scope by owner+major+current actor/delegation+operation+business target. Candidate foundation key format `[A-Za-z0-9_-]{16,128}` is review input, not a product replay guarantee.
- Canonical fingerprint includes beneficiary/purpose/scope generation, target/expected refs, plan/promotion/quote/price consent, approved Money/units/method, action/reason/policy/geometry content and meaningful effective time. Publish array set/order/duplicates and omitted/null equivalence; exclude secrets, signed URLs and trace IDs. Same key/meaning replays original operation after current authorization; changed meaning conflicts; pending is same operation.
- Permanent unique purchase/activation/redemption/Booking/entitlement effects and publication/archive business dedup survive replay-cache cleanup. Publish receipt/tombstone/financial-audit lifetimes separately from quote/hold/benefit/grant/cursor/geometry activation deadlines; adopt no default TTL.
- Timeout/disconnection/5xx after submit is UNKNOWN, not denial or success. Current-authorized same-key exact request or owner operation lookup resolves it. Do not prompt new payment, free slot/quota/units, retry new business identity or delete draft recovery refs until actual outcome is known.
- Cross-owner transactions expose per-step operations/effects and durable compensation keys/fences; only owner applies its real financial/entitlement/Booking effect. Partial subscription cancel/refund/adoption remains pending/reconciliation with separate facts; peers do not rollback databases, original postings or service history.
- Each published owner exposes OperationLookupV1 returning its current authorized Operation plus its exact family status view; no arbitrary cross-owner lookup/DB join. Ownership/resource concealment and available receipt retention define post-expiry recovery, including staffed reconciliation where accepted, not fabricated success.
- Candidate errors: 400 invalid/unknown field, 401 expired/revoked, 403 role/object/purpose/CSRF, 404 concealed object, 409 revision/key/publication/conflicting effect, 422 policy/state/eligibility, 429 bounded throttle, 503 missing approved source/policy, 504 deadline with safe UNKNOWN operation. Closed safe reason/recovery codes require publication; no provider exceptions/PII. Reads return source quality, not stale-dependent write approval.
- Candidate events `subscription.purchase-progress.v1`, `subscription.management-progress.v1`, `pricing.promotion-reservation-progress.v1`, `customer.admin-record-changed.v1`, `vehicle.admin-record-changed.v1`, `geo.publication-progress.v1` require exact E/owner review; no event is currently implemented/accepted here.

```ts
interface ProgressPayloadV1 {
  schemaVersion: 1;
  operationRef: Ref;
  resourceRef: Ref;
  publicationRefs: Publication[];
  previousRevision: Revision | null;
  policyRef: PolicyRef;
  stateCode: ApprovedCode;
  occurredAt: UTC;
}
```

- Keep accepted envelope semantics eventId/producer/correlation/aggregateVersion and strict `booking.confirmed.v1` unchanged. Proposed payload is minimal references/current audience policy, no contact/plate/geometry/private bytes/room membership/secrets. Conditional events exist only after actual owner transition; intake or UI action emits no invented completed/paid/active event.
- Owner commit/receipt/outbox atomically; consumers inbox-dedup event identity+payload hash, persisted checkpoints/gap recovery and authorized source resync. Duplicate/old/gapped delivery cannot activate twice, redeem twice, restore units, resurrect archived/live publication or resend payment. Reporting cache is not operational authority.
- Closed existing DTOs need accepted new contract/major or explicit publication mapping; no silent enum/state/required-field widening, rounding/coercion, `sham`→`shamcash` alias, policy token→integer conversion or adding fields to strict confirmed event. Old readers can remain immutable historical readers while new writes use accepted new major.

## 9. Provider-first dependencies and proposed UNEXECUTED gates

E must publish accepted base/source/tree/review, exact OpenAPI/AsyncAPI/JSON schemas, request/response/event majors, package/client versions, closed codes/policies/bounds, guest/current auth/object scopes, money/revision adapters, Origin/CSRF, query/cursor/precondition/error/byte/status routes, deadlines/lookup/replay and ownership/resource/gate manifests. A requests these changes; it does not edit E shared packages, registry, infra, CI, ports, databases or queues.
Order: accepted predecessors/policy/UI → actual B plan/intent and C narrow Booking bindings → B price/subscription/promotion providers and real B financial prerequisites → C current reserve/confirm/consume/compensation → A customer/D scoped admin consumers. Geo validation and B/C readiness providers precede live activation. W06 approved privacy/chat/review/media execution remains its explicit preceding owner map, not replaced by this commerce packet.

| Candidate scenario ID  | Provider + affected customer/operator/admin consumer gate; all UNEXECUTED                                                                                                                                                                                               |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W07-A-G01 PURCHASE     | Actual approved plan/current price consent; two guests/member/admin isolation; proof/unallocated/mismatch credit not active; matched posting activates once; changed quote requires confirm; crash/lost response/restart lookup; no auto debit/capacity/customer Wallet |
| W07-A-G02 MANAGE       | Last unit reserve/consume versus freeze/cancel, active/expired/partial/UNKNOWN effects, revision/revocation, policy refusal; actual entitlement/Booking/refund independent outcomes; no optimistic restore/history erase                                                |
| W07-A-G03 PROMOTION    | Eligibility read consumes nothing; quota/per-beneficiary/stacking simultaneous race; real narrow Booking binding; confirm versus expiry/release/UNKNOWN; duplicate redeem/correction; safe denied/unavailable/expired customer and scoped admin views                   |
| W07-A-G04 REPEAT       | Historical choices immutable; retired vehicle/package/add-on/Geo and changed price/coverage; fresh quote/slot/benefit/promotion; NEEDS_INPUT null price; explicit new confirmation; no automatic Booking/debit; actual compensation/UNKNOWN                             |
| W07-A-G05 ADMIN-SCOPE  | Role plus object/purpose denies unauthorized records/contact search/unmask/update/archive; revoked scope/cursor isolation/tamper/filter/limit; masked minimal pages/no count leak; audited detail; safe errors without PII                                              |
| W07-A-G06 ADMIN-UPDATE | Expected revision race/null-omission/unknown keys; contact unverified/login untouched; optional plate/no owner transfer; archive versus live Booking; future selection removed while old snapshots/payment/service unchanged                                            |
| W07-A-G07 GEO          | Real approved Aleppo geometry/provenance and policy; invalid rings/overlap/precision; concurrent publish/changed draft/stale receipt; actual B/C readiness/adoption failure/UNKNOWN; retirement quote policy; historical snapshots retained/new publication audit       |
| W07-A-G08 DELIVERY     | Actual DB constraints/provider HTTP/current member+guest+service auth; receipt/outbox crash/replay/hash/gap/source repair; package parser old/new compatibility; D rebuild no side effects; three-app current pending/review/conflict/unknown/partial states            |

No provider/consumer/browser/broker gate above was executed by this read-only audit. Product plans/promotion/manage copy, approved role/object rules, participant/retention privacy policies, real prices/coverage/provider evidence and numeric limits remain exact owner inputs. Missing applicable inputs block affected production writes; a candidate fixture or merged proposal cannot close acceptance.
