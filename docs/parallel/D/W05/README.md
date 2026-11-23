# W05-D — Authorized financial operations entry

Task: **W05-D**. Phase: **BLOCKED_ENTRY / lane-local proposals**.
Parent product implementation: **NOT_STARTED**. Day 4 AM is a conditional
milestone, not proof of a provider, policy, base or implemented financial action.

## Current immutable source

Observed proposal parent/target: `3ce756cd39a9b0c1013043cee0ca1bb183466da7`;
tree `cc3517ec85525c7310fe340397506ef6be3fe0a9`. This is **not BASE_W05**.
All W04 proposals #56–60 are externally merged, including D #57 at
`b5ea7b620eab777685959d71dacd5b43632a2617`. Their 31 additions since
`1ec9d8aebf4470a2815471116643fa6ebe0d5a95` are lane documents/declarative
specifications only; no app/service/shared runtime changed.

The actual E release registry remains W01 / INTEGRATION_PENDING: BASE_W02 is
null, BASE_W03/04/05 fields are absent, accepted next-wave contracts and clients
are empty, and next-wave package publication is empty. E must complete the
earlier reviewed contract/provider/barrier process; relabeling this main SHA
cannot supply an accepted W05 base. Merged proposals are not semantic acceptance.

E bootstrap cross-owner permission is expired by current instructions and merged
handoffs. The historical conditional ownership registry/checker is unreconciled,
does not restore permission, and does not authorize dependent product writes.
Only D-local proposals/specifications are changed in this sprint.

Applicable AGENTS, design lock, frozen customer/technician/admin references,
manifests/F010, ADR 0004, architecture/VERIFICATION and F001 catalog/ADR were
inspected. The catalog's 19 service boundaries supersede older grouping. Admin
and Gateway own no financial database; no new technician application is created.

## Concrete entry dependencies

| Required provider/input | Actual current fact / closure owner |
| --- | --- |
| Accepted BASE_W05 and B finance/C Media/E permission release | Unpublished; E with reviewed provider/consumer schemas, parsers, clients, routes/errors, versions and actual gates |
| Payment status, proof review, verification, refunds, reconciliation and settlements | Billing/Wallet marker-only; B must implement real owned persistence/HTTP/constraints/operation recovery with approved financial policy |
| Payment-bound private proof | Media marker-only, no purpose-bound proof access; C needs B binding first, current E finance scope, scan/finalize/read expiry and audit |
| Current Finance authority / approval limits / reasons | Identity foundation has billing.read/refund only; W05 object/market/action/reviewer/treasury/export grants and limits are not published |
| Cancellation and rescheduling | Booking/Scheduling/Dispatch product APIs absent; C must supply durable owner operations and B compensation/refund status separately |
| Actual merchant/provider verification | No accepted setup, merchant/sandbox evidence, adapter/documentation or verification method in current release; product/B/E must resolve and prove test-fund capability |
| Communications financial events / Reporting freshness and audit | D workers consume foundation probes only; product persistence, accepted financial events/snapshots and source revision/coverage are absent |
| Operational and financial UX states | Static prototype is not an approved proof/refund/settlement/cancel/reschedule/pending-compensation design; exact production states require product/design closure |
| W05 isolated environment and heavy slot | Not allocated/reserved; E supplies real source-bound DB roles, queues, object prefixes, ports, browser profiles and one initial heavy acceptance slot |

Cash, ShamCash and Syriatel Cash remain the three frozen methods. Wallet is
internal custody, not another checkout method. Paymera remains an unresolved
recorded scope/provider decision; no fourth method is added, silently dropped
from required scope, or represented as an implemented connector. Merchant setup
and sandbox verification must be evidenced after that decision; sample QR/payment
data cannot supply either. Production payment/refund execution is not required
to test this task: actual authorized sandbox/test-fund evidence is required.

## Independent financial and operational facts

