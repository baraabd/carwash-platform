# W01-C contract requests and provider-first interface roadmap

Status: **PROPOSAL_ONLY / BASE_PUBLICATION_PENDING**. This packet implements no
operation and accepts no contract. It is the next-wave request from permanent
Lane C to Lane E and the relevant data owners.

Inspected source: `main@69d81a83a3409d0693272efeb19ebeb9805750f5` on 2026-10-05.
That full SHA is an observation, **not an accepted BASE_W01**. No published E
base/owner/resource/lease registry was found in tracked source. E must publish
the immutable base, accepted package versions, exact leases and isolated
resources before dependent implementation. W01 permits lane-local proposals
while that publication is missing. C makes no assumption that any temporary
bootstrap lease has already been recorded.

## 1. Current source facts and boundaries

| Fact inspected | Source | Consequence |
| --- | --- | --- |
| F001 catalog v2 names 19 data owners plus a stateless gateway | `architecture/service-catalog.json`; `architecture/adr/F001-monorepo-and-data-ownership.md` | Older grouped Booking documentation does not give Booking capacity, assignment or financial authority. |
| Media and Workforce have empty domain/application/ports markers and `ServiceMarker` schemas | `services/media/src`; `services/media/prisma/schema.prisma`; equivalent Workforce paths | Uploads, scans, object authorization, reviews, resources and eligibility remain unimplemented product behavior. Foundation factories/adapters are not business APIs. |
| Scheduling and Dispatch are export-only skeletons | `services/scheduling/src/index.ts`; `services/dispatch/src/index.ts` | There is no capacity concurrency guard, hold, assignment or dispatch service. |
| Booking has marker schema and an unconnected pure lifecycle helper | `services/booking/prisma/schema.prisma`; `services/booking/src/domain/lifecycle.ts` | Valid transition/overlap functions prove neither HTTP authorization nor database transaction safety. No Work record exists. |
| Normal authenticated Identity sessions/roles/permissions exist | `packages/contracts/src/identity.ts`; `services/identity/src/application/identity-auth.service.ts`; `services/identity/src/domain/auth-policy.ts` | Reuse these implemented foundations. They are not a guest identity or guest booking authorization contract. |
| Gateway uses verified `subject`, `sessionId`, `authVersion`; forwards Bearer plus verified headers | `apps/api-gateway/src/application/gateway.service.ts`; `infrastructure/identity-client.ts` | Client-supplied actor/role headers cannot authorize a domain command. Domains must validate caller and resource authority. |
| Gateway owner union/config lacks Media, Scheduling, Dispatch and Geo; existing admin dispatch route points to Booking | `packages/contracts/src/gateway.ts`; `apps/api-gateway/src/infrastructure/config.ts` | E-owned additive routing and ownership reconciliation are prerequisites; C must not quietly extend them. |
| `@carwash/contracts@0.0.2`, `@carwash/event-contracts@0.0.2`, `@carwash/api-clients@0.0.1` | Their `package.json` files | These are observed versions only. No W02 Media/Workforce contracts are accepted in them. E selects and publishes actual accepted versions. |
| Existing event envelope has exact keys and strict v1 event parser | `packages/event-contracts/src/envelope.ts`; `booking-confirmed.ts` | Do not add fields to an existing exact-key event and call it compatible. New events need independent schemas/exports/registrations. |
| F010 separately registers approved technician/admin HTML | `docs/design/f010-reference-manifest.json`; `F010_REFERENCE_PROVENANCE.md` | Preserve these references. Older customer-only wording saying those references are pending is historical; additional production/English states still need acceptance. |
| `apps/operator-web` remains a planned boundary/export marker | `apps/operator-web/README.md`; `src/index.ts` | A golden prototype is not an implemented, integrated technician application. |

Authoritative facts stay separate: **Workforce eligibility/resources**, **Media
objects/scans/access**, **Scheduling capacity/holds**, **Dispatch assignment**,
**Booking lifecycle and proposed Work execution**, **Billing verified payment,
cash receipt/custody and ledger**, **Wallet approved balances/holds referencing
Billing postings**, and **Subscription entitlement**. Gateway and the three
apps own no business truth. A green foundation run is not W01 wave acceptance.

## 2. External decisions and publication requests

All IDs below are lane-local requests, not decisions already made. The root/E
decision registry may normalize them while retaining traceability.

| ID | Decision/request | Required owner | Blocks |
| --- | --- | --- | --- |
| C-D01 | Publish immutable wave base, contract versions, exact bootstrap leases, isolated resources and prerequisite child ordering | E | Every dependent implementation and acceptance gate |
| C-D02 | Approve missing production states, copy and English LTR designs without changing frozen Arabic references | Product/design owner | Unmatched production/English app behavior and visual acceptance |
| C-D03 | Privacy request-only intake versus full owner fulfillment; exceptions, holds, audit and purge/backup timelines | Product/privacy; C Media/Workforce/Booking; A personal data; B financial retention | Privacy fulfillment; never blanket-delete financial/work evidence |
| C-D04 | Active-task location consent, minimum precision, freshness thresholds, retention and permitted operations/customer readers | Product/privacy + C Booking; A Geo advisory; E access contracts | Any live task-location publication/read |
| C-D05 | Technician employment/invitation model, verification requirements/reviewer scope, work-grant expiry, fleet/equipment/maintenance scope and work-hours/timezone policy | Product + C Workforce; E confirms catalog/schema scope | Workforce decisions, eligibility, roster and resource authoring |
| C-D06 | Aleppo zones, market timezone/hours, quote currency/amount rules, cash booking prerequisite, cancellation/hold/compensation deadlines; resolve customer `payServiceAllowed()` blocking pending electronic payment versus technician pending-ShamCash execution/closure | A Geo, B Pricing/Billing, C Scheduling/Booking, product | W03/W04 real reservation/booking/cash journey; exact execution prerequisite and unpaid-closure policy cannot be inferred from either conflicting prototype |
| C-D07 | Approved cash-custody holder/purpose, handover reviewer, partial/mismatch money policy and Billing/Wallet boundary | B financial owners + product; C relationship facts | W04 cash/custody provider and consumers |
| C-D08 | Decide required Paymera scope from owner instruction and actual provider documentation; publish applicable credentials/merchant prerequisites | Product + B payment owner; E external/runtime prerequisites | Any Paymera integration or checkout-method change |
| C-D09 | Media class limits/MIME list, scanner/storage, scan deadline/retries, private read expiry/revocation semantics, upload expiry and idempotency retention | Product/privacy owner + C Media; E runtime/config | W02 Media implementation and its app consumers |
| C-D10 | Guest session/capability binding, service delegation, object grants, fine-grained permissions and gateway routes | E Identity/gateway/contracts, C domain owners, A guest journey | Guest uploads/bookings and all new domain HTTP acceptance |

