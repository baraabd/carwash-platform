# W05-A — W06 profile, benefits, reviews, private media, privacy and conversations

Status: **PROPOSED / NOT ACCEPTED / NOT IMPLEMENTED / TESTS UNEXECUTED**. Packet `w05-a-w06-customer-account-privacy-chat/0.1.0`; candidate wire major V1 is a review request, not an E-published freeze. This bounded handoff starts no W06 runtime or real provider operation.

## 1. Current-source acceptance audit and reconciliation

Observed `main@3ce756cd39a9b0c1013043cee0ca1bb183466da7`, tree `cc3517ec85525c7310fe340397506ef6be3fe0a9`. Read AGENTS; required design/architecture/F001/F010/verification sources and locked references are unchanged from the inspected W04 target. Historical verification prose is not current product evidence.

- `architecture/parallel-contract-release.json`: BASE_W02=null, acceptedNextWaveContracts=[], no accepted BASE_W05/BASE_W06 or reviewed product package release. Existing contracts0.0.2/event-contracts0.0.2/api-clients0.0.1 publish Identity/Gateway foundation and probe/strict contract-only booking.confirmed.v1; `packages/api-clients/src/index.ts` exports nothing.
- Customer/Vehicle/Geo/Wallet/Subscription/Media/Reviews/Support/Billing schemas are ServiceMarker-only; Communications has only foundation InboxMessage/ProbeNotification. No profile/consent/benefit/privacy/review/chat product provider or guest provider is accepted here.
- `apps/customer-web/src/features/account/{AccountRoute.tsx,accountViewModel.ts}` explicitly defer profile/privacy/export/reset/payment-demo/motion/help; saved-address/garage entries are session UI. Approved account export is **local demo JSON without image bytes**; reset deletes local demo content. Neither is server export/financial erasure fulfillment or customer stored value.
- Latest peer handoffs are B/C/D/E W04→W05 proposals; no B/W05 packet exists in this source. Current task expiry overrides historical bootstrap leases. No moving peer DTO/DB/branch is consumed.

| Exact source under docs/parallel                                                        | W06 reconciliation request; no acceptance inferred                                                                                                                                                     |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `A/W02/ENTRY_CONTRACT_PACKET.md` §§profile/consent/privacy/chat decisions               | Preserve optional contact/plate, one-time unsaved data, immutable Booking snapshots, guest authority; consent/retention/reset/export/chat participants remain owner decisions                          |
| `B/W04/W05_CONTRACT_PACKET.md`; `B/W01/FUTURE_FINANCE_CONTRACTS.md` W06 reservations    | Billing is journal/receipt authority, Wallet approved internal custody/holds; Subscription owned entitlement. Holder/purpose/benefit plan/proration/privacy policies require explicit B/product inputs |
| `C/W04/W05_CONTRACT_REQUESTS.md`; `C/W01/CONTRACT_REQUESTS.md` §§Media purposes/privacy | Booking/Dispatch current relationship and real purpose binding precede Media upload/read/revoke; cancel/refund cannot erase Work/financial/custody history                                             |
| `D/W04/W05_CONTRACT_REQUESTS.md`; `D/W01/CONTRACT_PROPOSALS.md` CP-D-003/004/005/006    | Current participant delivery/reconnect, Support intake versus owner fulfillment, verified Reviews versus KYC, privacy-safe projections/exports; numeric limits/retention/channels remain proposals     |
| `E/W04/W05_CONTRACT_REQUESTS.md`; `E/W03/TOPOLOGY_AND_W04_REQUESTS.md`                  | Exact shared auth/revision/money/error/clients and real producer/subscriber activation; approved inputs/provider capability/evidence still required                                                    |

F001 catalog/ADR is ownership authority: A Customer profile/consent/addresses, Vehicle saved vehicles; B Wallet/Subscription/Billing; C Media and Booking/Dispatch relationship facts; D Reviews/Support/Communications/Reporting/Configuration; E Identity/auth/Gateway/shared release. Support privacy intake/coordinator is **proposed** from D's packet; registry privacy owner/policy is still null. Product/E/owners must approve the coordinator and each owner's retention/actions, not invent a Privacy service or universal erase endpoint.

## 2. Candidate common schema and authorization profile

