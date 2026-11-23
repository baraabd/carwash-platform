# W08-D → W09 operational contract requests

Status: **PROPOSED / NOT_ACCEPTED / NO_BASE_W08**. Revision: proposal 0.1.0;
this is not a package, endpoint, event or policy release. Observed main:
`f0b76221c1a1991ba78327c019f0b4a0a7c53dff`. No W09 implementation starts here.
E must reconcile these requests with the current owner packets, approve the
essential additive contracts before staging rehearsal and publish an immutable
base, versions, review record and provider/consumer evidence. Main and merged
proposal documents do not supply that acceptance.

## Common contract envelope requested from E and authoritative owners

The following are proposed semantic fields, not accepted wire spellings. Freeze
one strict schema/version and public client export per operation. Unknown fields,
missing required fields and invalid enumerations must fail closed. A field may
be null only where its schema explicitly represents an unavailable fact; null
cannot imply unrestricted scope, successful delivery or zero money.

| Concern | Required contract decision and evidence |
| --- | --- |
| Identity and service trust | E owns current authenticated actor/session, authentication generation, allowed action and scope decision; bind audience, service principal and request purpose. Service accounts do not inherit human permissions. Guest capabilities never acquire admin grants. Do not trust browser-supplied actor or projection role fields. |
| Owner authority | Every request/receipt binds owner, subject/resource reference, action, purpose and current owner revision. Opaque participant references require E's private identity mapping and C's current relationship facts; D cannot infer conversation membership from a Reporting row. |
| IDs and revisions | Freeze operation/request/event IDs, resource and assignment-attempt revisions, configuration and authorization generations, cursor/snapshot/generation identity. B's opaque revisions and earlier D integer proposals require one reviewed profile or explicit versioned adapters. |
| Money and time | Freeze owner-approved Money fields, integer minor-unit transport, currency/precision-policy reference and mixed-currency handling; no floating-point sums or implied two decimals. UTC instants and approved market timezone/calendar boundaries are separate. Rendering Asia/Damascus is not financial timezone approval. |
| Idempotency | Owner persists actor+action+resource/purpose-scoped identity and canonical fingerprint with replayable result in the same transaction as the mutation. Same identity/different fingerprint conflicts. Specify canonicalization, receipt lookup, retention/replay lifetime and expired-identity behavior; no duration is selected here. |
| Outcomes and recovery | Distinguish rejected, pending, unknown and owner-confirmed terminal facts. Timeout does not authorize a new money operation. Define error codes, retry eligibility, maximum attempts/elapsed time, status lookup, compensation owner and post-revocation result access. Sensitive result bodies must be redacted if current access fails. |
| Audit and privacy | Minimal actor reference, action, scope/purpose, owner operation/resource references, revision, outcome and UTC decision time. Never include session material, OTP, private URL, raw message, private evidence bytes or unnecessary customer/contact/location fields. Freeze legal retention, deletion/restore masks and audit access separately. |
| Compatibility | Preserve Identity V1 and strict booking.confirmed.v1. Additive fields still require runtime parser/client compatibility tests. A breaking dependency requires an explicit new common base; no local aliases silently become production fallbacks. |

## Requests and essential staging prerequisites

All six requests are **BLOCKED / NOT_ACCEPTED**. Provider and consumer tests use
real merged owners and isolated E-allocated resources. Fixtures can validate
parsers, never satisfy integrated acceptance.