Missing decisions do not prevent design inventory or declarative test work.
They prevent implementation that chooses unapproved policies or promotes demo
Riyadh geography/currency/data into an Aleppo production requirement.

## 3. Common proposed v1 wire rules

These rules are requested for new contracts; they do not amend existing ones.

- New internal prefixes remain `/internal/v1/media`, `/internal/v1/workforce`,
  `/internal/v1/scheduling`, `/internal/v1/booking` and
  `/internal/v1/dispatch`. Proposed public paths below are an E routing request.
- Resource identifiers are opaque server-created UUIDv4 strings. This fits the
  current Identity/gateway UUID validators; introducing UUIDv7 needs an explicit
  E compatibility change. `revision` and `expectedRevision` are safe integers
  starting at 1. Every changed authoritative aggregate increments its own
  revision; a Booking revision is not an Assignment/Work/Media revision.
- Times are real instants in canonical UTC with milliseconds
  (`YYYY-MM-DDTHH:mm:ss.sssZ`). Local working hours use a separately approved IANA
  `timezoneId`, local date/day and half-open `[start,end)` interval semantics.
  The F010 rendering timezone does not establish a commercial hours policy.
- Amounts cross boundaries only as `{ minorUnits: string, currency: string }`:
  base-10 integer minor units, approved currency and exponent from B. No floats,
  automatic FX, ambiguous Syrian-lira scale, demo SAR price or inferred pay rate.
  Media/Workforce/location schemas contain no authoritative payment fields.
- Authenticated actor context is derived from the verified Identity principal
  `{subject, sessionId, authVersion}` and current permissions. No request body
  may choose its acting technician, reviewer, customer or admin identity.
  A service caller is authenticated as that service; delegation binds the
  original user/guest, allowed operation/resource, audience and expiry. E must
  specify verification, revocation and anti-replay. A trusted-header convention
  alone is not sufficient when a domain endpoint can be called directly.
- A guest proposal uses an E-issued, server-bound guest principal/capability,
  distinct from normal Identity subjects. It is restricted to its own booking
  intent, draft/upload purpose and later booking; resubmission cannot bind to
  another guest or upgrade to a technician/reviewer. No email/name/phone
  supplied by the browser proves ownership. Authentication registration and
  guest conversion require explicit ownership transfer semantics from E/A.
- Requests use strict documented field validation, bounded strings/arrays and
  explicit enums. Object/classification/ownership/policy are server-checked.
  Commands carry `expectedRevision` when mutating an existing aggregate;
  mismatched revisions return 409 without mutation. Read models expose source
  revision and freshness; projections never authorize a write.
- Errors propose `{ error: { code, message, requestId, correlationId,
  retryable, operationId? } }`. Safe codes distinguish invalid input (400/422),
  required/forbidden actor (401/403), concealed inaccessible object (404),
  stale revision/idempotency conflict (409), rate limit (429), dependency not
  ready (503), and transport timeout/unknown outcome (504). E decides additive
  gateway preservation/mapping: current `upstreamFault` collapses domain errors.
  Never leak another object's existence, private URLs or scanner diagnostics.
- Proposed new-event envelope retains the existing structural vocabulary:
  `{eventId,eventType,schemaVersion,producer,occurredAt,correlationId,
  aggregateVersion,data}`. `aggregateVersion` names the producing resource's
  revision. Broker identity/ACLs establish the producer, not its payload string.
  Outbox commits with local state; consumer Inbox commits with its projection
  before ACK. Duplicate IDs replay safely; old revisions do not regress state;
  gaps trigger bounded reconciliation from the producer's authorized API.

### Idempotency, retries and lifetimes requested for every mutation

`Idempotency-Key` uses the current gateway alphabet and length:
`[A-Za-z0-9_-]{16,128}`. The durable owner scopes uniqueness by verified
principal/delegated actor, operation/version and target resource or creation
scope. Scanner callbacks additionally bind authenticated worker and job ID.

Fingerprint = SHA-256 of canonical validated semantic input, method/versioned
operation, target, `expectedRevision`, actor/guest binding and relevant policy
revision. JSON key order is irrelevant; checksum/object revision, assignment,
amount/currency, quote/hold references and consent version are relevant.
Transport trace IDs, transient credentials and connection details are excluded.
No caller-controlled actor claim is accepted before fingerprinting.

The owner reserves the key and commits state, audit, outbox and replayable
result atomically. The same key/fingerprint returns the original outcome/status
and stable resource IDs without a second business effect. Another fingerprint
returns `IDEMPOTENCY_CONFLICT` (409). In-progress duplicates return a documented
operation status; they do not run a second mutation. Each operation must define
which terminal rejected results are retained. Replay always revalidates current
authorization and redacts sensitive results if access was revoked.