| Fact / action | Authoritative owner | D consumer rule |
| --- | --- | --- |
| Evidence submitted / processed / previewed | B payment binding + C Media | Narrow selected proof/purpose access; no contents, permanent URL or sensitive identifiers in logs, query URLs, analytics or browser persistence |
| Proof review / correction / rejection | B Billing | Current finance-review scope, approved reason, expected revision, durable operation/audit; uploaded proof is not received funds |
| Provider-verified funds | B Billing | Independent accepted verification method matching transaction/beneficiary/Money; provider callback or image must not be accepted without owner verification |
| Recorded cash / custody / handover | B Billing / Wallet | Field receipt, holder declaration and treasury acceptance stay independent; custody movement is not a new payment |
| Refund requested / reserved / approved / submitted | B Billing | Show durable operation and current authority; request is not executed refund; concurrent requests cannot exceed approved remaining value |
| Refund executed / partial / failed / unknown | B Billing | Authoritative amount/currency/revisions and immutable original/reversal links; timeout recovers the same operation rather than resending money |
| Company settlement / discrepancy / correction | B Billing with Wallet reconciliation | Independent receipt/posting/treasury evidence and policy; no locally changed balance or hidden bypass |
| Cancellation intent / actual Booking lifecycle | C Booking | Durable versioned operation and per-owner progress; successful cancellation can coexist with failed/pending B refund |
| Rescheduling / capacity / assignment | C Booking, Scheduling, Dispatch | Authoritative old/new reservation and expected revisions; alternative-slot conflict and partial progress remain visible |
| Customer/operator notifications and membership | D Communications from accepted owner facts | Server-current recipients, durable delivery/read distinctions, no successful notification implies cancelled/refunded |
| Financial report / export initiation | D Reporting from B/C source and current grant | Separate source revision/coverage/freshness and audited actor/scope/reason; report totals never authorize money movement |

Trace each admin command as page → accepted public client → E Gateway credential/
CSRF transport → B/C current object/action/market authorization → owner durable
command receipt/audit/outbox → operation status and independent D read copies.
This path is required behavior, not present implementation. Operations/Support
cannot gain financial authority through direct requests or role/actor headers.
Each owner rechecks current authority on mutation, replay, operation read and
private access; hiding a button is insufficient.

Financial commands pin exact owner versions, reason/policy, amount/currency and
business identity. A response lost after commit leaves an uncertain operation;
retrieve its durable outcome under current authorization. Same fingerprint
replays the original result; changed payload conflicts. New idempotency keys must
not bypass business uniqueness or create a second refund/settlement.

Cancellation **and rescheduling are now W05 scope and required real C/B tests**.
Do not carry W04's deferred-action boundary into this task. Booking owns durable
coordination; Scheduling capacity and Dispatch assignment remain separate owner
facts; B owns financial compensation. Late payment cannot resurrect expired
capacity, and a failed alternative slot cannot be disguised as successful
rescheduling. Exact eligibility, fee/refund and replacement/release policy must
be approved before implementation; D invents none.

## Actual source and missing approved surfaces

Admin is foundation-only/businessReady=false; api-clients exports no client.
Current F007 has GET /admin/billing and POST /admin/billing/:id/refund as routing
contracts, not a real B business controller. Query strings are rejected; there
are no accepted payment search/detail/proof/recovery/settlement/cancel/reschedule
routes or Media/Wallet gateway ownership. E must publish the exact supported
transport without privately extending shared code from D.

Billing/Wallet/Media/Booking/Scheduling/Dispatch schemas are ServiceMarker only.
Communications is marker/Inbox/ProbeNotification; Reporting is marker/Inbox/
ProbeProjection. Existing Identity security is preserved; it does not close
W05 fine-grained finance policy. The unconnected pure Billing ledger and Booking
lifecycle are not production providers.

Static payment/custody rows and inert reconciliation/export controls provide no
proof queue/detail/viewer, reviewer conflict, refund amount/reason/approval,
settlement discrepancy, operation recovery or cancel/reschedule compensation
screens. Approved design gaps include precise pending/unknown/denied/expired/
failed/partial/stale/empty/loading states, permission/reason confirmations and
financial report/export status. Production English/LTR states are also missing.
Keep reference hashes/layout/copy/icons/RTL/focus/motion and seven customer steps.

