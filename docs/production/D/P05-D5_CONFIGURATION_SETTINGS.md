# P05-D5: Configuration conforms to configuration.v1 (admin settings backend)

Parent task: P05-D (Lane D). Status of the parent: **INTEGRATION_PENDING**.
`BUSINESS_READY` stays `false`. Real Identity grants no `configuration.*` permission,
there are no Gateway routes, no deployed relay process and no broker producer identity.
Nothing here is production-ready, deployed or fully integrated.

## Scope

- The Configuration service now implements Lane E's published `configuration.v1`
  (`packages/contracts/src/configuration/v1.ts`) and emits the registered
  `configuration.configuration-published.v1` event (`packages/event-contracts/src/business-v1.ts`).
- This resolves the owner side of CR-D-P01-06. The market and namespace wire model wins,
  and the P01-D3 environment/tenant model is kept as a **superseded** expand-step surface.
- Staff read routes support the approved admin screen «الإعدادات». D6 ports that screen.

## Design

### Model (migration `20261011090000_p05d_configuration_v1`, additive only)

| Table | Rule |
| --- | --- |
| `config_scope` | One row per `(market_id, namespace)` (unique). `id` is the event aggregate id (`configuration-scope`). `published_version` starts at 0. A trigger lets it move only by exactly +1 and keeps the scope identity immutable. Rows are never deleted |
| `config_draft` | Columns: `revision` (optimistic token for approve/publish/withdraw), `status` `DRAFT→APPROVED→PUBLISHED` or `→WITHDRAWN`, `base_version` (= `expectedVersion`, `NULL` for the first), content, sha256 `content_hash`, author, approver, publisher and withdrawer with their timestamps. **CHECK** `approved_by <> author_subject` keeps four eyes in the database too. **CHECK** requires the facts of each state. A **partial unique index** allows at most one open draft (`DRAFT`/`APPROVED`) per scope. Rows are never deleted |
| `config_version` | Immutable published versions. `UNIQUE(scope_id, version)` and `UNIQUE(draft_id)`. Holds content, hash, `effective_at`, publisher. Triggers refuse UPDATE/DELETE/TRUNCATE |
| `config_history` | Append-only `DRAFT_CREATED/APPROVED/PUBLISHED/WITHDRAWN` with actor, draft revision, version (publish only, CHECK), content hash, `reason` (nullable, see CR-D-P05-D5-03), correlation id, `occurred_at` and `seq` (BIGSERIAL paging cursor). Never holds content |
| `config_idempotency` | PK `(actor_subject, idempotency_key)`, plus operation, sha256 fingerprint, status and response. Written in the command's transaction and append-only |
| `outbox_message` | Same shape and lease columns as the catalog/booking outboxes |

The P01-D3 tables (`config_revision/review/pointer/audit`) are untouched. Their append-only
revokes still hold. The new history tables get the same discovered-grantee revoke and
**triggers**, which still refuse rewrites after a provisioning replay grants DML again
(proved in V1-R4). `hardenPrivileges` does not name them yet (CR-D-P05-D5-06).

### Commands (one local ACID transaction each)

1. A transaction-scoped advisory lock on `(actor, Idempotency-Key)` makes a concurrent retry
   wait and then **replay**.
2. A known key with the same fingerprint replays the stored status and body (header
   `idempotency-replayed: true`). A different fingerprint gives `409 IDEMPOTENCY_CONFLICT`.
   The fingerprint is sha256 of the canonical JSON `{v:1, contract:'configuration.v1',
   operation, actor, target, body}`, the published `idempotencyMaterial`.
3. The domain rule runs under row locks. Lock order is always scope, then draft, so there is no
   deadlock cycle. Rule failures roll everything back and store nothing; retrying re-evaluates.
4. Each command appends a history row, stores the outcome, and on publish inserts
   `config_version`, CAS-moves `published_version`, and writes the outbox row.

