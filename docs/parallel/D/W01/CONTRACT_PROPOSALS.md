# W01-D source-derived contract proposals

**Status: PROPOSED ONLY.** Observed `main@69d81a83a3409d0693272efeb19ebeb9805750f5`; no published `BASE_W01` or E acceptance registry is available. This file defines reviewable next-wave candidates, not registered APIs, implemented workflows, approved policy or production readiness. Only D documentation is changed. Platform E must accept/version shared schemas, clients, grants, routing, broker resources and technical runtime changes; each service owner must implement its own data and tests afterward.

## 1. Evidence and scope

| Source inspected | Proven observation | Implication for proposals |
|---|---|---|
| `AGENTS.md`, `docs/design/DESIGN_LOCK.md`, `docs/design/reference-manifest.json`, `docs/adr/0004-approved-ui-precedence.md`, canonical customer HTML | Seven preserved customer screens; prototype payment/save states are illustrative; no fabricated authentication, money or readiness. | No UI/reference changes or a new Card/Paymera integration in D. |
| `docs/design/f010-reference-manifest.json`, admin HTML, technician reference | F010 registers all three golden references. Admin contains 17 sections, five form types, settings fields and fixture actions. | Preserve layout; inventory is not a business API. Existing modal save/settings save only show prototype toast. |
| Full `architecture/service-catalog.json` (19 services), `docs/ARCHITECTURE_AR.md`, `docs/VERIFICATION.md` | Current catalog separates domain ownership; many business entries still planned. Older architecture text sometimes assigns newer owners' work to Booking/Catalog/Billing. | Follow current catalog boundaries; E must reconcile historical vocabulary explicitly, rather than implement conflicting cross-owner writes. |
| `packages/contracts/src/{identity,gateway,registry}.ts` | Existing Identity V1 role/permission vocabulary and Gateway routing descriptors; eight Gateway owner variants; no Configuration/Reviews/Communications routes. API clients is a skeleton. | Proposed additions require E work. Existing `/admin/reviews/:id` routes to **Workforce verification**, not Reviews moderation. Gateway routing is not proof of every upstream API. |
| `services/identity/src/{application/identity-auth.service,domain/auth-policy,ports/identity.ports,transport/http/auth.controller,transport/http/auth-runtime}.ts`, Identity Prisma schema, `docs/F006_IDENTITY_RUNBOOK.md` | Implemented security foundation: registration/login/challenges/session/refresh/logout; status and roles mutations require fresh grants, reject actor=target, increment `authVersion` and revoke target sessions; current mutations have no expected revision or HTTP idempotency receipt. | Extend with explicit V2 governance contracts; preserve strict V1 input/behavior, do not claim missing bootstrap/invitation/MFA/scopes exist. |
| Identity HTTPS OTP adapter and config | Email adapter uses challenge:generation idempotency and 3s timeout; credentials mounted from files; no production fake. | General Communications delivery cannot borrow this as proof of SMS/push/WhatsApp or provider delivery confirmation. |
| `services/configuration/src/index.ts`, `services/reviews/src/index.ts` | Ownership skeletons only. | New service runtime/DB/broker/secrets/readiness artifacts are prerequisites, not D implementation. |
| Communications/Support/Reporting application and Prisma files | Foundation shell/marker; Communications and Reporting have probe inbox/effects, not product notifications/cases/reports. | Do not describe probe persistence as implemented product data. |
| `packages/event-contracts/src/{envelope,registry,booking-confirmed}.ts`, `packages/platform-messaging/src/{types,inbox-consumer}.ts`, service-kit errors/filter | Strict event keys/version, UTC milliseconds, aggregate revision; authenticated producer separate from JSON. Inbox hashes exact bytes and commits local effect before ACK; technical error envelopes differ among Identity/Gateway/service-kit. | E must register new event types, consumer inbox namespaces, producer ACLs and compatible error adapters; retain byte-integrity checks and bounded retries. |

W01-D prioritizes Identity/admin authorization bootstrap and Configuration read/publication. Communications, Support, Reviews and Reporting definitions are subsequent dependent slices. None may bypass Media ownership, Billing verification, Customer consent or current Identity authorization. Decisions are `DEC-D-01` through `DEC-D-18` in `DECISIONS.md`.

## 2. Proposed common wire and behavior profile

The following is schema pseudocode for review. E must supply machine-readable OpenAPI/JSON Schema/AsyncAPI, parsers and positive/negative fixtures at a registered package version. These are **not** current exported TypeScript types.

```ts
type UUID = string;                       // canonical lower-case UUID; generate v4 for
                                         // next-wave IDs to match Identity V1 constraints
type Revision = number;                  // safe integer >= 1; no increment from browser
type UTC = string;                       // valid YYYY-MM-DDTHH:mm:ss.sssZ instant
type MinorAmount = string;               // canonical /^(0|[1-9][0-9]*)$/; no float/sign
type Money = { amountMinor: MinorAmount; currency: string; exponent: number;
               currencyPolicyVersion: Revision };
type Scope = { marketId: UUID; organizationId?: UUID; teamId?: UUID };
type ResourceRef = { owner: string; id: UUID; revision: Revision };
type CommandMeta = { commandId: UUID; reasonCode: string; reason?: string };
type Receipt = { operationId: UUID; resourceId: UUID; revision: Revision;
                 state: string; committedAt: UTC };
type BusinessFault = { error: { code: string; message: string; requestId: UUID;
                               correlationId: UUID; retryable: boolean;
                               fields?: { field: string; code: string }[];
                               currentRevision?: Revision } };
```

