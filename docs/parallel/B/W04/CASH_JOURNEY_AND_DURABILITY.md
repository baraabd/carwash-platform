# Cash journey — Current inventory and required durable facts

Status: **unaccepted W04 design**. No cash order exists to trace in actual owner
databases at source `1ec9d8aebf4470a2815471116643fa6ebe0d5a95`.
This table identifies the missing real trace; it is not a simulated success report.

## One-order source and acceptance trace

| Boundary                           | Authoritative required fact / retained reference                                                     | Current source / acceptance implication                                                                   |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Quote                              | Pricing immutable quote ID/revision, subject, exact money and policy                                 | Pricing ServiceMarker only; Catalog quote helper unconnected; no accepted real quote                      |
| Booking / cash due                 | C Booking/saga with B obligation, immutable quote/booking/customer-or-guest references               | Marker-only owners; W03 proposal merge adds no obligation                                                 |
| Assignment and service eligibility | C current fenced assignment/Work/eligible collector and permitted collection phase                   | Booking/Dispatch/Workforce marker-only; Identity assigned-work permission alone cannot supply these facts |
| Service completion                 | C Work completion and allowed unpaid follow-up, independent of receipt                               | Technician prototype local phase; no persisted actual Work outcome                                        |
| Cash collection                    | Billing once-only authorized business effect at original obligation money                            | No collection, account, journal, receipt, command/audit/outbox models                                     |
| Customer receipt / download        | Billing immutable safe receipt, live account/guest object access, stable server artifact             | Customer Receipt is booking-choice summary; prototype download explicitly demo; no real financial receipt |
| Initial custody                    | Wallet approved holder/purpose with unique Billing receipt/posting allocation                        | Wallet ServiceMarker only; no balance/hold/projection or accepted holder policy                           |
| Handover / deposit                 | Wallet pending transfer with exact source allocations, approved receiver and operation identity      | No persisted handover; admin prototype aggregate cards do not define a deposit workflow                   |
| Treasury acceptance / settlement   | Billing authorized balanced settlement posting and verified treasury evidence; Wallet reconciliation | No settlement authority or schema; declarations alone cannot settle money                                 |
| Cross-app view / discrepancy       | A/C/D display owner revisions/as-of and explicit pending/settled/disputed workflow                   | Customer session demo, operator/admin technical boots; no real combined journey                           |

Billing/Wallet foundations have separate named runtime/migration identities and
Prisma clients. Billing migration is `20260920000000_sprint_02_foundation`;
Wallet migration is `20261005060000_w01_foundation`. Both schemas contain only
ServiceMarker, business readiness false, empty business application/ports exports.
Generic message adapters and Billing's pure BigInt ledger assertion do not create
receipts, authorize accounts or enforce SQL immutability. Existing marker/probe
foundation checks are not a cash financial implementation.

## Reference mapping and missing production scope

Customer payments HTML `payExportReceipt` downloads explicit demo text, not a
legal/server financial document. Its cash-collected simulation requires demo
stage4. Technician `showCash` allows handoff/closed, demands full illustrative
amount and confirmation, prevents the browser-local second collection. It also
separates wash completion/unpaid follow-up and permits receipt after local closure.
These controls do not approve production timing, partial policy or currency.

Admin wallets reference contains custody/settled/pending aggregate cards only,
with illustrative SAR totals. Holder detail, deposit/acceptance/discrepancy and
financial audit/critical confirmation production states are not thereby designed.
A's current React Receipt is a fixture-backed booking selection summary; its
session has no business network/payment persistence. Preserve approved visual
and interaction scope; request exact production states/copy and safe downloadable
receipt format/fields from A/C/D/product rather than invent a new screen.

## Required independent money dimensions

- Billing due/outstanding belongs to the original immutable obligation and policy,
  never recomputed from today's Catalog prices or technician/browser totals.
- Collection and stable customer receipt are Billing facts. A customer's paid
  status may coexist with cash still in technician/team custody and not settled.
- Wallet held/allocated/handover/reconciled amounts reference Billing postings;
  no editable balance or second posting authority is introduced.
- Treasury settlement moves the same collected cash. Adding collection, custody
  and settlement as three revenues is incorrect. No mixed-currency totals or
  undisclosed conversion is permitted.
- C service/assignment/Booking and cancellation facts remain separate. Completion
  is not collection; reassignment is not custody transfer; cancellation cannot
  erase collected cash or original receipt. Pending compensation/refund stays explicit.
- Reporting/Wallet projection freshness is visible. Missing/delayed/gapped source
  cannot be labeled zero, unpaid or settled, or authorize a sensitive command.

Exact wire states, derived amount equations, account categories, posting triggers,
partial allocations, tolerance and hold purposes require approved policy. These
principles do not select any numerical business input.

## Collection and stable receipt transaction

