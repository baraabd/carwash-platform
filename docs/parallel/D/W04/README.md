# W04-D — Cash operations entry and owner-bound proposals

Task: **W04-D**. Phase: **BLOCKED_ENTRY / lane-local proposals**.
Parent product implementation: **NOT_STARTED**. This is the bounded Day 3 task,
not acceptance of earlier waves or permission to implement W05.

## Verified current source

Observed main/proposal parent: `1ec9d8aebf4470a2815471116643fa6ebe0d5a95`;
tree `9f04d674056041bbc810a62e4cc7f275c32581b8`. This is **not BASE_W04**.
W03 proposals #51–55 are externally merged. Their 29 added paths since
`82e7402ed9ab6cc4f565f423441cd0655f2d627a` are documentation/declarative
specifications only. D #55 merged at `a2eb3aba835b48c0908fb4d0ac6339bd4120fbb3`.
Neither proposal merge nor foundation CI accepts the runtime parent.

The actual `architecture/parallel-contract-release.json` still reports W01 /
INTEGRATION_PENDING, BASE_W02=null, no BASE_W03 or BASE_W04 field, empty accepted
next-wave contracts and clients, and no published next-wave package versions.
The ownership registry retains unreconciled conditional W01 entries; the current
instruction and E's merged W02/W03 handoffs prohibit further bootstrap writes.
Permanent D ownership applies; stale registry entries do not restore E permission.

Applicable AGENTS, design lock, ADR 0004, reference manifests, F010 registry,
F001 catalog/ADR and VERIFICATION were inspected. F001's 19 service boundaries
supersede older grouping: no admin business database or new technician app.
Historical verification/status documents are distinguished from current source.

## Entry and concrete dependencies

| Required input | Current evidence / next responsible owner |
| --- | --- |
| Immutable BASE_W04 and assignment/Booking/cash/Communications/participant release | Unpublished; E must close predecessor provider/consumer reviews and publish versions, parsers, clients, routes and mandatory gates |
| W03 technician eligibility/private review and Booking views | Workforce/Media/Booking schemas remain markers; D admin remains foundation-only; C/A/B/E producers and approved D review states are required |
| Real Reporting primitives | Reporting has ServiceMarker, InboxMessage, ProbeProjection only; D must implement after accepted business events/snapshots and migration baseline |
| Admin create-on-behalf Booking | C Booking with Scheduling capacity, B quote/obligation, A customer/vehicle/consent and E distinct current permission; no alternate admin coordinator |
| Assignment/reassignment/operational execution | Dispatch owns assignment; C/E must freeze execution/binding authority, resource fencing and operator prerequisites before consumers |
| Field cash / custody / company settlement | B Billing receipt/postings and minimal Wallet custody; actual holder/receiver, financial policy, approvals and authoritative reads remain pending |
| Notifications/conversations/provider outcomes | D provider after accepted authoritative events/current participant scope; channel/provider/consent/retry policies and E topology/service identity remain pending |
| Live positions | W04 explicitly requires C **Workforce snapshots**, not Booking location as an alternate owner; missing contract, consent, timestamp, accuracy and freshness policy block display |
| Isolated combined environment/heavy slot | No W04 allocation, process or reservation exists; E must allocate accepted-source stack, roles/ports/queues/object prefixes/browser profile and one initial heavy slot |
| Missing production UI states | Product/design must accept exact operational, finance, delivery and stale/denied/conflict states; registered static references do not approve them |

Work execution persistence/authority remains unresolved: C's Booking Work proposal
is not an accepted expansion of the catalog. This is separate from the W04 task's
explicit Workforce location source. No new Work service or owner is chosen here.

## Authority and cash journey

| Fact / transition | Authoritative source | Admin / Reporting / Communications rule |
| --- | --- | --- |
| Customer beneficiary / consent / vehicle snapshot | A Customer / Vehicle | Current administrator and beneficiary are different identities; optional plate remains optional; disclose only approved minimal fields |
| Quote / cash obligation | B Pricing / Billing | Bind immutable quote, currency policy and due amount; prototype totals are not financial authority |
| Capacity claim / confirmation | C Scheduling / Booking | Use frozen owner commands, expected revisions and durable operation lookup; a timeout does not prove failure |
| Assignment / acceptance / rejection / reassignment | C Dispatch | Current assignment generation fences stale actions and former participants; no gateway/admin-owned assignment |
| Eligibility / arrival / start / private evidence / completion | C Workforce, accepted execution owner and Media | Independent eligibility and finalized clean purpose-bound media; completion is not a cash receipt |
| Field cash received | B Billing | Stable receipt and accepted collection evidence; no browser checkbox or uploaded image asserts receipt |
| Custody and handover pending | B Wallet with Billing links | Holder declaration does not establish treasury acceptance; no second ledger or checkout method |
| Company settlement | B Billing with reconciled Wallet outcome | Independent treasury authority/evidence and immutable posting references; the same cash must not become additional revenue |
| Operational notification / membership / delivery | D Communications consuming accepted C/A/E authority | Current server-verified participant scope; durable local intent, external acceptance, delivery, browser receipt and read are different evidence |
| Dashboard reconciliation / totals / lag | D Reporting from C/B events and authoritative reads | Separate counts/money columns by source and currency; delayed projections never authorize sensitive commands |

Required actual sequence: real customer confirmation and capacity → eligible
assignment/acceptance → arrival/start → private before/after evidence → service
completion → Billing collection receipt → Wallet pending handover → independent
admin treasury approval and Billing-backed settlement. Correlation connects owner
receipts and revisions; it does not create cross-database atomicity.

