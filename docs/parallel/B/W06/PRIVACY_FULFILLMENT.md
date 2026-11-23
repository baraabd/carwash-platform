# W06-B — Finance privacy fulfillment proposal

Status: **PROPOSED_NOT_ACCEPTED / NOT_IMPLEMENTED / BUSINESS_TESTS_NOT_RUN**.
This document requests owner-reviewed contracts and policies. It publishes no
BASE_W06, permission, retention rule, legal deadline or runtime guarantee.

## Current W06 obligation and historical scheduling

The current W06-B task explicitly includes B-owned export, anonymization and
retention fulfillment from the W01 decisions. This packet therefore proposes
that work in W06. B/W01 and B/W05's earlier W07 reservation is historical;
it must not silently defer the current W06 obligation. W07 requests cover
compatible extensions and remaining inventory, not removal of this W06 scope.
This scheduling instruction does not approve B-12 policies or shared schemas.

Entry remains blocked by the unpublished accepted BASE_W06 and predecessor
contracts, B-12 decisions, verified requester/task authority and actual financial
providers. Approved scope determines each executable action. No posted journal
deletion, customer stored-value product or global cross-service erase is implied.

## Inputs and explicit incompatibilities

Source inputs: B/W01 `POLICY_DECISIONS.md` B-12 and privacy requirements;
B/W01 `FUTURE_FINANCE_CONTRACTS.md` and `future-finance-contracts.schema.json`;
A/W05 `W06_CONTRACT_REQUESTS.md` section 5; D/W01 CP-D-004; and
E/W05 `W06_CONTRACT_REQUESTS.md` privacy request/fulfillment section.
These are unresolved decisions and proposals, not accepted legal policies.

| Existing proposal | Required reviewed reconciliation |
| --- | --- |
| B actions EXPORT / DELETE / ANONYMIZE | Map accepted intake actions ACCESS / RECTIFICATION / ERASURE / RESTRICTION / CONSENT_WITHDRAWAL to exact owner actions. An erasure request does not authorize deleting postings. |
| B generic FinancialResult.state | Replace open strings with action-specific closed results and valid required/nullable fields; define partial, blocked, failed and unknown outcomes. |
| B privacy-fulfilled events | Existing proposal carries policy/fulfillment/intake IDs without actual action/outcome/evidence. Publish truthful owner-result semantics before any completion consumer. |
| A CUSTOMER_RECEIPT_FACTS class | Explicitly decide Wallet statements/holds and Subscription purchase/benefit/reservation classes and fields. Do not widen this class to internal custody or third-party records. |
| D Support coordination | Confirm coordinator and required owner/copy obligation map. Support case grants cannot grant financial execution or disclosure authority. |

## Authority and policy prerequisites

Product/privacy/accounting owners must resolve B-12 with approver/source,
effective revision, jurisdiction where applicable, permitted fields/classes,
retention start triggers and periods, anonymization/redaction rules, legal holds,
backup/provider-copy handling, partial-export permission and completion criteria.
No engineering default supplies a due date, purge horizon or anonymity guarantee.

E must publish current subject/resource/purpose and delegated-service authority,
assurance lifetime, guest recovery/claim rules, task audience and scoped grants
for intake/status, owner execution, finance export and download where approved.
The present Identity vocabulary has billing.read/refund and Support case grants;
it has no accepted financial privacy execute/export/download or hold-management
grant. Account/session revocation remains E-owned and separate from erasure.

B rechecks current authority before work and sensitive status/replay/download.
Caller subject IDs, phone/plate, possession of a request UUID, broad staff role,
old grant snapshot or a Support ACK are insufficient. Define account-closure
recovery explicitly so a pending request remains recoverable under approved auth.

## Required request, task, result and artifact contracts

Apply the common request profile in [W07 requests](W07_CONTRACT_REQUESTS.md):
owner/consumer, closed versioned schemas, current auth, IDs/revisions, exact
Money/time where applicable, transitions, key/fingerprint/replay/lifetimes,
errors/UNKNOWN/recovery, compatibility, packages/config and actual gates.