```ts
type UUID = string; // canonical UUIDv4 candidate; current ingress accepts versions1–5
type UTC = string; // strict valid YYYY-MM-DDTHH:mm:ss.sssZ; authoritative server instants
type Revision = number; // positive safe entity integer candidate; E must reconcile opaque peer refs
type Sequence = number; // safe nonnegative cursor/latest/read value; a persisted message sequence >=1
type Ref<O extends string> = { owner: O; id: UUID; revision: Revision };
type PolicyRef = { owner: 'configuration'; id: UUID; version: Revision; contentHash: string };
type Money = { amountMinor: string; currency: string; currencyPolicyRevision: string };
type MoneyFacts = { money: Money; minorUnitExponent: number; policyRef: PolicyRef };
type Owner =
  | 'customer'
  | 'vehicle'
  | 'geo'
  | 'booking'
  | 'billing'
  | 'wallet'
  | 'subscription'
  | 'media'
  | 'reviews'
  | 'support'
  | 'communications'
  | 'reporting'
  | 'identity';
type Quality = {
  evaluatedAt: UTC;
  sourceRefs: Ref<Owner>[];
  state: 'CURRENT' | 'STALE' | 'PARTIAL' | 'UNAVAILABLE';
};
type Operation = {
  schemaVersion: 1;
  operationId: UUID;
  owner: Owner;
  state: 'PENDING' | 'SUCCEEDED' | 'REJECTED' | 'RECONCILIATION_REQUIRED';
  reasonCode: string | null;
  evaluatedAt: UTC;
};
```

Candidate null/state guards: CURRENT quality needs actual authoritative refs; no source=unavailable, never a zero balance/default success. PUBLISHED review requires verifiedCompletionRef/publishedAt; privacy fulfillment requires current non-null assurance, while RECEIVED/VERIFYING can have null assurance and cannot start owner extraction/deletion.
Exact Money is canonical nonnegative integer minor-unit text, approved currency/exponent/bounds/policy, no float/default currency/conversion or mixed-currency sum. Entity, opaque financial/publication/quote revisions, policy version, conversation sequence and delivery cursor are distinct; published lossless adapters/new majors reconcile B/C/D differences, never local coercion. UTC recording differs from capture/client time; display dates use approved market timezone, appointments Asia/Damascus.

- Current member credential or E's real accepted guest capability binds beneficiary/resource/purpose; current signed delegation/audience/revocation checked by each owner. No phone/plate/known IDs/caller actor headers or admin creator imply ownership. Guest expiry/recovery/claim and privacy identity assurance are explicit E/A/owner gates; alternative verified offline intake requires a separate approved implementation.
- Candidate grants for E review: profile/consent self read/write, approved benefit self read, review create/withdraw self, privacy intake/status/download self, conversation read/send self. Staff/reviewer/support/finance grants have distinct market/case/assignment/purpose scopes; super-admin known-permission mapping cannot automatically approve new grants. Cookie commands require accepted Origin/CSRF.
- Principal changes cancel late responses and clear owned private caches. Every download, transcript page, message send, replay and grant issuance rechecks current object/purpose authority; no browser body selects another subject or arbitrary room. Permission/policy unavailable fails closed for sensitive actions.

## 3. CP-A-W06-01 — Profile, consent and approved benefit boundary

```ts
interface ProfileUpdateV1 {
  schemaVersion: 1;
  expectedRevision: Revision;
  patch: { name?: string; contactPhone?: string | null; motion?: 'SYSTEM' | 'ON' | 'OFF' };
}
interface ProfileViewV1 {
  schemaVersion: 1;
  profileRef: Ref<'customer'>;
  name: string;
  contactPhone: string | null;
  contactVerification: 'UNVERIFIED' | 'VERIFIED';
  verificationRef: Ref<'identity'> | null;
  motion: 'SYSTEM' | 'ON' | 'OFF';
  quality: Quality;
}
interface ConsentSetV1 {
  schemaVersion: 1;
  expectedRevision: Revision;
  purpose: 'MARKETING_MESSAGES' | 'SERVICE_MEDIA_REUSE';
  decision: 'GRANT' | 'WITHDRAW';
  policyRef: PolicyRef;
}
interface ConsentViewV1 {
  schemaVersion: 1;
  consentRef: Ref<'customer'>;
  purpose: ConsentSetV1['purpose'];
  decision: 'GRANTED' | 'WITHDRAWN';
  policyRef: PolicyRef;
  recordedAt: UTC;
  enforcement: {
    owner: Owner;
    state: 'PENDING' | 'APPLIED' | 'FAILED' | 'UNKNOWN';
    operationId: UUID | null;
  }[];
}
interface CustomerBenefitViewV1 {
  schemaVersion: 1;
  subscriptionRef: Ref<'subscription'> | null;
  state: 'NOT_AVAILABLE' | 'PENDING' | 'ACTIVE' | 'EXPIRED' | 'SUSPENDED' | 'UNAVAILABLE';
  planPolicyRef: PolicyRef | null;
  units: { available: number; reserved: number; consumed: number } | null;
  expiresAt: UTC | null;
  quality: Quality;
}
interface ApprovedWalletReadV1 {
  schemaVersion: 1;
  holderRef: Ref<'wallet'>;
  purposeCode: string;
  balance: MoneyFacts | null;
  holds: {
    holdRef: Ref<'wallet'>;
    amount: MoneyFacts;
    state: 'RESERVED' | 'CONSUMED' | 'RELEASED' | 'RECONCILIATION_REQUIRED';
  }[];
  quality: Quality;
}
```