- IDs are service-owned opaque identifiers, never customer-facing `WG-*` fixture values, phone numbers or emails. Scope IDs are resolved by the owning service, not trusted from browser claims. `subject`/`sessionId`/`authVersion` stay Identity authority; `entityRevision`, configuration `version` and event `aggregateVersion` have separate meanings.
- UUID parser compatibility matters: Identity V1 currently accepts UUID versions 1–5 while event helpers allow 1–8. Generate v4 here until E agrees a compatible parser expansion; do not publish v7 input that existing auth rejects.
- Each V2 command uses `Idempotency-Key` (proposed 16–128 ASCII `[A-Za-z0-9_-]`) and `commandId`; an owner-local unique `commandId` prevents ambiguous logical reuse. Exact object fields, bounded arrays/strings/byte sizes and enum parsing apply. Empty strings cannot stand for absent IDs. No URL/file/blob/credential field accepted where a Media object ID or secret reference is required.
- Proposed fingerprint `sha256('cw-command-v1\n' + canonicalJSON({contractId,actorSubject,actorService,scope,operation,targetId,expectedRevision,body}))`; parser-normalized object keys sorted recursively, arrays preserve order, numeric format canonical, and domain normalization specified per field. Include policy revision and concurrency precondition. Exclude request/correlation IDs, CSRF tokens, cookies, transport timestamps and volatile signing headers. The browser cannot choose actor or fingerprint. Body hash alone is insufficient.
- Key uniqueness scope is `(owningService, contractMajor, actorSubjectOrService, operation, scope, targetId, idempotencyKey)`. A unique claim and local state/audit/outbox/result commit occur atomically. Same key+fingerprint returns original status/receipt; different fingerprint returns `409 IDEMPOTENCY_CONFLICT`; concurrent same key does one effect and returns replay or `202` with the same operation ID; never starts another attempt. Fresh authorization/object permission is checked before replay; a revoked actor cannot obtain a retained sensitive response.
- Proposed retention under DEC-D-15: response replay for seven days; minimal hash/receipt tombstones for 90 days. Record `acceptedAt`, `replayUntil`, `tombstoneUntil`; return `409 IDEMPOTENCY_EXPIRED` during tombstone-only period, no effect. After approved tombstone removal, clients must use new command IDs; owners' durable business uniqueness remains mandatory for refunds/publication/delivery/provider attempts. The lifetime must become an explicit accepted contract/policy; seven/90 days are **not** an existing system rule. Do not claim unlimited deduplication after deleting all unique references.
- Auth/validation failures before claim are not successful outcomes and do not reserve keys. A committed business rejection is stored if part of a claimed operation; unexpected/dependency failure before any effect rolls back the claim. Uncertain external outcome stays `PENDING_RECONCILIATION` with operation ID, never reset to unexecuted. Receipts contain no private document, OTP, raw phone or secret. Stored sensitive result encryption/access retention is owner responsibility.
- Money: currency is an approved uppercase code and exponent a validated market-policy integer, not a hardcoded two-decimal assumption. Positive payment/remedy amounts required where appropriate; upper bounds established by Billing; currencies/exponents cannot be mixed, exchanged or summed silently. References to financial values always include Billing source revision. D proposes no tax/provider tariff or exchange rate.
- Time: instants stored in UTC with milliseconds; display/interpretation includes validated IANA timezone and policy version. Local date ranges are `[startInclusive,endExclusive)` plus `timezone`; never parse a timezone-less booking datetime as server local time. Durations are bounded integer seconds/minutes, not “10 دقائق” strings. Server clock decides expiry, never browser clock.
- Events preserve the existing strict envelope `{eventId,eventType,schemaVersion:1,producer,occurredAt,correlationId,aggregateVersion,data}` for each newly registered `*.v1` type. No unexpected fields under current parsers. Any envelope change requires a new version or accepted compatibility adapter; Monorepo does not imply atomic deployment. Emit owner-local audit/outbox with business commit; Reporting down does not prevent or erase local audit.
- Receiving owners validate the registered producer/broker ACL plus payload, use their own inbox namespace and payload hash, compare aggregate revisions and recover missing gaps through an authorized owner snapshot. Same event ID/different bytes goes to DLQ/integrity alarm; duplicate bytes are no-op. Older revision cannot overwrite newer, and a revision gap is not silently skipped. Do not add top-level schema fields to old events to make this possible.
- Proposed foreground deadlines under DEC-D-16: current-auth lookup 2s; owner validation/read 3s; total interactive operation 10s. A timeout after local commit returns/recoverably discovers operation receipt; dependency failure before commit uses `503 DEPENDENCY_UNAVAILABLE`/`504 DEPENDENCY_TIMEOUT`. No blind write retry. Read composition may report individual stale/unavailable sections; never turn a sensitive authorization timeout into access.
- Proposed error codes: `400 REQUEST_INVALID`, `401 AUTH_REQUIRED`, `403 AUTH_FORBIDDEN`/`STEP_UP_REQUIRED`, `404 RESOURCE_NOT_FOUND`, `409 REVISION_CONFLICT`/`IDEMPOTENCY_CONFLICT`/`INVALID_TRANSITION`/`IDEMPOTENCY_EXPIRED`, `422 POLICY_INVALID`/`DOMAIN_VALIDATION_FAILED`, `429 RATE_LIMITED`, `503 DEPENDENCY_UNAVAILABLE`, `504 DEPENDENCY_TIMEOUT`. Cross-account resource reads use a non-enumerating 404 when appropriate. No SQL/provider stack prose or PII in response/log. E must preserve existing Identity V1 `{error:{code,message,requestId}}` and Gateway V1 error behavior with adapters rather than silently replacing them.

## 3. CP-D-001 — Identity V2 admin governance and bootstrap

### Authority and compatibility

Identity owns credentials, sessions, grants and login/account status. It does **not** own Workforce approval/ability to work, customer consent, cash custody, payment confirmation or domain-object relationships. Admin is a UI audience, not a data-owning service. Sensitive owner operations verify current session authorization and their own object/scope rule.

Existing `auth-policy.ts` role mappings are source facts, not proposed new grants:

| Existing role | Existing permission mapping |
|---|---|
| `customer` | `profile.read:self`, `profile.write:self`, `bookings.read:self`, `bookings.create:self` |
| `technician` | `profile.read:self`, `profile.write:self`, `work.read:assigned`, `work.execute:assigned` |
| `operations` | `operations.dispatch` |
| `finance` | `billing.read`, `billing.refund` |
| `support` | `support.cases.read`, `support.cases.write` |
| `reviewer` | `verification.review` |
| `super-admin` | All entries in current `IDENTITY_PERMISSIONS`, including `identity.accounts.suspend` and `identity.roles.assign` |

Preserve this V1 vocabulary and tested behavior during compatibility migration. New namespace/object scopes and the grant strings explicitly labeled proposed below are not present exports and cannot be treated as a current administrative permission.

Current V1 routes accept strict `{status}` or `{roles}` and return 204. Adding `expectedRevision` or `reason` to those bodies would break their current parser. Proposed new base `/internal/v2/identity` leaves V1 reads/auth/challenges untouched. E must decide a transition policy: retain old admin mutations only for explicitly legacy clients while V2 adoption is tested, then disable their writes through an agreed release/feature policy. Never leave an unrestricted last-admin bypass through V1 after claiming V2 governance protection.

### Proposed schemas and routes

```ts
type IdentityAccountAdminViewV2 = {
  accountId: UUID; entityRevision: Revision; authVersion: Revision;
  status: 'ACTIVE'|'SUSPENDED'; roles: IdentityRole[];
  grantAssignments: { grant: string; scope: Scope; expiresAt?: UTC }[];
  createdAt: UTC; updatedAt: UTC; // email only in explicitly permitted detail projection
};
type AdminSessionViewV2 = {
  subject: UUID; sessionId: UUID; authVersion: Revision;
  roles: IdentityRole[]; permissionAssignments: { grant: string; scope: Scope }[];
  authenticatedAt: UTC; stepUp?: { verifiedAt: UTC; expiresAt: UTC; method: string };
};
type AccountStatusCommandV2 = CommandMeta & {
  expectedRevision: Revision; status: 'ACTIVE'|'SUSPENDED'; scope: Scope;
};
type AccountGrantCommandV2 = CommandMeta & {
  expectedRevision: Revision; scope: Scope;
  assignments: { role: IdentityRole; scopes: Scope[]; expiresAt?: UTC }[];
};
type AdminInvitationV1 = {
  invitationId: UUID; revision: Revision; state:
    'PENDING_DELIVERY'|'INVITED'|'ACCEPTED'|'EXPIRED'|'REVOKED'|'DELIVERY_FAILED';
  accountId?: UUID; intendedRoles: IdentityRole[]; scopes: Scope[]; expiresAt: UTC;
};
```

