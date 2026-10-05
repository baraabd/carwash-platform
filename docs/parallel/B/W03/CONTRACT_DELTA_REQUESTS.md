# W03 Billing — Concrete contract publication requests

Status: **unaccepted proposal**, revision `w03-b-entry/0.1.0`.
Intended external major version: V1 subject to E review; assigned published
package/contract versions: **none**. These request/schema tables are review
inputs, not private runtime DTOs or existing endpoints.

## Source compatibility issues to settle first

The merged W02 documents are proposals. Shared exports still contain only
Identity/Gateway and two foundation/contract-only events; api-clients is empty.
Reuse one accepted public schema rather than translating silently between drafts.

| Draft discrepancy                                                                              | Required decision / producer                                                                                        |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| B opaque revision references versus C safe-integer Ref revisions                               | E/B/C define one exact revision type; no lossy coercion or treating latest as expected revision                     |
| B ACCOUNT/GUEST binding versus C CUSTOMER/GUEST beneficiary context                            | E/A/B/C freeze authority/claim semantics and exact subject discriminator/reference; body IDs grant no access        |
| B minorUnitExponent/currencyPolicyRevision versus D exponent/currencyPolicyVersion             | E/B/D publish one exact money/policy envelope and immutable revision semantics; both use integer minor-unit strings |
| Customer/C cash/sham/syriatel versus B future electronic shamcash/syriatel                     | E/A/B/C freeze the transport enum and explicit approved UI-method mapping; neither is a fourth method               |
| Existing booking.confirmed requires customerId                                                 | E/A/C revise guest-compatible event shape and compatibility strategy before guest finance consumption               |
| Existing Identity billing.read/refund vocabulary lacks creation/posting/compensation authority | E/A/C/B publish service audience/operation grants, guest object binding, critical operation and delegation checks   |
| Existing Gateway billing summary/refund routes have no intent/status/cancellation contract     | E owns exact routes/envelopes/CSRF/credentials/client exports/errors and executable conformance gates               |

The B W01 closed future-finance schema is preserved. It is not accepted or silently
extended. D's draft uses minor-unit strings, not major-unit decimal amounts.
Exact reviewed wire schemas must be compiled/exported at the barrier; a table
below does not authorize local DTO copies.

W01's future packet reserves provider-backed electronic intents for W05. The
current W03 task explicitly requests durable **internal pending intent records**.
Freeze that distinction: W03 persists an unpaid financial primitive; it does not
invoke a merchant/provider or claim a provider intent/charge was created. Publish
the appropriate additive contract rather than reuse the future provider shape.

## W03-B-REQ-01 — Pricing validation / quote use

Owner: Pricing (B). Consumers: Billing (B), Booking (C). Dependency: actual accepted
W02 Catalog/Pricing. Refine the merged
[W02 validation request](../W02/W03_CONTRACT_PACKET.md) without claiming it live.

| Schema surface                                       | Required fields / types / semantics to freeze                                                                                                                                                                                                      |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Request                                              | Accepted schema version; quote ID and exact revision; accepted subject binding; authenticated requesting service/principal/audience/operation; orchestration reference; optional exact currency/amount assertions, never overrides                 |
| Response                                             | Immutable quote reference, subject/issuer evidence, accepted exact money envelope, Catalog/price/description/policy revisions, issue/expiry/server-evaluation UTC times, bounded validity decision/reason and use/reservation evidence if required |
| Use/status/release commands, if policy requires them | Scoped command key/ID, expected state/revision, Booking/Billing purpose/reference, fixed commit/release semantics and authorized original-result lookup; no read-as-exclusive-use shortcut                                                         |
| Event, if required                                   | Accepted authenticated producer envelope, event/aggregate identity/revision, use/release fact and safe quote/operation references; no private contact/plate/proof payload                                                                          |

Approve lifetime, exact expiry boundary, revocation/honoring, whether reuse is
permitted, validation-to-commit rules and reservation release/unknown-outcome
handling. No numerical deadline or consumption rule is selected here.

## W03-B-REQ-02 — Billing create intent / cash obligation

Owner: Billing (B). Caller: C's authorized Booking coordinator; A/D only via
accepted object-authorized transport where scoped. Candidate contract ID family:
`billing.obligation.v1` / `billing.intent.v1`, **requested, not assigned**.

| Schema surface                  | Required fields / types / semantics to freeze                                                                                                                                                                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Create request                  | Schema version; scoped command identity/key; Booking/orchestration reference and expected revision; immutable quote/use reference; accepted subject and payment method; independently authenticated actor/service/delegation evidence; optional money consistency assertions   |
| Create result                   | Stable operation/intent/obligation IDs; resource revision; original quote/booking/subject/method references; server-derived exact money/policy envelope; cash due or electronic pending state, explicitly unpaid; creation UTC time; original command outcome/status reference |
| Operation-status request/result | Original actor/service + operation scope and command/reference; current authorized object lookup; original committed/rejected/uncertain result and resource revision, preserving stable replay                                                                                 |
| Financial-status result         | Independent due/intent/verified-collection/refund/settlement dimensions and authority/as-of revision; W03 has no verified collection or settlement; do not fabricate a generic paid flag                                                                                       |
| Obligation/intent event         | E-approved producer-authenticated event envelope; unique event ID, fact type/version, aggregate ID/revision, operation/causation/correlation, immutable safe quote/booking references, money only where explicitly approved                                                    |