Candidate `customer.profile-update.v1`, `customer.consent-set.v1` and own read families extend reviewed A proposals only after E acceptance. Omission leaves patch field unchanged, phone=null clears profile contact; bounded Unicode/name/phone normalization is owner policy. Contact edit does not change Identity login/credential, verify a number or rewrite historical Booking contact. VERIFIED requires actual Identity verification bound to current normalized contact; otherwise UNVERIFIED. Unsaved edits survive stale refetch/conflict.

- Consent purpose names above are proposed closed vocabulary, not approved legal basis/text. Explicit policy/version/decision audit; optional marketing refusal cannot block essential transactional service. Withdrawal is effective in Customer authority and blocks optional future sending/marketing reuse through current owner checks; queued sends/Media grants recheck, downstream enforcement pending is visible. It cannot retract delivered messages/downloaded bytes or delete immutable evidence. Worker/location consent is C-owned scope, not a customer toggle granting worker tracking.
- `subscription.customer-benefits.read.v1` is only an accepted product-approved owned benefit view; unit meaning/plan/expiry/reserve→consume/release triggers require B/C policy. Admin reference's illustrative plan/remaining-wash inventory does not approve a customer subscription screen or production plan parameters. No inferred subscription plan, checkout SKU, automatic renewal/debit or price. Zero/null/unavailable are distinct; units never inferred from bookings or payment proof. Concurrent last-unit reserve and cancel/failure compensation stay B Subscription/C Booking authority.
- B's closed W06 `wallet.hold-resolve.v1` draft requires nonempty billingPostingIds for both consume/release; a release without postings needs reviewed new schema/major, not silent omission. B's entitlement reserve/resolve and hold reserve/resolve remain unaccepted; renewal books/debits nothing automatically.
- Wallet remains approved internal custody/holds backed by Billing, no second ledger. `ApprovedWalletReadV1` is a **conditional owner-review shape**, not permission to expose a team/company balance in customer UI. B must publish actual holder/purpose/closed hold states and current object grant; customer view stays unavailable/not-applicable until customer-facing scope is explicitly approved. Independently verified merchant receipt, allocation to obligation, posted balance/custody and outstanding are distinct B facts; mismatch does not erase received funds, prove outstanding=0 or fund an account. Do not reinterpret approved “payment demo” row as balance/fund/withdraw, add payroll/stored value or a fourth payment method.

## 4. CP-A-W06-02 — Reviews and private completion/media purpose reads

```ts
interface ReviewCreateV1 {
  schemaVersion: 1;
  bookingRef: Ref<'booking'>;
  completionRef: Ref<'booking'>;
  rating: 1 | 2 | 3 | 4 | 5;
  text: string | null;
}
interface ReviewViewV1 {
  schemaVersion: 1;
  reviewRef: Ref<'reviews'>;
  bookingRef: Ref<'booking'>;
  verifiedCompletionRef: Ref<'booking'> | null;
  rating: 1 | 2 | 3 | 4 | 5;
  text: string | null;
  state:
    | 'PENDING_VERIFICATION'
    | 'PENDING_MODERATION'
    | 'PUBLISHED'
    | 'HIDDEN'
    | 'REJECTED'
    | 'WITHDRAWN';
  submittedAt: UTC;
  publishedAt: UTC | null;
  safeReasonCode: string | null;
  quality: Quality;
}
interface MediaPurposeReadV1 {
  schemaVersion: 1;
  objectRef: Ref<'media'>;
  bindingRef: Ref<Owner>;
  purpose: 'SERVICE_EVIDENCE' | 'CHAT_ATTACHMENT' | 'SUPPORT_EVIDENCE' | 'SELF_EXPORT';
  state: 'PROCESSING' | 'AVAILABLE' | 'QUARANTINED' | 'WITHHELD' | 'REVOKED' | 'UNAVAILABLE';
  policyRef: PolicyRef;
}
interface MediaGrantV1 {
  schemaVersion: 1;
  grantId: UUID;
  objectRef: Ref<'media'>;
  purpose: MediaPurposeReadV1['purpose'];
  bindingRef: Ref<Owner>;
  url: string;
  expiresAt: UTC;
  sha256: string;
  contentType: string;
}
```

