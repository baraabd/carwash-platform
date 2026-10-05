# W06 owner requests, including privacy fulfillment

**REQUESTED / NOT_ACCEPTED / NOT_IMPLEMENTED.** BASE_W06 and exact next package
versions are unpublished. The following semantic families need owner-reviewed
schemas, not private DTO copies or speculative package exports. W05 acceptance
and predecessor barriers remain prerequisites; do not automatically begin W06.

## Shared required profile

For every family freeze producer/consumer, contract ID/version, route/event shape,
required/nullable/unknown fields, object IDs and owner revisions, exact Money/
currency/scale/rounding where relevant, server UTC/effective policy/expiry,
current actor/session/guest/object/purpose authority, canonical idempotency
scope/fingerprint/conflict/replay/lifetime and cross-key uniqueness, error/deadline/
unknown-result status, owner-local audit/outbox/compensation, backward compatibility,
private-data classifications, real producer/consumer tests, packages/configuration
and approved production UI mapping. No proposed name below is already exported.

| Requested family                                | Authority / consumers                                      | Minimum semantic fields and decisions                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wallet holder/balance/hold/custody              | B Wallet → B/C, scoped A/D views                           | Approved actor/holder/purpose, currency, available/reserved/custody amounts, hold/operation/posting IDs, revisions, reserve/commit/release receipt, replay/finality/reconciliation. Freeze allowed holders and internal custody uses; no inferred customer funding/withdrawal/fourth method. Old WalletHoldResolveCommand draft requires posting IDs even RELEASE: settle action-specific evidence/nullability, never fabricate release postings. |
| Entitlement eligibility/reserve/consume/release | B Subscription → C Booking, A/D                            | Benefit/catalog/price/policy snapshot, subject/Booking, immutable entitlement ID, revision/expiry, reservation and consume/release operation/result; exact financial evidence needed by each transition. No automatic recurring debit.                                                                                                                                                                                                            |
| Booking benefit binding/compensation            | C Booking ↔ B                                              | Current Booking/financial-plan/reservation revisions, lifecycle fence, independent entitlement and charge/refund receipts, unknown/partial result and recovery; two concurrent bookings cannot consume one unit.                                                                                                                                                                                                                                  |
| Support request/action/status                   | D Support ↔ actual A/B/C owners                            | Verified requester/delegation, subject/Booking/object scope, reason and minimal evidence, task/action receipt, authorization revision, audit and partial/failed/blocked progress; Support cannot grant itself finance/work/privacy authority.                                                                                                                                                                                                     |
| Review eligibility/moderation/publication       | D Reviews ↔ C Booking, A Customer, C Media                 | Real completed-work eligibility, author/Booking/object, one-review business rule, revision, moderation reason/authority, edit/publication/removal and purpose-bound processed media; no fixture grants eligibility.                                                                                                                                                                                                                               |
| Fleet/technician binding                        | C Workforce/Dispatch → C/operator, D scoped administration | Existing team/van/equipment/eligibility/current work-grant IDs/revisions, expiry/revocation/assignment, retention and approved employment model. Fleet is within Workforce authority, not a new provider marketplace/payroll service.                                                                                                                                                                                                             |
| Private media linkage                           | C Media ↔ authoritative purpose owners                     | Reservation/object/version/checksum, purpose/classification/subject, scan/process/finalization, current byte-access grant, expiry/retention/delete receipt; thumbnails/exports remain private when source is private.                                                                                                                                                                                                                             |
| Notifications and approved channels             | D Communications ↔ real event owners, A/C/D views          | Event/version/revision/correlation, recipient/consent/purpose/channel/template revisions, dedup/send/delivery/unknown receipt, retries/provider result/retention; current OTP implementation does not prove SMS or any new channel.                                                                                                                                                                                                               |

Public event projections expose only the data needed by an authorized consumer.
Keep `booking.confirmed.v1` strict shape unchanged; new financial/benefit/privacy
events require separately reviewed versions and compatible replay tests.

## Privacy request is not fulfillment

