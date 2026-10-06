# W09-D staging entry and W10 evidence packet

Task W09-D: rehearse real staging operations and recover supporting services.
Status: **PROPOSAL_ONLY / ENTRY_BLOCKED / REHEARSAL_NOT_RUN**. Proposal revision
0.1.0 is not an accepted contract/package, deployed candidate or passed rehearsal.
Observed main `b47390c8ce04b2674e9222918bcd4e03fa5aed24`, tree
`c8a1f2f9e84f6298f1b044a8e8cec2549f33c15f`, is an analysis source, not BASE_W09.
The registry still publishes W01/INTEGRATION_PENDING, BASE_W02=null and no
accepted next-wave contracts/clients. W08-D PR80 merged a proposal; it did not
implement admin operations, close INT-D-01 or accept W08/W09.

## Entry decision and concrete dependency requests

No documented deployed-candidate/environment entry was supplied or found in
the inspected repository packets. This does not assert that an external staging
environment cannot exist. E must identify it and publish the following actual
inputs before dependent source writes, service calls or recovery operations.
No first-time staging setup or guessed environment endpoint is authorized here.

| Required input | Current evidence / accountable supplier |
| --- | --- |
| Accepted BASE_W09 and integrated W08 | NOT_PUBLISHED; E supplies full resulting-target SHA/tree, mandatory and affected checks, independent review and actual contract/client versions. Main/merged proposals are not substitutes. |
| Deployed candidate | NOT_SUPPLIED; E supplies candidate identifier/source/tree, exact repository image digests for apps/services/workers/migration jobs, actual registry pull/deployment/startup receipts and immutable configuration/key references. Local foundation image inventory is not deployed artifact evidence. |
| Environment and identity | NOT_SUPPLIED; E supplies existing authorized staging identity/namespace, ingress/internal origins, current account/service identity/permissions, role/session/guest policy and permitted private-data test subjects. Do not discover credentials, assume a login or probe a guessed staging URL. |
| Allocated resources and slot | NOT_SUPPLIED; E supplies run/Compose/DB runtime/migration roles, queue/object/browser/output namespaces, exact owned process/worker stop handles and measured heavy-slot allocation. Worktree isolation is not runtime isolation. |
| Prior and deployed migration state | NOT_SUPPLIED; each owner + E supply prior accepted populated product schema/data, target migration IDs/order, applied/drift/role/constraint evidence, compatibility and rollback/forward decision. Current21 foundation migrations are inventory, not actual staging state. |
| Rehearsal scope and procedures | NOT_SUPPLIED; E supplies permitted faults/restores/rollback, actual existing deployment/restore interfaces/commands, backup integrity/access evidence, abort criteria and awaited cleanup/return-to-baseline protocol. Destructive production work remains excluded. |
| Numerical recovery/workload profile | NOT_ACCEPTED; product operations + E approve demand/environment/latency/error/freshness/RPO/RTO and owner-specific recovery/data-loss limits. Foundation timeouts and historical harness budgets do not fill these fields. |
| Real application/provider/design entry | BLOCKED; A/B/C/D implement and prove all required owner providers and admin/customer/operator consumers. Product/design supply missing English/production/recovery/private states; preserve registered references,17 admin screens and seven customer steps. |
| Actual operations roster | NOT_SUPPLIED; project supplies named authorized Operations/Finance/Support/on-call contacts, channel, hours/coverage, incident/abort responsibility and escalation acknowledgement. Repository reviewer/domain names are not an on-call roster. |

The [role runbooks](ROLE_OPERATIONS_RUNBOOKS.md) and
[recovery runbook](SUPPORTING_SERVICES_RECOVERY_RUNBOOK.md) are proposed
procedures. A contact label, written runbook, health response, scheduled exercise
or fixture does not satisfy this entry or a measured operational journey.

## Required operational bundle and sequencing

