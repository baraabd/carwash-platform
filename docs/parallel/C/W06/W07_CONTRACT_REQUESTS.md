# W06-C — W07 contract requests

REQUESTED / NOT_ACCEPTED / NOT_IMPLEMENTED. Semantic families below need exact owner-reviewed IDs/versions/closed schemas/parsers/clients and E immutable BASE_W07 publication after real W06 acceptance, not private DTOs.

| Owner/family/consumers | Request/result/event semantics to freeze |
| --- | --- |
| B Pricing promo reserve/commit/release/restoration → C/A | Current subject/guest, promo/quote/policy revisions, eligible items/stack, exact discount Money, budget/use limits, reservation/expiry and operation/result/restoration receipts. Last-use uniqueness and no automatic restoration |
| B Pricing requote/rebooking → C/A | Immutable old snapshot and current catalogue/vehicle/Geo/availability refs, original/new quote versions, exact Money/rounding/expiry, changed-item/price acceptance and stale errors; no historical overwrite |
| B finance/benefit + C cancellation → A/C/D | Booking/version/lifecycle fence, cancellation policy, original capture/consume/promo effects, independent release/correction/refund/restoration receipts and partial/unknown/review; no refund-implies-benefit revival |
| C Workforce/Dispatch/Booking and B financial-read → operator/D | Current work/resource/grant, approved holder/purpose/fieldset, independent received/custody/benefit/refund refs/asOf/freshness; no merchant proof/full-ledger leak or operator verification grant |
| D Communications notification/reconnect → A/C/D | Current recipient/consent/channel/template/purpose, source event/revision/cursor, dedup/send/delivery/unknown outcomes and redaction; source repair not resend; OTP not SMS proof |
| D Support → actual C/B/E owners | Verified requester/delegation/subject/object/purpose, action/task IDs, expected revisions/reason/policy, actual per-owner status/audit; receipt grants no refund/eligibility/privacy authority |
| D/E privacy coordinator and C Media/Workforce/owners | Verified request/task/subject/current grant, approved export/anonymize/retention scope, policy/legal hold/deadline, per-owner result/retained categories, private scanned export digest/expiry/revocation; partial/request-only/completed distinct, required derived/queue/cache/provider/backup copies mapped |

Every family closes required/null/unknown fields/enums and owner revisions; canonical Money/currency/minor-unit/rounding and UTC/approved market timezone; current audience/actor/guest/delegation/object/purpose checks at execution/replay; idempotency owner+operation-major+actor+target and canonical fingerprint/conflict/concurrent-pending/original replay/lifetime with lasting business uniqueness; errors/timeouts/deadlines/authorized unknown lookup; original-effect linked compensation; atomic state/audit/outbox and inbox/effect, event hash conflict/old/gap/reorder/source repair; minimal private-data projection and backward compatibility. Preserve strict booking.confirmed.v1; new fields require accepted version, not reader widening.

Provider-first: B real promo/price/restoration/posting constraints, C cancellation/resource fences, D/E narrow current Support/privacy task authority; then C Booking/operator and A/D actual journeys before consumer merge. E publishes route/grant/topology/packages/config/resource/gate changes. Full D fleet admin-browser acceptance remains explicit W07 dependency. No W07 execution from this request.
