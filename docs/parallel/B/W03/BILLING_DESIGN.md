# W03 Billing — Source inventory and proposed durability design

Status: **unaccepted design, no business implementation**. Source:
`82e7402ed9ab6cc4f565f423441cd0655f2d627a`. The purpose is to make the blocked
provider concrete for review without choosing accounting policy or private DTOs.

## Actual Billing inventory

Billing has a Nest/Prisma health shell, owned PostgreSQL adapter and generic
message classifier. Its schema contains only `ServiceMarker`; the sole migration
is `20260920000000_sprint_02_foundation`. Application/ports files export nothing.
No payment intent, cash obligation, account, posted journal/line, financial
reference, command receipt, audit, outbox/inbox, quote client or business transport
exists. BUSINESS_READY remains false.

`src/domain/ledger.ts` is a historical pure BigInt assertion. It checks 2–1000
lines, nonblank account strings, three uppercase currency characters, sides and
positive 1–18-digit minor-unit strings, then sums separately per currency.
It does not authenticate accounts, validate an approved exponent/currency/bound,
post money, persist anything or enforce database immutability. The historical
unit examples and foundation Nest/DB/messaging gates prove only their own scope.
Its limits are not production policy.

F001 supersedes the old Billing README/grouped architecture: Pricing owns quotes,
Scheduling capacity, Booking sagas, Billing financial postings, Wallet referenced
custody/balance/holds, Subscription entitlements. No peer database or service
implementation imports are permissible. Source-derived inventories/fingerprints
are recorded separately in [ENTRY_EVIDENCE.json](ENTRY_EVIDENCE.json).

## Independent financial facts

| Fact                                | Authority and proposed consumer meaning                                           | Creation does not establish                                     |
| ----------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Amount due / cash obligation        | Billing obligation tied to immutable quote, subject, booking reference and policy | Receipt, collected funds, custody or treasury settlement        |
| Electronic payment intent pending   | Billing durable request/status; creation remains unpaid                           | Provider success, collection or capacity                        |
| Verified collected amount / receipt | Billing authoritative verification/posting; W04/W05 scope                         | Company cash handover or service completion                     |
| Cash custody                        | Wallet's approved holder/purpose projection referencing Billing postings          | A second ledger, customer stored value or settled treasury cash |
| Settlement                          | Billing authorized settlement posting plus Wallet reconciliation of its reference | Booking completion or automatic resolution of a shortage        |
| Booking / service / capacity        | C-owned facts consumed under accepted contracts                                   | Paid/collected/settled status                                   |

A/C/D displays must retain these dimensions and their revisions/as-of time.
Do not reduce them to one PAID boolean or calculate outstanding due by subtracting
treasury settlement. Cancellation of a due obligation is not a refund of money
that was never collected. Proof upload, navigation or wash completion is not
received money. W03 cash begins due; electronic begins pending, both unpaid.
Wire state names/amount mapping are frozen by the accepted contract, not this table.

## Accounting-policy review matrix

| Candidate event/fact                 | Decision required                                                                                                | W03 boundary                                                                  |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Intent requested/created             | Does approved accounting recognize any noncash obligation here? Which authorized category/reference?             | Never post collected/custody/settlement money merely because an intent exists |
| Cash obligation accepted             | Approved receivable/revenue recognition trigger and exact account usage, or no journal at this point             | Durable due fact is required; accounting recognition cannot be guessed        |
| Obligation cancellation/compensation | Whether to extinguish due and append a linked reversal for a previously recognized entry; fees/reasons/authority | No mutation/deletion of posted history; no invented refund                    |
| Verified cash/electronic receipt     | Collection/clearing/custody category, authoritative receipt and verification rules                               | Next wave/provider scope; no W03 collection implementation                    |
| Custody handover/treasury acceptance | Holder/treasury categories, independent acceptance and mismatch/shortage handling                                | Requested for W04; not a W03 settlement                                       |

Conceptual receivable, revenue, clearing, custody, treasury and reversal categories
are review topics, not selected account numbers, approved balances, debit/credit
instructions or jurisdictional accounting advice. D supplies versioned approved
configuration; Billing enforces current authorized account usage and snapshots
the effective posting policy. Missing policy rejects safely rather than selecting
zero tax, a currency, recognition event or arbitrary balanced accounts.

## Proposed owned persistence invariants

| Resource                                    | Required durable invariant                                                                                                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Intent / obligation                         | Server quote/subject/booking/method/policy binding, immutable original money evidence, independent financial state/revision                                                    |
| Account                                     | Billing-owned identity, permitted currency/category/purpose/actor usage and lifecycle; closed/foreign/unauthorized account denied                                              |
| Posted journal and lines                    | Immutable posted header/lines; exact minor-unit arithmetic, valid account/currency/side/bounds, approved policy and balanced debits/credits per currency at transaction commit |
| Business effect reference                   | Unique accepted reference tuple for each intent/obligation/posting/compensation effect; different command keys cannot duplicate one business effect                            |
| Command receipt                             | Actor/service + operation scoped key, canonical accepted-version fingerprint, stable resource/result/error and terminal replay; no volatile cache as authority                 |
| Audit / outbox                              | Authorized actor/beneficiary/delegation/policy/ref/correlation evidence; business, receipt, audit and emitted fact commit atomically                                           |
| Inbox / local outcome                       | Consumer/event uniqueness plus original fingerprint; domain mutation and receipt commit before ACK; conflicting IDs quarantined                                                |
| Compensation / failed orchestration outcome | Original orchestration/operation reference, expected revision, authorized reason, stable child key/result and explicit unresolved status                                       |

