# W02-C — E prework contract and resource request

Status: **PROPOSED / NOT ACCEPTED**. Source `3db1afdd04c6ec65a38ca83f3993c964a1bf7587`; no verified BASE_W02. This is a delta/closure request against the merged [W01-C packet](../W01/CONTRACT_REQUESTS.md), sections 3–5 and 8. Its proposed schemas and common ID/revision/time/idempotency rules remain subject to provider/consumer review; no private DTO is copied into a service.

## Publication requested before product writes

| Item / accountable owner | Concrete missing publication | Required acceptance evidence |
| --- | --- | --- |
| E contracts/clients | Accepted IDs, exact schemas/parsers, supported client exports, OpenAPI/AsyncAPI, package versions and compatible error/retry mapping for Media and Workforce | Publish source SHA/review record; valid/invalid/unknown-field conformance and old Identity/Gateway/event compatibility; do not repurpose `booking.confirmed.v1` |
| E Identity/Gateway; C resource owners | Workforce self access separate from assigned-work permission; reviewer case/jurisdiction binding; roster/revoke scopes; authenticated service delegation and live principal checks; Media owner/config/route additions | Direct-owner and Gateway HTTP tests, cookie CSRF, live revoked/expired/suspended authority, forged headers/subject and out-of-scope delegation rejection |
| E dependencies/build/runtime | Reviewed dependency additions in C manifests: published contracts/security and messaging adapters as needed; actual private-store, scanner and bounded image processor; explicit service/browser config and shutdown/readiness behavior | Frozen pinned install/audit, independent builds/typechecks/images, secrets external, no global generator rewrites or business-ready default |
| E C/W02 resource allocation | Manifest binding lane/wave/run, Compose project, exact ports, isolated DB/runtime/migration roles, broker vhost/exchanges/queues/ACLs, private object bucket/prefix, scanner job namespace/credentials/endpoint, output/temp/browser profile and one heavy slot | Active lease/provisioning and foreign-namespace denial; owned process/container handles; cleanup-before-verdict; allocations alone are not running services |
| E barrier | Full verified BASE_W02 and accepted package versions; independent policy/review evidence and resulting-main mandatory checks; actual lease release | New common base before affected writes. If a contract changes mid-wave, publish/reverify a new common base; C never forks it privately |

Current packages are `@carwash/contracts@0.0.2`, `@carwash/event-contracts@0.0.2`, `@carwash/api-clients@0.0.1`. No new version is chosen here. Media/Workforce currently depend on service-kit/event-contracts, but lack contracts/security-kit/platform-messaging and storage/scanner/processing adapters. E decides the reviewed technical implementation and package changes.

E's existing `allocate-environment.mjs` can describe DB/broker/object namespaces. Its schema has no scanner field, and `infra/compose.dev.yml` has no object store/scanner. Request that gap through E; an object prefix, reserved port or fake scanner result cannot satisfy the entry requirement.

## Exact contract closure items

Keep the W01 Media reservation/status/finalize/read/revoke schemas and narrow Workforce media-authority read as proposals. Close these items before publishing them:

1. **Case-state vocabulary:** W01 proposes `DRAFT`, `SUBMITTED`, `UNDER_REVIEW`, `CHANGES_REQUESTED`, `APPROVED`, `REJECTED`; W02 requires needs-information behavior. Publish one exact enum/transition map, including correction/resubmission and revision rules. No alias is silently accepted. Review outcome, document safety and current work eligibility remain separate facts.
2. **Actor/resource authority:** verified Identity subject/session/authVersion is server derived. Delegation binds service audience, operation, original principal, resource/case revision, expiry and current jurisdiction; do not forward browser-selected reviewer/worker identity as authority. Workforce's binding provider must support self/upload/reviewer checks without reading Media.
3. **Finalize/processing:** distinguish bytes stored, validated, quarantined, scanned, processed and available. Verify actual size/MIME signature/hash and immutable object revision; pin scan/processing results to the same bytes. Client URLs/ETags/hash declarations are untrusted input. Duplicate finalize returns stable operation/result without renewing upload authority; ambiguous timeout is recovered by status, not blind re-upload.
4. **Reads/revocation:** only clean processed objects in the required current binding receive business read grants. Quarantine is inaccessible to business audiences, including owner/reviewer/admin. Scanner/processor identities receive separate tightly scoped technical access to exact job/object bytes, never a general business grant or public link. Publish whether business reads are authorization proxies or bounded signed storage grants, their expiry and effective revocation semantics. An already downloaded file cannot be recalled by metadata revocation.
5. **Events/recovery:** publish strict `media.scan-completed.v1` and Workforce eligibility/roster events with aggregate revision and authenticated producer ACLs. No documents/private URLs/PII in payloads. Local business state+outbox commit together; inbox+consumer effect commit before ACK. Gaps reconcile through accepted owner reads; bounded retries/DLQ/audit, no stale clean event restoring a revoked object.
6. **Retention/cancellation:** approve pending upload cancellation, orphan/quarantine cleanup, retention/legal-hold/deletion audit and document replacement behavior. Workforce keeps exact object/revision refs; replacement, expiry or revocation reevaluates eligibility and does not rewrite earlier reviewer audit. No cross-owner DB access or universal erasure promise.

