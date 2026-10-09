# P02-A2 — Vehicle service conforms to `vehicle.v1`

Lane A, child sprint 2 of P02-A ("Connect customer booking steps to real
customer/catalog/geo/pricing/scheduling APIs"). This child makes the Vehicle
owner service a provider of the published `vehicle.v1` contract, so the
customer app's vehicle step can later consume it through a typed client. It
does not touch the customer app, the gateway or any shared package.

| Item | Value |
| --- | --- |
| Base | `origin/main` `566d2e7435dac0803d075556fff43c435f8a29a7` (tree `1bd162f2578878643b3e2c2cc437fece36716588`) |
| Tested head | `032fd2791df4844e7fd1c6356aa50234bbf9c341` (tree `39be788cbbf8a926ad60c2df0e4a0bfc7e9f1256`) |
| Later commits | documentation and the evidence JSON only (no source change) |
| Contract | `vehicle.v1` from `@carwash/contracts@0.1.0` (P01-E1), status `published-provider-pending` |
| Event | `vehicle.vehicle-updated.v1`, envelope v2, `@carwash/event-contracts@0.1.0` |
| Migration | `20261008100000_p02a2_vehicle_contract_v1` (expand-only) |
| Evidence | `docs/production/A/evidence/cw-p01a-dd857e126002.json` (`PASSED`, 25/25, dirty tracked files 0) |

## What changed

### HTTP surface (`/internal/v1/vehicle`)

The controller serves exactly the contract's route table; a test reads Nest's
route metadata and compares it with `VEHICLE_V1.routes`.

| Route | Behavior |
| --- | --- |
| `GET /mine?limit&cursor` | Active vehicles, `(createdAt, id)` keyset. Default 20, max 100. Opaque base64url cursor. Any other query parameter is `REQUEST_INVALID`. |
| `POST /mine` | `Idempotency-Key` required. Closed `VehicleInputV1`. 201 + `ETag`. |
| `PATCH /mine/:vehicleId` | `Idempotency-Key` + `If-Match` required. Full replacement of `VehicleInputV1`. An identical replacement keeps the revision. |
| `POST /mine/:vehicleId/archive` | `Idempotency-Key` + `If-Match` required. No body, or `{}`. Archiving an archived vehicle returns it unchanged. |
| `POST /vehicle-snapshots/resolve` | `service:vehicle.snapshot.resolve`. Use case implemented; **the route refuses every caller** (see blockers). |

Removed P01 routes: `POST /`, `GET /:vehicleId`, `PATCH /:vehicleId`,
`POST /:vehicleId/archive` and `?includeArchived`. No consumer used them: the
gateway has no vehicle route, and the customer app uses no network.

### Errors

Every `vehicle.v1` route answers in the E1 envelope
`{error:{code, reason, message, requestId, correlationId, retryable, retryAfterMs, issues[]}}`.
That includes malformed or oversized JSON rejected by the body parser before
routing. A controller-scoped filter takes precedence over the platform filter
that `bootstrapService` registers.

| Refusal | Code (status) | Reason / issues |
| --- | --- | --- |
| Body field invalid | `VALIDATION_FAILED` (422) | `issues:[{field:"$.plate.text", code:"INVALID_LENGTH"}]`, using the contract parser's issue codes |
| Bad header, query or JSON | `REQUEST_INVALID` (400) | `issues:[{field:"header.if-match", ...}]` |
| Not owned, or missing | `NOT_FOUND` (404) | `VEHICLE_NOT_FOUND` |
| Edit of an archived vehicle | `CONFLICT` (409) | `VEHICLE_ARCHIVED` |
| Active limit reached | `BUSINESS_RULE_VIOLATION` (422) | `VEHICLE_LIMIT_REACHED` |
| Key reused with a different body | `IDEMPOTENCY_CONFLICT` (409) | — |
| Key missing / `If-Match` missing | `IDEMPOTENCY_KEY_REQUIRED` / `REVISION_REQUIRED` (428) | — |
| Stale revision | `REVISION_CONFLICT` (412) | — |
| Identity unreachable or invalid | `DEPENDENCY_UNAVAILABLE` (503, `retryable: true`) | — |

Messages are fixed English diagnostics and never echo a refused value.

### Domain

- `VehicleInputV1` = `{type, make, model, color, nickname, plate: {text, region} | null}`.
  It is a closed object: every key is required and unknown keys are refused.
- Plate text is normalized exactly as `normalizePlateText` (NFC, trim,
  collapse whitespace, uppercase) and then must match the contract alphabet.
  - The alphabet is uppercase Latin letters, Arabic letters, ASCII and
    Arabic-Indic digits, and `-`, with a maximum of 12 characters.
  - A digit is no longer required, and Arabic-Indic digits are kept as typed.
  - The plate stays optional and has **no** uniqueness, globally or per owner.
- `MAX_SAVED_VEHICLES = 10` active vehicles, from the contract. The P01
  `VEHICLE_MAX_ACTIVE_VEHICLES` environment variable is removed.
- **Provider strictness (declared semantic difference).**
  - Free text (`make`, `model`, `color`, `nickname`, `region`) is stored
    trimmed with inner whitespace collapsed. Whitespace-only text is refused,
    and C1 controls are refused.
  - The contract parser accepts both of these. The provider never accepts
    anything the contract parser refuses, and everything it emits parses.
  - A corpus test proves both directions.
- Snapshot: `captureSnapshot` builds `VehicleSnapshotV1` with source `saved`.
  - An archived vehicle resolves only for `booking-display`, never for quote
    or create.
  - Ownership is checked by principal kind **and** subject.
  - The read is audited with the calling service and its purpose.

### Identity

- The session parser now takes `principalKind` from Identity (P01-E3) instead
  of hard-coding `account`.
- It fails closed in three cases: a view without a valid kind, a view without
  a `roles` array, and a guest view with roles.
- Real guest sessions are exercised end to end.

### Persistence (migration `20261008100000_p02a2_vehicle_contract_v1`)

Expand-only. No row is rewritten or deleted and no column is renamed.

- **New columns.** Adds the nullable columns `make`, `model` and `plate_region`.
  Widens `color` to `VARCHAR(40)` (no table rewrite).
- **Nickname storage.** `display_name` keeps holding the name, now mapped to
  `nickname` in Prisma.
- **Plate check.** Replaces `vehicle_plate_check` (P01: digit required, no
  Arabic-Indic digits) with `vehicle_plate_v1_check ... NOT VALID`. Adds
  `vehicle_nickname_v1_check ... NOT VALID` (40 characters). Both apply to
  every new or updated row.
- **Fully valid checks.** `vehicle_make_check`, `vehicle_model_check` and
  `vehicle_plate_region_check` (a region requires a plate).
- **Index.** `vehicle_owner_page_idx` on `(owner_kind, owner_subject, status, created_at, id)`.
- **Audit.** `audit_entry` gains `actor_kind` (default `principal`),
  `actor_service` and `purpose`. Subject and session become nullable under
  `audit_entry_actor_check`: a principal row needs subject + session, and a
  service row needs service + an allowed purpose. The append-only trigger
  stays as it is.

**Data conformance before serving traffic.** P01-A2 was never deployed, but a
database that holds P01 rows must report zero from this query before this
release serves it. Then run `VALIDATE CONSTRAINT` for both NOT VALID checks in a
reviewed step:

```sql
SELECT count(*) FROM app.vehicle
WHERE (plate IS NOT NULL AND (char_length(plate) > 12
       OR plate !~ '^[A-Z0-9٠-٩ء-ي-]+( [A-Z0-9٠-٩ء-ي-]+)*$'))
   OR (display_name IS NOT NULL AND char_length(display_name) > 40);
```

The read mapper never rewrites a stored value.

### Events and outbox

- **Envelope.** `vehicle.vehicle-updated.v1` is written in envelope v2:
  - `aggregate {type:'vehicle', id, version: revision}`
  - `actor {kind: account|guest, id: subject}`
  - `data {change: CREATED|UPDATED|ARCHIVED}`
- **Exchange.** The exchange is `vehicle.events`, matching the AsyncAPI channel.
- **Validation.** Each event is parsed with the published `VEHICLE_UPDATED_V1`
  parser before insert, so a drifting shape aborts the transaction.
- **Not published yet.** The relay still needs Lane E's
  `@carwash/platform-messaging` dependency (A-P01-03), so rows stay pending.
  No broker is exercised here.

### Idempotency

- **Key.** A key is required on every mutation, including archive.
- **Scope.** The scope is `vehicle.v1:<kind>:<subject>`.
- **Fingerprint.** SHA-256 of canonical JSON
  `{v:1, contract, operation, actor, target, body}` (the E1
  `idempotencyMaterial` shape).
  - The body is the parsed input; updates and archives include the expected
    revision.
- **Retention.** 24 hours, with the existing purge job.
- **Concurrency.** Concurrent duplicates serialize on an advisory lock and
  replay the first result.
- **Mirrored helper.** `canonicalJson` is mirrored in the service until it may
  depend on `@carwash/contracts` (A-P02-01).

## Evidence

All commands ran in the isolated worktree on the tested head unless noted.

| Command | Result | Dependencies |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | PASS, lockfile unchanged | — |
| `pnpm build:packages`, identity/vehicle `generate` + `build` | PASS | — |
| `pnpm --filter @carwash/vehicle typecheck` | PASS | — |
| `pnpm --filter @carwash/vehicle test:unit` | PASS, 30/30 (domain, application with in-memory ports, Identity session parsing against a loopback HTTP stub, Nest transport incl. envelope under the platform filter) | none real |
| `node --test tests/production/A/vehicle.contract.test.mjs` | PASS, 5/5 (route table, input corpus both directions, page/snapshot/error parsing) | built published parsers |
| `node scripts/production/A/acceptance-a.mjs --services vehicle` | **PASS, 25/25** (includes the 5 contract tests) | real PostgreSQL 16.10 (least-privilege roles, migration identity ≠ runtime identity), real Identity Nest app + Redis 8.2.10, real vehicle HTTP adapter |
| `npx eslint` on changed files | PASS | — |
| `node scripts/check-design-reference.mjs` | PASS (reference unchanged) | — |
| `pnpm check:boundaries` | PASS | — |
| `node scripts/check-migrations.mjs --base-ref origin/main` | PASS | — |

The real-infrastructure suite proves the following:

- **Contract and auth.**
  - Every 2xx body parses with the published `parseVehicleV1`, page or
    snapshot parser.
  - Every error parses with `parseApiErrorEnvelope`, has the contract status,
    and uses an allowlisted reason.
  - Anonymous, forged and revoked sessions are refused, and cookie writes
    without CSRF are refused.
  - A real **guest** session creates and lists its own vehicles, and the event
    actor is `guest`.
- **Ownership and concurrency.**
  - Ownership returns 404 to another account and to a guest.
  - With 8 concurrent creates on one key, one vehicle and one event are
    created, and the other 7 are replays.
  - Key reuse with a different body returns 409.
  - Expiry and the TTL boundary behave correctly, and purge works.
  - Concurrent revision edits produce one winner.
- **Archive, limits and pages.**
  - Archive is idempotent and read-only after archiving.
  - The 10-vehicle limit holds under 13 concurrent creates, and refused writes
    leave no key.
  - Keyset paging covers 7 vehicles in 3 pages, and a cursor never crosses
    owners.
  - The snapshot route is closed and no service audit row is written.
- **Database and isolation.**
  - Database CHECKs enforce plate, region, audit-actor and archive invariants;
    both NOT VALID constraints are present and unvalidated.
  - Outbox rows parse with the published event parser and carry no
    plate/name/colour.
  - The runtime role cannot reach the Identity database.
  - An Identity outage returns a retryable 503 and writes nothing.

**Not exercised:** broker relay or consumers, the gateway, a browser, a
production deployment, and workload identity.

## Security and privacy

- Owner is always the Identity session principal. A body field can never name
  an owner, and kind and subject both partition data.
- No plate, name, colour or subject value appears in errors or logs.
  Identifiers only reach audit and events.
- The snapshot route never accepts a user session as a workload. It is
  deny-by-default via `NoWorkloadIdentity`.

## Rollback

1. Redeploy the previous vehicle image.
2. Drop `vehicle_plate_v1_check` and `vehicle_nickname_v1_check`, because the
   P01 application may write lowercase or 13–20 character plates and 41–60
   character names.
3. Keep the added columns and index; they are harmless to P01.

Re-adding the P01 plate check needs a reviewed data plan. No compensation is
needed: no cross-service write exists in this child.

## Shared files touched

`tests/production/A/_support.mjs` received two additive exports, `guest()` and
`contracts`/`eventContracts`. They are byte-identical to the copy in P02-A1
(customer), so the two PRs merge cleanly. No other shared harness file changed.

## Blockers and requests (Lane E unless noted)

- **A-P02-01.** Add `@carwash/contracts` to `@carwash/vehicle` (manifest +
  lockfile).
  - That would let the service import the parsers, `canonicalJson` and the error
    table instead of mirroring them.
  - The mirrors are pinned by `vehicle.contract.test.mjs`.
- **P01-E5 workload identity.** A verifier and scope grant for
  `service:vehicle.snapshot.resolve`, needed before Booking or Pricing can
  resolve snapshots. The use case, audit and tests are ready; only the adapter
  behind `WorkloadAuthenticator` is missing.
- **Gateway routes.** Expose `vehicle.v1` principal routes for the customer app
  (requested in A-P01-02).
  - The routes need `If-Match`/`Idempotency-Key` forwarding, query strings
    (`limit`, `cursor`) and `ETag` exposure.
  - `GatewayOwner` needs a `vehicle` value.
  - This is the next consumer dependency of P02-A (customer-web vehicle step).
- **CI.** The vehicle workflow already runs `acceptance-a.mjs --services vehicle`,
  which now includes the contract suite. No workflow change is needed.
- **Outbox relay.** Unchanged since A-P01-03.
- **Owner decisions still open.** Decision A2-D1 keys ownership by principal
  rather than by customer id. Idempotency retention stays at 24 h.

Parent task status: **INTEGRATION_PENDING**. Vehicle is provider-conformant
on real PostgreSQL and Identity. The customer app does not consume it yet, and
cannot until the gateway routes and the customer-web dependency land.