Choose concrete column names/types/constraints and new migration IDs only after
accepted schemas and approved numeric bounds. Prisma schema and append-only SQL
migrations must agree; no db-push/reset or changed old migration. Cross-service
references are contract IDs, never foreign keys/joins to another database.

Database balance must survive raw runtime SQL attempts, concurrent line insertion
and commit order; a service-layer assertion is insufficient. Review appropriate
transaction-final validation/constraints, immutable-row enforcement and minimum
posting privileges, with legitimate posting and rollback tests. Do not expose
an unsafe SECURITY DEFINER function or rely on a request body's account permission.
The actual mechanism is an implementation review decision, not already deployed.

`infra/postgres/provision.sh:98–106` currently grants runtime DML on all owned
tables and regrants it on provisioning replay. Marker isolation tests permit
that DML and deny DDL/TRUNCATE/REFERENCES. A one-time REVOKE alone can be undone.
Billing owner-local immutability/balance enforcement or E-reviewed privilege
changes must remain effective after provisioning replay. Request infra changes
from E; do not edit the provisioner. Migration/operator identity restrictions
and documented recovery must preserve historical facts as well.

## Quote validation and concurrency boundary

Use the real merged Pricing public contract/client and current service/subject
authority. Verify immutable quote ID/revision, beneficiary, method eligibility,
exact money and policy references; browser total is at most a consistency assertion.
Never use the old Catalog helper or reconstruct a quote locally.

Freeze the validation-to-commit boundary with Pricing/C/E: read validity alone
does not reserve/exclusively consume a quote. If accepted policy requires quote
reservation/consumption, persist its reference and recover uncertainty under its
published command/status/release contract. If it is read-only, freeze exactly
what accepted validation evidence/deadline permits Billing's commit. Test expiry,
revocation and conflicting uses at that boundary. Do not invent a distributed
transaction, unconditional acceptance after expiry or a numerical grace period.

Race same-key requests through one database receipt; different payload conflicts.
Race different keys for the same business effect through the unique business
reference and accepted replay/conflict semantics. Recheck authorization on replay
under the published policy; a receipt is not a new access grant or changed quote.

## Failure and durable recovery

| Failure window                                                    | Required proposed behavior                                                                                                                 |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Pricing/Identity/config unavailable before commitment             | Safe rejected/uncertain outcome per accepted contract; no guessed totals or money posting                                                  |
| Quote becomes unusable during orchestration                       | Accepted owner reservation/deadline rule resolves it; durable rejection/release/compensation, never capacity inference                     |
| Business/receipt/audit/outbox transaction fails                   | All local effects roll back; stable accepted failure/status rules distinguish rejection from commit uncertainty                            |
| Billing commits but HTTP response is lost                         | Same scoped key/request or authorized operation status recovers exact durable result after restart; no unrelated replacement intent/charge |
| Outbox commit then broker/publisher-confirm interruption          | Durable lease/retry and the same event identity; possible redelivery, no invented exactly-once transport                                   |
| Consumer crashes before commit/after commit before ACK            | Redelivery retries uncommitted work or returns deduplicated result; commit precedes ACK                                                    |
| Reused event ID with different content / stale or gapped revision | Quarantine conflict; prevent state rollback and request authorized owner refresh; bounded retry/DLQ/audit                                  |
| Capacity unavailable or saga deadline expires                     | Booking records its outcome, Scheduling owns release; Billing records authorized compensation/financial result only                        |
| Cancellation races a committed creation / repeated compensation   | Serialize accepted state/revision and stable child key; preserve one result and immutable linked postings if policy requires               |

Local failed orchestration records do not impersonate Booking or write its DB.
Request/status/cancel/compensate use object-level Identity/guest/service scopes;
revoked or suspended principals and wrong audience/operation/beneficiary are denied.
Late financial facts cannot revive expired capacity. W03 never emits
payment-confirmed solely for an intent, due obligation, proof or service state.

## Evidence required

The specification covers actual isolated PostgreSQL migration/upgrade, transaction
and privilege bypass, restart/response loss, quote/account/guest/service authority,
outbox/inbox recovery and downstream actual A/C/E quote/Booking/cash integration.
Use real providers for their corresponding acceptance. Explicit test-policy or
Booking fixtures may aid a bounded contract-shape check but remain labeled;
they cannot prove accounting approval, capacity or full flow. All cases are
NOT_RUN in this proposal. No chart, schema migration or runtime is claimed.