Numerical byte/type/page/dimension/count limits, processor/scanner choices, deadlines/retries, upload/read/replay lifetimes, review scope/criteria, required document kinds, expiry/grant policy, employment/invitation model and retention exceptions are **pending owner inputs** (C-D03/C-D05/C-D09/C-D10). Technician's local JPEG/PNG/WebP and 10 MiB check is a reference observation, not server policy. W01's suggested 60-second read/15-minute upload lifetimes are unapproved suggestions; do not install them as defaults.

## Purpose audiences and authority producers

| Class | Authoritative relationship | Permitted proposed audience | Enabling dependency |
| --- | --- | --- | --- |
| Workforce identity/verification document | Workforce case owner/revision and assigned reviewer scope | Owning applicant self-view; currently authorized case reviewer | Accepted real Workforce Binding provider, E delegation and Media policy. Clean file does not mean approved worker |
| Payment evidence | B obligation/payment-case owner, beneficiary and authorized financial reviewer | Owning customer/guest under accepted capability; B financial reviewer | Accepted real B authority provider; E/A guest binding if applicable. Receipt image never confirms money |
| Service before/after photo | Booking Work and current fenced assignment/customer ownership | Current authorized assigned uploader and exact entitled customer/admin purpose | W03/W04 real Booking/Work authority provider. No demo booking/assignment authority |
| Other class | Its accepted domain authority and purpose policy | Only explicitly reviewed audience | Disabled until provider/policy acceptance; no general-public or marketing reuse fallback |

Self view is separate from reviewer decision permission. Super-admin remains subject to object binding/audit. An unrelated customer, worker or reviewer cannot read metadata or obtain a grant. Missing producer/Identity/storage/scanner fails closed with the accepted dependency error; no fallback file or broad wildcard grant.

## Bounded child acceptance queue

| Proposed child | Scope and real producer dependencies | Required acceptance before next child |
| --- | --- | --- |
| W02-E-Access/Contract-Prework | E-owned publication/resource prerequisites above; not a C source edit | Accepted common base, released effective paths, exact contracts/scopes/config and allocated running resources |
| W02-C-Workforce-Binding-Provider | Owned operator-to-Identity binding, versioned DRAFT case, immutable case owner, reviewer scope and Media authority read. No Media call, review outcome or eligibility grant | Real PostgreSQL migration/constraints/restart; current Identity/direct HTTP/Gateway auth and published contract conformance |
| W02-C-Media-Provider | Consume merged binding provider; reservations/actual bytes/quarantine/scan/processing/finalize/private reads/revocation/retention/audit/outbox | Real isolated store/scanner/DB/Identity/Workforce tests; HTTP cross-worker/grant denial; fail-closed outages and crash/replay recovery. Other purposes require their own real authority provider |
| W02-C-Workforce-Review-Eligibility | Consume merged Media; exact document refs, submit/needs-info/approve/reject, versioned reason/audit, expiry/revocation, scoped grants, teams/basic roster, outbox/inbox | Real authorized admin-principal review API and Media reads; stale/replaced/expired docs, current permission, restart and broker replay tests |
| W02-C-Operator-Self-Consumer | Reuse Identity, accepted self/profile/eligibility/readiness/empty-roster APIs; approved navigation and states | Explicit operator build/typecheck; real session/server flows; Arabic RTL/focus/reduced motion and reference/candidate/diff. Missing approved production/English designs block their acceptance |

Each child branches from an accepted base, targets main and passes E's latest-target-plus-head gate. No child imports an unmerged peer branch. Provider conformance fixtures stay labeled and cannot close consumer integration. Parent remains INTEGRATION_PENDING until the combined source passes every W02 task-listed case. D's complete admin browser review is W03; **real admin-principal reviewer HTTP/API and Media ownership tests are W02** and are not deferred with that browser.

## Design and endpoint evidence handoff

Technician has an approved Arabic prototype, but production invitation/login/onboarding/document submission, required loading/review-pending/rejected/expired-session/forbidden/dependency-unavailable, never-assigned empty roster and English LTR are missing approved states. Trial profile and demo completion copy do not establish production approval. Request exact screen/copy/reference decisions while provider work proceeds after its prerequisites.

**B payment evidence and D reviewer/roster actual endpoint examples: BLOCKED_NOT_RUN.** Source exposes no Media/Workforce product endpoints. W01 examples are synthetic proposals only. After each provider is accepted, attach sanitized request/result/error captures from actual authorized HTTP calls with provider SHA, contract version, object/case revisions, principal role/scope and environment, plus cross-owner denial and expiry/revocation evidence. Never fabricate live URLs, tokens, receipts or scanner outcomes for this handoff.

No message/comment to another person is sent by this document. E/provider/consumer decisions are requested through this reviewable lane packet.