| Candidate route | Request/response | Authorization and concurrency |
|---|---|---|
| `GET /session` | `AdminSessionViewV2`; no-store | Identity validates JWT and live session/account/authVersion; no grants copied from unverified caller headers. Step-up evidence only if an implemented verified mechanism exists. |
| `GET /accounts?cursor&limit&scope&status` and `GET /accounts/:id` | Allowed admin projection, cursor bound to query/scope; proposed max page 100 | Proposed `identity.accounts.read` and object scope. Current `identity.roles.assign` must not implicitly become a broad PII search right. |
| `POST /accounts/:id/status` | `AccountStatusCommandV2` → receipt + updated admin view | Existing `identity.accounts.suspend` plus scope/step-up policy; target `entityRevision` matched atomically. Actor=target forbidden as current V1. Suspension and reactivation never imply work eligibility. |
| `POST /accounts/:id/grants` | `AccountGrantCommandV2` → receipt + updated view | Existing `identity.roles.assign` plus proposal `identity.privilege.assign` for high privilege; cannot grant outside actor delegation scope; self-escalation denied; approved separation rules. |
| `POST /admin-invitations` | Command meta + `email`, `roles`, `scopes`, bounded expiry → redacted invitation receipt | Proposal `identity.admins.invite`; verified current administrative authority; no public registration role switch. Token digest stored; delivery is private and never logged. |
| `POST /admin-invitations/:id/revoke` | Command meta + expected revision → receipt | Inviter/explicit authorized admin scope; revocation invalidates acceptance token atomically; acceptance race has exactly one result. |
| `POST /admin-invitations/:id/accept` | Opaque one-time token + authenticated matching verified account → new receipt | Not authorization by email alone; expected recipient binding and token expiry; no token in URL/log. CSRF for browser command; accepting a self-owned invitation can only install authority originally granted by approved inviter. |
| Offline `identity-bootstrap-admin` owning-service command | Approved bootstrap manifest with environment, verified `accountId`, requested bootstrap role, reason, ceremony receipt/witness refs → audit receipt | Not an HTTP API. Separate narrowly scoped operational capability and approved custodians (DEC-D-10); reads only Identity DB through owning-service port. No command is implemented by this proposal. |

Invitation addresses are normalized by existing email rules; passwords follow current significant-character input rules. Technician invites require Workforce coordination but **admin invitation is not technician approval**. Token expiry proposal 24h is open under DEC-D-09/10/16; no automatic password generation or credential sent in clear text. Identity registration remains a customer role until explicit approved grants.

### Transaction, states and audit

1. Verify current principal/CSRF, exact schema, rate budget, command uniqueness, approved grant scopes and step-up evidence. A login email OTP is not asserted to be independent MFA; actual method/window needs decision and implementation.
2. Take owner-local idempotency claim and deterministic lock order. Proposed lock order: governance lock (for privilege/suspension affecting last admin), affected account IDs sorted, then sessions/command. Recheck actor, session, `authVersion`, permission and delegation inside the write transaction; preflight alone is insufficient.
3. Match target `entityRevision`; verify no removal/suspension/expiry leaves zero usable admins authorized to recover the environment. Last-admin guard is a transaction invariant under the governance lock; a dashboard count cannot enforce it. V1 and offline writers must participate in the same guard before it is claimed effective.
4. Update account/grants, increment `entityRevision` and `authVersion` once, revoke target sessions, persist immutable audit and any registered access-change outbox record and receipt in the same transaction. A no-op same-value command returns a receipt without inventing a second state change; whether it increments revision must be registered consistently (proposal: no increment).
5. Return current receipt; lost response replays once. Reporting projection or broker unavailable never rolls back a committed account mutation or grants temporary access. Consumers' sensitive commands still consult live Identity until revocation events are fully registered/verified.

Account state remains current `ACTIVE|SUSPENDED`; missing account is not “pending technician”. Invitation state machine is independent and single-use. Invite delivery accepted does not mean the invitation was accepted. Delivery failure → `DELIVERY_FAILED`; a new authorized resend attempt rotates generation/secret and is audited; ambiguous provider result reconciles before duplicate send. Expired/revoked invitations cannot be accepted. If Workforce preparation fails after an invite, revoke/cancel a still-unused invitation or record a linked pending workflow; do not remove a credential/account via another owner.

Proposed audit fields: `{auditId,action,outcome,actorId,actorServiceId?,subjectId,scope,commandId,requestId,correlationId,beforeRevision,afterRevision,reasonCode,approvedDecisionRef?,occurredAt}` plus redacted structured changed-field names. Do not store password hash, OTP, cookie or raw invitation token in audit. Local append-only audit and protected DB permissions must be implemented; current `IdentityAudit` has a smaller schema and cannot be described as already supporting these fields.

Bootstrap: preflight verifies exact environment/source/config and active verified account; transaction locks governance row and rejects if bootstrap already completed or an eligible bootstrap admin exists. Write one explicit grant, increment authVersion, revoke preexisting sessions, record ceremony result and a durable `bootstrapCompleted` marker atomically. Replaying the same ceremony ID returns redacted receipt; another ceremony cannot regrant. It must not create an admin from a fixture or reset a password. Recovery from last-admin loss is a separately approved emergency operation with fresh audit/dual custody, never disabling the guard in public HTTP.

### Provider-consumer acceptance required after E acceptance

- Provider: strict V1 compatibility; rejected role injection; V2 mismatched revision; simultaneous status/grant writes; same-key/different-body; same-key race/lost-response; cross-scope grant; actor revoked between preflight/commit; self-target denial; replay after actor revocation; expired step-up; last-admin race across two actors; no V1/expiry/bootstrap bypass; audit/receipt/outbox rollback on failed DB commit.
- Invitation: invalid/expired/revoked/reused token; recipient mismatch; parallel acceptance/revocation; privacy-safe decoy/non-enumeration response; provider timeout and idempotent generation; no raw tokens in logs/evidence.
- Bootstrap: dry-run performs no grant; missing custodian manifest/environment mismatch refused; one ceremony wins concurrently; marker/audit commit atomically; rerun replay; recovery test without public role switch.
- Consumers: Gateway forwards exact Set-Cookie/Origin/CSRF transport and strips caller identity headers; all domain owners distinguish current grant from object ownership and reject inactive/revoked session; Admin shows access denied/conflict/unavailable and refreshes after grant change. Browser evidence with real Identity required separately from contract/unit tests.