Sequence narrow real providers before consumers against accepted contracts:
E current trust/routes and operation-status/private-byte transport; A/B/C/D
authoritative data/status/history; D protected case/review/communication/
configuration/report/export providers; all three application consumers; then
E-orchestrated staging journeys and recovery. Parent remains INTEGRATION_PENDING
until all listed gates pass on the combined source. No moving peer branch,
private DTO/client, database import or provider fixture substitutes a producer.

Run the required journeys with real, deployed admin/customer/operator apps:
technician review/corrections→current eligibility; cash booking→receipt/custody/
company settlement; electronic proof→independent verification/refund; subscription
and promotion; fleet restriction→scheduling/dispatch effect; support resolution;
moderated review; scheduled notification→actual permitted delivery disposition.
For each retained action capture current Identity and owner scope, durable
operation/receipt/revision, denied controls, reload/reconnect and owner outcomes.
No production customer messages or live payment/refund may be used for evidence.
Use E-approved isolated data and permitted sandbox/provider profiles; an unknown
provider availability cannot be relabeled a successful real send/payment.

Under E orchestration, rehearse D populated upgrade, scoped backup/restore,
rollback or accepted forward recovery, worker interruption, duplicate/reordered
delivery and provider outage. Inspect actual restored Configuration versions,
case/review/history, conversation and delivery attempts, Inbox/effects/frontiers,
audit/financial-request links, private artifacts and source report reconciliation.
Measure elapsed recovery and the actual data-loss window with approved bounds.
No checkpoints, cases or other product models are claimed present in the current
marker/probe schemas. Pure process health is a separate technical observation.

## Proposed local evidence schema

These are proposed evidence-bundle field groups for E review, not a new external
API/event or an executed bundle. Every mandatory value needs real provenance;
missing/null/unknown cannot mean empty data, zero loss or PASS. A measured zero
must include its independent reference dataset and measurement method.

| Field group | Required actual content before acceptance |
| --- | --- |
| Task and immutable source chain | W09-D phase; accepted BASE_W09; latest target, PR head and exact combined candidate/tree; review record; resulting target if merged. Bind every artifact to the source/config actually executed. |
| Deployed artifacts and contracts | Environment/candidate/run ID, registry repository digests/pull/startup receipts, app/service/worker/migration inventory, package/client/event/schema versions and immutable configuration/key-policy references; omit secret values. |
| Migration and prior state | Prior accepted schema/data manifest, backup point/digest/owner access, migration IDs/applied order/drift, runtime/migrator roles and actual clean/populated upgrade output; schema/client/event compatibility and rollback/forward path. |
| Actors and permissions | Actual approved role/service accounts represented by redacted test references; current actor/session/auth generation, purpose/object/market/assignment and owner authorization. Captured revocation/restoration and private-document denial controls. |
| Journey and fault observations | Case ID, exact approved screens/actions and command, UTC timestamps/monotonic duration, operation/fingerprint/revision/receipt, authoritative before/after data, actual fault/ACK/worker timing, result/disposition and redacted output/artifact links. Label real HTTP/DB/broker/provider/browser versus fixtures separately. |
| D restored state | Configuration versions/CAS/adoption; case/review event/history and moderation count; conversation message/attempt dispositions; Inbox source digest/local effects/application generation; contiguous per-source frontier/vector and privacy-mask revision; audited financial request linked to actual B result. |
| Reconciliation and measurement | Independent owner source snapshot/high-water/gap manifest and permitted values/fields, report definition/Money/currency/time profile, restored control totals/content and omissions; measured elapsed recovery/data-loss window/error/freshness under approved environment/profile. No global sum across currencies. |
| Private data and audit | Object/artifact purpose/state/version/digest/retention and current access; permitted log/audit fieldset and sensitive canary checks. Public evidence omits actual private bytes/URLs, credentials, precise locations, contact/message/proof content and unnecessary personal identifiers. |
| Cleanup, risks and acceptance | Owned handles and awaited cleanup proof, returned environment state, every failure/blocker/owner/retest, actual escalation acknowledgement, exact accepted-limit comparison and release disposition. No shared resets, manual ledgers or queue deletion. |

