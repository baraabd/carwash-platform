# Cash journey, permission transitions and exact reconciliation

Source `1ec9d8aebf4470a2815471116643fa6ebe0d5a95`. All transitions and contract fields below are
**proposals for provider review**, not implemented or accepted APIs.

## Independent authorities and browser observations

| Fact / permanent owner                            | Required journey observation                                                                                         | Authority and access boundary                                                                                                         |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Identity / E                                      | Distinct customer or guest, dispatcher, technician and finance sessions                                              | Verified current principal, object scope and revocation; role label alone grants no booking or money authority                        |
| Catalogue/Pricing / B; Geo / A; Configuration / D | Seven-step customer selects an actual eligible Aleppo service and server quote                                       | Accepted coverage, hours, currency precision and price policy; optional plate and guest booking preserved                             |
| Scheduling/Booking / C                            | Explicit confirmation yields durable order, capacity reference and independent cash due                              | Accepted W03 quote binding, capacity race/expiry and saga recovery; immutable snapshots                                               |
| Workforce/Dispatch / C                            | Admin reviews eligible staff, assigns; one technician accepts                                                        | Current eligibility/grant/shift plus one live assignment; admin transport does not write owner DBs                                    |
| Booking work execution / C                        | Accept → travel → arrive → before evidence → start → checklist → after evidence → explicit finish → handover/closure | Booking owns execution/events/saga under F001; Dispatch owns assignment, not work completion                                          |
| Media / C                                         | Authorized evidence upload, processing, later customer before/after read                                             | Private classified objects; current purpose/object grants at reservation, finalization and read; scanned bytes and immutable bindings |
| Billing / B                                       | Authorized actor records cash or leaves completed work unpaid; customer reads accurate receipt                       | Server-verified cash authority, due/collection ledger, immutable correction links, audit and replayable receipt                       |
| Wallet / B                                        | Technician cash custody and company handover reconcile                                                               | Approved actor/purpose, Billing posting references; no independent financial ledger or fourth checkout method                         |
| Reporting / D                                     | Admin reconciliation converges with each source revision/reference                                                   | Own projection only, explicit source watermarks; cannot authorize collection or overwrite source facts                                |
| Communications / D                                | Accepted journey notifications reach intended audience safely                                                        | Template/purpose/recipient scope, consent where required, deduplication and ambiguous-send recovery; no money/booking authority       |

Gateway forwards accepted commands and composes bounded authorized reads; it owns
no business record. Use public versioned HTTP/events only. Owner-local test
assertions may inspect that owner's DB under its test role; the integration runner
uses public observations, never peer DB joins or implementation imports.

The technician reference requires before evidence before start, checklist before
after evidence, then explicit finish and vehicle handover/closure. Test each
prerequisite and rejected premature transition. Financial collection, delivered
but unpaid closure and company cash handover remain separate facts.

## Permissions over the journey

Before assignment, the technician has no blanket customer/private-image access.
The successful assignment activates only approved minimum job fields: service,
time, necessary location/contact instructions and purpose-scoped evidence. Other
customers, unassigned jobs, workforce identity documents, finance administration
and electronic-payment approval remain denied. Reassignment, revocation, expiry
and session changes are tested at each command and media read. Exact field mask,
post-completion access duration and location owner need accepted policies.

Admin dispatcher grants allow scoped assignment, not automatic money approval.
Finance grants allow the approved collection/correction/handover operations,
not unrestricted identity/media access. If a technician may record cash, Billing
must verify the specific current collection grant and assignment; completing work
must not call a payment-confirmed shortcut. A technician's electronic-payment
approval attempt must fail without any financial effect, even using a raw request.

Customer and guest may see only their authorized order, receipt and permitted
before/after objects. Marketing permission is independent. A guest recovery
credential must survive browser restart under the reviewed E protocol; an
in-memory C014 order or predictable booking ID is not that protocol. Signed media
URLs require explicit lifetime/revocation semantics; immediate revocation cannot
be claimed for previously issued bearer URLs without enforcement at object fetch.

## Both required cash outcomes

Let `Q` be the accepted immutable server quote total, in canonical integer minor
units. Let `C` be net authorized customer cash collected, `D` current amount due,
`K` cash still in the approved holder's custody, and `S` accepted treasury
settlement. Record currency, precision and policy revision with every comparison.
For these two no-discount/no-refund acceptance scenarios, `D = Q - C`.

| Outcome                                        | Booking/work                                             | Billing customer account                                       | Wallet/custody                                 | Customer/admin presentation                                                                  |
| ---------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Completed and unpaid                           | Work completed exactly once; payment remains independent | C=0, D=Q; no collection posting or received-money receipt      | K=0, S=0; no movement invented from completion | Delivered and amount still due; any service document clearly distinguishes uncollected money |
| Completed and collected, before handover       | Work completed; assignment facts unchanged by money      | C=Q, D=0; one unique collection reference and balanced posting | K=Q, S=0 after causal application              | Customer collection receipt; admin sees holder custody still outstanding                     |
| Same collected order after reconciled handover | Historical order/quote unchanged                         | Same customer collection, separate treasury posting            | K=0, S=Q after accepted handover               | Same receipt; company settlement is not a second customer payment                            |

The strict complete-journey run uses the approved full cash amount. Partial cash,
overpayment, discounts, rounding, refunds and corrections must use separately
accepted policy/tests; do not invent their behavior. Equality is exact string/
integer arithmetic, never float or a fixed two-decimal currency assumption.
A real configured `Q`, not a plausible sample price, populates saved evidence.

## Reference and amount oracle

Capture `bookingId, bookingRevision, quoteId, quoteRevision, capacityId,
assignmentId, assignmentRevision, workId, workRevision, obligationId, collectionId,
collectionPostingId, receiptId, custodyMovementId, handoverId,
treasuryPostingId` as applicable. These are candidate semantic names; owner
schemas must decide exact exports. Null/absence distinguishes unpaid and pending
handover; no invented IDs or fixture receipts.

Reconcile in stages: immutable Booking quote snapshot equals Billing obligation;
Billing collection/receipt point to the same obligation and one posting; Wallet
movement points to that posting and approved holder; treasury handover points
to its own Billing posting; Reporting includes the same references and its applied
source revisions. The runner records the command/event correlations and expected
source revision vector rather than comparing unrelated global counters.

Out-of-order/duplicate events cannot lower revisions, duplicate effects or make
an uncollected order paid. A projection gap exposes staleness and requests reviewed
owner reconciliation. Rebuild Reporting without sending notifications or changing
Booking/Billing/Wallet. Temporary lag must be visible; stale Reporting cannot
approve collection, refund, custody acceptance or settlement.