D `reviews.create.v1` and own status/withdraw request require current beneficiary plus authoritative actual completed execution, proposed uniqueness `(bookingId,beneficiaryContext)`. Guest review eligibility/linkage, edit window, text bounds, public attribution and appeals need D/A/E/product acceptance. Payment and completion remain independent; unavailable/corrected completion defers verification/creates correction workflow, not fabricated verified badge. Moderator cannot alter stars/wording; publish/hide/withdraw correct approved Reporting counts once, preserve audit/history.

- Public review projection, if approved, excludes booking/customer/contact/plate/address/private evidence; display attribution has separate approved consent/policy. Existing `/admin/reviews/:id` is Workforce verification/KYC; never reuse its route/grant for customer review moderation. Local rating selection is not publication. No unapproved review-image upload or marketplace provider scope is added.
- C Media requires real owner binding: Booking Work→service evidence; Communications conversation/message→chat attachment; Support case→case evidence; export job→export object. Each purpose needs current relationship + object classification + scanner/processor + accepted policy, never “CLEAN means public”. Completion compare uses actual permitted before/after same attempt/angle, preserving approved slider/zoom/play/reduced motion; marketing reuse separate.
- Short-lived grants are fresh-authorized; replay retains original expiry, renewal is a distinct authorized operation. Revocation stops new grants/read access under accepted fetch enforcement; it cannot claim every cached copy erased. Retention/legal hold/purge/EXIF/face/plate rules and exact MIME/size/checksum/expiry remain C/privacy inputs. Proof/KYC objects cannot be relabeled chat/export evidence or broadened into review media.

## 5. CP-A-W06-03 — Exact export/reset/deletion scope and per-owner fulfillment

| Approved reference surface                       | Candidate production mapping and still-required decision                                                                                                                                                                                |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local JSON export, no photos                     | Separate BUSINESS_SNAPSHOT job with approved own-field/class allowlist and source vector; explicit SUBJECT_ACCESS intake requires privacy identity/policy plus actual owner fulfillment, not demo download                              |
| Local reset of demo state                        | UNSENT_DRAFT reset clears only this principal's unsent local drafts/cache; remote saves/orders/history/financial/provider operations unchanged. Server-draft reset only through accepted owner contract if server drafts actually exist |
| Saved address/vehicle removal                    | Customer/Vehicle own revisioned archive/delete under policy; historical Booking snapshots remain immutable. Scope is a deliberate selection, never reset→blanket deletion                                                               |
| Production personal-data erasure/account closure | Separately approved authenticated privacy intake and owner actions; Identity account/session action is E-owned. No erase-financial-history, terminate-account or backup purge implied by a reset button                                 |