`createDraft` locks the scope row. `expectedVersion` (null = 0) must equal `published_version`
(else `412 VERSION_CONFLICT`), and the scope must have no open draft (else `409 DRAFT_ALREADY_OPEN`).
`approve` needs the right `expectedRevision` (else `412 REVISION_CONFLICT`), an open draft
(else `409 DRAFT_CLOSED`) that is not already approved (`409 DRAFT_ALREADY_APPROVED`), and an
approver who is not the author (`422 SELF_APPROVAL_FORBIDDEN`).
`publish` needs the right revision and an `APPROVED` draft (else `409 DRAFT_NOT_APPROVED`) whose
`base_version` still equals `published_version` (`409 DRAFT_BASE_STALE`). The new version is
`published_version + 1`, and `effectiveAt` is the injected clock at publish (the contract body
has no requested time). `withdraw` (owner-local) closes an abandoned open draft so the scope is
free again.

`contentHash` is sha256 (lowercase hex) of the **canonical JSON of the namespace content object**
(the published `canonicalJson`). The contract fixes only the format, so this definition is
requested in CR-D-P05-D5-02.

`getCurrent` reads the scope counter and its version in one REPEATABLE READ snapshot. It
re-validates the content with the parsers and re-checks the hash: a corrupt row gives a
redacted 500 and is never served. With nothing published it returns
`404 POLICY_UNAVAILABLE`, never a default.

### Contract consumption

`services/configuration` may not depend on `@carwash/contracts` or
`@carwash/platform-messaging` yet: that is a lockfile change owned by Lane E (CR-D-P01-03,
CR-D-P05-D5-01). `domain/configuration-v1.ts` therefore restates the published parsers
one-to-one. **V1-C1** feeds a matrix of 151 bodies plus marketId, transition and canonical-JSON
samples through the COMPILED published parsers and the owner parsers, and fails on any
difference in result, code or path.

The event is built from the published `CONFIGURATION_PUBLISHED_V1` (already a dependency) and
validated with its `parse` before the outbox row is written. The outbox store structurally
implements `OutboxStore`, and the SHARED `OutboxRelay` drives it (booking precedent).

### Authorization matrix

| Route (prefix `/internal/v1/configuration`) | Access | Real Identity today |
| --- | --- | --- |
| `GET /scopes/:marketId/:namespace/current` | `service:configuration.read`: `x-service-client` + `x-service-token` checked by the service-kit `ServiceClientAuthenticator` against digests in `CONFIGURATION_SERVICE_CLIENTS` (absent = nobody) | staff bearer = 401 |
| `POST /scopes/:marketId/:namespace/drafts` | `configuration.write` + Idempotency-Key | 403 for every role |
| `POST /drafts/:draftId/approve` | `configuration.approve` + key, approver ≠ author | 403 |
| `POST /drafts/:draftId/publish` | `configuration.publish` + key | 403 |
| `POST /drafts/:draftId/withdraw` (owner-local) | `configuration.write` + key | 403 |
| `GET /scopes/:marketId/:namespace` (overview) | `configuration.read` | 403 |
| `GET /scopes/:marketId/:namespace/versions?limit≤50&beforeVersion` | `configuration.read` | 403 |
| `GET /scopes/:marketId/:namespace/history?limit≤50&beforeSeq` | `configuration.read` | 403 |
| `GET /scopes/:marketId/:namespace/diff?from&to` | `configuration.read` | 403 |
| `GET /drafts/:draftId` | `configuration.read` | 403 |

Sessions are verified by Identity (`GET /internal/v1/identity/session`, 2 s deadline, fail
closed). Without `IDENTITY_ORIGIN` the service still boots and answers `503 AUTH_UNAVAILABLE`
(`UnconfiguredSessionAuthority`). A forwarded `x-auth-subject` that disagrees with Identity
gives 401. Per-replica budgets per subject or client apply: 30 commands, 240 staff reads and
600 service reads per minute. They can be overridden with `CONFIGURATION_RATE_*_PER_MINUTE`;
invalid values fail the boot. The budget is not distributed. Errors use the service-kit envelope
`{error:{code,message,correlationId,status}}`. Validation messages name a field path, never a
value.