D/W01 CP-D-004 is an unaccepted candidate for Support coordination. Product/D/E
must confirm the coordinator and per-owner obligation map before publication.
Use existing services; no new global Privacy service or one-call cross-DB delete.
Approved scope determines which export/rectification/anonymization/retention
operations execute in W06 and which require an explicitly sequenced later owner
task. B's earlier W07 reservation cannot be silently relabeled W06 fulfillment.

Candidate request receipt: `requestId`, verified subject/requester/delegation,
`requestKind`, scope/policy revision, received time, request revision, operation
ID and status. Candidate owner task: `taskId`, request/subject, authoritative
owner, data-purpose scope, requested operation, expected owner/policy revision,
deadline and current scoped service/actor grant. Candidate owner result:
`resultId`, request/task/owner, actual action, status, affected scope/revision,
completed time only when actually complete, redacted evidence locator/digest,
retained categories/reason/policy/legal-hold reference, failure/blocker/retryability
and secure export artifact metadata when applicable. Exact enums and fields need
owner review before implementation.

Request received, identity verified, owner work pending, partial fulfillment,
blocked/failed owner result and fulfillment completed are separate visible states.
Completion requires every required owner result plus approved projection/media/
provider-copy/backup handling; no aggregator can mark complete from an ACK.
Exports can be delivered while retention/anonymization is still pending, with
truthful per-operation status. Consumer/admin copy for these states is unapproved.

| Owner boundary                             | Required requested action / evidence                                                                                                                                                                      |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A Customer/Vehicle/Geo                     | Profile/contact/consent/address/vehicle/location export and approved rectification/anonymization/retention; consent withdrawal separate from account deletion and financial history.                      |
| B Billing/Wallet/Subscription              | Scoped financial/benefit export and approved redaction/retention/subject-link policy; preserve immutable required ledger evidence and legal holds. Do not invent a retention period or delete postings.   |
| C Booking/Scheduling/Dispatch/Workforce    | Scoped booking/work/assignment/fleet records and approved historical identifiers/retention; privacy operation cannot silently cancel live work or erase compensation receipts.                            |
| C Media                                    | Objects, versions, derived images, quarantine and private export objects, purpose retention and actual delete/anonymization evidence; revoke access before exposing expired/private data.                 |
| D Support/Reviews/Communications/Reporting | Cases/reviews/messages/delivery/provider copies/projections and current consent handling; actual per-owner results, redacted audit and lawful retention decisions.                                        |
| D Configuration / product policy           | Versioned effective retention/legal-hold/consent/fulfillment policies and owner validation; actual inputs and accountable approval, not guessed legal rules.                                              |
| E Identity/Gateway/platform                | Current sessions/refresh chains/guest and delegated grants, account/authVersion revocation, status/export access and caches. Revocation is an access result, not physical deletion of other owners' data. |

The map must cover broker queues/DLQs, logs/traces/audit, caches/reporting views,
backups/restore reapplication, third-party notification/media copies and export
downloads. Owners approve retention and deletion guarantees for each copy. Export
format (JSON versus private binary), authentication/expiry/download limits,
processor-scanned object, manifest/digest, revocation and secure disposal remain
explicit contracts. No public URL or reusable bearer URL is a privacy guarantee.

Required privacy provider tests: current subject/object denial, revoked session/
grant after request and before download, duplicate/conflicting operations, partial
owner outage/resume, retention/legal hold, accurate per-owner result aggregation,
restore/projection/provider-copy handling and sentinel redaction. Consumer tests
must distinguish request accepted from completed, with actual independent sessions.
Prototype local JSON export/reset cannot close server fulfillment acceptance.

## Freeze and sequencing request

E/owners first settle common authorization/Money/revision/idempotency/media/policy
profiles. Accept real Wallet/Subscription eligibility/reservation providers, then
C Booking binding/compensation and actual consumers. For support/reviews/fleet/
notifications, accept actual purpose/eligibility/event authority before consumers.
For privacy, first accept a narrow verified request/subject/purpose/task-binding
provider so executors have real authority to consume. Then accept scoped owner
executor/status/export providers, followed by final coordinator completion
aggregation and the customer/admin journey. Preserve all mandatory gates;
publish exact package versions and immutable accepted base only at the reviewed
barrier. This request packet is not that release.