Billing verifies accepted current Identity/service/collector authority, the actual
C assignment/work fence, and the persisted obligation/quote/beneficiary/method/
money/policy references through public contracts. Actor, collector, custody holder,
receiver and beneficiary are distinct bindings; request IDs alone grant none.
Freeze validation-to-commit authority semantics with C/E. Race reassignment,
revocation, Work phase and obligation cancellation; do not claim a distributed
transaction or use a stale preflight as indefinite collection permission.

Persist a scoped operation key and canonical fingerprint together with a unique
accepted collection business identity. Same-key same-payload replay retains original
receipt/posting/operation IDs after restart and offline recovery; different payload
conflicts. Different keys/two collectors must not create a second collection of the
same effect. Business uniqueness survives permitted receipt-cache compaction.
Approved partial installments, if any, need explicit identity/cardinality/remaining-
due policy rather than newly generated retry identities or arbitrary tolerances.

Commit balanced collection journal/lines, stable receipt, due update, command
result, actual audit and Outbox in one local transaction. Account eligibility,
per-currency exact balance, policy bounds, unique references and posted immutability
must survive raw runtime SQL, concurrent finalization and provisioning replay.
Blanket runtime DML currently allows UPDATE/DELETE and is replayed by the provisioner;
a service assertion or one-time REVOKE alone is insufficient. B owns financial
schema/migrations; request any shared privilege/provisioner change from E.

Receipt/download reads recheck current account/guest/delegation scope against the
original beneficiary. Freeze allowed safe receipt fields, format, document identity,
revision/linked correction and retention. No customer/operator contact, private
proof, bank secret or arbitrary ledger account is exposed. Download authorization
cannot derive from a phone, plate, URL, receipt ID or client localStorage. No legal
tax/invoice classification is assumed. Later price edits never rewrite the document.

## Minimal Wallet custody and settlement durability

Wallet stores only approved custody account/holder/purpose, posting-linked movements,
allocated/residual amounts, optional purpose-specific holds, pending handover and
source checkpoints/reconciliation. Every financial movement has authoritative
Billing receipt/posting refs and accepted amounts/revisions. It cannot write Billing
tables, maintain an independent ledger, fund/spend customer stored value or infer
ownership from a technician reassignment.

Competing handovers/reservations cannot allocate the same receipt/posting cash twice.
Publish exact permitted allocation/partition/residual rules and aggregate limits.
Current collector/holder and distinct receiver/treasury authority are independently
checked under approved policy. Initiating a handover/deposit is a declaration,
not treasury receipt. Self-acceptance by role name cannot create permission.

Freeze the coordinating owner/protocol for Billing settlement and Wallet acceptance.
Billing owns balanced settlement postings and unique financial business refs;
Wallet advances reconciled custody only from verified Billing evidence and accepted
treasury result. A Billing commit before lost reply/Wallet projection update is
recovered via the same operation/posting references, never a replacement posting.
Local failed/pending outcomes remain queryable until reconciliation; no optimistic
cross-service rollback, silent custody transfer or fabricated settled state.

Shortage/overage/missing evidence creates an explicit discrepancy with owner,
reason/policy, immutable source/evidence refs, current revision, resolution action/
authority and audit. Corrections use linked append-only adjustments and balanced
Billing references, not historical edits or undisclosed tolerance. An accepted
discrepancy resolution cannot double-consume allocations or conceal a pending hold.

## Message recovery and adoption risks

Both producers commit actual facts with Outbox; Wallet/other consumers commit
Inbox/hash, local effect and source checkpoint before ACK. Same identity/different
content quarantines; stale/gapped/correction-before-collection/settlement-before-
handover delivery remains pending and triggers authorized owner reconciliation.
Delayed subscriptions need accepted history recovery; required durable bindings
must exist before activation. Broker confirm is not every subscriber's commit.

E's merged W03 defect ledger records static probe-adoption risks: D's existing
Inbox stores catch all unique errors as duplicates; the Catalog Outbox can strand
a final crashed lease; publisher lifecycle/confirm-crash seams and required
subscriber/DLQ topology need review. These are unexecuted adoption observations,
not current W04 failure reports or permission to edit E/D source. Future Billing/
Wallet adapters must test winning Inbox fingerprint versus unrelated uniqueness,
durable exhausted-work parking, partial missing bindings and actual confirm/ACK
crash windows rather than copy a probe store without evidence.

## Required failure evidence

The specification includes competing keys/collectors/amounts, current-authority
races, receipt/journal/audit/outbox rollback, lost response/restart, projection
delivery interruption, handover allocation/replay, independent treasury denial,
settlement-before-Wallet recovery, correction/cancellation ordering and real
three-app downloadable receipt/paid-with-unsettled-custody/discrepancy journeys.
Use actual isolated Billing/Wallet PostgreSQL, broker and merged authority providers.
Fixtures remain labeled contract-shape aids and cannot close financial or app
acceptance. All cases remain NOT_RUN in this proposal.