| Request | Authoritative producer / consumers | Proposed request and response/event field groups | Transitions, recovery and required tests |
| --- | --- | --- | --- |
| OP09-01: bounded operational alerts | Each owner supplies its own facts; E owns telemetry/incident routing; D Reporting/Communications consume permitted references | Alert identity/version, owner, condition code, approved severity, observed UTC time, first/last observation, aggregate count, freshness/frontier and bounded correlation references. Acknowledge request binds current actor, alert revision and reason code; response is durable receipt, not proof of resolution. Threshold/budget profile reference is required and currently absent. | Open→acknowledged→resolved only from current owner evidence; re-open deduplicated by accepted incident identity. Owner stale/unavailable becomes explicit unknown. Duplicate/reordered updates cannot lower severity or falsely resolve. Test role denial, cardinality/size bounds, redaction and current revocation. No real alerts/messages sent by this packet. |
| OP09-02: permission recovery | E Identity/gateway/security-kit → D app/services; A/B/C enforce their own resource grants | Request binds current session/actor, purpose and resource; response identifies current authorization generation and permitted action/scope or denial/unavailable. Revocation notification schema binds subject/session/generation, event version and time without unnecessary PII. Define subscription registration and reconnect verification. | Invalidate sensitive caches, pending fetches, modal drafts, object URLs and subscriptions on revocation; fence late responses by actor/generation. Reauthentication rechecks owner scope; it never replays an abandoned privileged mutation automatically. Test open tabs, in-flight requests, missed/reordered notifications, long export/download and concurrent case/refund decisions. Freeze revocation freshness/delivery and no-cache policy before rehearsal. |
| OP09-03: queue replay and integrity | B Catalog outbox; D Communications/Reporting inbox/effects; E broker/shared messaging | Replay request binds incident, permitted queue/consumer/event range, source manifest/digest, original event identity, schema, accepted byte/fingerprint profile, reason and expected consumer generation. Response binds durable replay attempt and per-owner application/frontier status. DLQ body/private payload access needs separate scope. | Preserve original identity and detect changed bytes; never mint a new identity to bypass Inbox or clear receipts. Repair broad uniqueness classification in both D stores after real race reproduction; unrelated effect failure must remain retryable/error. Generation replay rebuilds only the intended projection, never messages or money. Real DB/broker six race controls, commit-before-ACK kill, restart, ordered gap/catch-up and unauthorized replay denial required. |
| OP09-04: private exports and retention | A Customer owns customer export sections; B/C/D own their sections; C Media owns private bytes; coordinator remains unpublished; E current grants | Export request binds purpose, subject/scope, allowlisted fields, canonical filters, owner snapshot vector, current grants and approved resource/retention profile. Receipt/result binds job identity, owner status, projection generation, snapshot digest, private artifact reference, sensitivity and expiry policy reference. Download reauthorizes actor/object/purpose and does not use job possession as authority. | Proposed queued/running/ready/failed/cancelled/expired states require owner acceptance; missing owner result remains partial/unknown. Revoke generation before exposing prepared bytes; mask deleted subjects during historical rebuild/restore. Test query/cursor/scope tampering, formula/newline/tab variants, CSV/PDF fields, unauthenticated/foreign/revoked downloads, resource exhaustion, expiry/deletion and restored backups. Legal retention and coordinator must be accepted, not inferred. |
| OP09-05: safe original-operation recovery | B Billing/Wallet/Subscription/Pricing and C Booking/Dispatch/Scheduling; D Support/Configuration/Reviews/Communications own only their commands | Status request binds original operation identity, actor/resource, purpose and accepted fingerprint; owner receipt returns current authoritative state/revision and safe next action. Cross-owner compensation links the original intent and each compensation identity. Reporting provides freshness only. | Pending/unknown never becomes success or authorizes a second refund, confirmation or privileged decision. Same-key retries return owner receipt; different payload conflicts; stale revision loses safely. Test concurrent admins, committed response loss, dependency failure, late completion after revocation/cancellation, replay and audit. Support closes cases separately from Billing refund settlement. Freeze lifetime/status semantics before UI integration. |
| OP09-06: incident and projection recovery runbooks | E incident operations + authoritative source owners; D owns its service repair/read model | Incident receipt links exact source/tree/image/configuration, owner, alert/operation references and redacted evidence. Rebuild job binds per-source consistent snapshot/high-water manifest, application generation, contiguous applied frontier/vector, privacy-mask revision, catch-up barrier and fencing token. Activation result identifies old/new generation and measured reconciliation. | Read-only triage first; owner-approved scoped replay/repair next; independent reconciliation and fenced atomic switch only when all source barriers converge. Retain Inbox transport receipts while applying a new projection generation. No peer DB access, cross-owner reset or duplicate external effect. Test gap/reorder/restart/stale worker, mixed-currency independent datasets, refund/cancel/moderation corrections, privacy deletion and failed cutover rollback. |