```ts
type PrivacyClass =
  | 'PROFILE'
  | 'SAVED_ADDRESSES'
  | 'SAVED_VEHICLES'
  | 'BOOKING_SNAPSHOTS'
  | 'CUSTOMER_RECEIPT_FACTS'
  | 'OWN_REVIEWS'
  | 'CONVERSATION_TRANSCRIPT'
  | 'MEDIA_METADATA'
  | 'SERVICE_MEDIA_OBJECTS'
  | 'CHAT_ATTACHMENTS'
  | 'SUPPORT_EVIDENCE'
  | 'PAYMENT_PROOF';
type SnapshotClass = Exclude<
  PrivacyClass,
  'SERVICE_MEDIA_OBJECTS' | 'CHAT_ATTACHMENTS' | 'SUPPORT_EVIDENCE' | 'PAYMENT_PROOF'
>;
interface ExportRequestV1 {
  schemaVersion: 1;
  kind: 'BUSINESS_SNAPSHOT' | 'SUBJECT_ACCESS';
  classes: SnapshotClass[];
  format: 'JSON_NO_MEDIA_BYTES';
  policyRef: PolicyRef;
}
interface PrivacyIntakeV1 {
  schemaVersion: 1;
  action: 'ACCESS' | 'RECTIFICATION' | 'ERASURE' | 'RESTRICTION';
  classes: PrivacyClass[];
  purposeCode: string;
  policyRef: PolicyRef;
} // subject derived from verified auth
interface OwnerFulfillmentV1 {
  taskId: UUID;
  owner: Owner;
  action: string;
  policyRef: PolicyRef;
  state: 'PENDING' | 'COMPLETED' | 'PARTIAL' | 'BLOCKED' | 'FAILED' | 'UNKNOWN';
  operationId: UUID | null;
  affectedClasses: PrivacyClass[];
  evidenceRef: Ref<Owner> | null;
  reasonCode: string | null;
  disposition:
    'LOGICAL_ACTION_DONE' | 'RETAINED_UNDER_POLICY' | 'PURGE_PENDING' | 'PURGED' | 'UNKNOWN';
  completedAt: UTC | null;
}
interface PrivacyStatusV1 {
  schemaVersion: 1;
  requestRef: Ref<'support'>;
  identityAssuranceRef: Ref<'identity'> | null;
  state: 'RECEIVED' | 'VERIFYING' | 'IN_PROGRESS' | 'PARTIAL' | 'BLOCKED' | 'COMPLETED' | 'FAILED';
  ownerResults: OwnerFulfillmentV1[];
  dueAt: UTC | null;
  policyRef: PolicyRef;
  quality: Quality;
}
interface ExportViewV1 {
  schemaVersion: 1;
  exportRef: Ref<'support' | 'customer' | 'reporting'>;
  kind: ExportRequestV1['kind'];
  state: 'QUEUED' | 'COLLECTING' | 'PARTIAL' | 'READY' | 'FAILED' | 'EXPIRED' | 'REVOKED';
  requestedClasses: PrivacyClass[];
  fulfilledClasses: PrivacyClass[];
  ownerResults: OwnerFulfillmentV1[];
  snapshotRefs: Ref<Owner>[];
  objectRef: Ref<'media'> | null;
  sha256: string | null;
  expiresAt: UTC | null;
}
```

Candidate `support.privacy-intake.v1`/status/per-owner task/result and `customer.business-export-request.v1`/status/download require approved coordinator allocation. Classes listed are review candidates, not all approved export content; third-party messages/staff notes/identity credentials/proof bytes/internal finance/custody details are excluded or independently redacted by owner policy. Specify exact snapshot JSON schema version, own fields and partial/source-asOf manifest before publication; aggregate owner reads are not a global atomic snapshot.

- B's existing privacy fulfillment family is reserved for W07 and its closed action enum EXPORT/DELETE/ANONYMIZE differs from D intake ACCESS/RECTIFICATION/ERASURE/RESTRICTION. If W06 requires that provider earlier, B/E must accept explicit reprioritization/schema mapping; existing B privacy events omit outcome and generic FinancialResult.state is open, so neither proves closed partial/blocked fulfillment.
- Intake receipt ≠ fulfillment. Each owner separately validates verified subject/class/action/current scope/legal hold/retention, returns durable task outcome/evidence, never cross-DB deletes. Support cannot mark globally COMPLETED before every required accepted action/evidence is fulfilled; pending backup/projection/object tasks keep honest partial/blocked state. Logical redaction, revocation, physical purge and retained exception are different facts; no guessed statutory due date, purge horizon or instant all-copy erase.
- READY export requires permitted finalized private Media object/checksum and actual manifest, then fresh subject/purpose authorization for short-lived download. READY business snapshot does not complete a subject-access request. Owner missing/degraded exports either remain blocked/partial or produce a visibly partial manifest only if accepted policy permits; never empty=complete. Artifact includes JSON records/allowed metadata, no embedded private image bytes or permanent grant URL. Binary privacy classes are erasure/access decision scope, not snapshot export permission; any separately approved subject-access bytes delivery needs a distinct owner artifact/grant schema. Metadata-only JSON cannot count as binary-class fulfillment.
- Reset cannot cancel unknown submitted booking/message/upload/financial/privacy jobs by clearing browser state; retain safe operation refs/status recovery and abort only local view requests. Optional saved-record removal uses explicit current-revision commands per Customer/Vehicle. Multi-owner partial success is displayed, not compensated by deleting unrelated saved records or reconstructing fixture history. Financial/Work/custody audit retention follows actual approved owner policy; verified merchant receipts, obligation allocations, refunds/reversals and retained/deleted personal presentation remain independently visible facts, never inferred from one deletion state.
- Consent withdrawal is immediate A authority plus downstream enforcement, distinct from privacy erasure. Account closure/revocation, guest recovery to retrieve pending export and identity assurance expiry need E decision. Deleted/redacted data must not reappear from stale replicas, event replay, rebuilds or source re-export; owner tombstones/corrections and backup-restoration policy are explicit gates.