Manual booking uses C's accepted create-on-behalf command. Before each command,
refresh the relevant owner state, expected revision, capacity and current grant.
Double-click prevention is UI feedback; durable owner idempotency handles replay,
restart and lost responses. Competing/stale commands show conflict and refresh;
unavailable capacity never triggers an admin-local substitute booking algorithm.

## Current source and design gaps

`apps/admin-web/src/index.ts` is foundation-only/businessReady=false;
`packages/api-clients/src/index.ts` is an empty export. The legacy Gateway
`admin.dispatch` route targets Booking while the catalog assigns Dispatch its
own boundary; E/C must publish the reconciled contract, not merely reuse the name.
Identity V1 grants do not provide the required scoped cash/settlement/create-on-
behalf/participant authorities. Existing OTP email delivery is not SMS capability.

The admin reference has static KPIs, payment/custody figures, schematic Riyadh
markers, inert matching/report/export buttons and a four-field experimental manual
booking modal. Technician collection is local demo state with no B receipt.
Registered visuals remain locked. AG-02/07/08/12/15/16 and DEC-D-18 require precise
production states for detail/confirmation, pending/unknown/failure/conflict, denied
access, reconciliation, stale/offline location and delivery/conversation views.
Financial actor/purpose and provider decisions from W01 remain open.

INT-D-01 remains a **static integrity finding, not a reproduced database failure**.
Both Communications/Reporting inbox stores catch any transaction P2002/23505 as
DUPLICATE; the shared consumer ACKs that result. Real same-ID/different-hash races,
same-hash controls and unrelated effect-unique failures are required before adopting
the stores for product notifications/projections. No source repair is claimed here.

## Provider-first children to agree with E

| Proposed child | Entry / narrow acceptance scope |
| --- | --- |
| W04-C-BINDING / W04-C-OPERATIONS | Accepted C assignment/execution binding, current eligibility and participant authority first; direct DB/HTTP/revision/private Media tests, no dependency on an unmerged D app |
| W04-D-COMMUNICATIONS | Accepted producer event/current-access contracts and actual C/A/E authority; D-only durable records/migrations, Inbox integrity, message/read APIs, retries and verified provider outcomes; real owner tests before app consumers |
| W04-B-CASH / W04-B-CUSTODY | Accepted C prerequisites and any merged D client actually required; B's real receipt/treasury/custody primitives and constraint/recovery tests; no circular three-app gate before the provider exists |
| W04-D-REPORTING | Now-accepted C/B events, replay/snapshot/authoritative reconciliation reads; D append-only migrations, atomic effects/checkpoints and durable freshness/integrity acceptance |
| W04-D-ADMIN-CONSUMER | All consumed providers merged/accepted; real manual booking, assignment, cash approval, notification and fresh location flows plus affected Linux/device UI gates before consumer merge |
| W04-ABC-D-INTEGRATION | E serialized latest-target candidate and actual three-app cash journey, injected failures and correlated reconciliation; parent remains INTEGRATION_PENDING until all cases pass |

These are proposed child boundaries, not new branches/PRs or accepted gates. If a
provider needs another provider, split a narrow binding/read authority first;
fixtures cannot satisfy that prerequisite. E retains all mandatory CI and actual
resulting-target verification. No peer feature branch is an implementation base.

## Full approved admin inventory remains visible

| Screen ID | W04 state / retained scope |
| --- | --- |
| dashboard | Selected cash/reconciliation scope BLOCKED; reference KPIs only |
| bookings | Selected manual/queue/detail scope BLOCKED; cancel/reschedule remain W05 |
| customers | A-owned display/consent prerequisite BLOCKED; full retained inventory pending |
| technicians | W03 eligibility/private-review predecessor still BLOCKED |
| services | Retained B catalog/configuration scope pending |
| fleet | C resources/eligibility prerequisite BLOCKED; retained full scope |
| payments | Selected cash receipt/treasury approval scope BLOCKED; electronic/refund W05 |
| wallets | Selected custody/handover/reconciliation scope BLOCKED; no stored-value expansion |
| subscriptions | Retained future approved customer entitlement scope pending |
| promotions | Retained B Pricing scope pending |
| coverage | A Geo/C availability prerequisite BLOCKED; real Aleppo inputs pending |
| live | Selected C Workforce last-update/accuracy/stale/offline scope BLOCKED |
| reviews | Retained Reviews moderation scope pending; distinct from technician verification |
| disputes | Retained Support scope pending |
| notifications | Selected durable Communications/delivery scope BLOCKED |
| reports | Selected separate counts/cash/custody/settlement/freshness scope BLOCKED |
| settings | D Configuration and E Identity policy prerequisites BLOCKED |

See [Communications and Reporting plan](COMMUNICATIONS_REPORTING_PLAN.md),
[declarative acceptance specification](../../../../tests/parallel/D/W04/ACCEPTANCE_SPEC.md),
[W05 requests](W05_CONTRACT_REQUESTS.md), [source observation](SOURCE_OBSERVATION.json)
and [English handoff](HANDOFF.md). Every product case remains BLOCKED/NOT_RUN.
Cancellation/rescheduling are not activated, implemented or required as W04
operations. W05 proof review/refunds/settlement corrections are proposals only.
Stop at this bounded reviewed handoff; no automatic next wave, merge or deployment.