Proposed retention for ordinary Media/Workforce commands is **at least seven
days** and for Booking/Dispatch/cash **at least thirty days or the longer
approved offline/recovery window**; neither value is accepted policy. C-D09,
C-D05 and C-D07/B's financial retention decision must set exact lifetimes before
implementation. Critical unique business references and retained tombstones
must prevent duplication after replay-record expiry. Guest capability expiry
does not delete state or authorize reuse. No new key is a way to retry an
unknown write outcome.

The current gateway default is 3,000 ms and one HTTP attempt; it is observed
foundation behavior, not a business completion deadline. New provider acceptance
must meet E's published transport budget. Scan/booking sagas use durable async
operations, separately approved deadlines and status reads. After timeout,
retrieve by recorded operation/resource/idempotency correlation before retrying
the same key. Bounded exponential retry/jitter applies only to retryable transport
failures; authorization, invalid input, stale revisions and rejected policies do
not retry automatically. User cancel/timeout never proves the owner rolled back.

Each compensation is a separately authorized owner command with its own durable
key derived from saga ID, step and compensation generation; it has fingerprint,
status, timeout and replay rules too. No gateway transaction spans databases.

## 4. W02 Media provider requests

Requested contract identifiers: `media.upload-reservation.v1`,
`media.object-status.v1`, `media.read-grant.v1`, `media.revoke.v1`, and new
`media.scan-completed.v1`. These names are proposed, not published exports.

| Proposed command/read | Minimum request schema | Minimum response | Authorization and failure rules |
| --- | --- | --- | --- |
| `POST /upload-reservations` | `{purpose, binding:{ownerDomain,resourceId,resourceRevision}, declaredMime, declaredBytes, sha256, consentRevision?}` | `{uploadId,objectId,revision,state:"RESERVED",policyRevision,expiresAt,uploadGrant:{url,method,requiredHeaders,maxBytes,expiresAt}}` | Media authorizes actor against a producer-issued resource/purpose binding; client cannot choose storage key or another customer/booking. Guest draft binding depends on E/A. Explicit 422 type/size policy, 503 unavailable storage/policy. |
| `POST /upload-reservations/:id/finalize` | `{expectedRevision,sha256}` | `{objectId,revision,state:"QUARANTINED",scanJobId,operationId}` | Server verifies stored bytes, signature/type, checksum, byte limits and binding. No read/attachment eligibility before successful scan. A fake browser checksum/ETag is not proof. Expired reservation or mismatch rejects safely. |
| `GET /objects/:id` | No ownership claims; optional authorized conditional read | `{objectId,revision,purpose,binding,state,scan:{status,checkedAt?,policyRevision},retention:{policyRevision},availability}` | Metadata is also object-authorized; concealed 404 for unrelated resources. No raw storage key or durable public URL. |
| `POST /objects/:id/read-grants` | `{expectedRevision,purpose:"REVIEW"|"SERVICE_EVIDENCE"|"PAYMENT_EVIDENCE"|"SELF_VIEW"}` | `{grantId,objectId,objectRevision,url,expiresAt,disposition}` | Media rechecks scanner/object status and current requester/resource authority at issuance. Workforce reviewer case membership, Booking assignment/customer binding, or B payment-case authority is required. Image cleanliness is not identity approval/payment confirmation. |
| `POST /objects/:id/revoke` | `{expectedRevision,reasonCode}` | `{objectId,revision,state:"REVOKED",operationId?}` | Authorized domain/privacy command; revoke blocks new reads immediately and schedules physical purge under approved retention/hold policy. Revocation is not proof all CDN/cache/download copies vanished. |
| Authorized scan worker result | `{scanJobId,objectId,objectRevision,result:"CLEAN"|"REJECTED"|"ERROR",scannerPolicyRevision,sha256}` | Stable job outcome/revision | Authenticated scanner/worker identity, exactly matching bytes/job; stale callback cannot restore revoked/deleted object. Error/timeout stays unreadable; bounded retry/dead-letter and operations alert. |

Proposed purposes: `IDENTITY_DOCUMENT`, `WORKFORCE_DOCUMENT`,
`VEHICLE_DOCUMENT`, `WORK_BEFORE`, `WORK_AFTER`, `PAYMENT_PROOF`,
`SUPPORT_EVIDENCE`, `PROFILE_IMAGE`. Product must confirm the required set;
adding profile imagery is not permission for a new profile product. Marketing
reuse requires independent consent and is outside service-evidence approval.
Media validates the asserted business relationship through accepted domain
authorization contracts, never by reading Workforce/Booking/Billing tables.

### Authoritative binding prerequisite: split the Workforce/Media cycle

`W02-C-Workforce-Binding-Provider` is a narrow real provider accepted after
`W02-E-Access` and **before Media**. It owns operator/self identity binding,
minimal DRAFT verification-case persistence and immutable case-owner identity,
case revisions, authorized reviewer assignment/jurisdiction and scoped
upload/review resource authority. It includes real owned database migration,
HTTP/Identity authorization and revision/constraint tests. It makes **no document
scan, document-completeness, review-decision or work-eligibility decision** and
does not call Media. A prototype case or mock authority is not this provider.

