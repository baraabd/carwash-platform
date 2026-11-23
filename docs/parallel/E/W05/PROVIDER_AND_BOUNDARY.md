# W05 provider verification and E boundary proposal

**PROPOSED / NOT_ACCEPTED / NOT_IMPLEMENTED.** Source:
`3ce756cd39a9b0c1013043cee0ca1bb183466da7`. Billing owns provider adapters,
financial decisions and its DB. E owns technical secret transport, contracts,
Identity/Gateway/clients and cross-owner evidence; Gateway owns no financial data.

## Official public evidence, researched 2026-10-05

These links establish only the stated narrow facts, not merchant entitlement,
versioned APIs, finality, test access or transaction/refund verification.

| Provider      | Primary public source and observation                                                                                                                                                                                                                                            | Acceptance gap                                                                                                                                                                                                                 |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ShamCash      | [Arabic API request](https://shamcash.sy/ar/apiRequest) and [English API request](https://shamcash.sy/en/apiRequest) are official search-indexed request pages. Full English retrieval timed out. The newly found channel is a documentation lead, not a retrieved API protocol. | Obtain actual versioned protocol, authentication, lookup/finality, notification/replay/refund semantics, merchant agreement/owner and acceptance access. Form contents/eligibility are unverified.                             |
| Syriatel Cash | [Official service](https://www.syriatel.sy/services/syriatel-cash) describes merchant onboarding, QR payments and merchant received-payment history through provider applications/MySyriatel.                                                                                    | History is a candidate independent-review evidence source, not an approved verification route. Machine lookup, authenticated callbacks, export schema, transaction refunds, test facility and WashGo authority are unverified. |
| Syriatel Cash | [Official campaign](https://www.syriatel.sy/campaigns/syriatel-cash-service) and service page differ in numeric limits/fees and merchant instructions. Linked guides were not retrieved.                                                                                         | Do not adopt numeric limits, fees, denomination or USSD instructions as policy without current effective merchant terms. Wallet closure/balance return does not establish transaction refund support.                          |
| Paymera       | [Official site](https://paymera.net/) advertises partner API access, merchant dashboard and QR/POS/card services. No versioned protocol retrieved.                                                                                                                               | Required scope/method mapping, agreement/access, signatures, status lookup, settlement/reversals/refunds and actual test facility remain owner decisions. Advertising an API does not accept an integration.                   |

All required electronic routes: **DOCUMENTATION_AND_ACCESS_PENDING**. Missing
retrieval means unverified; do not claim providers lack APIs, refunds or sandboxes.
Unofficial SDKs, lookalike domains or wallet automation are not authoritative
protocol evidence. Do not submit API/account forms or perform merchant operations
as part of this proposal.

Paymera was requested in the broader project work. B/product must explicitly
resolve its required transport/provider relationship to the approved `cash`,
`sham`, `syriatel` UI methods, or record an approved later scope. No reviewed
source establishes a Paymera↔ShamCash/Syriatel relationship. Do not silently omit
it, rename it Paysera, or invent a fourth checkout method. Wallet remains an
internal data owner unless approved holder/purpose scope says otherwise.

## Per-provider entry dossier

B supplies a named accountable merchant owner and current approved agreement;
provider identity/API version/document hashes; actual environment and approved
verification route; beneficiary/merchant binding; exact money encoding/currency
scale and fee/finality terms; independent transaction lookup/history provenance;
refund/reversal/dispute semantics; notification trust/replay rules; operational
credentials provisioned without printing secrets; test permissions and cleanup.
E records reviewed versions and consumers. D/product approves reviewer authority
and production wording. Absence of any required route stays BLOCKED.

A route may be provider sandbox verification or explicitly authorized independent
merchant review. Local synthetic callbacks alone cannot qualify either route.
If a provider cannot reproduce a listed adversarial condition, retain a separate
local fault case and record the actual independent provider confirmation used
to establish the authoritative result. No required test is silently skipped.

## Independent facts and manual review

Customer proof/hint submission → proof processing → reviewer decision →
independently verified merchant credit → obligation allocation → final settlement
are distinct facts. A customer screenshot, QR, entered reference, provider request
acknowledgement, successful navigation or work completion cannot establish money.

A proposed manual decision carries `reviewOperationId`, `intentId`, `proofRevision`,
`expectedReviewRevision`, reviewer/current authorization, policy revision,
redacted independent merchant evidence locator/digest, provider transaction identity,
merchant, exact amount/currency and observed/final status/time. Billing verifies
the evidence against the intended beneficiary and request; C Media verifies
processed private proof purpose/binding. Commit decision, immutable audit and
durable receipt atomically in the authoritative owner DB. Compare-and-swap rejects
competing reviewers; retries return the original decision. D administers the
workflow, not an alternate finance ledger.

Current grants must be rechecked at mutation and later proof-byte access. Support,
technicians, the submitting customer and a self-assigned reviewer cannot grant
themselves settlement/refund authority. Existing role names or `billing.refund`
and `verification.review` permissions alone do not prove object/merchant-scoped
authority. Required separation of duties and exceptional review rules are explicit
policy decisions. Audit denial/conflict as well as successful mutation.

## Candidate wire profile, not exported API

Every row needs authoritative owner review before E publishes schemas/clients.
Route names, exact enums, numeric representations and versions are deliberately
unpublished; consumers must not copy a peer's private DTO.

| Proposed contract family         | Owner → consumers              | Required request/result semantics                                                                                                                                                                                      |
| -------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Payment instructions/intent      | B → A/D/C                      | Booking/obligation snapshot, beneficiary/provider/method, immutable price/policy revisions, exact Money, expiry and authoritative status/revision; private QR/instructions provenance distinct from actual transfer.   |
| Proof intake/correction          | B + C Media → A/D              | Intent and purpose-bound processed media ID and/or transaction hint; expected proof/review revision; checksum/scan/expiry/ownership; correction reason; supersession/removal; private-access token never on event bus. |
| Verify/review operation          | B + E current grants → D       | Independent evidence, review CAS, actor scope, idempotency, immutable audit; received credit and allocation outcomes separately visible.                                                                               |
| Allocation/status/reconciliation | B → C/A/D/reporting            | Credit/obligation/allocation/posting/operation IDs, each authoritative revision, provider finality/time, mismatch/unknown disposition; no single `paid` flag overwrites independent facts.                             |
| Refund plan/execute/status       | B ↔ C, D authorized action     | Source receipt/postings, approved refund policy/amount, reserved allowance, refund operation/result identity, provider idempotency/lookup, pending/unknown/final/failed distinction and immutable reversal links.      |
| Booking compensation/status      | C ↔ B/Scheduling/Dispatch, A/D | Lifecycle operation, current Booking/capacity/assignment/financial-plan revisions, fences, owner receipts, terminal policy and explicit partial/reconciling result.                                                    |

All families must settle required/nullable/unknown fields; exact IDs/revisions;
lossless Money/currency/scale/rounding; UTC owner clock and effective policy/expiry;
current account/session/guest/operation ownership and CSRF; canonical fingerprint;
same-key replay/conflict; business uniqueness across keys; timeouts and durable
unknown-result lookup; retention/tombstones; errors/redacted reasons; compensation;
backward compatibility; actual producer/consumer tests; reviewed package/config
versions. Prototype numbers are not wire Money. Latest A/B/D candidates use integer minor units but still differ in exact Money
fields, scale/policy placement and opaque/numeric revisions. Older C/other profiles
and any decimal adapters need an explicit reviewed compatibility profile; do not
claim all current peers disagree on the integer representation.

Keep strict `booking.confirmed.v1` payload `{bookingId,customerId}` unchanged.
Richer payment/lifecycle/entitlement events require new reviewed versions, owner
outbox commits and consumer revision-aware replay; timestamps alone do not impose
cross-owner total order. No new exports in `api-clients0.0.1` are implied here.

## Gateway, status and secret transport

Actual Gateway currently rejects query strings, does not forward precondition
headers and treats304 as upstream failure. Its bounded JSON client has no private
binary/SSE/WebSocket implementation. Choose owner-approved bounded polling first
or explicitly publish the required event transport; define allowed query/header
keys, conditional status, revision conflicts, credential/CSRF propagation,
per-route deadlines/backoff/rate/size limits and reconnect/current-auth rules.
Do not silently strip a precondition or turn stale state into a successful write.
Public status responses expose only actor-authorized safe projections; Reporting
and browser caches never become settlement authorities.

Provider callback ingress is a separate authenticated machine principal, not a
customer cookie route. Actual official documentation determines raw-body handling,
signature algorithm/key identifiers, clock skew, replay window, key rotation,
verification lookup and acknowledgement contract. Do not invent one HMAC profile
for all providers. Untrusted input cannot create a verified receipt. Enforce
bounded bytes, safe parsing, rate control and a durable deduplication/processing
receipt before the approved acknowledgement; retries/crashes remain recoverable.

Secrets reside only in approved server secret plumbing, never apps, fixtures,
Git history, logs or evidence bundles. Use explicit safe-field allowlists and
sentinel tests across Gateway/Billing/Identity/Media/traces/errors/metrics/events.
Current logging masks many keys, but bare `proof`, `qr`, `recipient`, `account`
and transaction references need explicit coverage. Do not log raw body/signature,
QR payload, proof bytes/URLs, beneficiary identifiers, OTP/token or full financial
reference. Redacted evidence locators must preserve provenance without leaking
credentials or private data; authorized audit storage has separate access/retention.
