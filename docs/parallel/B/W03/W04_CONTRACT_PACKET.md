# W04 Billing collection and minimal Wallet custody request

Status: **PROPOSED_NOT_ACCEPTED**. Request revision `w03-b-w04-finance/0.1.0`.
Intended external command/event major: **V1, subject to review**; this is not a
published package version or a grant to implement W04. Accepted versions for
these requests: none. Observed source is
`82e7402ed9ab6cc4f565f423441cd0655f2d627a`, not an accepted wave base.

This W03 next-wave handoff refines the unaccepted W01 future-finance reservations.
It does not amend their closed JSON schemas, start collection/Wallet source work,
post money, call a provider, or introduce a checkout method. W03 remains bounded
to Billing intent/obligation/journal primitives after its own entry requirements
are satisfied. W04 implementation requires E's separate accepted `BASE_W04`.

## Authority and prerequisites

Billing owns financial obligations, authoritative collection receipts, accounts,
immutable balanced postings, corrections and treasury settlement evidence. Wallet
owns only the approved custody holder's records, handover/hold coordination and
Billing-backed projection. It never has a second financial ledger or reads
Billing's database. C owns assignment/work/Booking facts; A owns beneficiary
relationships; D publishes approved configuration and derived Reporting; E owns
shared schemas/clients, service identity, current critical-operation grants,
Gateway transport and broker ACLs. Admin/Gateway own no financial tables.

Before freeze, B/product/accounting must resolve W01 B-03/04/05/06/07/08/12/13:
currency/scale/bounds, collection amount rules, accounting categories and posting
triggers, correction/cancellation approval, holders/purposes, treasury recipient,
shortage/overage policy, independent acceptance, replay/privacy retention and
deadlines. D CP-D-002 currently excludes financial amounts and supplies no accepted
accounting policy schema. Request a reviewed typed policy reference/publication
and B-owned applicability validator; Configuration never becomes the ledger.

These are relevant policy questions, not defaults: does a due obligation create
a journal, and which balanced accounts; when does declared cash become an accepted
receipt; which C work states permit collection; can collection be partial or
overpaid; who holds it; what evidence makes a treasury receipt final; which custody
holds are required; what happens on disagreement? No guessed chart of accounts,
zero tax, numeric TTL, holder, merchant or approval threshold is selected here.

## Shared vocabulary requiring E reconciliation

In the tables, `AcceptedMoney`, `VerifiedSubjectEnvelope`, `OwnedResourceRef`,
`OperationReceipt` and `AcceptedEventEnvelope` are **semantic references to the
future E-published contracts**, not types or private DTOs to implement. Every
request/response/event uses one reconciled envelope and accepted money vocabulary.

E and affected owners must freeze exact field names, required/nullable/unknown
rules, bounds, enums, parsers and compatibility fixtures. Money is lossless
canonical integer minor units with approved currency, exponent and immutable
currency/accounting-policy references; no JavaScript float, default exponent,
conversion or mixed-currency sum. Every resource has its authoritative owner,
immutable ID and exact owner revision. Owner revisions are separate from the
positive monotonic event `aggregateVersion`; a policy revision cannot be cast
silently into either.

Known differences to reconcile, rather than choosing one privately:

| Topic     | Source proposals / current constraint                                                                                                        | Required decision                                                                                                                                                          |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Money     | B `amountMinor/currencyPolicyRevision`, exponent in currency policy; C `minorUnits/currency`; D `amountMinor/exponent/currencyPolicyVersion` | One published money/scale/policy representation and lossless versioned adapters. D also uses minor-unit strings; no major-unit conversion is implied.                      |
| Principal | B `ACCOUNT/GUEST`, C `CUSTOMER/GUEST` beneficiary context, A lower-case account/guest; current Identity only account/session/authVersion     | Verified initiating actor, service delegation and beneficiary binding remain distinct; define guest expiry/claim effects without automatic resource transfer.              |
| Revision  | B opaque definition/policy strings; C/D safe positive integers; B future finance also has numeric entity revisions                           | Publish exact per-owner/ref wire types and comparison rules; do not globally coerce them.                                                                                  |
| Methods   | Approved UI/registry `cash/sham/syriatel`; B future electronic command `shamcash/syriatel`                                                   | Versioned mapping for existing three methods. Internal Wallet is not a fourth method; Paymera scope remains an owner/provider decision.                                    |
| Events    | Billing service catalog entry reserves `billing.payment-confirmed.v1`; B proposes `billing.payment-verified.v1` plus collection events       | E/B select separate collection/settlement names and parsers; never alias obligation/intent/custody success into payment confirmation. Preserve strict existing Booking V1. |
| Recovery  | Proposals have different command IDs, key scopes, array normalization, replay/tombstone periods and deadlines; Gateway defaults to 3 seconds | Freeze common semantics and safe reason adapters. Proposed numerical values remain unaccepted; no blind new-key retry.                                                     |