The current [acceptance specifications](../../../../tests/parallel/D/W09/ACCEPTANCE_SPEC.md)
are all BLOCKED/NOT_RUN. Actual staging bundle: **NOT_PRODUCED**;
recovery observations: **NOT_MEASURED**; operational roster: **NOT_SUPPLIED**.
Do not create a populated-looking evidence fixture or claim an executed bundle
from these documents. [Source observation](SOURCE_OBSERVATION.json) and
[handoff](HANDOFF.md) bind only the current source/proposal diagnostics.

## W10 requests and unresolved blocker transfer

These requests extend [W08 operations proposals](../W08/W09_OPERATIONS_CONTRACT_REQUESTS.md)
and E's W08 rehearsal packet. Their proposed names/versions remain unaccepted.
They cannot waive incomplete W08 hardening, W06 financial privacy fulfillment,
real product journeys or current authority/retention decisions.

| Request | Authoritative owner and required freeze |
| --- | --- |
| W10-D-ENTRY | E release/operations: immutable accepted source/deployed-artifact/configuration/migration/environment identity, authorized command interface, current actors, roster, resource slot, approved bounds and actual final-source gate/review bundle. A manual supplied status needs the same evidence as an automated hook. |
| W10-D-RECOVERY | Each data owner + E: owner-local request/status and history/checkpoint inspection, restore incarnation/source manifest, revision/generation/privacy fences, migration/worker/client compatibility, scoped replay and rollback/forward abort/recovery. Publish exact request/response/event schemas and clients before D hooks. |
| W10-D-FINANCE | B/C with E trust: original financial/resource operation identity, actor/purpose/resource revision, durable outcome/compensation and recovery lookup; preserve Wallet physical custody versus Billing actual receipt/posting/settlement. Restored D audit links cannot authorize another refund or resurrect capacity/benefits. |
| W10-D-PRIVATE | Approved coordinator/all section owners/C Media/E: per-owner privacy obligation/result, retained/blocked/partial disposition, current authorization and restore suppression across private files, exports, backups/caches/DLQ/history. No invented coordinator, statutory duration, marketing consent or public artifact fallback. |
| W10-D-OPERATORS | Project operations + E: actual named escalation contacts, permitted access and response/abort acknowledgement; D role screens/statuses and incident evidence. Owner roles are routing requests, not supplied people or proven availability. |

For every essential interface freeze authoritative provider/consumer, schema and
version; actor/guest/service/object/purpose scope; IDs/revisions and exact
Money/currency/precision/time semantics; allowed transitions; idempotency scope,
canonical fingerprint, replay result/lifetime and expired evidence; errors,
timeouts/pending/unknown/status and retry budget; compensation; compatibility,
provider/consumer tests and required package/configuration. No numeric profile
or transport vocabulary is selected by this packet. Current Identity V1 and
strict booking.confirmed.v1 stay compatible; breaking changes need a new common
base before affected work resumes.

## Evidence invalidation and release boundary

A source, contract/client/schema/migration/worker/image/configuration/key-policy/
permission/retention/design/profile/environment change invalidates affected
prior evidence even if an older head was green. Record exact affected cases;
E recomputes latest-target+head, reruns all mandatory/affected gates, obtains
independent review, verifies unchanged refs and verifies the actual resulting
target after any authorized merge. Metadata-only publication of this handoff
does not repair missing operational evidence. Same-login sessions do not
satisfy independent approval or branch protection.

No production deployment, real-customer message, live payment/refund, broad
process kill/stack reset, cross-owner database query, manual ledger edit or
queue deletion is authorized here. Stop after this reviewed W09-D draft packet;
E must supply accepted entry and measure the bounded rehearsal before BASE_W10
or release readiness. No W10 implementation starts automatically.