Minimum requested authority read, accessible only to the authenticated Media
service with E-verified delegated principal:
`GET /verification-cases/:id/media-authority` with accepted delegated operation
`UPLOAD_DOCUMENT|READ_DOCUMENT_REVIEW|READ_DOCUMENT_SELF` and case revision.
Result proposal: `{caseId,caseRevision,actorBinding,permittedPurpose,
permittedOperation,authorityRevision,validUntil}` or concealed denied/not-found.
The verified actor/delegation supplies `actorBinding`; the browser cannot choose
it. The provider verifies current case owner or authorized reviewer/case scope,
session/permission and case access state. E selects exact request transport and
signed authority/delegation format. Media validates the resulting resource and
action binding for reservation/read grants; reviewer role alone never authorizes
an unrelated case. Neither an authority result nor a clean object approves a
verification case.

`W02-C-Media-Provider` consumes that accepted real binding provider and owns
bytes, quarantine, scanner and object access. After Media acceptance,
`W02-C-Workforce-Review-Eligibility-Consumer` adds document attachments,
submission/completeness/review/eligibility transitions as Workforce-owned
business behavior and a **consumer of Media**, including actual integrated
review and revoked/replaced-document tests. Its database/auth/domain gates are
still provider gates for later Scheduling/Dispatch/app consumers. The W02-C
parent remains INTEGRATION_PENDING until this full affected journey passes.

Every other declared Media purpose has its own accepted real authority-provider
prerequisite. A guest/draft binding from A/E must precede enabling that upload;
B must supply payment-obligation/evidence authority before payment-proof
consumption; D must supply Support-case authority before its evidence. W03's
real Booking provider publishes persisted booking/guest/customer relationship
bindings; it is not a W02 fixture renamed authority. Work-before/after bindings
and attachment consumers wait for W04 real Work/Assignment providers. Reserve
schema names now, but do not enable absent purposes, create fake owner resources
or claim their future integration passed at W02.

Proposed private-state transition:
`RESERVED -> QUARANTINED -> CLEAN|REJECTED`; `ERROR` is scan-job state, never
clean-object state. `EXPIRED`, `REVOKED` and `PURGED` are terminal access states.
Replacement creates a distinct object/revision binding; it cannot silently
mutate the bytes of an already approved document or Work evidence attachment.

`media.scan-completed.v1` data proposal:
`{objectId,objectRevision,purpose,binding:{ownerDomain,resourceId,resourceRevision},
scanJobId,result:"CLEAN"|"REJECTED",scannerPolicyRevision,sha256}`.
Exclude document contents, private URLs, precise locations and scan engine
details. A scan error is operational retry/alert, not a CLEAN event. E confirms
catalog event/registry and broker route additions.

Policy decisions C-D09 remain unresolved: per-class byte/count/page/dimension
limits; magic-byte/MIME allowlist; image re-encoding/metadata removal; PDF
support; malware/sandbox engine; limits for archive/decompression bomb handling;
upload/scan/grant expiry; outstanding quarantine cleanup; retention/legal holds;
storage region; prefix and encrypted access; rate quotas and low-bandwidth retry.
Suggested grant expiry is 60 seconds and upload reservation 15 minutes for
review, not production defaults. Enforce limits before/during/after upload.
No plaintext executable/SVG/HTML or public bucket acceptance without a reviewed
policy. Effective revocation must be explicit: a proxy checks every read, or a
signed-storage grant can remain valid until its short expiry. Claim immediate
revocation only if the chosen mechanism proves it.

Replay returns the original reservation and original grant expiry; it must not
renew credentials. A new authorized grant operation can issue a fresh short
grant with its own key. Read-only object status never fabricates finalized,
clean or available bytes. Orphaned reservations/quarantine objects expire under
Media-owned cleanup, independently from their business owner's compensation.

## 5. W02 Workforce and operator provider requests

Requested contract identifiers: `workforce.self.v1`,
`workforce.verification-case.v1`, `workforce.review.v1`,
`workforce.eligibility.v1`, `workforce.resources.v1`, `workforce.work-hours.v1`.

| Proposed operation | Minimum schema/result | Authority, revisions and independent facts |
| --- | --- | --- |
| Self/invited operator profile | `OperatorView {operatorId,subjectId,revision,profileState,verificationState,eligibility:{state,revision,validUntil?,reasonCodes}}`; mutation `{expectedRevision,allowedProfileFields}` | Workforce binds normal Identity subject to operator. Technician role alone neither creates an operator nor grants work eligibility. No new contractor/marketplace/payroll model. |
| Add/replace case documents | `{caseId,expectedRevision,documentKind,objectId,objectRevision}` -> `{caseId,revision,state,documents:[{kind,objectId,objectRevision,scanState}]}` | Workforce verifies object binding and Media clean/readable policy; references only. Attachment does not approve the case. Current-revision completeness evaluated server-side. |
| Submit case | `{expectedRevision}` -> `{caseId,revision,state:"SUBMITTED",submittedDocumentRevisions}` | Applicant/self or authorized invited-operator manager; exact snapshot; cannot submit quarantined or missing required documents. Invitation versus self-onboarding is C-D05. |
| Read assigned review | `{caseId}` -> bounded dossier with document references and decision log | `verification.review` plus current case jurisdiction/assignment; no global document access inferred from role. E defines reviewer/case scoped authority. |
| Review decision | `{expectedRevision,decision:"APPROVE"|"REQUEST_CHANGES"|"REJECT",reasonCode,message,documentRevisions}` -> `{caseId,revision,state,decisionId,eligibilityRevision}` | Verified reviewer, no self-approval, immutable actor/time/reason/audited document snapshot. Stale/replaced documents or revoked access conflict. Required message/copy/design awaits product. Approval criteria are C-D05. |
| Suspend/revoke work grant | `{operatorId,expectedRevision,reasonCode,effectiveAt}` -> `{operatorId,revision,eligibilityState,eligibilityRevision}` | Authorized Workforce operations domain permission; Identity account suspension is a separate E command. Revoke emits new eligibility fact and blocks new assignments; existing Work is reviewed by C orchestration. |
| Author roster/team/assets | `Team {teamId,revision,members:[{operatorId,role}]}`; `Van {vanId,revision,status,capabilities}`; `Equipment {equipmentId,revision,status,capabilities}`; mutations include `expectedRevision` | Workforce owns team membership, operating vans/equipment and baseline availability. Customer Vehicle records belong A. No shared table or invented service. Maintenance/unavailable intervals proposed under Workforce, pending E/catalog confirmation. |
| Author work hours | `{resourceId,expectedRevision,timezoneId,weeklyIntervals,exceptions:[{localDate,intervals,reasonCode}]}` -> `{resourceId,revision,timezoneId,policyRevision,workingIntervals}` | Workforce owns shifts/base hours; Scheduling owns resulting capacity, holds and reservations. Validate overlaps, overnight normalization, timezone transitions and permission. Actual working hours are C-D05 input. |
| Read current eligibility/resources | `{operatorId|teamId,at,requirements,knownRevision?}` -> `{eligibilityRevision,state,validUntil?,evaluatedAt,resourceRevisions,requirementsSatisfied}` | Scheduling/Dispatch service authority; fresh authorization at sensitive assignment/commit, not stale projected eligibility. Exact freshness/max-age policy pending C-D05. |

