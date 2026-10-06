# W07-A — commerce and repeat acceptance requests

**PROPOSED_NOT_ACCEPTED / BUSINESS_IMPLEMENTATION_BLOCKED.** Source:
`f01e87f4619414960e9e39c65e523a3250fbcbaf`. Use the candidate schemas in
[A/W06](../W06/W07_CONTRACT_REQUESTS.md) only as review input. E must publish
owner-reviewed routes/events/clients in the actual BASE_W07 before binding them.

## Separate authoritative facts

| Required customer fact                                                      | Authority and honest presentation/recovery                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Plan discovery, eligibility, units, remaining washes, plan/history revision | B Subscription; current authorized beneficiary and approved plan publication. Missing data means unavailable, not zero or an invented plan. History is bounded and source/revision/as-of identified.                                                                                       |
| Purchase intent and financial qualification                                 | B Subscription purchase plus B Billing verified original obligation/posting. Navigation, proof image or browser acknowledgement cannot activate a plan. Distinguish rejected purchase, pending/unknown payment and pending activation.                                                     |
| Activation and expiry                                                       | Subscription decides from accepted policy and authenticated financial evidence. Successful payment is a distinct fact; do not call benefits active while activation is unknown. Explicit reconciliation reads the original purchase, never creates a second purchase.                      |
| Entitlement reserve/consume/release/correction                              | Subscription owns its reservations and units; C Booking owns durable coordination and Scheduling owns capacity. Approved policy fixes consume trigger, lifetime and restoration; an unconsumed reservation, consumed use and correction have distinct receipts.                            |
| Freeze/resume/cancel and renewal if approved                                | Subscription owns the current transition and lifecycle fence, Billing owns any refund/credit and Wallet its posting references. Requested cancellation, cancelled plan and paid refund are separate. Renewal never books a date or authorizes automatic debit.                             |
| Promotion validity/eligibility/combinability/use budget                     | B Pricing owns current facts; D supplies approved offer/policy governance via owner APIs. A requests a verdict and safe approved rejection reason; it does not evaluate codes/budgets from client fixtures.                                                                                |
| Current bill and final receipt                                              | Pricing supplies itemized Money, approved currency/precision, rounding/tax/policy and quote revisions/expiry; Booking preserves its accepted snapshot, Billing supplies financial receipts. A formats server amounts without applying a local discount or recalculating entitlement value. |
| Current object authorization                                                | E publishes credential/grant transport; every owner verifies current beneficiary/object/purpose independently. Guest capability scope/linking is explicitly accepted, never inferred from matching a phone or local session order.                                                         |

Required subscription display states include discovery/detail, purchase review,
activation pending/unknown, active/exhausted/expired/frozen/cancelled and history;
freeze/resume/cancel request and independent financial consequences. These are
required state families, **not approved copy, screens or enum values**. No such
routes exist in current router.tsx. Product/A/B/E must approve exact reference,
state placement and Arabic copy; approved renewal scope is still unresolved.

Production promotions must map home discovery, care/package applicability,
quote rejection/change, Review consent and receipt without merging any of the
seven decisions. The frozen customer prototype supplies package cards, not an
approved promotion input or Subscription management design. Confirm placement,
interaction, eligibility/expiry/change/rejection/loading/unknown states and copy.
Do not invent a coupon field, new tab, mandatory login or silent screen removal.

## Wire and policy decisions to close before binding

The prior candidate includes `SubscriptionPurchaseV1`, purchase/plan views,
manage/entitlement commands, promotion eligibility/reservation/mutation views,
repeat-quote and A admin shapes. Review the complete schemas and guards in the
prior packet, including WITHHELD fields being null and REDEEMED requiring actual
Booking/effect references. Publish one reviewed release, not A-private adapters
for incompatible owner meanings.

| Decision                     | Accountable acceptance input                                                                                                                                                                                                                             |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plans and policies           | B/product: real units/price/beneficiary/vehicle/package/zone limits, validity/timezone, renewal, freeze windows, consumed/unused refunds, proration/rollover, expiry and rejected transitions. Basic/Premium/Fleet samples remain samples.               |
| Quote and promotion identity | B/C/E: pre-confirmation Booking intent, quote/policy/offer revisions, explicit consent fingerprint and reservation fence. Eligibility/read-only quote must not require an already consumed benefit or completed Booking.                                 |
| Limits and stacking          | Pricing/product: actual validity instants/market zone, eligibility, combinability/order of application, per-subject/Booking/business-use budget, rounding and expiry; no guessed duration or percentage.                                                 |
| Cross-owner compensation     | B/C: actual original reserve/consume/capture/redemption IDs, current lifecycle revision and distinct release/correction/refund receipts. Refund never implies capacity or benefit resurrection.                                                          |
| Recovery semantics           | Owners/E: exact operation-scoped key + canonical fingerprint, replay/conflict, retention/lifetime, deadline, status lookup and terminal/partial/unknown/error result. Permanent business identity prevents duplicate effect under different client keys. |
| Transport                    | E: accepted bounded list/cursor/status/query/conditional-header transport; current Gateway rejects queries and JSON transport alone does not publish the new required surfaces. Freeze error/source-quality/revision semantics before consuming.         |
| Compatibility                | E/owners: retain real Identity V1 and strict booking.confirmed.v1; new facts require reviewed new exports/events or explicit version changes. No expanding old event payload in a consumer.                                                              |

Concrete merged-proposal reconciliation gaps remain before acceptance:

- A's FREEZE/RESUME/CANCEL and B's pause/renewal/change families need approved
  action-specific fields and effective-date meaning; requested, scheduled and
  effective cancellation are different facts. No implicit expansion to renewal
  or plan change from a management enum.
