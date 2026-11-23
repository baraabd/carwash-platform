# W06-A — wallet, support, reviews and private comparison proposal

**Proposed/unaccepted; all dependent runtime work and acceptance are blocked.**
B supplies Wallet/Subscription/Billing; C supplies Booking/Media; D supplies
Support/Reviews/Communications; E supplies current Identity/grants/guest/public
transport and released clients. Accepted BASE_W06 and approved screen/policy
inputs are absent. This document requests boundaries, not working integrations.

## Wallet visibility and finance recovery

The account payment-tour row uses a wallet icon but is a demo tour, not a real
balance/history surface. W06 must expose the approved server wallet scope when
the owner publishes it. B/product must first identify eligible holders, purposes,
approved read/actions and whether customer visibility is in that scope. Wallet is
an internal owner and not automatically a fourth checkout method or customer
stored-value funding/withdrawal product. The W06 requirement stays blocked, not
silently omitted, while these inputs are undecided.

Use authorized server snapshots with holder/purpose, amount as exact integer-minor
decimal string, published currency/precision, available/held facts, revision,
server instant and Billing posting references. No float conversions, currency
exchange guesses, arbitrary balance edits or illustrative amount promoted to real
money. History pagination and detail access require current object/holder scope;
never expose another holder's entries through a guessed ID or shared cache.

Duplicate/stale events cannot double-credit or overwrite a newer projection.
An event gap/reconnect requires the approved snapshot/cursor reconciliation query.
Projection freshness does not grant money-mutation authority. Unknown/pending
capture/refund/settlement is distinct from confirmed credit; missing/stale data
must not appear as a known zero or spendable sum. Commands, if approved, use the
same durable operation identity after timeout/reload; UI retry cannot create a
second payout or release an unresolved hold. B's genuine financial and recovery
gates remain necessary beyond A's display tests.

## Support, chat, contact and refund cases

Support owns cases/resolution decisions; Communications owns conversations,
messages, read/delivery state and durable recovery. Billing owns all verified
money/refunds; a refund case/resolution request is not a completed refund.
Booking/Workforce/Dispatch supply narrow current booking, work eligibility and
assignment participant authority through their separately accepted contracts.
Provider here means the approved assigned service actor, not a new
marketplace product or permission to browse all customers.

Before coding, D/C/E/product release these exact inputs:

- Case/booking/conversation identity, permitted customer/guest/assigned actor/
  support roles, membership/purpose/revision and current object grants for read,
  send, attach, join/leave/reassignment/escalation/close/reopen as approved.
- Authorized retention-policy version and approval record; visibility after
  reassignment/closure/revocation, content and attachment retention/redaction,
  participant additions and support-access audit. No arbitrary duration or
  implied legal approval is adopted.
- Approved visible participant aliases/capabilities; public clients do not need
  private Identity subjects, internal grants, phone/address or reviewer identities.
  Contact channels/addresses/hours/availability and any external channel provider
  require genuine configuration; current OTP delivery is not proof of SMS support.
- Exact message/case schemas, attachment purpose reservation, delivery/read
  semantics, opaque cursor/snapshot reconciliation and bounded operation lookup.
  A Socket/UI acknowledgement alone cannot prove durable message acceptance.
- Versioned refund-case projection with Support case state and separately sourced
  Billing requested/pending/unknown/verified/refunded/failed facts. Accepted user
  copy must not collapse case closure into money returned.

Persist a stable case/message business identity and actor/operation fingerprint.
On lost response/reload/reconnect, reconcile the original operation and fetch
the accepted snapshot/events. Duplicate deliveries or new retry keys must not
create a second case/message. Gaps require query recovery; out-of-order messages
must not downgrade status. Preserve drafts with approved privacy scope; never
restore another participant's text on account/guest switch.

Media reserve/upload/quarantine/scan/finalize/object access is independent from
message/case permission and from business evidence eligibility. Every reserve,
attach, preview, download and later access rechecks current owner, purpose,
classification and object authority. A clean scan does not prove ownership or
admissibility. Reject foreign objects, foreign booking/case purpose, expired grants
and unfinalized/quarantined attachments. Keep rejected uploads/recovery visible
without silently sending another file. Forward only restricted object IDs and
safe metadata, never arbitrary client URLs, base64 images or public CDN links.

## Verified-service rating and moderation