## 6. CP-A-W06-04 — Customer/operator/support conversation and attachments

```ts
// Owner-internal binding; never serialized as a customer participant response.
interface InternalParticipantBindingV1 {
  participantRef: Ref<'communications'>;
  subjectRef: Ref<'identity'>;
  role: 'BENEFICIARY' | 'ASSIGNED_OPERATOR' | 'SCOPED_SUPPORT';
  membershipRevision: Revision;
  purposes: ('READ' | 'SEND' | 'ATTACH' | 'READ_RECEIPT')[];
  expiresAt: UTC | null;
}
interface ParticipantViewV1 {
  participantRef: Ref<'communications'>;
  role: InternalParticipantBindingV1['role'];
  approvedDisplayLabel: string | null;
}
interface ViewerMembershipViewV1 {
  participantRef: Ref<'communications'>;
  membershipRevision: Revision;
  capabilities: ('READ' | 'SEND' | 'ATTACH' | 'READ_RECEIPT')[];
  expiresAt: UTC | null;
}
interface ConversationViewV1 {
  schemaVersion: 1;
  conversationRef: Ref<'communications'>;
  bindingRef: Ref<'booking' | 'support'>;
  kind: 'BOOKING_SERVICE' | 'SUPPORT_CASE';
  participants: ParticipantViewV1[];
  viewerMembership: ViewerMembershipViewV1 | null;
  membershipGeneration: UUID;
  latestSequence: Sequence;
  state: 'OPEN' | 'READ_ONLY' | 'CLOSED' | 'UNAVAILABLE';
  retentionPolicyRef: PolicyRef;
  quality: Quality;
}
interface MessageSendV1 {
  schemaVersion: 1;
  clientMessageId: UUID;
  conversationRef: Ref<'communications'>;
  expectedMembershipRevision: Revision;
  content:
    | { kind: 'TEXT'; text: string }
    | { kind: 'ATTACHMENT'; objectRef: Ref<'media'>; caption: string | null };
}
interface MessageViewV1 {
  schemaVersion: 1;
  messageRef: Ref<'communications'>;
  conversationRef: Ref<'communications'>;
  sequence: Sequence;
  authorParticipantRef: Ref<'communications'>;
  content: MessageSendV1['content'] | null;
  state: 'PERSISTED' | 'REDACTED' | 'WITHHELD';
  createdAt: UTC;
  redactedAt: UTC | null;
}
interface MessagePageRequestV1 {
  schemaVersion: 1;
  conversationRef: Ref<'communications'>;
  cursor: string | null;
  limit: number;
}
interface MessageReadMarkerV1 {
  schemaVersion: 1;
  conversationRef: Ref<'communications'>;
  expectedMembershipRevision: Revision;
  throughSequence: Sequence;
}
interface MessagePageV1 {
  schemaVersion: 1;
  conversationRef: Ref<'communications'>;
  generation: UUID;
  items: MessageViewV1[];
  nextCursor: string | null;
  state: 'CURRENT' | 'GAP' | 'RETAINED_RANGE_EXPIRED' | 'UNAVAILABLE';
}
interface DeliveryViewV1 {
  schemaVersion: 1;
  notificationRef: Ref<'communications'>;
  state:
    | 'QUEUED'
    | 'PROVIDER_ACCEPTED'
    | 'DELIVERED'
    | 'READ'
    | 'UNKNOWN'
    | 'FAILED'
    | 'EXPIRED'
    | 'SUPPRESSED';
  attemptId: UUID | null;
  providerAcceptedAt: UTC | null;
  deliveredAt: UTC | null;
  readAt: UTC | null;
}
```

D `communications.conversation-read.v1`/messages/send/read-marker and Support own-case conversation use server-derived object-purpose membership. “Provider” in task means an approved current service operator/team participant, not a new marketplace seller. Product/C/D/E must decide individual versus team/dispatcher, support-entry grounds, old technician historical visibility, public sender labels/contact masking, read-only versus send and retention. Proposed roles above grant nothing until accepted. Customer cannot nominate arbitrary participant IDs; internal Support notes are a separate private fieldset.