Required/null/unknown handling: E freezes the exact closed object/nullable choices,
key format/size, identifier/revision bounds, method values and optional assertion
rules. Missing required authority/policy fails closed. Use the single accepted
money/subject envelope by reference; none is privately defined in production.
Unknown fields cannot supply totals, beneficiary grants or accounting accounts.

Durability: persist actor/service + operation scoped key, accepted-version canonical
fingerprint and stable result atomically with business/audit/outbox. Define array
normalization, conflicting payload errors, concurrent in-progress status, restart
replay and terminal rejection retention explicitly. Different keys for the same
unique business effect cannot create a second obligation. Revalidation/replay must
not mutate original money or extend quote validity. Idempotency retention and
business uniqueness both survive restarts/cleanup under approved policy.

## W03-B-REQ-03 — Cancellation / compensation

Owner: Billing. Booking owns the saga/deadline/reason request; Scheduling owns
capacity release. Candidate family `billing.compensation.v1`, unaccepted.

Request schema needs original operation/obligation/booking reference, expected
financial revision/state, accepted reason, stable child command/key, initiating
service and current authority. Response needs original/new resource revisions,
stable accepted/rejected/uncertain outcome, effective UTC time, linked reversal
posting reference **only if approved recognition policy produced a journal**,
and durable operation lookup. Event needs only the actual committed financial
fact and accepted envelope/revision/correlation; never a fabricated Booking outcome.

Freeze eligible cancellation states/reasons/amount semantics, race ordering,
financial reversal rules, critical approval separation and unknown-outcome recovery.
Canceling unpaid due does not collect or refund money. An unavailable capacity
result is recorded with its reference; Billing never changes C's database.

## W03-B-REQ-04 — Account / posting policy authority

Owner: Billing enforces accounts/postings; D publishes reviewed accounting inputs;
E supplies service/critical-operation authentication. Configuration request/result
must identify immutable effective accounting policy, authorized categories/use,
money envelope/limits, journal-producing facts, recognition timing, cancellation/
reversal rules and retention. Missing values are unavailable, not default policy.

No arbitrary account/line posting API is granted to Booking or admin. If an
approved administrative posting operation is required, freeze exact operation/
account scope, current actor and object authority, expected revision, reason,
approval/audit fields and stable replay first. Billing owns the transaction and
database constraints; being arithmetically balanced does not authorize accounts.

## Errors, time, transport and backward compatibility

E freezes stable HTTP/envelope reasons and retry classification for unauthorized/
wrong-owner/revoked subject, missing quote, expiry/revocation, quote/booking/money/
revision mismatch, missing policy, unauthorized account, invalid transition,
same-key conflict, business-reference conflict, dependency unavailable and unknown
timeout. Do not treat timeout as confirmed rejection or create a new-key charge.

Define UTC server evaluation/commit times, absolute saga/use deadlines, command
budgets and bounded retry/DLQ/reconciliation. Key syntax/lifetime and result retention
remain policy decisions. Event IDs with changed content quarantine; duplicate
delivery has one local effect. State/receipt/inbox commit before ACK; outbox facts
commit with owned mutation. Stale/gapped revisions require owner refresh.

Reconcile the existing required customerId event and closed W01 drafts through
an explicit additive compatible schema or versioned break with a new common base.
Publish compiled contracts/events/clients and exact version matrix before dependent
code resumes. Breaking mid-wave changes pause affected consumers. Never depend
on an unmerged peer branch, another Prisma client or shared business DB.

## Required E wiring and acceptance

Billing needs reviewed contracts/api-clients/security-kit/platform-messaging
dependencies, actual compiled exports, Identity/service grants, Gateway routes,
broker publisher/consumer permissions, safe fixture identities and isolated
resource allocation. E also resolves blanket provisioning grants against durable
ledger controls; B does not edit manifests or infra. Publish real provider/consumer
commands and frontend gates rather than inventing scripts that do not exist.

Provider tests require real Pricing/Identity/configuration where their authority
is claimed, and real owned PostgreSQL/HTTP/constraints/restart/broker recovery.
Consumer tests require actual A/C/E quote → Booking → cash obligation, unavailable
capacity and duplicate events, with exactly one quoted unpaid obligation and no
payment-confirmed event. Fixture shape tests remain labeled and cannot close this
gate. E serializes target+head candidates and independent reviews; all mandatory
CI remains intact. W04 requests are in [W04_CONTRACT_PACKET.md](W04_CONTRACT_PACKET.md).