**Superseded P01-D3 routes** (`/values/...`, `/revisions...`) are kept unchanged as the expand
step: nothing consumes them, removing them is a separate contract step, and their tables carry
audited history. They are not offered to D6.

## Exact staff response shapes (for D6)

`DraftView`, from createDraft (201), approve, withdraw and `GET /drafts/:id` (200):
```json
{"draftId":"uuid","marketId":"sy","namespace":"booking.policy.v1","revision":1,
 "status":"DRAFT|APPROVED|PUBLISHED|WITHDRAWN","baseVersion":null,
 "content":{...namespace content...},"contentHash":"64 hex","authorSubject":"uuid",
 "createdAt":"ISO","approvedBy":null,"approvedAt":null,"publishedBy":null,
 "publishedAt":null,"publishedVersion":null,"withdrawnBy":null,"withdrawnAt":null}
```
Publish (200): `{"draft":DraftView,"published":PublishedConfigurationV1}`.
`PublishedConfigurationV1` (also `getCurrent`):
`{"marketId","namespace","version","effectiveAt","contentHash","content"}`.

Overview:
`{"marketId","namespace","publishedVersion":0,"current":PublishedConfigurationV1|null,"openDraft":DraftView|null}`.

Versions:
`{"marketId","namespace","items":[{"version","draftId","contentHash","effectiveAt","publishedBy","publishedAt","content"}]}`
(newest first).

History:
`{"marketId","namespace","items":[{"id","seq":"decimal text","action","draftId","draftRevision","version":number|null,"contentHash","actorSubject","reason":null,"correlationId","occurredAt"}]}`
(newest first; next page `beforeSeq=<last seq>`).

Diff:
`{"marketId","namespace","from":VersionItem,"to":VersionItem,"changes":[{"field","from","to"}]}`.
It returns 404 if either version is missing.

Command responses carry `idempotency-replayed: true|false`.

Error codes D6 must handle:
- `AUTH_REQUIRED` 401, `AUTH_FORBIDDEN` 403, `AUTH_UNAVAILABLE` 503
- `IDEMPOTENCY_KEY_REQUIRED` and `IDEMPOTENCY_KEY_INVALID` 400 (key `^[A-Za-z0-9_-]{16,128}$`)
- `VALIDATION_FAILED` 422 (message `CODE at $.path`), `SECRET_NOT_CONFIGURATION` 422
- `VERSION_CONFLICT` and `REVISION_CONFLICT` 412
- `DRAFT_ALREADY_OPEN`, `DRAFT_CLOSED`, `DRAFT_ALREADY_APPROVED`, `DRAFT_BASE_STALE`, `DRAFT_NOT_APPROVED` 409
- `SELF_APPROVAL_FORBIDDEN` 422, `IDEMPOTENCY_CONFLICT` 409, `NOT_FOUND` 404, `RATE_LIMITED` 429

## Settings mapping for D6 (approved admin «الإعدادات»)

| Prototype control (A:L130) | Maps to | Status |
| --- | --- | --- |
| المنطقة الزمنية `<select>` Asia/Riyadh, Europe/Stockholm | `market.presentation.v1.timezone` | **Conflict**: the contract allows only `Asia/Damascus`, so neither reference option is valid. The visible options need an owner decision (CR-D-P05-D5-08). D6 must not submit the reference values |
| عملة المنصة `<select>` SAR, USD, SYP | `market.presentation.v1.currency` | USD and SYP are supported. **SAR is not in the contract** (CR-D-P05-D5-08) |
| مدة الحجز المؤقت «10 دقائق» | `booking.policy.v1.holdTtlSeconds` (minutes × 60; 60–3600 s) | Supported |
| الحد الأقصى للتأخير «20 دقيقة» | none: configuration.v1 has no lateness field (`maxLatenessMinutes` is refused as `UNEXPECTED_FIELD`) | **Unsupported**, read-only or pending (CR-D-P05-D5-09) |
| Roles list: Super Admin 3, Operations 7, Finance 4, Support 9 | Identity owns roles and memberships, and has no member-count read | **Read-only/unsupported**; counts are prototype data (CR-D-P05-D5-10) |
| حفظ التغييرات | `createDraft` per changed namespace (`expectedVersion` = overview `publishedVersion` or null) | Approve and publish have no approved screen. They need a second person and separate design acceptance |