- Current Booking beneficiary/Dispatch assignment/Support case authority rechecked at read/send/reconnect and Media attachment grant. Reassignment/revocation invalidates prior membership/queued access; support entry audited and case-scoped, no operations/finance/admin blanket transcript access. Public participants expose only Communications-owned opaque refs and approved labels/roles. Identity subject bindings and other participants’ scopes stay server-side; viewerMembership contains only the current viewer’s safe action capabilities/revision/expiry, never raw Identity/account/grant data. A capability snapshot is not authorization: every owner command/read rechecks current membership. Guests get only accepted purpose-limited recovery, no phone-based room join.
- Binding provider→Media CHAT_ATTACHMENT/SUPPORT_EVIDENCE reservation/scan/finalize→message/case link precedes send; current recipients must qualify for that object/purpose. Redacted/withheld content=null and no newly issued grant; revoke attachment access without rewriting financial evidence. No HTML execution, provider URL fetch, arbitrary storage key or proof object reuse. Content/file limits and approval/retention/transcript-export rules are actual policy inputs.
- Persist message/server sequence/command receipt/audit/outbox before acknowledgment/broadcast. Same clientMessageId/key after lost acknowledgment queries/replays one message; delivery retries do not send another business message. Read markers monotonic per currently authorized participant, cannot exceed visible sequence; queued/provider accepted/delivered/read are distinct and never imply received money, refund or Work success.
- Reconnect uses membership/filter/generation-bound cursor and bounded replay; gap/expired range returns honest retained-range/snapshot status. Snapshot+subscribe watermark prevents lost updates only if published protocol proves it; otherwise visible freshness/source reconciliation. Auth revocation prevents buffered private delivery. External channel UNKNOWN reconciles same provider attempt before retry under actual capability; no SMS/WhatsApp/push/channel support inferred from email OTP or UI.

## 7. Replay, partial outcomes, events, compatibility and E publication

- Retain candidate ingress key `[A-Za-z0-9_-]{16,128}`; E closes actor/delegate+operation+business target scope and canonical fingerprint: beneficiary/owner/class/action/purpose/policy/expected revisions, consent decision, rating/text/content hash, attachment binding, clientMessageId and export fieldset/format. Secrets/URLs/request IDs excluded; array/set order defined. Same key/meaning replays original receipt/IDs/expiry after current authorization; changed meaning409; concurrent pending returns same operation. PII-bearing replay bodies need actual retention/encryption/redaction policy.
- Durable uniqueness for review beneficiary/booking, message/conversation/clientMessageId and owner/task prevents effects after cache cleanup. Replay/tombstone/guest/scan/grant/message/transcript/export/retention/deadline/skew/retry budgets remain named owner/E decisions; old proposed 7d/90d/60s/24h defaults are not adopted. Provider timeout is UNKNOWN; persist attempt first and reconcile same operation. No new-key resend, duplicate review, blanket reset or repeated deletion/export as recovery.
- Candidate safe errors400 malformed/unknown;401 expired/revoked;403 scope/CSRF;404 concealed foreign object;409 revision/key/cursor/generation;422 ineligible binding/media/policy;429 throttle;503 dependency/policy unavailable;504 deadline/unknown outcome. Safe owner code/phase/operation/current-next-action exported, no raw transcript/phone/location/proof/token. Partial per-owner state remains visible; retry only failed/unknown task via accepted identity, not global rollback. Failed export partial-object cleanup through Media; already committed message/consent/financial history cannot be unsent/erased by SQL compensation.
- Candidate events V1: customer.profile-updated/consent-updated, reviews published/hidden/withdrawn/corrected, support.privacy-task/result, communications message/access/redaction/delivery, Media access/availability and owner privacy outcomes. Exact data `{operationId,ownerRef,policyRef,state,occurredAt}` plus purpose/class/action/related safe refs as applicable; Review published adds rating/verified completion ref only if approved; no contact/transcript/private URL/document/identity assurance content or free-text privacy request. Existing strict booking.confirmed.v1 is unchanged.
- E closes each discriminated event schema/envelope/producer ACL; owner state+receipt+audit+outbox and consumer Inbox+effect/ACK atomicity, duplicate/hash-conflict/stale/gap/correction/rebuild rules. Reporting rebuild does not resend chat/marketing, republish review, reinstate withdrawn consent or revive erased PII. D notifications are derivative delivery facts; source owner remains authority. Current Gateway rejects query URLs, lacks conditional/precondition/stream forwarding and buffers JSON; accepted bounded query/cursor/error/guest/byte-origin adapters are prerequisites, not presumed routes.
- New strict majors/exports/public clients preserve Identity/Gateway/cash/electronic/Booking old semantics; unknown field/major/enum rejected or safe unavailable. Publish B/C/D revision/beneficiary/money adapters and supported provider/consumer matrix, separately new privacy/chat/review purposes/grants. E owns packages/dependencies/config/CI/infra/root manifests; A requests accepted policies/resource namespaces/OpenAPI/AsyncAPI/broker topology/storage scanner/ports/DB-role/browser allocations, never changes reserved files.