Reviews owns eligibility, review uniqueness and moderation. Booking supplies
beneficiary/coordinator facts; C's accepted Work-completion authority supplies
execution evidence, with Workforce/Booking responsibility frozen explicitly in
the C/E release. Work eligibility and Dispatch assignment are separate facts;
payment, local order stage or client toggles do not establish eligibility. The
before/after pair is not a substitute for completed-service evidence either.

Request exact eligible subject/service, allowed rating/text/attachments, review
uniqueness policy, expected revision, idempotency/business identity, edit/withdraw
rules if approved, moderation revisions/outcomes and public presentation policy.
Do not invent rating limits, edit windows or publication timing from fixtures.
An accepted submission is not necessarily published; rejection/held moderation
and definite/unknown write outcomes remain distinct, with approved copy.

Test duplicate submit under identical/different keys and concurrent tabs/reload,
non-beneficiary/guest/unfinished/cancelled/foreign bookings, revoked authorization,
and stale/duplicate/out-of-order moderation. Only accepted currently authorized
data renders; failure/unknown outcome retains original operation lookup. A
submitted review never changes payment, entitlement or service-completion facts.

## Private before/after comparison

The frozen HTML implements local demo comparison using illustrative scenes and
local IndexedDB photos. React HomeShowcase currently marks comparison deferred;
tracking is only C014's unpaid handoff. This is not private server Media.

The C owner must publish a versioned scene/pair manifest bound to the authorized
booking, work stage, purpose and media references. Request required/optional views,
availability/scan/finalization status, pair origin and private access/renewal/
expiry/revocation/retention rules. Only same-booking, same-approved-scene real
before/after objects from the same Work attempt can be presented as a genuine
result. Never pair objects from different attempts after reassignment/retry, or mix a real photo
with an illustrative fallback or another booking's image to claim a completed pair.

Missing one or both sides, unknown fetch, expired grant, rejected/quarantined media,
retired/deleted/retained records and authorization denial need exact approved UI
states and recovery. They are not a blank 'success' or a fabricated image. Display
illustrative assets only in an explicitly separate approved demo/preview context.
Server-authorized renewal uses current grants; retry does not prolong an expired
URL or resurrect revoked consent. Private caches/object URLs must be scoped,
disposed on close/logout/account switch and not stored in unapproved persistent
browser/service-worker caches. Refresh keeps eligibility and Media facts separate.

Preserve the frozen comparison shape and approved Arabic/RTL/icons: drag/range
control, keyboard movement, play/pause, zoom/expanded view, scene selection and
reset. Handle pointer cancel/multi-touch without trapping normal mobile scroll;
bound split position and name/value feedback; stop prior animation when editing,
switching scenes, closing or navigating. A modal returns focus to its opener;
keyboard focus remains visible and authorized controls work at approved sizes.
Honor both system reduced motion and approved preference. Reduced motion must
not auto-play; the full comparison remains manually accessible. Expired/denied
authorization during play/zoom stops access and routes to the approved recovery.
The reference's zoom is enlargement in a bottom sheet, not pinch/wheel zoom;
additional gesture semantics need explicit approval. Preserve its LTR range value
inside the Arabic/RTL screen rather than reversing the split without a decision.

Service-evidence purpose and marketing consent are separate. A service image
does not authorize marketing reuse; consent withdrawal/revocation must follow
the approved owner retention/action rules in [account request semantics](ACCOUNT_REQUESTS_AND_RETENTION.md).
No marketing publication/upload or provider operation is performed here.

## Approval and real gate boundary

Request exact approved production states/copy for wallet loading/stale/unknown,
support membership/retention/attachments/refund, review eligibility/moderation and
missing/expired/private comparison. Frozen demo wording cannot claim server saves
or deletion; missing designs/decisions block only affected writes. A submits these
decisions to E/owners rather than editing their packages or inventing screens.

Acceptance needs real owner DB/migrations/constraints, HTTP current authorization,
broker duplicate/gap/restart recovery and customer/operator/admin affected journeys,
including private attachments and participant retention decisions. Customer build/
typecheck and pinned Linux reference/candidate/diff/focus/accessibility flows plus
separate Windows/mobile-device interactions are also required for implementation.
Hash preservation proves reference bytes only. Fixtures, local unit/domain tests,
Socket notifications and foundation green checks cannot close these real gates.
Every new specification in this packet remains UNEXECUTED.