## Proposed request / response / event requirements

Each mutation carries a stable logical command identity and `Idempotency-Key`
under the accepted syntax. Current Gateway accepts `[A-Za-z0-9_-]{16,128}`;
preserving that alphabet is a compatibility request, not a published new business
contract. Credentials establish current actor/service scope. Body references are
assertions to validate, never proof of ownership, assignment, grant or receipt.
No arbitrary account IDs, caller-written journal lines or client-selected
financial states are exposed as collection authority.

| Request ID / intended command                                                         | Request schema requirements                                                                                                                                                                                                                                                                     | Response schema requirements                                                                                                                                                                                                                                                                                                                            | Proposed event requirements                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| W04-B-01 `billing.cash-record.v1`                                                     | Obligation and Booking refs, exact expected obligation revision; durable collection business ref; C assignment and permitted work-state refs/revisions; declared `AcceptedMoney`; accepted accounting/collection policy refs. Actor/service and beneficiary come from verified authority.       | Billing-owned receipt ID/revision; linked obligation/Booking/collection refs; accepted amount/currency/policy; immutable journal/posting refs if the approved trigger requires them; separate collection and due states; server accepted/posted times; durable operation/audit refs. An authorized declaration is not external electronic verification. | `billing.cash-recorded.v1` candidate: authoritative receipt/obligation/Booking/posting refs, accepted financial revision and safe policy/time refs. Include Money only if an accepted consumer needs it; never raw contact, proof bytes or ledger-account secrets. |
| W04-B-02 `billing.cash-reverse.v1`                                                    | Original receipt ref, expected revision, stable correction business ref, bounded approved reason code and approval/evidence ref. Original receipt amount is owner evidence; permitted correction amount/policy is explicit.                                                                     | New linked reversal/correction receipt and balanced posting refs, preserved original IDs/history, resulting authoritative obligation/collection revision and operation/audit refs. No update/delete of posted journals.                                                                                                                                 | `billing.cash-reversed.v1` candidate: original/reversal receipt and posting refs, resulting source revision, approved reason/policy ref and server time. Wallet applies the linked correction once through references.                                             |
| W04-B-03 Billing treasury-settlement command, final ID for freeze                     | Handover/custody refs and expected revision; deduplicated immutable collection/receipt/posting refs; independent treasury acceptance/evidence ref; approved recipient identity and `AcceptedMoney` assertions; stable settlement business ref. Current independent treasury grant is mandatory. | Billing treasury receipt/settlement ID/revision and accepted, rejected or unresolved outcome; accepted amount and discrepancy refs under policy; journal/posting refs only on the approved trigger; durable operation/audit refs. Unknown evidence/provider outcome remains pending.                                                                    | Separate Billing treasury-settlement fact with immutable receipt/settlement/posting refs, source revision, policy and server time. Cash already collected must not be counted as a second customer payment when custody settles.                                   |
| W04-B-04 `wallet.custody-handover.v1`                                                 | Approved holder/recipient and custody-account refs; expected Wallet revision; unique receipt/posting refs from Billing; declared `AcceptedMoney`; approved custody-purpose/policy refs; stable handover business ref.                                                                           | Wallet handover ID/revision and pending status, covered Billing refs/amount, reservation/hold ref only if an approved purpose requires it, operation/audit refs. It cannot claim treasury receipt from the holder's declaration.                                                                                                                        | `wallet.custody-handover-pending.v1` candidate with handover/holder/recipient/custody refs, source revision and safe Billing links. Pending is never settled.                                                                                                      |
| W04-B-05 `wallet.custody-accept.v1`                                                   | Handover ref/expected revision, independent treasury evidence/approval and Billing settlement refs. Wallet validates authoritative Billing status through accepted service contracts; no body-supplied settled flag.                                                                            | Final reconciled handover/custody revision only after Billing confirms applicable postings/receipt; otherwise pending/reconciliation-required/disputed outcome, exact outstanding refs and operation/audit refs.                                                                                                                                        | `wallet.custody-settled.v1` candidate only for reconciled Billing-backed settlement. Payload retains Billing receipt/posting/source revisions; delayed/missing facts never produce fabricated settlement.                                                          |
| W04-B-06 minimal custody hold reserve/resolve, only if required by approved purpose   | Owned custody account/holder, accepted purpose, handover/operation ref, expected revision and approved amount/source refs. Resolve selects accepted release/consume transition plus required Billing refs.                                                                                      | Stable hold ID/revision, accepted amount, purpose/ref and pending/held/released/resolved outcome; one local reserved effect and explicit reconciliation state. No new customer top-up, spend, transfer or withdrawal flow.                                                                                                                              | Purpose-specific held/released/resolved facts referencing Billing and Wallet source revisions. General Booking/customer-balance holds remain W06 reservations; W04 does not promote that future scope.                                                             |
| W04-B-07 authorized financial status, operation recovery and custody projection reads | Exact obligation/receipt/settlement/operation/holder resource and accepted purpose/fieldset; current object/grant authority. Optional cursor is bound to approved query/scope/generation. Reads have no mutation key.                                                                           | Authoritative Billing money/ref/status with evaluatedAt; Wallet projection with asOf, per-source checkpoint/coverage and current/stale/partial/unavailable quality; no missing row interpreted as zero/settled. Bound/redact actor fields.                                                                                                              | No command event for a read. Projection updates are separate derived Wallet/Reporting facts with explicit source owner/revision; consumers never use them to authorize a sensitive collection/settlement.                                                          |