INT-D-01 remains **static/not runtime reproduced** in both D Inbox stores:
whole-transaction P2002/23505 becomes DUPLICATE, which the consumer ACKs.
Changed-byte races and unrelated effect-unique rollback must be tested and
repaired under accepted D provider scope before financial-event adoption.
No bug repair, database reproduction or acceptance is claimed by this packet.

## Provider-first children to agree with E

| Proposed child | Narrow provider acceptance before dependent consumer |
| --- | --- |
| W05-B-PAYMENT-BINDING / W05-C-PROOF | B actual payment/proof authority first, then C real private upload/scan/finalize/read; avoid requiring the future admin viewer to accept Media |
| W05-B-VERIFY-REFUND-SETTLEMENT | B current permission/constraints/durable operations/immutable postings and real sandbox verification/callback/unknown-outcome gates; test funds only |
| W05-C-CANCEL-RESCHEDULE | Accepted Scheduling/Dispatch/financial primitives first, then durable C orchestration and owner DB/revision/capacity/compensation tests; split binding providers if cyclic |
| W05-D-EVENT-CONSUMERS | Actual frozen B/C financial/lifecycle events and repair reads; D Communications/Reporting migrations, atomicity, history/freshness, private recipient scopes and sensitive audit/export gates |
| W05-D-ADMIN-CONSUMER | Now-merged real providers and approved states; actual proof/finance/refund/settlement/cancel/reschedule journeys before consumer merge |
| W05-ABC-D-INTEGRATION | E latest-target candidate and resulting-target checks with customer/operator propagation, exact capacity/financial convergence, independent review and platform evidence |

These are proposed child scopes/gates, not opened implementation branches or
accepted base versions. A fixture is never a runtime provider. Keep all mandatory
CI; do not impose an unmerged consumer full journey as a producer's initial gate.

## All 17 admin screen rows retained

| Screen ID | W05 state / retained scope |
| --- | --- |
| dashboard | Financial/operational independent freshness scope BLOCKED |
| bookings | Required cancel/reschedule/read/compensation scope BLOCKED |
| customers | A ownership/consent/display prerequisite BLOCKED; full scope retained |
| technicians | Earlier eligibility/private-review prerequisite still BLOCKED |
| services | Retained B catalog/configuration scope pending |
| fleet | C resource/current assignment/capacity prerequisite BLOCKED |
| payments | Selected proof/status/refund/reconciliation scope BLOCKED |
| wallets | Selected custody/company settlement views/actions BLOCKED; no stored value |
| subscriptions | W06 B admin/entitlement contract proposal; retained future scope |
| promotions | Retained B Pricing scope pending |
| coverage | A/C actual market/availability prerequisite BLOCKED |
| live | Earlier Workforce last-update/accuracy/stale/offline prerequisite BLOCKED |
| reviews | W06 verified eligibility request; no unverified customer review activation |
| disputes | W06 Support resolution/refund linkage proposal |
| notifications | Selected financial pending/failure/correction consumers BLOCKED |
| reports | Selected financial history/freshness and export-initiation audit BLOCKED |
| settings | D Configuration/E Identity finance/actor/policy prerequisites BLOCKED |

See [financial operations plan](FINANCIAL_OPERATIONS_PLAN.md),
[declarative cases](../../../../tests/parallel/D/W05/ACCEPTANCE_SPEC.md),
[W06 requests](W06_CONTRACT_REQUESTS.md), [source observation](SOURCE_OBSERVATION.json)
and [English handoff](HANDOFF.md). Every product case is BLOCKED/NOT_RUN.
W06 Support/Reviews/consent/conversation/Wallet/Subscription requests are proposals
only; no automatic next-wave implementation, self-approval, merge or deployment.
