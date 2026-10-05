# W03-C — Capacity and persisted orchestration prework

Status: **PROPOSED / NOT ACCEPTED / NO PRODUCT IMPLEMENTATION**. Observed source and entry blockers: [checkpoint](CHECKPOINT.md). Existing proposed wire requests remain in [W02 C W03 packet](../W02/W03_CONTRACT_PROPOSAL.md); B's [Pricing/Billing request](../../B/W02/W03_CONTRACT_PACKET.md) and A's [ownership/Geo request](../../A/W02/W03_CONTRACT_REQUESTS.md) need provider/consumer reconciliation and E publication. This document adds database/recovery semantics rather than privately publishing another DTO.

## Hard-capacity provider design for review

Scheduling alone owns capacity units, versioned windows, hold/reservation occupancy, expiry, command receipts and audit. Workforce identifiers/revisions are external references, not cross-database foreign keys. Resource eligibility/shifts, Geo coverage/travel and Pricing service/add-on duration are current accepted producer facts. Capacity is not the count of today's Bookings or a Redis lock.

Proposed PostgreSQL strategy: represent each approved exclusive resource unit by a stable Scheduling-owned row and occupancy by a half-open `tstzrange`. A partial exclusion constraint on `(unit_id WITH =, occupied_interval WITH &&)` prevents overlap among persisted blocking HELD/COMMITTED occupancy rows. E must approve/provision required `btree_gist` extension/migration privilege; exact SQL/Prisma mirrors and supported upgrade are future provider work. An approved resource with multiple units must have explicit units and capacity policy; do not invent an operational unit count.

Hold creation validates positive normalized intervals, approved duration/add-ons/buffers, shift/zone/policy revisions and current eligibility. Lock all relevant unit rows in stable ID order, reconcile expired conflicting holds in the same local transaction, and insert occupancy/hold/receipt/audit/outbox atomically. A resource combination claims its units together or none. Constraints remain the final guard; optimistic preview and worker timing cannot guarantee exclusivity. Adjacent `[a,b)` and `[b,c)` intervals do not overlap, while travel/service buffer expansion can create a conflict.

Commit/release/expiry contend on the hold/version and the same unit locks. Commit requires current hold state/revision and server-time expiry predicate inside the transaction, not a cached application check. Specify the decision instant and exact boundary with approved clock policy; no delayed worker can make an expired hold committable. Persist expiry/release before freeing occupancy. A late expiry worker must not release a committed reservation. Duplicate terminal commands replay their recorded outcome, not increment capacity. Selection deadlocks/serialization failures retry only with the same durable command identity and accepted bounded policy.

Future owned entities for review: CapacityUnit, CapacityWindow, Hold, Reservation, Occupancy, CommandReceipt, AuditEntry, OutboxMessage; append-only migrations plus local schema mirrors. No new entity/model is implemented here. Runtime receives no migration/extension privilege. Real SQL concurrency/constraint and foreign-role denial tests precede acceptance; helper unit tests do not replace them.

## Durable Booking coordinator design for review

Booking owns Intent, immutable Booking snapshots, Operation/Saga, Step/Attempt, Compensation, CommandReceipt, AuditEntry, Outbox and Inbox. Scheduling owns reservations; Billing owns obligations/postings; Pricing owns quote validation/consumption. No shared transaction or peer database write is available.

Before external effects, a local transaction authenticates current actor/guest/admin scope, reserves durable intent/key/fingerprint uniqueness and persists the orchestration plan. Separate initiating actor from beneficiary context, including create-on-behalf reason audit. Revalidate matching Quote/Hold/beneficiary/location/vehicle/contact/consent references and optional plate under current owner authority. Browser totals are consistency assertions at most; the canonical B money snapshot is authoritative. Persist only approved snapshot fields and retain original source/policy revisions.

Each step records immutable provider operation/key, request fingerprint, deadline, attempt, state and receipt ref before invocation. Provider acknowledgments are persisted in a local transaction with versioned state/audit/outbox. Lease/fence the active coordinator attempt; a stale worker cannot overwrite a newer recovery decision. Never keep the saga solely in Gateway memory or hold a SQL transaction open across HTTP calls.