Proposed case states: `DRAFT -> SUBMITTED -> UNDER_REVIEW -> APPROVED |
CHANGES_REQUESTED | REJECTED`; corrections return to `DRAFT` and require an
explicit new submission/revision. Work eligibility separately represents
`PENDING | ELIGIBLE | SUSPENDED | EXPIRED | REVOKED`. Product decides appeal,
renewal and review state/copy not present in the approved prototype. Media
revocation or document expiry triggers reevaluation, never hidden approval.

Proposed events use catalog-reserved names `workforce.eligibility-changed.v1`
with data `{operatorId,eligibilityRevision,state,validUntil?,reasonCodes}` and
`workforce.shift-updated.v1` with `{resourceId,resourceType,shiftRevision,
timezoneId,effectiveFrom}`. E decides new resource-change event names only if
accepted scope needs them. No PII, documents, pay rate or location history in
events. Projection invalidation is not proof an active booking has been safely
reassigned; Dispatch/Booking own that durable response.

E permission request C-D10: use existing `verification.review` only together
with verified case authority; request fine-grained workforce self/operations,
roster/asset/hours authoring and Media grants. Preserve existing public enums
and consumers through additive publication and updated role-mapping tests.
Never equate `operations.dispatch` with unrestricted workforce/financial edits.
`super-admin` broad rights do not bypass object bindings, audit or self-review
policy. Precise new permission names are for E to approve and publish.

Operator W02 consumption is bounded to approved technical shell/self/resource
capabilities. Task execution/photos/cash screens remain future consumers of
W03/W04 providers. Any fixture is labeled and cannot stand in for assigned Work,
persisted server profile, readiness or payments. Bootstrap source stays E-only
under a recorded lease until verified BASE_W02; C does not edit it in W01.

## 6. Active-task location and privacy request contracts

**Proposed existing owner: Booking, as part of its Work execution record.**
Task-location samples/read views/freshness are work context, not baseline
Workforce shifts or A Geo's static zones/geocoding/travel estimates. This
proposal changes no service catalog now; E must confirm ownership/publication.

Proposed command `POST /work/:id/location-samples`:
`{workRevision,assignmentId,assignmentRevision,consentRevision,sequence,
capturedAt,position:{latitude,longitude,accuracyMeters}}`.
Actor comes from Identity/delegation. Current active assignment must bind the
operator, Work and Booking; permitted phases are product-approved active Work
phases only. Server validates finite/ranged coordinates, sensor age, accuracy,
bounded sequence/rate and current consent. Missing consent/location permission,
stale/released assignment, terminal Work or wrong operator cannot write.
Idempotency fingerprint includes the canonical sample, sequence and all bindings.

Result `{sampleId,locationRevision,acceptedAt,expiresAt,precisionPolicyRevision}`.
Samples do not advance Booking/Work execution phase. Separate
`locationRevision` avoids making a location refresh a stale Work command.
Proposed read `GET /work/:id/location-view` returns
`{status:"AVAILABLE"|"STALE"|"UNAVAILABLE"|"WITHHELD",position?,capturedAt?,
receivedAt?,expiresAt?,precisionMeters?,locationRevision?,policyRevision}`.
Customer reads only its active booking; assigned operator and authorized
operations read only necessary scope. Server coarsens coordinates per viewer
policy. A timestamped stale point must not display as a live location.

C-D04 must settle location freshness thresholds, minimum useful precision,
client/server skew budget, rate and retention before implementation; no numbers
are inferred from illustrative reference maps. Consent is explicit, revocable,
versioned and bounded to active task/purpose. No always-on/background tracking.
Reassignment, completion/cancellation and consent withdrawal stop new samples
and customer grants. Persist only the minimum necessary; map display/cache
cannot extend retention. Browser denial/offline/manual navigation remains a
real UX state, not a fabricated coordinate or automatic phase transition.
Contact/customer-address access is independently authorized and audited.

Privacy request proposal C-D03: a server-owned request references authenticated
subject/verified guest, operation `EXPORT|DELETE`, scope, consent/request time,
status and owner fulfillment acknowledgments. C owns its Media, Workforce and
Booking/Work fulfillment only after an approved policy; A/B/D fulfill their
own data through accepted commands. No C command deletes another owner's DB.
Request intake alone cannot be called completed export/deletion. Legal/financial
holds, safety evidence and immutable audit exceptions require named approval
and a visible scoped result, not invented blanket retention. B determines cash,
payment and ledger retention. Exact intake coordinator/registry owner is an E
publication request; no new privacy service is proposed.