All intended schemas must include version, bounded UTC-millisecond instants,
operation/resource revisions and explicit state enums after review. Local display
uses accepted timezone/policy. Lifetime boundaries and skew are policy decisions;
a read/replay cannot extend a quote, hold, evidence or permission lifetime.

## State and audit requirements

The semantic transitions to freeze are: obligation due independently of Booking;
authorized accepted collection creates an immutable receipt; correction creates
a linked reversal; custody waits for Billing-backed reconciliation; a handover
remains pending until independent treasury evidence and authoritative settlement
converge. Exact state names, posting triggers, over/underpayment paths and no-op
revision rules require B/C/D/E and policy review. An unresolved or rejected
operation cannot advance to collected/settled. Late settlement records its money
fact without resurrecting Scheduling capacity or Booking/work/assignment state.

Audit requirement: immutable local audit ID and operation/business refs; verified
initiating actor plus service/delegation/audience/scope; beneficiary separately;
current session/auth version or accepted guest authority reference; assignment
and work refs/revisions; approval/evidence and policy revisions; before/after
resource revisions; reason/outcome; server occurrence/commit time; request and
correlation refs. Persist only approved fields, never raw guest tokens, OTP,
merchant credentials, private media or contact/plate data. Technical trace IDs
are not business deduplication keys. Retention/redaction needs an approved policy.

## Replay, ordering, errors and compensation

Freeze key scope over owning service, contract major, verified initiating
actor/service-delegation binding, operation and create/target business scope.
The canonical fingerprint includes beneficiary, accepted policy/money, all
meaningful source/expected revisions, assignment/work/evidence/correction refs
and normalized receipt/posting lists. E/owners decide order/set semantics and
duplicate refusal; sorting lists privately can change the command's meaning.
Exclude credentials, CSRF, trace/request IDs and volatile transport timestamps.

Business state, durable receipt, audit and Outbox commit in one owner transaction.
Same scoped key/fingerprint returns the original outcome after current authority;
changed payload conflicts. Permanent unique collection/correction/settlement
business refs prevent repeat financial effects even when a replay response expires.
Replay/tombstone/evidence privacy periods and safe concurrent pending response
are explicit unresolved contract fields. Lost response after commit is resolved
through the same key/command or authorized operation lookup, never replacement
collection with a new key. A dependency timeout remains unknown until owner
status proves an outcome.

The consumer validates broker-authenticated producer plus exact accepted schema,
commits Inbox/payload hash and owned effect before ACK, and maintains per-owner
aggregate/source checkpoints. Duplicate bytes are no-op; changed bytes for one
event identity are quarantined; stale revision cannot overwrite newer. A gap,
reversal arriving before its collection, or settlement before the referenced
handover/posting leaves reconciliation pending and triggers an authorized
immutable owner snapshot/read. E must freeze replay routes/windows, dead-letter
recovery and producer/consumer ACLs. There is no global event order or distributed
exactly-once transaction.

Errors need safe versioned reasons for authentication/current-grant/assignment
denial, wrong owner, missing ref, revision/key/business-ref conflict, invalid
transition, amount/currency/policy mismatch, unposted/reversed source, missing
evidence, short/over discrepancy, dependency unavailable, timeout/unknown outcome
and projection gap/staleness. E settles coarse Gateway mappings and reason
allowlists; current 409/422 detail loss and 503/504-to-502 mapping do not prove
these semantics. No private source/provider exception or PII is returned.