`createDraft` needs the **complete** namespace content. Fields without a prototype control
(`quoteTtlSeconds`, `minLeadMinutes`, `horizonDays`, `slotStepMinutes`,
`cancellationCutoffMinutes`, `defaultLocale`) must be carried over unchanged from
`overview.current.content`. While nothing is published, D6 cannot form a valid draft from the
screen alone and must show the policy as not configured. It must not invent defaults.

## Events

Emitted: `configuration.configuration-published.v1`, envelope v2, exchange
`configuration.events`, routing key = event type.
- `aggregate {type:'configuration-scope', id: scope uuid, version}`
- `actor {kind:'account', id: publisher}`
- `data {marketId, namespace, contentHash, effectiveAt}` and nothing else (no content)
- `causationId` null; `traceparent` forwarded only when valid

Delivery is **at least once**. Competing relays lease disjoint rows (SKIP LOCKED). A relay that
dies after leasing loses nothing. A relay stalled past its lease can publish a duplicate with
the **same eventId**; its fenced `markPublished` returns false and the row is finalised once.
This is measured in V1-M4. Consumers must deduplicate by `eventId`.

Consumed: none.

## Commands and results

Real-infra evidence: `docs/production/D/evidence/p05-d5-real-infra.json` (sourceSha 6be422b, tree b1348ee, sourceDirty false, 23/23 = 9 legacy P01-D3 + 14 v1).

| Family | Command | Result |
| --- | --- | --- |
| Domain + application specs | `node --test services/configuration/dist-tests/test/*.spec.js` | PASSED 27/27 |
| Typecheck/build | `pnpm --filter @carwash/configuration typecheck/build/build:tests` | PASSED |
| Real PostgreSQL + RabbitMQ + real Identity | `run-real-infra.mjs --suite configuration` | PASSED 23/23 (V1-C1, A1, A2, L1, L2, R1–R4, M1–M5 + legacy H1–H9) |
| Lint / prettier / layers / boundaries / migrations / design reference | `eslint`, `prettier --check`, `check-layers`, `check-boundaries`, `check-migrations`, `check-design-reference` | PASSED |

## Real versus stubbed

- **Real:** the compiled Nest app, PostgreSQL 16 with the runtime role, Identity (deny paths:
  customer, operations, finance and super-admin all get 403; super-admin's bearer is not a
  service credential), RabbitMQ 4 with confirms, the shared relay, and the published parsers as
  the oracle.
- **Stub, labelled:** a loopback Identity session server for positive staff paths, because no
  real role holds `configuration.*`.
- **Created in-test:** the producer user `cw_configuration_app`, with exactly the requested ACL,
  and the `configuration.events` exchange (declared by the infrastructure identity). Both are
  removed after the run.

## Security and privacy

- Deny by default; four eyes in the application and as a DB CHECK.
- No content values in events, history or logs (hashes only).
- Closed namespaces (integers and enumerations), so no secrets can be expressed, plus the
  `SECRET_NOT_CONFIGURATION` guard.
- Service tokens are stored as digests only and compared in constant time.
- Append-only history survives provisioning replays.

## Rollback and compensation

The migration is additive. Rolling back means redeploying the previous image: the new tables
are ignored and the P01-D3 routes are untouched. A bad published policy is fixed by a **new**
reviewed draft and publish (forward rollback), never by rewriting a version. Unpublished outbox
rows stay pending until a relay runs and are never lost.

## Contract requests