## 7. W03 Scheduling/Booking and W04 Dispatch/Work/cash roadmap

Windows below are conditional ordering targets, not promised dates. Every
provider child uses an accepted base and its own owned real DB/HTTP/Identity
gates. Every consumer child begins after the needed provider is accepted on the
target; fixture conformance cannot close parent integration.

| Child sprint / target window | Provider scope and requested interfaces | Consumers and merge prerequisite |
| --- | --- | --- |
| W02-E-Access / before W02 consumers | E Identity/guest/resource delegation, contracts/gateway route publication and allocated resources | C Media/Workforce HTTP providers require actual accepted auth contracts. Normal implemented Identity remains reused. |
| W02-C-Workforce-Binding-Provider / after E access, before Media | Real operator/self and minimal DRAFT case ownership/revision; reviewer case scope; authenticated delegated Media resource-authority API; no document decisions or Media dependency | Media consumes only after this owned DB/HTTP/Identity provider is accepted; other purposes wait for their real A/B/D/Booking/Work binding providers. |
| W02-C-Media-Provider / after Workforce binding | Private reserve/finalize/scan/status/read/revoke with real owned persistence/storage/scanner and object-level authorization using accepted real binding providers | Workforce review/documents consume after Media. Unavailable guest/payment/Support/Booking/Work bindings keep their relevant purpose consumers blocked rather than mocked. |
| W02-C-Workforce-Review-Eligibility-Consumer / after binding and Media | Workforce-owned document attachment/submission/review/eligibility plus agreed roster/resources/hours; migrations/events and actual Media consumer integration | Full real case/document/review journey before this child merges; later D admin review/roster and C operator consumers merge after required real providers; parent remains INTEGRATION_PENDING until their journeys pass. |
| W02-C-Operator-Self-Consumer / after actual Workforce self/resources and approved self states | Bounded operator self/bootstrap/readiness consumption and its own approved parity; no Booking/Work/photo/cash dependency | Actual accepted self/resource APIs and approved production/copy gates; full operations inventory remains W04 scope. |
| W03-B-Pricing-Provider / dependency request before Scheduling/Booking | B server quote/duration/version/expiry and approved exact money/catalogue inputs | Scheduling/Booking consumers cannot create production authority from demo prices or copied Catalog quote helper. |
| W03-B-Billing-Obligation-Provider / before Booking | B creates server-priced booking obligation/payment-condition and cancellation/refund references, including cash pay-after-service policy | C Booking cannot manufacture payment confirmation or invent whether cash permits confirmation; consumed only after B provider acceptance. |
| W03-C-Scheduling-Provider / before Booking | Availability read; create/commit/release hold; reservation read; expiring capacity with real DB constraints | C Booking + A time selection consume accepted provider. Workforce shifts/eligibility, A Geo zone and B Pricing duration/quote providers are prerequisites. |
| W03-C-Booking-Coordinator / after required providers | Durable create/confirm/cancel/reschedule/status saga; immutable quote snapshot; Scheduling/Billing compensation status; real persisted booking/customer/guest Media binding authority | A guest/seeker confirmation and C/D booking views consume the real coordinator only after its integrated provider gates. Booking binding does not depend on W04 evidence; Work/photo binding and consumers wait for W04 Work/Assignment. |
| W03-A-Booking-Consumer / dependency handoff after real coordinator | A customer guest/optional-plate/seven-step booking consumes current accepted quote/availability and durable confirmation | Full affected real guest booking journey before A consumer merge; not a request for C to implement A. |
| W04-C-Dispatch-Provider / after reserved Booking and eligibility | Assignment attempts/create/accept/release/reassign; CAS/fencing by assignment revision | C Booking Work coordinator and D dispatch consume accepted real provider; no assignment inferred from booking status. |
| W04-C-Work-Binding-Provider / after Dispatch and Booking, before Work photo authorization | Narrow real Work attempt record, current assignment/actor/purpose authority and owned revision/audit; no Media-dependent phase completion | Media Work-purpose consumer can authorize actual persisted Work objects after this provider merges; no evidence/completion/cash implementation claimed. |
| W04-C-Media-Work-Purpose-Consumer / after Work binding | Activate/test Media WORK_BEFORE/WORK_AFTER authorization and phase/object binding against the merged real Work authority | Full actual upload/finalize/read/revoke and cross-work denial before merge; no standalone fixture closes this integration child. |
| W04-C-Work-Provider / after Work binding, Dispatch, Booking and Media Work-purpose acceptance | Authorized phase/checklist/photo/contact/location/history transitions consume real Media while keeping Work/payment/custody independent | C operator and A task-progress/media consumers require combined journey proof; D notifications/projections receive accepted events. |
| W04-C-Task-Location-Provider / after real Work and approved consent/freshness policy | Booking-owned active-Work samples/read views and bounded authorization/retention, consumed through accepted Geo/map ports | Real object/assignment/consent authorization, stale/out-of-order/denial/offline cases; no always-on/background capability claim. |
| W04-B-Cash-Custody-Provider / after Work/cash-reference contract publication | B cash collection record, custody movement/handover, company acceptance/reconciliation and immutable financial postings | C/D cash/operator/admin finance consumers merge after B's provider and complete cash journey gates. Work completion itself is not money. |
| W04-C-Operator-Consumer / after all affected real providers | Preserve six approved execution phases, evidence/comparison/history and cash follow-up through accepted APIs | Full affected browser journey with actual Media, Booking, Dispatch, Workforce and B cash providers before consumer merge. |