## Requested bounds and performance profile

E and product operations must approve workload mix, dataset sizes, concurrent
actors, duration, hardware/OS/runtime/database/broker versions, dependency
faults, acceptable error/latency/freshness windows and recovery objectives.
Owners must publish limits for HTTP body/text/field count, filters/sort/cursors,
page size, export row/byte/runtime/concurrency, retries and deadlines,
subscription count/fan-out and replay range/rate. D records measured dashboard,
search and export outcomes against those approved values before index or
pagination changes. No product thresholds, benchmark observations or index
improvements are claimed here. The technical 3-second gateway timeout,
foundation lease/retry defaults and historical harness budgets are not SLOs.

## Proposed incident procedures to review before rehearsal

1. **Permission revocation or private-link exposure:** E establishes current
   actor/session/generation and exact affected object/purpose with the owner.
   D fences client responses and removes sensitive caches/subscriptions; C
   revokes affected private artifacts. Recheck the original operation through
   its owner; do not automatically issue another mutation. Preserve redacted
   audit and obtain approved notification/retention decisions.
2. **Inbox conflict, DLQ or missed projection:** D compares original identity,
   accepted byte profile and committed receipt/effect in its own store. Treat
   contradictory bytes as integrity conflict; unrelated unique failures are
   not duplicates. E verifies producer/service identity and transport. Owner
   repair/replay uses a bounded authorized range; compare independent owner
   data and contiguous frontiers before declaring recovery.
3. **Unknown money or administrative decision:** D shows pending/unknown and
   retrieves the original owner receipt under current authorization. B/C or
   the D owner determines terminal outcome and compensation. Support and
   Reporting cannot infer settlement from an image, navigation or projection.
4. **Export abuse or privacy request:** coordinator/section owners verify
   subject, purpose, fields and authorization; stop/revoke only owned jobs and
   private artifacts. Audit minimal scope/time/outcome. Apply owner-approved
   retention masks to exports, projections and restored backups; do not delete
   another owner's database or promise legal retention from a fixture.
5. **Failed generation cutover:** D preserves the live generation and transport
   Inbox. Verify manifest/vector, privacy-mask and activation fence; rebuild or
   discard only the isolated failed generation. Roll back display activation
   with current authorization and reconcile against authoritative owners.

These are reviewable procedures, not an executed drill. E must allocate exact
Compose/DB/role/queue/object/browser namespaces and authorized fault points.
Record process ownership, stop handles and cleanup proof. Keep one heavy slot
until measured headroom permits more. No production destructive exercise,
deployment, live money or real message is authorized by this task.

## Sequencing and next action

Essential OP09-02/03/04/05/06 schema/trust/recovery semantics and the OP09-01
approved alert/budget profile precede staging rehearsal. Split accepted narrow
providers from their consumers: E auth/trust, each owner's command/status and
private data provider, then D app/export/read-model consumers with full real
affected journeys. Parent W08-D remains INTEGRATION_PENDING/NO_GO until every
required hardening and accessibility failure is fixed and retested on the actual
latest-target+head candidate, with independent review and verified resulting
target. Do not start W09 from this proposal.

See [security plan](SECURITY_PRIVACY_EXPORT_RECOVERY_PLAN.md),
[17-screen matrix](ADMIN_SECURITY_ACCESSIBILITY_MATRIX.md),
[acceptance specifications](../../../../tests/parallel/D/W08/ACCEPTANCE_SPEC.md)
and [checkpoint](HANDOFF.md).