Dependencies: DEC-D-09/10/15/16/17; Identity owning schema mirrors/migrations + offline CLI + audit/idempotency + grant scopes + optional actual step-up mechanism. E exports V2 types/parsers/clients/errors and routes, accepts new grants, fixtures and revocation event schema. Domain owners provide object rules. No Workforce, financial or provider change belongs in Identity's DB.

## 4. CP-D-002 — Configuration V1 read, draft, validation and publication

### Ownership and typed policies

Configuration owns immutable policy versions, scoped drafts, approvals, publication metadata and active pointer. It cannot own live bookings, holds, grants, package prices, stock/capacity, bank credentials, balances, subscription counts or case outcomes. Domain owner contracts validate policy applicability; their own command handlers enforce the effective rules.

| Proposed namespace | Configuration payload | Required authoritative validator/adopter |
|---|---|---|
| `market.presentation.v1` | `marketId`, timezone, supported languages, approved currency code/exponent metadata, formatting policy refs | Product decision DEC-D-04/18; Billing/Pricing validate financial compatibility; Gateway/UI consume permitted projection. No exchange/tax calculation here. |
| `booking.policy.v1` | Bounded hold TTL, allowed delay, cancellation policy reference/version and effective scope | Booking, Scheduling and Dispatch validate individually; TTL does not extend an existing hold automatically. |
| `communications.policy.v1` | Enabled approved channels/purpose refs, notification expiry/retry policy, provider configuration **reference** | Communications validates adapter capability; Customer owns consent authority. No recipient list, secret or message body. |
| `privacy.retention.v1` | Per-class duration/start trigger, approved purpose/hold-policy refs and revision | Media, Identity, Communications, Customer, Support, Reviews and Reporting validate relevant classes; each runs its own jobs. No central arbitrary deletion. |
| `reviews.policy.v1` | Eligibility window, moderated publication/appeal policy refs | Reviews + Booking verify applicability. No new stars/review state values by settings edit. |
| `feature.policy.v1` | Named allowlisted feature and scope, disabled/enabled policy, explicit capability/contract release prerequisites | Owning service validates release/capability; enablement cannot claim payment/provider readiness. |

Financial amounts/prices/refund decisions and actual Identity role assignments are excluded even though the admin settings reference displays roles/currency and service modal displays price. E must define closed namespace-specific payload schemas; there is no `PUT /settings` accepting unrestricted JSON. Unknown namespace/field fails 422. Secret references are server-managed IDs, not arbitrary URLs or browser-readable secrets.

```ts
type ConfigurationScopeV1 = { marketId: UUID; namespace: string; schemaVersion: 1 };
type ConfigurationDraftV1 = {
  draftId: UUID; scope: ConfigurationScopeV1; draftRevision: Revision;
  basePublishedVersion: number; // integer >= 0, 0 only means no prior publication
  contentHash: string; payload: unknown; state:
    'DRAFT'|'VALIDATING'|'VALIDATED'|'VALIDATION_FAILED'|'APPROVED'|'SCHEDULED'|
    'PUBLISHED'|'CANCELLED'|'SUPERSEDED';
  createdBy: UUID; updatedAt: UTC;
};
type ValidationReceiptV1 = {
  validationId: UUID; draftId: UUID; draftRevision: Revision; contentHash: string;
  owner: string; supportedContractVersion: string; policyDecisionRevision: Revision;
  result: 'ACCEPTED'|'REJECTED'; validatedAt: UTC; validUntil: UTC;
  dependencyRevisions: ResourceRef[]; issues: { field: string; code: string }[];
};
type PublishedConfigurationV1 = {
  scope: ConfigurationScopeV1; version: Revision; configurationId: UUID;
  previousVersion: number; schemaVersion: 1; contentHash: string; payload: unknown;
  publishedAt: UTC; effectiveAt: UTC; approvedDecisionRefs: string[];
};
```

`payload: unknown` is a documentation placeholder; it must be a namespace-discriminated closed schema in E, never an implemented unvalidated bag. `contentHash` is server-derived canonical validated payload bytes including namespace/schema/scope; clients cannot assert their own hash/version or nominate a validator URL.

### Proposed routes and authorization

| Candidate route under `/internal/v1/configuration` | Schema/response | Rules |
|---|---|---|
| `GET /scopes/:marketId/:namespace/current` | Effective allowed projection + `{version,effectiveAt,asOf,source}`; ETag `"cfg-<scope>-<version>-<hash>"` | Explicit service identity+namespace read grant or scoped admin `configuration.read`. Only safe presentation projection may be public via a separate Gateway route. No drafts, secrets/provider refs, audit actor PII or retention enforcement credentials in public response. |
| `GET /scopes/:marketId/:namespace/versions/:version` | Immutable permitted published version | Authorized scope and bounded history access; absence is 404. Version lookup never implicitly makes version active. |
| `POST /drafts` | Command meta + scope + `basePublishedVersion` + typed payload → draft receipt/ETag | Proposal `configuration.draft`; compare active pointer at create; base version mismatch 409. Creating initial draft requires base 0. |
| `PATCH /drafts/:id` | Command meta + `expectedDraftRevision` + complete typed payload → draft receipt/ETag | Draft-state and scope authorization; optional If-Match must agree with body; stale revision 409. Full replacement avoids ambiguous merge/deletion semantics. Clears validation/approvals, increments draft revision. |
| `POST /drafts/:id/validate` | Command meta + expected draft revision → operation receipt and receipts | Proposal `configuration.validate`; dispatch only to E-registered owner validators through bounded approved clients. Draft unchanged while validating; parallel edit invalidates returned receipts. |
| `POST /drafts/:id/approve` | Command meta + expected draft revision + validation IDs + accepted decision refs → approval receipt | Proposal `configuration.approve` scoped by namespace; fresh step-up/separation policy. Approver distinct from drafter where required; approval bound to hash, revision, base version and receipt set. |
| `POST /drafts/:id/publish` | Command meta + expected draft revision + expected active `basePublishedVersion` + approval ID + requested `effectiveAt` → immutable publication or scheduled receipt | Proposal `configuration.publish`; fresh auth/step-up, validator receipts unexpired, accepted decisions known; immediate first slice recommended. Scheduled activation remains blocked until worker and policy approved. |
| `POST /drafts/:id/cancel` | Command meta + expected draft revision → receipt | DRAFT/VALIDATED/APPROVED/SCHEDULED only with grant; cannot erase an already published version. Cancellation races with activation by the same locking/version guard. |
| `POST /scopes/:marketId/:namespace/rollback` | Command meta + expected current version + `restoreFromVersion` + new approval/reason → **new** published version | `configuration.publish` + applicable emergency policy; current owners validate older payload against current domain/runtime. Published history never mutated/deleted. |
| `GET /operations/:id` | Scoped operation/receipt | Same actor or explicitly delegated scope; pending is not saved/published. |

No existing Identity grant provides these operations today. `super-admin` currently maps to all **known** existing permissions; new grants cannot be assumed automatically authorized until E accepts delegation and migration policy.

### Publication transaction and domain validation