Compensation belongs to each owner: Billing records approved linked reversal or
pending correction; Wallet releases an unconsumed purpose-specific hold or
records disputed/pending handover; Booking coordinates its own saga. Never delete
a committed receipt, credit spendable funds optimistically, silently transfer
custody or roll back a peer database. Each compensation has a stable distinct
operation identity, fingerprint and durable outcome; unresolved compensation is
visible and recoverable. Live money/refund/provider execution remains separately
authorized; this packet grants none.

## Provider-first review and gates

Freeze this packet with E and real B/C/A/D provider/consumer review before
`BASE_W04`. Publish public parsers/clients/events, exact versions and compatible
routes/errors, Identity/guest/service grants, broker permissions, typed policies,
separate runtime/migration identities and isolated lane/wave/run resources.
Changes to shared packages/manifests/Gateway/CI/infra remain E-owned proposals.
No dependency on a moving peer branch or private DTO is permitted.

Suggested child boundaries after accepted entry: real C assignment/work authority;
Billing collection/correction/treasury providers; minimal Wallet custody provider
against merged Billing; A/C/D finance consumers against merged real producers;
then E's serialized combined candidate/resulting-target gate. They define future
review boundaries and avoid making the first provider wait for its future UI.

Required provider proof includes real isolated PostgreSQL migrations/upgrades,
per-currency balanced transactional postings and runtime privilege/immutability,
unauthorized account references, current/expired/revoked/foreign actor and
assignment refusal, concurrent same-key/conflicting payloads, independent
business-ref uniqueness, rollback/outbox atomicity, restart/lost-response replay,
no double receipt/correction/settlement, insufficient custody holds and
competing handover/acceptance/release races under approved policy. C assignment
and Identity must be actual accepted providers before their authority is claimed.

Required broker/consumer proof includes crash before/after commit/publish/ACK,
duplicate/hash conflict, reversal-first/settlement-first/gaps/stale revisions,
broker outage and authorized recovery; no projection creates money or double
collection. Required integrated A/C/D journeys show due, collected, custody
pending and treasury settled separately; work completion/unpaid follow-up stays
independent; wrong collector/self acceptance, foreign guest, stale admin and
unavailable provider are rejected without fabricating success. Preserve approved
Arabic RTL/seven steps and operator/admin reference parity with actual browser,
accessibility and canonical reference/candidate/diff evidence for affected UI.

These gates are **NOT_RUN_SPECIFICATION_ONLY** in this W03 proposal. No DB,
broker, provider or browser execution, migration, process or container is created
by this packet. Fixture conformance is labeled and never substitutes for actual
financial/provider/app acceptance. Parent W04 cannot be DONE from this request or
from foundation CI alone.

## Source evidence

- `architecture/service-catalog.json`: Billing owns payments/receipts/refunds/ledger;
  Wallet owns Billing-linked accounts/reservations/movements, with planned APIs.
- `architecture/parallel-contract-release.json`: null next base, unaccepted owner
  packets and financial/holder/provider decisions; UI methods `cash/sham/syriatel`.
- `../W01/FUTURE_FINANCE_CONTRACTS.md` and
  `../W01/future-finance-contracts.schema.json`: unaccepted collection/reversal/
  custody reservations; strict existing candidate fields are not expanded here.
- `../W01/POLICY_DECISIONS.md` and `../W01/OWNERSHIP_AND_STATES.md`: unresolved
  policy, approved-scope boundaries and independent financial facts.
- `../W02/W03_CONTRACT_PACKET.md`: unaccepted quote validation/binding and
  obligation expiry/replay/compensation requirements before Billing consumes it.
- `../../C/W02/W03_CONTRACT_PROPOSAL.md`,
  `../../A/W02/W03_CONTRACT_REQUESTS.md`,
  `../../D/W02/W03_CONTRACT_REQUESTS.md`,
  `../../D/W01/CONTRACT_PROPOSALS.md`: unaccepted actor/revision/money/orchestration/
  configuration/Reporting candidates requiring reconciliation.
- `../../E/W02/README.md`, `../../E/W02/CHILD_SPRINTS_AND_GATES.md`,
  `../../E/W02/IDENTITY_GUEST_PROPOSAL.md` and
  `../../E/W02/GATEWAY_CLIENTS_APP_ACCEPTANCE.md`: missing base/grants/guest/client
  acceptance and explicit provider-first/barrier boundaries.

Next action: E receives this reviewable request with B/C/A/D, resolves applicable
owner policy, accepts the actual W03 primitives and W04 contract release through
its common-base process, then authorizes bounded W04 provider children. This
document is a handoff, not notification sent to peers, review approval or release.