| Contract family | Fields and semantics to freeze |
| --- | --- |
| Verified intake receipt — approved D/E coordinator | Request/operation ID, verified subject/requester/delegation and assurance reference/expiry, action/classes/purpose, policy revision, received time and request revision. Receipt records intake; it does not start unverified extraction. |
| Owner task — coordinator to Billing/Wallet/Subscription | Stable request/task/business identity, allowlisted owner, current subject/object scope, approved operation/class/fieldset, task/policy/expected owner revisions, assurance/deadline and verified service audience. |
| Owner status/result — each B owner | Task/request/result/operation IDs, actual action and affected scope, owner revision, closed pending/partial/blocked/failed/unknown/completed outcome, disposition, evidence reference/digest, retained categories and policy/hold reason, retry owner/next action; completedAt only for actual completion. |
| Scoped export manifest — B and approved aggregator | Requested/fulfilled classes and fieldsets, each owner's source revision/asOf, omissions/quality, snapshot format/version, artifact binding/checksum and real generation state. Multi-owner reads are not a global atomic snapshot. |
| Private artifact/access — actual C Media and accepted delivery owner | Real purpose/subject/task binding, finalized object/version/checksum/format, private classification, approved expiry/download limits/revocation/disposal, fresh download grant and access audit. No permanent public URL. |
| Per-owner result events/history — B to coordinator/D Reporting | Authenticated producer, event/operation/task IDs, aggregate revision/time, safe action/outcome/policy and evidence locator; exclude contact/proof/export bytes, assurance secrets and download grants. |

## Ledger-preserving execution and accurate outcomes

Billing preserves immutable amounts/currency, balanced entries, posting/business
identities, reconciliation links and required evidence. Wallet and Subscription
preserve approved financial/Booking/usage references. Apply only approved changes
to eligible identity/contact/presentation fields; never rewrite posted money.
Retained opaque subject links may remain personal data: report pseudonymization,
restriction or a retained exception accurately rather than claiming anonymity.

Export permitted subject-owned financial and benefit facts. Exclude another
customer, technician/team/company balances, merchant secrets, proof bytes,
private accounts and staff notes unless separately authorized by accepted policy.
Customer Wallet funding is conditional approved scope; custody is a separate
holder/purpose and cannot become a customer export merely through a Wallet name.

Persist owner operation/task/result/audit/outbox atomically. Stable task/effect
uniqueness survives retry-cache expiry. Same meaning/key recovers original result
after current authorization; changed meaning conflicts. A lost response remains
UNKNOWN until lookup/reconciliation proves the existing action. Do not create a
new-key export, repeat an irreversible action or compensate by deleting a ledger.

Logical redaction, restricted access, physical purge, legal-hold retention,
artifact readiness and account revocation are separate facts. A READY business
snapshot does not complete a subject-access or erasure request. A permitted JSON
metadata export does not fulfill an approved request for actual binary objects.
Missing owners cannot return empty=complete. Partial exports require policy and
an explicit manifest; coordinator completion requires every required obligation.

## Copies, replay and recovery

Approve the obligation map for queues/DLQs/events, logs/traces/audit, caches,
reporting views, replicas, backup restore, provider copies and export downloads.
Retention/tombstone and minimal nonpersonal dedup anchors need approved policy;
PII-bearing replay bodies/fingerprints cannot be kept indefinitely by assumption.
Rebuild/replay/re-export and restore must reapply accepted redaction/tombstones
before access, with truthful outstanding copy/purge/hold states. Access revocation
does not claim downloaded bytes or every backup were physically erased.

Retry only the affected failed/unknown task under current authority. Preserve
submitted operation references during local reset and account lifecycle changes.
Privacy does not silently cancel Booking, consume/release benefits, issue refunds,
withdraw consent on another owner, or abandon unknown financial operations.

## Required real acceptance and sequencing

All cases are **NOT_RUN**: own/foreign/two-guest scopes; spoofed/expired assurance;
revoked session/service grant before extraction/replay/download; Support/finance
separation; duplicate/conflicting task; concurrent hold/export/redaction; response
loss and restart around owner commit/artifact finalization; partial outage/resume;
current legal hold and approved release; ledger invariants; policy changes;
sentinel redaction across events/logs/exports; finalized private bytes/manifest;
expired/revoked download; artifact cleanup; replay/rebuild/restore/provider-copy
handling; and actual independent A/D sessions distinguishing intake from completion.

Acyclic children: E/product policy/auth/schema release -> verified narrow intake
and task-binding provider -> B executor/status/export and real Media providers ->
D completion/reporting consumers -> affected A/C/D journeys. Owned DB/migration,
HTTP/current Identity/constraints and actual consumers are mandatory; fixtures,
prototype reset/JSON download and foundation CI do not close fulfillment gates.