| Boundary / proposed step | Durable authority and recovery |
| --- | --- |
| Resolve/validate Quote and ownership | B/A/E accepted current reads; if quote use is an exclusive command, persist its provider operation and release compensation. Successful validation read alone does not reserve a quote |
| Acquire capacity | Resolve supplied validated hold or create one using Scheduling's frozen command; preserve exact intent/beneficiary/quote refs and receipt. Choose one published protocol before coding, not double-hold both paths |
| Initialize obligation | B derives amount/beneficiary from Pricing authority. Stable operation ensures one obligation per accepted intent. Receipt is not payment verification |
| Commit reservation | Scheduling independently arbitrates expiry versus commit. Persist exact reservation/hold revisions; do not confirm from a successful preview |
| Confirm Booking | Only approved policy prerequisites plus real owner receipts allow transition. Cash may confirm while financial state is UNPAID if explicitly approved. Electronic/pending-payment policy needs B/product decision |
| Reject/expire/compensate | Persist durable desired outcome and compensation identities; release Scheduling capacity, cancel/reverse/refund Billing according to B policy, release exclusive quote use if applicable. Unfinished compensation stays RECOVERY_REQUIRED |

The final accepted order of obligation initialization/capacity commit/quote consumption and compensation deadlines is B/C/E policy review, not established by the table. Test every approved ordering's failure window. Timeout means unknown outcome; query/replay the **same** provider operation under current authorization before deciding whether to retry or compensate. Compensation also survives lost acknowledgment. A late obligation/payment fact cannot resurrect expired capacity; record a recoverable policy outcome and obtain new capacity only through an approved deliberate path.

Local state+audit+receipt+outbox commit atomically. Published event ID stays stable across retries. Inbox+effect commit before ACK; conflicting same-ID payload, stale revision and gaps follow approved quarantine/resync rules. Projection freshness is visible; unavailable financial/capacity/assignment facts are unknown, not success defaults. Booking retrieval/status and admin list/detail require current object scope and bounded safe fieldsets. Rebook/reschedule requires new current Quote/capacity authority, preserving history.

## Closure requests and producer queue

E publishes exact schemas/parsers/clients/routes/error mappings/service delegation, timeout/replay/retention policies, admin beneficiary scopes, broker ACLs and resource allocation at verified BASE_W03. Reconcile B `ACCOUNT/GUEST` versus C `CUSTOMER/GUEST`, reference/enum/money vocabulary and quote-use exclusivity; no private alias or undocumented adapter. A validates ownership and actual Aleppo geography; D publishes accepted timezone/hours/policy revisions. Current `bookings.create:self` cannot authorize create-on-behalf; admin actor audit and reason must survive provider calls/replay.

1. **W03-E-Contract-Prework:** accepted base/public contracts/access/config and policy/input closure. No C shared-file edit.
2. **W03-B-Pricing-Validation + Billing-Obligation providers:** real current owner/Identity/DB/constraint/restart/conformance gates; B owns these writes.
3. **W03-C-Scheduling-Provider:** real capacity/hold/commit/release/lookup and own SQL gates against accepted Workforce/Geo/Pricing facts; no Booking business write required for a narrow provider receipt.
4. **W03-C-Booking-Coordinator:** actual merged Scheduling/B/A/E providers; real guest/self/admin HTTP, unknown outcome/restart/compensation/broker gates.
5. **W03-A/D/C-Consumers:** A seven-screen cash booking, D full Workforce review and required Booking views, C bounded Operator projections against actual providers. Approved production/English designs remain blockers; fixtures cannot close this child.

Provider-only evidence keeps parent INTEGRATION_PENDING. Each child uses an accepted base/latest-target candidate, never an unmerged peer branch. E preserves all mandatory gates and verifies unchanged refs/resulting main. W03 requires D's real admin-browser Workforce review, which was deliberately outside W02's complete browser scope. Only combined acceptance can publish the next base.