1. Normalize typed draft input with server rules. Check timezone/currency allowlist and domain decision references, bounded nonzero TTLs, delays, logical intervals, policy reference versions and feature-capability prerequisites. Validation cannot approve production provider enablement without the Billing owner's accepted merchant/provider capability.
2. Validation HTTP request to each registered owner: `{validationId,scope,draftId,draftRevision,contentHash,payload,requestedEffectiveAt,decisionRefs}` authenticated as Configuration with exact allowed namespace. Response `ValidationReceiptV1` must bind the exact input/hash/version, supported contract major and current dependency revisions. The owner may reject retroactive or incompatible policy; owner validation does not modify its transaction state.
3. Validation requests are bounded/time-limited; collect every required owner receipt. Any unavailable/reject/expired/mismatch keeps draft unpublished, returns typed issue and records unsuccessful validation audit. Proposed receipt maximum age 5 minutes is DEC-D-16 open, not a runtime fact. Revalidate if any dependency revision/hash/decision/base changes. A validator success is not authorization to publish.
4. Approval binds immutable draft hash/revision + owner receipt set + active base version + approver. Any edit removes approval. Publication rechecks actor/step-up, approvals and domain validation applicability immediately before commit. For sensitive policy, a cached successful preflight cannot substitute for current owner state/version. Cross-owner atomic validation is impossible; accept a bounded validation lease/revision protocol, or fail closed. This consistency decision belongs in E/DEC-D-11, not an assumed global transaction.
5. In a local Configuration transaction, take idempotency claim, scope active-pointer lock and draft lock in fixed order. Check expected active version and draft revision. Assign next monotonically increasing scope version; append immutable version + audit + outbox + receipt and update active pointer atomically for immediate publication. Two drafts based on the same prior version cannot both publish silently; loser returns 409 and must rebase/revalidate/reapprove.
6. Proposed event `configuration.configuration-published.v1` keeps existing envelope and data `{configurationId,marketId,namespace,version,previousVersion,contentHash,effectiveAt}`. Consumer fetches the permitted immutable payload rather than receives secret/large policy data on broker. `aggregateVersion` equals scope publication revision. E must settle aggregate scope identity and gap-repair contract; no event is added to registry in D.
7. Consumers persist adopted version/inbox in their own DB and apply policy only to subsequent policy-governed operations unless explicit migration was approved. Existing quote, price, booking/payment snapshot, consent revision and hold expiry do not retroactively change. An adoption error is visible and owner-specific; Configuration does not compensate by writing into that service. Flag remains disabled if capability validation fails.

Scheduled proposal: serialize scheduled versions per scope and persist `SCHEDULED` without making them current; activation worker with lease/fencing checks clock, current base, actor/approval validity and required fresh validator receipts. If superseded, unavailable or invalid, hold `ACTIVATION_BLOCKED` as operation outcome and alert rather than activate stale policy. Cancel/publish/worker race guarded by owner transaction. Event published only when policy actually becomes effective; a separate registered scheduled event would be necessary if scheduling observability is required. Simplest next slice supports immediate publication only; accepting requested future time is not enough to claim scheduling implemented.

Rollback is a validated forward publication. Configuration failure before local commit leaves prior active version; response loss after commit finds same receipt. Broker outage leaves outbox pending and authoritative read current. Consumers that cannot fetch an unknown version mark degraded/use only accepted bounded previous policy (read-safe policies), or refuse sensitive decisions (financial/access/retention/provider policy). No cache fallback broadens access. Rebuild/read-model outage never hides source policy audit.

### Acceptance and prerequisite E work

Provider tests: scope isolation/public redaction; namespace closed schemas; valid/invalid timezone/currency/duration/feature ref; draft revision mismatch; parallel draft edits and publishes; active-base conflict; validation receipt hash/revision/version/expiry mismatch; validator outage; decision not accepted; approver/drafter separation; revocation during publish; same-key race/lost response; local rollback/audit/outbox atomicity; scheduled/cancel race if accepted; forward rollback compatibility; no secrets in payload/events/logs; old published rows immutable.

Consumer tests: fixture generated by provider parsed by client; unknown major/enum/namespace rejected safely; out-of-order/duplicate event + gap authorized snapshot; adoption failure/status; stale active pointer not overwriting newer; revoked read/publish; existing Booking/Pricing/Billing snapshot untouched; 304/ETag and no-store for privileged data; browser draft remains on timeout/conflict, no prototype saved toast before receipt. Run owner database/migration/ACL, actual broker, HTTP and browser checks as distinct evidence categories.

E prerequisites: register Configuration runtime DB/migration role/secrets/producer exchange/consumer queues; add per-namespace discriminated schemas/parsers and OpenAPI/AsyncAPI registry entries; new grants and scoped Identity V2 checks; Gateway owner/route union expansion and bounded client deadlines; technical idempotency/audit/lease support; domain-validation client and provider tests from Booking, Scheduling, Dispatch, Billing/Pricing, Media and the applicable privacy-owning domains. There is no additional Privacy service in the catalog. Shared technical support may coordinate transports but must not embed these domain rules.

## 5. CP-D-003 — Communications delivery, conversations and reconnect

Current Communications product application is a marker and its DB effects are foundation probes. The following requires actual product tables, migrations and registered contracts.

```ts
type NotificationRequestV1 = CommandMeta & {
  purpose: 'TRANSACTIONAL'|'MARKETING'; templateId: UUID; templateVersion: Revision;
  recipientRef: ResourceRef; channel: 'IN_APP'|'EMAIL'|'SMS'|'PUSH'|'WHATSAPP';
  sourceEventId?: UUID; bookingId?: UUID; expiresAt: UTC; scope: Scope;
  consentRef?: ResourceRef; parameters: Record<string,string>;
};
type DeliveryViewV1 = { notificationId: UUID; revision: Revision; state:
  'QUEUED'|'SUPPRESSED'|'SENDING'|'PROVIDER_ACCEPTED'|'DELIVERED'|'READ'|
  'RETRY_WAIT'|'UNKNOWN'|'FAILED'|'EXPIRED'|'CANCELLED';
  channel: string; attemptId?: UUID; acceptedAt?: UTC; deliveredAt?: UTC; readAt?: UTC;
};
type ConversationMessageV1 = { messageId: UUID; conversationId: UUID; sequence: Revision;
  revision: Revision; authorId: UUID; type:'TEXT'|'MEDIA_REF'; text?: string;
  mediaObjectId?: UUID; createdAt: UTC; redactedAt?: UTC };
```

Typed template parameter allowlist is required, not arbitrary free-form recipient/content HTML. Recipient endpoints fetched through Customer/Identity permitted projections; no bulk raw email/phone list from Admin. Marketing requires current consent/purpose authority from Customer before queueing and again at actual send after delays. Transactional allowed basis must be explicit; refusing optional marketing cannot block essential booking service messages. Provider choice, channels and consent are DEC-D-07/12, not inferred from “Sent” fixtures.