## 8. Proposed provider/consumer gate cases and order

All case IDs are **UNEXECUTED**; real producers/owner outcomes precede customer/operator/admin integration:

| ID                        | Required proof                                                                                                                                                                                                                                           |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W06-PC-01 PROFILE-CONSENT | Real current member/two guests, contact≠Identity credential, patch conflicts/reload, withdrawal during queued send/grant, unavailable policy, no hidden consent or stale-principal reply                                                                 |
| W06-PC-02 BENEFIT-WALLET  | Actual approved holder/purpose isolation; no customer/team leak or stored-value fallback; unit eligibility/last-unit race/reserve-consume-release/expiry/refund policy and exact Billing references                                                      |
| W06-PC-03 REVIEW          | Foreign/incomplete/corrected/unavailable completion; guest eligibility; duplicate/edit/withdraw/moderation race; stars unchanged, public PII masked, aggregate correction once; KYC reviewer denied                                                      |
| W06-PC-04 MEDIA-CHAT      | Actual bytes/storage/scanner/binding/recipient grants; quarantine/foreign purpose/revocation/reassignment/expiry; compare same attempt/angle; no transcript/proof/URL broadcast                                                                          |
| W06-PC-05 EXPORT-FULFILL  | Own scope/current assurance, per-owner snapshot/asOf/fields, finalized private artifact/checksum; partial/outage/replay/lost result; business READY≠subject fulfillment; revoked worker/download/expired grant and third-party redaction                 |
| W06-PC-06 RESET-ERASE     | Unsent draft reset preserves submitted operation refs/history; selected record removal preserves Booking snapshot; owner legal hold/partial/purge/backups/projection outcomes, account action E-only; replay/rebuild cannot resurrect PII                |
| W06-PC-07 CHAT-RECOVERY   | Actual customer/current operator/scoped support membership, staff-note isolation, monotonic sequence/read, duplicate response-loss/restart, reassignment mid-send/grant, cursor gap, provider accepted≠delivered/read, ambiguous external reconciliation |

Acyclic sequence: E reviewed auth/guest/shared contract/policy release → A profile/consent and B approved benefit/Wallet facts plus C Booking completion/current relationship bindings → D Review/Support/privacy intake and Communications conversation binding → C Media each real purpose → D message/review/owner fulfillment/export consumers → A/C/D complete real affected journeys before consumer merge. Split coordinator binding from final fulfillment/attachment consumer where needed; provider owned DB/HTTP/Identity/migrations/constraints do not wait for an unbuilt app. E declares topology/ACL/bindings before publishers; actual external channels use only approved authorized test facilities and protocol evidence.
Require owned migration/upgrade/restart/current-auth tests, raw event crash/hash/gap recovery, actual storage/process/download, per-owner partial/privacy evidence and browser reference/candidate/diff/RTL/focus/reduced-motion at locked widths plus separate Windows/device checks. Exact new production copy/privacy/action consequences/chat participants/retention/legal deadlines/benefit and provider capability remain decisions, not guesses. Missing policies/providers block affected gates; no fixture or static schema closes them.
Proposal handoff: A documentation/specifications only; no product source/shared changes, migration/runtime/provider/DB/broker/browser operation or owned running handles. Actual existing local diagnostics and final PR binding are recorded in [CHECKPOINT.md](CHECKPOINT.md). Missing accepted BASE_W05 blocks current W05 writes; E/owner-reviewed W06 publication and verified BASE_W06 precede W06 writes. Next action is bounded B/C/D/E/product review and explicit decision recording; no contract is declared frozen here.