- A promotion reserve binds an initial quote, while repeat requires a revalidated
  quote bound to that reservation. B/C/E must freeze **rebind/supersede/invalidate**
  semantics between both quote identities and new consent; the prior shapes do
  not yet publish that transition. Old reservations must not redeem an
  incompatible quote or release/restock quota twice.
- A/B/C request freeze/cancel fences but publish no exact claim/terminal-noncommit/
  revocation/late-worker protocol. Expected revision or a cached reservation list
  cannot prove an in-flight remote consume will never commit.
- B's repeat/amendment/replacement requests are broader than A's fresh repeat.
  Publish distinct operation types: fresh repeat never cancels/amends the source
  Booking, charges amendment fees or transfers historic benefit/payment effects.
- Preserve closed W01 entitlement/Wallet schemas while introducing reviewed new
  fields/actions. Consumed entitlement needs an authorized linked correction,
  not a generic RELEASE. Existing Wallet V1 release's posting requirements must
  not be relaxed in an A consumer.

These are acceptance gaps, not established contradictory policies or permission
to change shared DTOs. [W08 requests](W08_CONTRACT_REQUESTS.md) bind adversarial
evidence to the eventual single accepted mappings. The read-only quote/plan →
narrow C intent → B mutation provider → C full coordinator sequence must be
agreed and tested with E, rather than waiting on final UI or a circular final
Booking requirement.

## Repeat, resume and follow-up trace

`HomeBookingEntries.tsx` renders active-order follow-up, latest-completed repeat
and touched-draft resume. `homeViewModel.ts` selects page-memory orders and
fixture packages/prices; cancelled orders are not offered by Home's completed
selector. `CustomerSessionProvider.tsx` calls pure transitions in bookingEntry.ts.
`viewOrder` only opens tracking when a local ID exists. OrdersRoute is still a
placeholder, and completion history has no production repeat entry.

`repeatOrder` accepts any existing local order ID, copies snapshot choices into
a draft, detaches saved vehicle ID, defaults unknown vehicle/package IDs to demo
defaults and drops unknown/duplicate extras. It picks `earliestSlot(now)` from
the deterministic five-day schedule, never the historical slot, and resolves
Review or the first missing-input step. It does not create an order; explicit
C014 confirmation later appends an unpaid session order. This is valid demo
behavior, not a current Catalog/Geo/Scheduling/Subscription/Pricing check.

`resumeBooking` guards missing/stale demo input but does not reacquire a server
quote, discard an actual hold or reconcile an already submitted durable command.
`startBooking` may prefill the first saved vehicle/address in memory. Defaults
cannot become permission to substitute a retired product or deleted record in
production. Existing historical snapshots stay immutable.

## Required production sequence — candidate, not runnable implementation

1. Read the authorized real historical Booking snapshot and current allowed
   reusable fields. Preserve source Booking/version; distinguish completed,
   cancelled and active requests. Unknown/foreign IDs reveal no record.
2. Build an **unsubmitted draft** with permitted vehicle/contact/address/package/
   extras choices. Drop old slot, holds, expired quote, promotion/entitlement
   reservation and payment/provider operation references. Do not carry a prior
   financial receipt as payment for a new Booking. Keep historic evidence intact.
3. Resolve current saved-record revisions/ownership/archive state, current
   Catalog publication, Geo coverage and Scheduling availability. A historical
   textual address/vehicle snapshot may be proposed only according to approved
   reuse policy. Missing/deleted/retired data gets a visible correction decision,
   never silent replacement with a fixture or automatic save.
4. Acquire fresh Pricing quote and current Subscription/promotion eligibility.
   Read-only eligibility/initial quote has no reserve/charge side effect. Publish
   narrow real Booking intent before benefit reservations if accepted contracts
   require it; this breaks the circular dependency with final confirmation.
5. Use actual current reservation/fence and revalidated quote for selected
   benefits; reacquire current capacity according to C's accepted protocol.
   A changed/expired/rejected offer or price invalidates prior consent; preserve
   draft choices, show the approved new server breakdown and require explicit
   confirmation. A zero server balance does not mean an unavailable response.
6. Confirm the new Booking explicitly using accepted revisions/fingerprint.
   Duplicate submit/restart uses the same business/operation identity. Transport
   timeout triggers lookup of the original operation; no second Booking or
   charge, no optimistic wash-count/balance increment, no stale hold reuse.
7. Reflect each actual Booking/capacity/payment/benefit/promotion compensation
   independently, including partial/unknown/review. A late payment cannot revive
   expired capacity or a cancelled plan. Fetch authorized current snapshots to
   display the result; delayed Reporting cannot authorize a new financial action.

## Production cutover remains an explicit gate

Current `initialSession.ts` always chooses fixture state, including fallback;
`customerCatalogFixture.ts`, priceBreakdown.ts and scheduling.ts are demo sources.
No real production data path is implemented, so this PR does not relabel the
existing demo as production or remove its deterministic reference/test inputs.

After accepted providers/designs exist, E/A must publish the actual production
entry/bundle/config contract. Production entrypoints must have no scenario-query,
unknown-response, auth/error/offline or dynamic-import fallback to demo orders,
prices, availability or merchant simulation. Preserve the frozen prototype as
reference. Prove this on the final bundle, runtime requests and full journeys;
static import inspection alone is insufficient.

W06 account/help/navigation/error/empty/privacy/wallet/chat/review/private-media
gaps carry forward in the complete inventory. Their approved owner effects and
real customer/operator/admin acceptance remain required; W07 commerce work
cannot close them by document publication or fixtures.