Candidate endpoints `/internal/v1/communications`: `POST /notifications` (scoped service `communications.send:transactional` or admin proposed `communications.campaigns.create` for eligible campaign), `GET /notifications/:id`, `POST /notifications/:id/cancel` with revision, `GET /conversations/:id/messages?afterSequence&limit`, `POST /conversations/:id/messages` with command ID, `POST /conversations/:id/read` with monotonic `throughSequence`. Mass campaigns require preview/eligible audience count/cap/approval and their own campaign ID; do not expand single notification request into “everyone” implicitly. Accepted queued receipt is not delivery confirmation.

Conversation membership is derived from authoritative Booking customer, current Dispatch assigned technician/team and explicitly scoped Support participants. Communications stores membership snapshot/version but rechecks sensitive access and assignment changes with owners; booking ID knowledge alone does not grant access. Customer cannot view another booking; replacement technician cannot browse unrelated past private threads; Support entry and read are audited. No global room join from caller-provided subject or Socket.IO room name.

Persist message+server sequence+audit/outbox before WebSocket broadcast; text plain UTF-8 bounded (proposal 2,000 chars), no arbitrary HTML. Media refs require Media scan complete, authorized purpose and matching booking/conversation; short-lived URLs obtained on authorized read, never embedded permanently in broker event. Reconnect reads since a server cursor; if outside retained range return snapshot/cursor-expired indication rather than a fabricated continuous log. Read cursor monotonic per participant, cannot mark beyond visible maximum sequence; delivered and read not synonyms.

External attempt has unique `(notificationId,channel,generation)` + provider idempotency ref. Persist intent before external call. Verified provider response sets PROVIDER_ACCEPTED only; verified callback/query sets DELIVERED if provider documents it. Redirects disabled, fixed approved endpoints, auth/signature/clock/replay validation, no OTP/contact/message logs. Timeout after submission -> UNKNOWN and reconcile before retry; provider without idempotency/query cannot receive blind replay. Bounded retry with exponential delay/jitter and expiry under DEC-D-12/16. Cancel stops pending sends; a delivered message cannot be unsent, compensation is a separately authorized correction notification referencing original ID. Business-event replay suppresses historical marketing/expired reminders and does not resend delivered messages.

Proposed catalog event `communications.delivery-updated.v1` data `{notificationId,revision,state,channel,attemptId?,statusAt}`; schema must define exact optional-key rules and avoid provider response PII. Additional conversation events need separate E registration. Inbox/outbox guarantees persistent enqueue once, not exactly-once third-party delivery.

Tests: Customer consent withdrawn while queued; template/channel/provider disabled; cross-booking room/message/media denied; assignment revoked mid-send/read/reconnect; message race/sequence/read monotonicity; response loss replay; callback spoof/replay/amount-irrelevant fields rejected; provider accepted not delivered; delivery timeout/reconciliation; crash before/after external call; broker rebuild does not resend; suppression/cancel/expiry; connection gap/snapshot and redaction. E dependencies: proposed scopes, delivery/provider port, signed callback schema and service identities, actual Runtime/Media/Customer/Booking/Dispatch contracts and privacy-approved fixtures.

## 6. CP-D-004 — Support resolution workflow and privacy intake

Support owns cases, case events and remedy requests. It cannot directly refund, alter booking execution, publish/unpublish review, grant roles or delete another owner's data.

```ts
type CaseV1 = { caseId:UUID; revision:Revision; category:
  'SERVICE_COMPLAINT'|'PAYMENT_QUERY'|'REFUND_REQUEST'|'PRIVACY_REQUEST';
  requesterId:UUID; scope:Scope; bookingId?:UUID; state:
  'OPEN'|'ASSIGNED'|'INVESTIGATING'|'WAITING_CUSTOMER'|'WAITING_OWNER'|
  'RESOLUTION_PROPOSED'|'RESOLUTION_PENDING'|'RESOLVED'|'CLOSED'|'REOPENED';
  evidenceRefs:ResourceRef[]; createdAt:UTC; updatedAt:UTC };
type ResolutionProposalV1 = CommandMeta & { expectedCaseRevision:Revision;
  remedy:'NONE'|'SERVICE_REMEDY'|'REFUND_REQUEST'|'PRIVACY_FULFILMENT';
  owner:string; sourceRef:ResourceRef; amount?:Money; customerFacingSummary:string;
  internalReasonCode:string; acceptedPolicyRef:ResourceRef };
type PrivacyIntakeV1 = CommandMeta & { requestType:
  'ACCESS'|'RECTIFICATION'|'ERASURE'|'RESTRICTION'|'CONSENT_WITHDRAWAL';
  requestedPurpose?:string; requestedOwners:string[]; scope:Scope };
```

Candidate endpoints `/internal/v1/support`: `POST /cases`, `GET /cases/:id`, scoped list, `POST /cases/:id/assign`, `/evidence`, `/resolution-proposals`, `/resolution-proposals/:proposalId/approve`, `/close`, `/reopen` with expected case/proposal revisions and command meta. Customer create/read own case; assigned support staff require fresh `support.cases.read/write` and local scope. Internal staff notes are a separate permitted projection, never returned to customer by a generic case serialization. Evidence stays Media-private and purpose-limited; scan/link state verified. Finance approval uses Billing authority, not Support's grant.

Approve resolution persists Support intent/audit/outbox and sends idempotent owner command linked by `resolutionRequestId`/case/proposal revision. Billing command candidate `{resolutionRequestId,caseId,sourcePaymentRef,requestedAmount,reasonCode,policyRef}` with Support service identity; Billing revalidates authorization/current refundable funds/currency and returns its own receipt. Lost response remains RESOLUTION_PENDING; query owner by request ID. Billing confirmed/rejected result advances case through inbox once, mismatched amount/reference rejected and surfaced. Case `RESOLVED` may mean nonfinancial remedy completed; when remedy is refund, it must not imply money returned until Billing confirms. Rejection permits a new reasoned proposal, not mutation of old intent. User closure while refund pending does not cancel ledger work silently. Booking/service remedy is separate owner command with explicit compensation and customer consent as policy requires.

Privacy intake uses authenticated requester + strong owner identity binding; never accepts arbitrary `subjectId` to export/delete another user. Alternative offline verified intake must be separately approved/implemented, not guessed anonymous authentication. Support records minimal request and coordination status; owner extracts rectifies/redacts/erases its own data under legal-hold and retention policy. Requester's access evidence stays private. Legal hold can block specific deletion with reason/status; withdrawal stops optional future marketing immediately in Customer authority and is separate from erasing immutable financial evidence. No statutory deadline is invented: dueAt/policy version requires DEC-D-06/07 and qualified owner review.

Proposed fulfillment task `{taskId,privacyRequestId,verifiedSubjectRef,purpose,action,requestedClasses,policyVersion,verificationExpiresAt}` to allowlisted owners through approved service auth. Owner result `{taskId,state:'COMPLETED'|'PARTIAL'|'BLOCKED'|'FAILED',completedAt?,reasonCode,affectedClassCounts}` avoids raw private payload over general events. Access result delivered through secure audited short-lived export route, no emailed raw archive by default. Support can only say completed after all required owner results, including relevant projection/backups lifecycle handling; preserve partial/blocked status honestly.