### Scheduling v1 proposal

- Availability inputs: zone/coverage revision, service requirements, quote/duration
  revision, normalized requested interval, resource requirement and market
  timezone. Read output includes capacity-window revisions, server time and
  `expiresAt`; it is an indication, never a capacity guarantee.
- Create hold: `{bookingIntentId,quoteId,quoteRevision,zoneId,zoneRevision,
  windowId,windowRevision,requirements,durationSeconds}` ->
  `{holdId,revision,state:"HELD",startsAt,endsAt,expiresAt,resourceConstraints}`.
  Exact hold TTL and clock/skew policy is C-D06, not client-selected authority.
- Commit/release: `{expectedRevision,bookingId,bookingRevision}` or
  `{expectedRevision,reasonCode,sagaId}` -> durable reservation/terminal outcome.
  Scheduling owns atomic last-slot/conflict constraints and expiry-versus-commit
  decision. A late commit/payment cannot silently revive an expired hold.
- Events retain catalog names `scheduling.hold-created.v1` and
  `scheduling.hold-expired.v1`; E publishes exact payload schema plus any
  accepted reservation event. Repeated release/expiry cannot create capacity
  twice; overlap, team/equipment occupancy and PostgreSQL concurrency require
  real tests rather than the historical `windowsOverlap` helper.

### Booking/Work/Dispatch v1 proposal

- Booking create input: `{bookingIntentId,vehicleSnapshotRef?,plate?,
  quoteId,quoteRevision,locationRef,locationRevision,
  holdId,holdRevision,contactSnapshotRef,paymentMethod,consentRevision}`.
  The owner adds server-derived customer/guest binding under the E/A accepted
  authorization contract; the browser never chooses it.
  Plate remains optional. Snapshot refs are read through owner contracts, never
  cross-owner DB access. Required real contact fields remain separate from plate.
- Booking output independently contains `{bookingId,revision,lifecycleState,
  capacity:{reservationId?,state},assignment:{assignmentId?,revision?,state},
  work:{workId?,revision?,state},payment:{obligationId?,state,sourceRevision?},
  cashCustody:{referenceId?,state,sourceRevision?},saga:{operationId,state}}`.
  Missing/unavailable facts are explicit unknown/pending, never success defaults.
- Quote snapshot is immutable and server validated by Pricing: amount/currency,
  package/addons and versions, duration, expiry, policy references. Reschedule/
  repeat booking revalidate current quote/zone/availability, preserving history.
- Dispatch command references `{bookingId,bookingRevision,reservationId,
  reservationRevision,operatorId|teamId,resourceRevisions,eligibilityRevision,
  expectedAssignmentRevision?}`. Current authenticated operations authority and
  fresh sensitive eligibility/reservation checks are required. Assignment
  acceptance/refusal/reassignment does not imply Work started or money received.
- Proposed Booking-owned `WorkExecution`:
  `{workId,bookingId,revision,assignmentId,assignmentRevision,state,checklist:
  {definitionRevision,items},evidenceRefs,startedAt?,completedAt?,auditRefs}`.
  State commands include expected Work and Assignment revisions and explicit
  intended transition. Six reference phases must be mapped by the state matrix;
  the prototype's `closed` screen label is not automatic financial settlement.
  Server checks actor/active assignment/phase/prerequisites; no UI button bypass.
  Independent history records exact actor/time/correlation, not editable notes.
- Release stale assignment and compensate failed Booking via accepted owner
  commands: Scheduling release capacity, Dispatch release assignment, Billing
  cancel/refund/reverse under its policy, Wallet/Subscription release holds if
  those later providers apply. Every saga step records deadlines/outcome and
  survives restart/replay. Unresolved compensation blocks readiness; no rollback
  claim based solely on local HTTP error. Work in progress needs a safety/product
  decision before cancellation or reassignment, not invented automatic eviction.

### Cash and financial boundary requested from B

C-D07 is the approval dependency for actual custody actors, purposes and money
policy; C-D08 separately resolves Paymera scope. Neither decision is inferred
from the prototype or this contract proposal.

C-D06 contains a concrete reference conflict: technician seed `WG-2042` with
pending ShamCash can proceed through washing/handover and close into unpaid
follow-up, while customer `payServiceAllowed()` blocks simulated service until
electronic payment is verified. Owner/B must approve the actual server execution
prerequisite and unpaid-closure policy, version it and publish the resulting
contract before Booking/Work implementation. Independently storing Payment and
Work states does not resolve when a Work transition may legally occur. Do not
silently allow work, prohibit the approved reference journey, verify the wallet,
or collect replacement cash merely to reconcile the prototypes.

Cash method selection -> B obligation for the server-priced booking -> service
completion independently recorded by Work -> assigned technician's authorized
cash collection command -> B receipt/custody fact -> custody handover request
-> authorized company acceptance/mismatch follow-up -> B reconciliation/posting.
If amount is not received, record collection/follow-up state without labeling
paid. A photo/transaction reference is evidence pending B verification. Cash
collection does not prove company custody; handover initiation is not acceptance.
ShamCash/Syriatel Cash use B's real verified payment contract and required
merchant decision; no Paymera method is silently added or removed.

Minimum C-to-B cash request proposal:
`{bookingId,bookingRevision,workId,workRevision,assignmentId,assignmentRevision,
obligationId,obligationRevision,amount:{minorUnits,currency},collectedAt,
evidenceRefs?,reasonCode?}` plus current authenticated assigned actor and
Idempotency-Key. B authorizes against accepted C relationship contracts and
owns final schema, exact partial/over/underpayment rules and every financial
posting. Result must separately expose collection, custody and reconciliation
references/states. Duplicate offline requests, same key/different amount,
reassigned actors and expired authority are acceptance cases. No local cash
balance or Work state writes Billing truth.

