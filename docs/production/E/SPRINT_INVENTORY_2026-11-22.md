# Sprint inventory and remaining production scope — 2026-11-22

## Scope and evidence boundary

The inspected baseline is main
`7aace4b515ca4efa179293624b2395d9f8121e88` (PR #146). The working candidate
contains additional corrections recorded in
[Customer conformance](CUSTOMER_CONFORMANCE_2026-11-22.md) and the candidate's
change set. This inventory does not certify an uncommitted tree, set
`BUSINESS_READY`, or replace final CI and release-barrier receipts.

Three sources answer different questions:

- `architecture/implementation-status.json` records foundation acceptance on
  `f364792d78cf572444df8093c2e4c6315becdae9`, dated 2026-10-01. Its later
  service inventory is dated 2026-10-05 and is not an up-to-date description of
  all subsequent business implementations.
- `docs/customer/C001_BEHAVIOR_INVENTORY.md`, the customer parity manifest and
  the C003–C014 documents define bounded prototype/React-port work. Their
  explicit exclusions distinguish those deliverables from production journeys.
- `traceability-matrix.json` and `TRACEABILITY_RECONCILIATION.md` reconcile
  production requirements on `a84b5ee`, dated 2026-10-13. Their row identifiers
  and closure map remain useful, but their old branch status, blocker counts
  and acceptance observations must not be presented as current observations.

Merged implementation, historical acceptance, current test results and complete
production scope are recorded separately below. No completion percentage is
inferred from test counts.

## Foundation: completed in the recorded foundation scope

All ten entries are marked `merged-and-verified` in the foundation registry,
against the historical verification record above. Current regression and
deployment evidence remain separate requirements.

| Sprint | Completed foundation capability |
| --- | --- |
| F001 | Monorepo ownership boundaries and foundation acceptance that rejects missing evidence. |
| F002 | Pinned Node/pnpm toolchain and frozen dependency discipline. |
| F003 | Clean-architecture service template and layer/import enforcement. |
| F004 | PostgreSQL ownership, runtime/migration-role isolation and schema-drift checks. |
| F005 | RabbitMQ foundation with durable Outbox/Inbox delivery semantics. |
| F006 | Identity authentication, sessions, Redis-backed browser security and authorization foundation. |
| F007 | Stateless authenticated Gateway/BFF foundation and routing contracts. |
| F008 | Redacted correlated observability and HTTP-to-message trace propagation. |
| F009 | CI/security gates, CodeQL, dependency/secret scanning and runtime-image checks. |
| F010 | Deterministic three-app golden HTML comparison, reference integrity and tracked design debt. |

These capabilities do not by themselves establish that every later business
route, financial operation or front-end journey is implemented and accepted.

## Customer C001–C014: implemented within their original bounded scope

The original C001–C014 unit suites passed 304 tests before the current repairs.
The modified customer slice passed 332 unit, bundle-boundary and HTTP-client
tests. Those results support the tested behavior; browser parity still needs
the exact candidate's canonical CI evidence. None of the original C documents
claims a complete production checkout.

| Sprint | Implemented deliverable | Additional production work |
| --- | --- | --- |
| C001 | Inventory of approved HTML behavior and machine-readable parity manifest. | Trace actual owner-service flows and acceptance evidence for every production action. |
| C002 | React shell, routing, navigation and feature/state boundaries. | Current candidate adds real guest entry/recovery and guarded loading/error/session states. Account registration/login UI and complete persisted booking journeys remain. |
| C003 | Home, resume/repeat entry and deterministic scenarios. | Live orders, repeat eligibility and durable drafts. Current candidate adds validated live Catalog/profile reads. |
| C004 | Vehicle selection in the booking draft. | Read owned Vehicle records and resolve their actual versioned snapshots. |
| C005 | Garage, saved vehicles and shared vehicle editor in session state. | Current candidate adds owner-backed create/read/update/archive, conflicts, exact retry and reload persistence. Exact-candidate real-browser acceptance and the vehicle-to-booking journey remain. |
| C006 | Package selection, package details and illustrative cost breakdown. | Published catalog selection plus a real expiring Pricing quote. Live Catalog browsing alone supplies no price. |
| C007 | Extras/add-on selection and illustrative calculations. | Real eligibility, identifiers, rates and quote validation. |
| C008 | Location/address selection and illustrative map. | Owned location data, serviceability and approved operational coverage. |
| C009 | Address book and shared editor in session state. | Canonical address CRUD adapter, persistence and revision conflicts. Current candidate adds the owner snapshot endpoint used by Booking. |
| C010 | Demonstration time selection and earliest illustrative appointment. | Real availability, capacity holds, expiry and confirmation. Choosing a prototype time reserves nothing. |
| C011 | Contact details and technician note in the draft. | Current candidate adds canonical authenticated profile writes without claiming phone verification. Connecting those facts to the durable booking journey and required operational verification remains. |
| C012 | Selection of cash/Sham Cash/Syriatel Cash as a draft method. | Billing intents, real provider verification and correct payment outcomes. No money operation occurs in the original sprint. |
| C013 | Review, summary and edit-and-return of an unsent draft. | Real quote/snapshot/hold checks immediately before the Booking command. |
| C014 | Idempotent confirmation of an in-memory demonstration order and route handoff. | Durable Booking creation, retry recovery and actual order/payment state. Current production mode refuses the demonstration command. |

The current candidate makes fixture scenarios selectable only in explicit
`parity` builds. It adds validated Catalog reads, real guest entry/recovery,
canonical profile writes and owned garage CRUD, and corrects Customer
profile/snapshot contracts. Six real Gateway/Identity/Customer/Vehicle integration
cases pass locally; a mandatory production-browser family is added for CI.
The remaining address and booking paths are not a completed production integration.

## P01–P06: substantial implementation, broader closure still required

The following assessment combines the owner implementation files, the
`docs/production/{A,B,C,D,E}` documents, the traceability requirements and the
current corrections. Older `README` statements such as “PR open” or “not
started” are not treated as authoritative when the implementation is present on
main. A passing provider suite does not substitute for the complete consumer
journey.

| Sprint group | Implementation present | Remaining closure criteria |
| --- | --- | --- |
| P01 — core business services | Customer, Vehicle and Geo providers; Catalog/Pricing; Workforce/Scheduling; Reporting, Communications and Configuration foundations; shared contracts and guest Identity foundation. | Real consumer/provider wire conformance, proper service identities, customer persistence and launch configuration. The current candidate repairs actual Customer profile/snapshot wire drift and Vehicle workload authentication. |
| P02 — booking, dispatch and billing | Versioned Scheduling holds, durable Booking coordinator, Dispatch assignment/offers, Billing obligations/payment intents and initial admin operations. | A complete customer journey through real owners, outbox/inbox publication and recovery, correct Gateway routes and real customer order queries. The current candidate repairs Booking creation/list routing and adds an owner-filtered `/mine` list; the customer checkout UI is still unconnected. |
| P03 — technician, admin and cash | Technician task execution, private Media, Workforce, operations/reporting UI, Billing receipts/custody and treasury reconciliation. | Real Gateway/Identity-to-owner journeys, durable Billing proof for cash collection, complete permissions and current browser evidence. The current candidate connects the cash path to Billing evidence and repairs production routes; a Dispatch declaration alone is not a receipt. |
| P04 — payments, cancellation and refunds | Payment-provider abstraction, reconciliation/refund core, Support exception cases, Booking cancellation/reschedule saga with Scheduling/Dispatch compensation, Gateway payment/security primitives. | Provider-specific verified integration, full published refund conformance, complete customer/admin UI, policy values and exact-source failure/recovery acceptance. Live merchant credentials and official provider facilities are external inputs. |
| P05 — subscriptions, wallet and support | Subscription entitlement/ledger core, Pricing promotions, custody-only Wallet projection, technician profile, Support and Configuration capabilities, published advanced contracts. | Subscription purchase/Booking consumption and cancellation restoration journeys; actual product interfaces for subscriptions/promotions/custody/support/settings; Reviews implementation and moderation journey; notification-channel delivery. A custody projection does not implement a customer stored-value wallet. |
| P06 — financial and operational closure | Merged Catalog/Pricing conformance, Billing Booking-saga/admin-finance improvements, finance matrix, traceability baseline and technician/media closure work; additional bounded corrections in the current candidate. | Complete the lane closure map below, resolve remaining contract/provider/UI gaps, and produce the exact candidate's mandatory release receipts. Documentation and safety boundaries do not close missing product functionality. |

Concrete implementation checks supporting this distinction include the four
ported admin screens in `apps/admin-web/src/ui` (dashboard, bookings,
technicians and payments), the remaining absent product screens, and
`services/reviews/src` retaining its foundation shell rather than a Reviews
business controller. Historical documents referring to Reviews code in another
worktree do not establish its presence on main.

## Exact closure sprint identifiers already defined by the project

The authoritative map is `traceability-matrix.json` → `closeSprints.sprints`.
It explicitly says only numbered file 01 was supplied at that time; subsequent
work was mapped by lane. Do not invent P06-CLOSE-02 through 06 or new S01/S02
completion records. A later real document and merge establish P06-CLOSE-07.

| Existing ID | Present disposition | Concrete next closure work |
| --- | --- | --- |
| P06-CLOSE-01 | Baseline/traceability deliverable merged in PR #145. | Reconcile statuses against current source/evidence without replacing original requirement IDs or erasing unresolved gaps. |
| P06-A | Customer production integration remains partial. | Account entry, canonical address writes, Geo, Catalog/Pricing, availability/holds, Booking create/change, payment and order tracking; real service and browser evidence. Current changes close the fixture boundary, live browse, guest/recovery, canonical profile/snapshot and garage CRUD slices, subject to exact-candidate CI. |
| P06-B | B1 Catalog (#135), B2 Pricing (#142), B4 Billing saga (#136), B5 matrix (#133) and B6 admin finance (#144) are merged bounded work. | Reconcile remaining refund and event/outbox behavior, cash/custody integration and subscription/promotion consumption; verify the finance matrix on the final source. Do not rebuild a duplicate wallet implementation already merged as P05-B3 (#134). |
| P06-C | Technician/provider implementation exists; full acceptance remains distinct. | Real operator Gateway and Identity acceptance, cash receipt flow, reassignment/media policy, recovery and current visual/accessibility evidence. |
| P06-CLOSE-07 | Technician execution/media work merged in PR #146. | Reconcile its old `NOT ACCEPTED` document with code and new evidence. The superseded-technician media fence is already implemented on baseline main; the old open B-07-01/todo wording is stale. Other scope and evidence requirements remain. |
| P06-D | Admin capability closure remains partial. | Complete owner-backed Support/Reviews/notifications/reports/settings and commerce/finance screens, scoped grants and actual operator/admin journeys. Existing candidate Gateway repairs do not create missing screens. |
| P06-E | Contracts, tooling and release-barrier framework exist. | Full three-app contract/journey/security/parity checks, migration and recovery rehearsal, exact-source artifacts and independent review, current required-check enforcement and complete release receipts. |

The map carries earlier recovery/release work IDs rather than replacing them:
P07-A1..A3, P07-B1, P07-C1..C2, P07-D1..D2, P07-E1..E4;
P08-B1..B2, P08-C1, P08-D1 and P08-E1..E2. Their old unmerged-branch
observations need source reconciliation. In particular, P07-E recovery,
governance and artifact tooling and P08-E barrier/smoke tooling are already
merged; that does not prove a production rehearsal or deployment occurred.

## Engineering work versus external decisions

The current user instruction authorizes implementation, testing and repairs.
The following are feasible repository work and must not be relabeled as owner
approval blockers: canonical adapters and request/response validation;
authenticated customer writes; correct service credentials and Gateway routes;
idempotent integration/recovery; real-service test coverage; and product flows
that fit the approved interaction/design scope.

Actual deployment or business inputs must come from their owners: launch city,
zones and service hours; real rates, currency/tax/rounding and invoice treatment;
cancellation/refund/subscription/custody policies; provider agreements, official
verification facilities and merchant credentials; retention/consent settings;
production infrastructure, secret references and incident/operating-window
details. Code may support configurable policies and test values without
presenting invented values as approved launch policy.

Design constraints are narrower than general implementation permission.
ADR-0004 already authorizes separating prototype simulations from production;
the old matrix's blanket statement that every such removal needs a new owner
decision is too broad. Truly missing visible designs, English/LTR versions,
technician onboarding and recorded contrast/copy decisions still need an
approved design or an explicitly narrowed release scope. Do not silently change
locked reference files or call an unimplemented view “blocked” solely because a
historical worktree note said to wait.

## Release verdict remains evidence-driven

`architecture/release-barrier.json` defines 19 required evidence families. The
last tracked evaluation is historical `NO_GO` on `3e1ab23`, not a fresh verdict
for this candidate. Current CI successes should be reported with their exact
head/merge SHA and scope; missing provider, browser, recovery, artifact or
external release receipts stay explicit. The project has no independent S01/S1
entry in these registries: that conversational label must be mapped to its
agreed scope rather than equated with all P01–P06.