Catalog event `support.case-resolved.v1` candidate data `{caseId,revision,resolutionId,remedy,outcome,ownerOperationId?,resolvedAt}` with no free-text complaint/evidence. E must register resolution/request/result and privacy task schemas separately; catalog name alone is not a live event.

Tests: requester ID spoof; cross-case scope/evidence; support-vs-finance separation; same-key and approve race; owner rejection/outage/ambiguous acceptance; refund pending not refunded; partial/over-refund/currency mismatch rejected by Billing; stale decision; duplicate/out-of-order result; close/reopen races; revoked assignee; privacy verified subject, hold/partial deletion, consent withdrawal, export authorization and erased Reporting projection. Dependencies: DEC-D-05/06/07/09/15/16/17; real Billing/Booking/Media/Customer privacy owner APIs and scoped grants; no shared DB query.

## 7. CP-D-005 — Reviews verified submission and moderation

Reviews is separate from Workforce KYC verification. Existing Gateway `/admin/reviews/:id` means verification review; do not repurpose it or existing `verification.review` permission into customer-review moderation. Proposed separate routes/grants through E avoid ambiguity.

```ts
type ReviewV1 = { reviewId:UUID; revision:Revision; bookingId:UUID; customerId:UUID;
  verifiedServiceRef:ResourceRef; rating:1|2|3|4|5; text?:string;
  state:'PENDING_MODERATION'|'PUBLISHED'|'HIDDEN'|'REJECTED'|'WITHDRAWN';
  publishedAt?:UTC; submittedAt:UTC; attributionRef?:ResourceRef };
type ModerationCommandV1 = CommandMeta & { expectedRevision:Revision;
  decision:'PUBLISH'|'HIDE'|'REJECT'|'RESTORE'; moderationPolicyRef:ResourceRef;
  reasonCode:string; customerFacingReason?:string };
```

Candidate `/internal/v1/reviews`: `POST /reviews` from authenticated booking customer with command meta, booking ID, 1–5 rating and bounded plain text; `PATCH /reviews/:id` own revision if approved edit window; `POST /reviews/:id/withdraw`; public safe `GET /published` only if approved; admin `GET /moderation-cases` and `POST /reviews/:id/moderation` require new scoped `reviews.moderate` + freshness/step-up policy. Customer self grants such as proposed `reviews.create:self` must be registered; existing login alone is not evidence of completed service.

Verify authoritative Booking customer and completed execution revision; payment status is a separate fact and a failed payment cannot automatically fabricate or erase completion. Attribution uses actual completion snapshot/assignment ref, not current technician displayed on a map. Proposed unique `(bookingId,customerId)` with revisions/withdrawal prevents duplicate ratings; whether multiple service components may be rated is DEC-D-13. If Booking unavailable, keep request deferred/unverified and do not publish a “verified” badge. Completed booking later corrected invalidates verification through a registered correction event/owner snapshot and creates a moderation case; do not delete source history.

Moderation cannot change stars/customer wording to improve averages. Preserve original/private revision, decision reason, actor and policy audit; hide/reject only by accepted reason policy. Reporting/Public projection counts only current published verified revisions; hide/withdraw reduces count exactly once and recomputes sum/count, not average-of-averages. A dispute is Support evidence, not automatic review suppression. Appeals create a linked moderation case with different reviewer if policy requires. Public projection excludes booking/customer IDs, phone, precise address, plate and private evidence; display-name policy/consent is DEC-D-07/13.

Catalog `reviews.review-published.v1` data candidate `{reviewId,revision,verifiedBookingRevision,rating,attributionRef?,publishedAt}`; hide/withdraw/correction events need separate registration to prevent reports retaining obsolete reviews. Any optional attribution schema excludes unrestricted actor/account PII. Same-key/revision, audit/outbox transactional profile applies; compensation is a new auditable moderation revision, never deleting past event IDs.

Tests: incomplete/other customer's booking; unavailable/corrected source; repeated/local prototype rating cannot publish; unique creation/edit race; invalid stars/HTML/oversize; scope and denied KYC reviewer; hide/reject/restore/withdraw transition; moderator cannot edit rating; duplicate/out-of-order lifecycle events; exact aggregate corrections; privacy-safe public projection and appeal separation. Dependencies DEC-D-07/09/13/15/17, implemented Booking completion and correction/snapshot contracts, new Reviews runtime and private DB migrations, E review scopes/clients/events; Admin UI approval for missing moderation states.

## 8. CP-D-006 — Reporting checkpoints, corrections and sensitive export

Reporting is event-derived and writes only its projections/checkpoints. It cannot approve a worker, refund, report an available spendable wallet balance as authority, or fix source data by projection edit. Admin buttons route to owner services; projection freshness is visible.

```ts
type ProjectionCheckpointV1 = {
  projectionName:string; schemaVersion:Revision; generation:UUID;
  producer:string; streamId:string; lastAppliedEventId?:UUID;
  contiguousAggregateRevisions: { aggregateId:UUID; revision:Revision }[];
  asOf:UTC; observedThrough?:UTC; state:'CURRENT'|'LAGGING'|'GAP'|'REBUILDING'|'FAILED';
};
type ReportViewV1 = { reportId:string; queryHash:string; scope:Scope;
  period:{startInclusive:UTC;endExclusive:UTC;timezone:string};
  sourceCheckpoints:ProjectionCheckpointV1[]; generatedAt:UTC;
  currencies: {currency:string;exponent:number;totalsMinor:string}[];
  quality:'COMPLETE'|'PARTIAL'|'STALE'; rows:unknown[] };
type ExportRequestV1 = CommandMeta & { reportType:string; scope:Scope;
  period:{startInclusive:UTC;endExclusive:UTC;timezone:string}; format:'CSV'|'PDF';
  fieldSet:string; purposeCode:string; expectedProjectionGeneration:UUID;
  acceptedPolicyRef:ResourceRef };
type ExportJobV1 = { exportId:UUID; revision:Revision; state:
  'QUEUED'|'GENERATING'|'READY'|'FAILED'|'EXPIRED'|'REVOKED';
  requestedBy:UUID; purposeCode:string; sourceGenerations:UUID[]; expiresAt:UTC;
  objectId?:UUID; checksum?:string; rowCount?:number };
```

Production response cannot expose unbounded per-aggregate checkpoint arrays; the pseudotype describes checkpoint facts. E registers bounded diagnostic summaries and authorized per-aggregate cursor queries. RabbitMQ delivery tag is channel-local and **not** a durable replay offset. Store event/inbox IDs and contiguous aggregate revisions/stream owner cursors provided by contract; `occurredAt` alone cannot prove no lost events. Snapshot/replay source must be defined by producer, not synthesized by Reporting's scan of other databases.