Wallet remains B's internal owner, not a fourth checkout option or second
ledger. The approved holder/purpose (e.g. technician/company custody rather than
customer stored value) must be identified by B's inventory/decision. C consumes
only approved references; no payroll, customer funding/withdrawal, provider
plans or recurring debit is invented.

## 8. Compatibility, publication and evidence gates

E request: publish schemas, strict runtime parsers, public exports, route
contracts, OpenAPI/AsyncAPI registries, exact package semver, permission/role
changes, technical client exports and compatibility tests at the barrier.
Do not copy private service DTOs. Preserve existing contract identifiers and
`booking.confirmed.v1` exact-key payload; introducing customer/guest optionality
there requires a separately versioned event or agreed additive new event.
Never silently widen existing events or enum meanings. Test old consumers on
new packages and new consumers against published provider wire fixtures, then
prove integration with actual merged providers. Package version increases alone
do not prove wire compatibility; new required fields/enum values can break old
strict readers. E owns any new base needed for a breaking change.

| Evidence type | Provider tests required | Consumer/integration tests required |
| --- | --- | --- |
| Shared structural contracts | Valid examples; strict unknown fields; malformed IDs/revisions/times/amounts; version/enum errors; old-contract compatibility | Parse/error/time semantics and unsupported version behavior; fixtures labeled contract-only |
| Identity and resource access | Forged subject/operator/reviewer/guest; direct endpoint caller; revoked sessions/grants; current permissions; cookie CSRF and delegation audience/scope | Permission denial and account suspension; authorized reviewer cannot open unrelated documents; guest resubmission remains same owner |
| Media | Actual storage/scanner; checksum/MIME/size; quarantine unreadable; scanner outage/crash/retry; expired/revoked grant; finalize-after-timeout and duplicate finalize; object replacement races | Cross-booking/customer photo denial; approved review reads clean bound object; replaced/revoked document cannot approve case; real before/after reads do not become public |
| Workforce | Real migration/upgrade and constraints; stale revisions; reviewer self-review denial; repeat decisions; grant expiry/revocation; team/equipment/hour conflicts | Scheduling/Dispatch reject stale or revoked eligibility; operator self/profile never grants work permission |
| Scheduling/Booking | Real last-slot race; hold expiry-versus-commit; expired quote; UTC/local edge cases; duplicate/unknown outcome; saga restart and compensation failure | Guest resubmission and optional plate; no confirmed result without required provider facts; rebook/reschedule revalidate; late payment cannot resurrect capacity |
| Dispatch/Work/location | Real fenced assignment races; stale/released assignment; incorrect phase; duplicate checklist/evidence; consent revoked and stale/offline location | Six approved phases; denied contact/navigation permission; truthful stale map state; no phase advance from location/button alone |
| B cash/custody | B real financial constraints, duplicate/same key different amount, partial/mismatch rules, authorized custody handover acceptance, ledger references | C/D complete service/collection/handover/follow-up journey; Work completion, receipt upload and navigation cannot set paid/settled |
| Messaging/recovery | Local state+Outbox and Inbox+consumer commit crash boundaries; duplicate/out-of-order/gap/poison events; bounded retry/DLQ; ACL denial | Real merged producer/broker/consumer checkpoints; no fixture renamed integration evidence |
| Application evidence | Accepted deterministic HTML reference; pinned Linux reference/candidate/diff captures and unchanged tolerance | Arabic RTL, 320/390/430/768/1024/1440 widths, keyboard/focus, reduced motion, permission denial, offline/retry/unknown outcomes. English LTR requires approved translation/design; cannot mark it passed before approval. Windows/device interaction evidence is separate. |

Root/E supplies exact current commands, gate manifest and resource allocation.
No new root CI, lockfile, package, TS/Docker metadata, service-catalog edit,
schema generator or global test is changed by this packet. Required new owned
service migrations are future provider work after lease expiry and acceptance;
append-only migration IDs must accompany Prisma mirrors, real upgrade/rollback
evidence and source-bound tests. W01 introduces **zero migrations**.

## 9. Handoff routing and next action

- **To E:** accept/revise this proposal; publish BASE_W01, leases/resources and
  provider/consumer child gate ordering. Publish W02 guest/delegation access,
  Media/Workforce schemas, routes, scopes and exact accepted package versions.
  Sequence real Workforce Binding -> Media -> Workforce Review/Eligibility;
  each other Media purpose waits for its own real resource authority provider.
  Request observability tags, broker routes/ACLs, storage/scanner resource
  prefixes, service config and ready probes. These are requests, not C edits.
- **To A:** guest draft/booked-resource capability ownership and conversion;
  authorized customer work/media/location views; optional plate preserved;
  current zone/address/vehicle/quote/availability snapshots via accepted owners.
  Never consume demo booking success as a real confirmation.
- **To D:** Workforce case-bound reviewer access and review decisions; Media
  short read grants; roster/asset/hour admin requests; separate Work, assignment,
  cash/payment and projection freshness. Admin remains a consumer, not an owner.
- **To B:** exact monetary/currency/time/payment-condition and cash/custody
  interfaces, late payment/refund compensation, wallet holder/purpose and
  financial retention decisions. C supplies work/assignment facts through APIs;
  B owns receipts, custody, reconciliation and ledger outcomes.

Next action: E/product/owners resolve and record C-D01..C-D10, split provider
children, then publish accepted contracts/common base. C remains at W01
proposal handoff; it must not start W02 implementation merely because this
packet exists. Parent W01 acceptance is pending its other inventory/state/test
packets and E review; no business, integrated, staging or production capability
is asserted by this document.