- **CR-D-P05-D5-01:** add `@carwash/contracts` and `@carwash/platform-messaging`
  (`workspace:*`) to `services/configuration` (lockfile). Then delete the restated parsers,
  import the published ones, and add a relay process (`relay.runner`) like catalog's.
- **CR-D-P05-D5-02:** pin in `configuration.v1` that
  `contentHash = sha256(canonicalJson(content))`, where content is the namespace object only.
- **CR-D-P05-D5-03:** add optional `reason: string(10..500)|null` to the createDraft, approve and
  publish bodies (`configuration.v1` minor). History stores `null` until then.
- **CR-D-P05-D5-04** (refreshes CR-D-P01-01): add the permissions `configuration.read`,
  `configuration.write`, `configuration.approve` and `configuration.publish` to
  `IDENTITY_PERMISSIONS`. Role mapping:
  - `super-admin`: all four (four eyes still needs two different super-admins).
  - `operations`: `configuration.read` and `configuration.write`, so it drafts.
  - `finance`: `configuration.read` and `configuration.approve`, so it approves market and
    currency policy.
  - `support`: `configuration.read`.
  - `configuration.publish`: super-admin only.

  Writer and approver are thereby different roles (operations drafts, finance approves).
- **CR-D-P05-D5-05:** broker bootstrap. Producer `cw_configuration_app` with configure and write
  on `^configuration\.events$` and read `^$`, plus the topic exchange `configuration.events`
  (durable). Subscriber read grants as consumers appear.
- **CR-D-P05-D5-06:** add `config_version`, `config_history` and `config_idempotency` to the
  history-revoke lists in `scripts/acceptance/lib/migrations.mjs` (`hardenPrivileges`) and
  `infra/postgres/provision.sh`. The triggers already hold.
- **CR-D-P05-D5-07:** Gateway admin routes (owner `configuration`), each listed as
  method, path → upstream, permission, idempotency:
  - `GET /admin/configuration/scopes/{marketId}/{namespace}` → `/internal/v1/configuration/scopes/{marketId}/{namespace}`, `configuration.read`
  - `GET .../versions`, `.../history` and `.../diff` → same suffixes, `configuration.read`
  - `GET /admin/configuration/drafts/{draftId}`, `configuration.read`
  - `POST /admin/configuration/scopes/{marketId}/{namespace}/drafts`, `configuration.write`, idempotency required
  - `POST /admin/configuration/drafts/{draftId}/approve`, `configuration.approve`, idempotency required
  - `POST /admin/configuration/drafts/{draftId}/publish`, `configuration.publish`, idempotency required
  - `POST /admin/configuration/drafts/{draftId}/withdraw`, `configuration.write`, idempotency required

  The Gateway already forwards the 409/412/422 reasons `SELF_APPROVAL_FORBIDDEN` and
  `DRAFT_NOT_APPROVED`.
- **CR-D-P05-D5-08 (owner decision):** the reference timezone options (Asia/Riyadh,
  Europe/Stockholm) and currency SAR are not in the contract enums. Either extend
  `BUSINESS_TIME_ZONES` and `CURRENCIES`, or approve the visible option change for D6.
- **CR-D-P05-D5-09:** «الحد الأقصى للتأخير» needs a field. Proposal: `booking.policy.v1` stays
  closed, so add `maxLatenessMinutes` (0–240) in a `booking.policy.v2` or a
  `dispatch.policy.v1` namespace. Which owner enforces lateness is a product decision.
- **CR-D-P05-D5-10:** an Identity read of role membership counts for the settings roles card
  (`GET /internal/v1/identity/roles/summary`, permission `identity.roles.assign`), or keep the
  card as pending.

## Remaining blockers

Identity permissions (04), Gateway routes (07), lockfile and relay process (01), broker
bootstrap (05) and the owner decisions (08–10). The workload identity platform is still pending;
service clients are the P04-E3 interim mechanism.

## Next consumer

admin-web D6 calls the staff routes through a candidate Gateway patch implementing
CR-D-P05-D5-07, using the mapping and shapes above.