Projection processing transaction records `(consumerName,eventId,payloadHash)` + local aggregate revision + checkpoint + derived effect. Foundation currently keys inbox per event ID for one probe consumer; adding multiple named consumers to one DB requires explicit namespaced inbox migration or isolated processing topology. Duplicate ID bytes no-op; altered bytes integrity DLQ; old revision ignored as duplicate-history after source verification; gap buffers bounded events/marks incomplete and invokes authorized producer snapshot/replay. Unknown major → DLQ/degraded, no silent acceptance.

Corrections: source owner publishes new aggregate revision and supersedes original source event/record through registered correction contract or provides authoritative snapshot. Reporting records correction provenance, reverses prior contribution then applies corrected contribution atomically; money entries reflect Billing reversals/posted facts and remain separate per currency. It does not edit a payment or emit a financial success. Erasure/redaction owner commands update permitted projections and remove sensitive indexes within approved hold/retention policy; immutable financial/audit facts follow separately approved legal requirements. No arbitrary “reconcile” button writes all domains.

Rebuild: new projection generation in isolated local tables from accepted source replay/snapshots, with redaction corrections included; no re-emitting notifications/refunds/booking commands. Verify checkpoint coverage and compare aggregate invariants, then atomic read-pointer switch. Old generation retention follows DEC-D-06. Queries/export pinned to generation remain consistent or return `409 PROJECTION_GENERATION_CHANGED` rather than mixing revisions. Failure preserves old generation as visibly stale; rebuild cannot fabricate completeness.

Candidate `/internal/v1/reporting`: `GET /reports/:type` scoped grant, bounded query and fieldset; `GET /projection-status`; `POST /exports` requires proposed `reporting.export` + field-level grant/purpose policy/step-up; `GET /exports/:id` restricted requester/delegated scope; `POST /exports/:id/revoke` with revision; `POST /exports/:id/download` fresh authorization creates short-lived Media read capability. Proposed download TTL 60s and job-object expiry 24h are DEC-D-06/14/16 open; no public permanent URL. “Export PDF” click is a queued receipt until READY, never successful file creation before object finalization.

Sensitive fieldset allowlist excludes passwords, OTP, cookies, raw identity documents, payment proof images, precise tracking, messages and complaint text by default. Financial detail requires Finance plus report purpose/scope; identity audit search requires explicit security/audit grant; Operations receives minimum operational projection. Export query, requester, purpose, accepted policy, fieldset, generation/checkpoints, row count/checksum, creation/download/revocation audit are recorded. Recheck grants at worker start, before READY and each download; revoked/expired access cancels or revokes capability. CSV formula injection escaped; PDF content rendered as text; no arbitrary client HTML/URL fetch. Media owns private object/storage/finalization/deletion/access checks, Reporting owns job and permitted content.

Timeout while generating leaves same export operation pending; client can query. Media/upload failure -> FAILED with cleanup of run-owned partial object through Media command; already completed object reference never reuses across unauthorized job. No export by emailing another recipient unless separately authorized. Export stale/partial policy thresholds DEC-D-14/16; if allowed, file records source asOf/quality/market/timezone/currency, otherwise block generation with typed state, not an invented zero total.

Catalog `reporting.projection-refreshed.v1` candidate `{projectionName,generation,schemaVersion,asOf,quality}`; checkpoint debug/private identifiers not public broadcast. Correction/rebuild/export events require E review separately.

Tests: foreign producer/unknown major; duplicate/hash-conflict/out-of-order/gap; crash around commit/ACK; delayed correction/hide/refund reversal exactly once; per-currency totals and timezone boundary; erased PII after rebuild; missed source window marked partial; two rebuild generations/pointer switch; no side effects during replay; revoked export worker/download; cross-market/fieldset purpose; CSV injection/PDF escaping; TTL/private-object finalization and partial upload cleanup; stale report cannot authorize refund or work. Dependencies DEC-D-04/06/09/14/15/16/17, registered owner events/snapshot/corrections/ACLs, namespaced inbox, real Media and projection runtime/migrations; explicit owner evidence remains separate from business acceptance.

## 9. E handoff and implementation order

| Order | Required accepted change by E/owner | Why D cannot implement it here |
|---|---|---|
| 0 | Publish `BASE_W01`, accepted registry, decision revisions, current source status and owner merge order. | Observed main is provenance, not an approved shared base; all CP IDs remain proposals. |
| 1 | `@carwash/contracts`: V2 Identity views/admin commands, scoped grants, common validation/receipt/error adapters; `@carwash/api-clients`: bounded authenticated clients and contract fixtures. | Shared packages have one designated writer; API clients is currently empty and grants/routing are not general admin capability. |
| 2 | Identity owning migrations/audit/idempotency/governance/bootstrap/invitation; actual optional step-up. Gateway strip/forward/CSRF/V2 routing verified. | Existing F006 foundation does not implement new proposals; V1 migration and no-bypass tests required. |
| 3 | Configuration typed namespace schema/OpenAPI, validation clients, runtime identity/DB/migrations/health/broker ACL/artifact, owner validators. | Configuration directory skeleton cannot be called running or ready; current service catalog business APIs remain planned. |
| 4 | `@carwash/event-contracts` / AsyncAPI registry: accepted owner event types, exact serializers/parsers and snapshot/gap/correction compatibility; platform broker topology. | Planned event names are not published schemas or authenticated producers. |
| 5 | `@carwash/security-kit`: service identity verification and scoped auth transport; `@carwash/service-kit`: technical idempotency/audit/deadline hooks; `@carwash/platform-messaging`: accepted namespaced inbox/lease and recovery support as needed. | Keep policy/business invariants in owner application/domain, not shared packages; preserve existing tests/semantics and service DB isolation. |
| 6 | Owners implement Communications/Support/Reviews/Reporting after actual Customer/Booking/Dispatch/Media/Billing source contracts; Admin wires approved states through typed clients. | D neither writes shared/runtime/source files nor claims hypothetical integration tests run. |
| 7 | Registered provider/consumer, DB/broker/HTTP/browser/visual evidence at final SHA; migrations/compatibility/rollback and decision refs. | Documentation/static guard PASS is not product implementation or deployment proof. |

Package revisions are not selected here: E chooses accepted semver after compatibility review. Proposed new fields cannot be silently added to strict V1 schemas. Each provider ships supported-major metadata/fixtures and a coexistence/deprecation window; consumers parse both only where explicitly supported. An unknown policy/event major keeps feature disabled or read model degraded, rather than guessing semantics. Compatibility matrix must list independently deployed provider/consumer versions and actual evidence SHAs, not a single “all green” claim.

E remains the permanent designated owner/writer of shared packages and shared root configuration, CI and infrastructure. The temporary W01 technical bootstrap exception for cross-owner app/service paths ends at a verified `BASE_W02`; after that, changes outside E's permanent ownership require a separately accepted exact exception/lease. A W01 bootstrap allowance never extends automatically into W02. This work performs no shared or cross-owner runtime write.

W01-D document acceptance can verify provenance, completeness, path ownership and frozen-reference guards. Runtime acceptance begins only after decisions and E registry are accepted and code exists. No tests in this proposal are described as executed.
