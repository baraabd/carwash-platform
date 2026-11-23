# W03 quote validation / Billing / Booking request

Status: **conditional, unaccepted next-wave request**. Proposal revision:
`w02-b-validation-request/0.1.0`; intended versioned external surface V1,
subject to E's compatibility review. Accepted/published package versions for
this request: none. Current consumed foundation versions remain contracts
`0.0.2`, events `0.0.2`, clients `0.0.1`.

This refines the W01 future packet's Pricing validation/Billing obligation
reservations, without replacing its closed schemas. No W03 producer/consumer,
new accepted DTO, mutation or payment state is implemented by this W02 packet.
First close [CONTRACT_DELTA_REQUESTS.md](CONTRACT_DELTA_REQUESTS.md), publish verified
W02 contracts and accept actual Catalog/Pricing providers.

## Owner and dependencies

Pricing owns quote validation and immutable calculation evidence. Booking (C)
owns orchestration; Scheduling (C) owns capacity. Billing (B) owns obligations
and postings. Gateway/admin own no quote, booking or financial tables.

E publishes bounded HTTP/client/event schemas and service authorization. A owns
actual customer/vehicle/location capabilities. D owns approved policy/configuration
publication. Consumer services use those contracts, not another owner's DB,
Prisma client or implementation. No quote implies a Booking, hold, payment,
cash receipt, Wallet balance or subscription entitlement.

## Requested validation contract

Candidate semantic request, not an existing endpoint:

| Field/evidence                    | Proposed semantics awaiting publication                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| schemaVersion                     | Explicit contract version; unknown versions rejected                                                         |
| quoteId                           | Immutable Pricing resource reference                                                                         |
| expectedQuoteRevision             | Exact snapshot revision, never an implicit latest quote                                                      |
| beneficiaryBinding                | ACCOUNT/GUEST reference verified under accepted Identity policy; cannot be trusted from body alone           |
| requestingActor/service           | Authenticated current principal and accepted service scope, independently checked by Pricing                 |
| purpose / orchestrationReference  | Accepted bounded operation and durable Booking/Billing correlation; cannot grant object access by themselves |
| expected currency/total/revisions | Optional consistency assertions only; never price override inputs; E settles required comparison fields      |

Propose a versioned response containing quote ID/revision, server-derived
beneficiary, issuer actor/delegation audit reference where applicable, exact
currency/precision/policy revisions, immutable Catalog/price/description/item
references and quantity/unit/adjustment/total evidence, issue/expiry times,
server evaluation time and a safe usable/expired/revoked decision.

All amounts must retain the single accepted money vocabulary. W01 B proposes
integer minor-unit decimal strings; E must reconcile that with C/D rather than
publish adapters with undocumented conversions. No JSON floating total, browser
quote reconstruction, default currency, exponent, rounding or fee policy is accepted.
The accepted W02 snapshot schema is consumed by reference, not copied as a private DTO.

## Policy questions that must be answered

- Validation at the exact expiry boundary uses server time and the approved
  expiry rule. TTL, honoring after price edits, revocation and retirement effects
  remain B-05/contract decisions; do not choose numerical lifetimes.
- Decide whether validation is a read or a durable reservation/consumption command,
  what constitutes use, whether/how multiple Bookings can use one quote, when
  capacity/obligation acceptance commits it, and any release deadline/compensation.
  A successful read cannot promise exclusive use or capacity.
- If consumption/reservation is required, specify expected state/revision, exact
  owner of its durable state, actor/operation/key uniqueness, request fingerprint,
  retained terminal outcomes and conflict/release/replay semantics before implementation.
- Rebooking creates a new quote against current accepted definitions/price/policy
  and revalidates capacity; it never rewrites the old quote or Booking snapshot.

## Failure, replay and unknown outcome

Request safe versioned reasons for not-found/wrong-owner, unauthorized/revoked
subject, expired/revoked quote, revision/currency/amount assertion mismatch,
missing policy, upstream unavailable and timeout. E settles HTTP/envelope
compatibility; W01-specific reasons are not current Gateway codes.

For any accepted mutation, require the published idempotency syntax and scope,
canonical request/version/actor/beneficiary fingerprint, one durable effect and
replay of the original outcome. Different payload with the same scoped key
conflicts. Response loss after commit is recovered with the same key/request
or an authorized status lookup; no new-key optimistic duplicate.
Replay never extends expiry or changes a snapshot. Retention/tombstone policy
must prevent a forgotten key from recreating an old obligation.

Billing derives its obligation amount/currency/beneficiary from authorized
Pricing evidence, not browser totals or a forged validation body. Exactly how
expiry and consumption interact with durable obligation creation must be accepted
by B/C/E. Financial journal/payment confirmation remains separate from that obligation.

## Events and compensation

Only accepted producer-authenticated events may be consumed. Reference-only
quote/obligation facts carry immutable IDs/revisions and safe correlation, not
contact, plate, private proof or a full sensitive snapshot. Choose event names
and compatible envelopes with E; do not reuse foundation.probe.created.v1 as finance.

Local state/receipt/audit/Outbox commit atomically; Inbox/projection commits before
ACK. Duplicate/conflicting event IDs, crash before/after commit/ACK, stale/gapped
revisions, broker outage and DLQ/recovery require real tests. Booking records
orchestration deadlines and calls each authoritative owner for compensation.
A late payment never recreates expired capacity or silently revives a revoked quote.

## Provider and consumer acceptance

Accept Pricing validation against actual W02 Catalog/Pricing/Identity/configuration
providers first. Prove restart-stable snapshots, live object/guest/admin authority,
expiry/revocation boundaries, exact assertion comparisons and concurrent
reservation/consumption if approved. Then accept Billing obligations and C's
Booking consumer against those merged providers, including unknown outcomes,
durable replay and real compensation/capacity evidence. A consumes verified
server totals in the frozen customer journey; D uses accepted publication and
on-behalf rules. Fixtures demonstrate shape only and do not close integration.

Required packages, route/export versions, policy revisions, broker permissions,
resource allocation and executable gate commands must be published by E before
source writes that consume this request. No peer notification or independent
approval is fabricated; the draft PR is the reviewable E/A/C/D handoff surface.
