# P02-A3 — Geo service conforms to `geo.v1` (provider)

Lane A, child sprint 3 of P02-A ("Connect customer booking steps to real
customer/catalog/geo/pricing/scheduling APIs"). This PR is the **provider** side for
the Place (المكان) step: it makes the Geo service answer exactly the published `geo.v1`
contract. It does not change customer-web, the gateway or any shared package.

| Item | Value |
| --- | --- |
| Base (origin/main) | `566d2e7435dac0803d075556fff43c435f8a29a7` (tree `1bd162f2578878643b3e2c2cc437fece36716588`) |
| Code commit (accepted) | `17d4bd111964fb4d5a2ad9b82fbb5ca50b8227bd` (tree `b7517e9918e27ff9c6d8d83c82047c199f06ff95`) |
| PR head | Code commit + this document and its evidence JSON (docs only) |
| Contract | `geo.v1` from `@carwash/contracts@0.1.0` (P01-E1), status `published-provider-pending` |
| Error envelope | P01-E1 `ApiErrorEnvelope` |
| Migration | `20261008100000_p02a3_geo_v1_decisions` (expand-only) |
| Events | unchanged: `geo.zone-updated.v1` rows in the outbox (relay/registration still Lane E) |

## Behavior

### `POST /internal/v1/geo/serviceability` (access: `principal`, safe POST)

- **Request:** `{point: {latitude, longitude}}`. It is a closed object, and each value is a
  decimal string with **exactly six fractional digits**.
  - The following are refused with `422 VALIDATION_FAILED`, with `issues[{field, code}]`
    naming the field:
    - numbers, `NaN`/`Infinity`, exponents and `-0.000000`;
    - fewer or more fractional digits, and out-of-range values;
    - the P01 shape `{coordinates:{crs,…}}` and any extra field.
  - Values are never rounded or clamped.
  - Malformed JSON and bodies over 16 kB return `400 REQUEST_INVALID`.
  - Nothing is recorded for a refused request.
- **Authorization:**
  - The call needs a CURRENT Identity session, checked through Identity
    `GET /internal/v1/identity/session` with a bearer token or Identity cookies. Foreign
    cookies are never forwarded.
  - The principal kind comes from Identity's `principalKind` (`account`/`guest`). A view
    that is missing `principalKind` or `roles`, or a guest view carrying roles, fails
    closed.
  - **Permission decision:** the session must hold `bookings.create:self`.
    - Every guest and customer account has it (P01-E3). The principal is checking a place
      for its own booking.
    - No staff permission is required or accepted instead. Staff tooling needs its own
      reviewed permission.
  - Results: missing, invalid or revoked sessions return `401 AUTH_REQUIRED`; a session
    without the permission returns `403 AUTH_FORBIDDEN`; an Identity timeout, outage or
    malformed answer returns `503 DEPENDENCY_UNAVAILABLE`.
- **Rate limit:** the existing per-replica, per-originating-address limiter runs **before**
  Identity is contacted.
  - Only explicitly trusted proxies are honored.
  - Over the limit returns `429 RATE_LIMITED`, with `retryAfterMs` and `Retry-After`.
- **Answer:** `ServiceabilityDecisionV1`, recorded before it is returned.

  | Situation | `decision` | `reason` | internal `detail` |
  | --- | --- | --- | --- |
  | No ACTIVE approved zone | `INDETERMINATE` | `GEO_DATASET_UNAVAILABLE` | `NO_APPROVED_ZONES` |
  | Point on a zone edge/vertex | `INDETERMINATE` | `LOCATION_UNRESOLVED` | `ON_ZONE_BOUNDARY` |
  | Point inside two ACTIVE zones | `INDETERMINATE` | `LOCATION_UNRESOLVED` | `OVERLAPPING_ZONES` |
  | Inside exactly one ACTIVE zone | `SERVICEABLE` | `null` | — |
  | Outside every zone | `OUTSIDE_ZONE` | `null` | — |

  - Other fields:
    - `datasetRevision`: the dataset revision the point was evaluated against.
    - `point`: echoed in fixed 6dp form.
    - `checkedAt` comes from the injected clock.
    - `expiresAt` is `checkedAt + GEO_DECISION_TTL_SECONDS` (default 1800 s, bounded
      60..86400).
  - A PostgreSQL outage returns `503 DEPENDENCY_UNAVAILABLE`. It is never a decision and
    never `SERVICEABLE`.

### `GET /internal/v1/geo/service-zones` (access: `public`)

- Returns `{items: ServiceZoneV1[]}` for ACTIVE zones: `zoneId`, `revision`,
  `name: {ar, en|null}`, `status: 'ACTIVE'`.
- Polygons and dataset provenance are **no longer returned**. P01-A3 leaked the polygon;
  `geo.v1` says zone polygons never leave Geo.
- The response is identical with or without credentials.
- `SUSPENDED` is never emitted, because Geo has no suspension state. Retired zones are not
  listed.

### `POST /internal/v1/geo/serviceability/validate` (access: `service:geo.serviceability.validate`)

- The use case `ServiceabilityApplication.validate` is implemented and tested against the
  real store. It requires the scope and checks in this order:
  1. The decision exists and was SERVICEABLE, otherwise `DECISION_NOT_FOUND`.
  2. The point is exactly the decided point, otherwise `POINT_MISMATCH`.
  3. The decision has not expired, otherwise `DECISION_EXPIRED`. Expiry is half-open:
     the `expiresAt` instant itself counts as expired.
  4. The caller's `expectedZoneRevision` matches the decision, otherwise `ZONE_CHANGED`.
  5. Re-evaluating the point against the CURRENT dataset still yields the same zone at the
     same revision, otherwise `ZONE_CHANGED`. This covers a revision, a retirement and a
     new overlapping zone.
- **The HTTP route is closed.** `DenyAllWorkloadAuthenticator` refuses every caller with
  `403 AUTH_FORBIDDEN`, because workload identity (P01-E5 / P02-E2) is not on main.
  Headers such as `x-service-client` are not credentials.

### Dataset revision and decisions (persistence)

- `geo_dataset_state` is a singleton (`id = 1`, CHECKed). Every committed zone import,
  revision or retirement advances it in the same transaction, so a no-op re-import does not
  advance it. Decisions read it in the same REPEATABLE READ snapshot as the zone candidates.
- `serviceability_decision` rows are append-only:
  - A `BEFORE UPDATE` trigger raises 42501.
  - The trigger function has no PUBLIC `EXECUTE`.
- PostgreSQL CHECKs mirror the `geo.v1` parser's consistency rules:
  - zone ref iff `SERVICEABLE`;
  - reason iff `INDETERMINATE`, with a fixed reason/detail mapping;
  - finite, in-range point;
  - `expires_at > checked_at`.
- **Retention:** a decision holds a precise point, which is personal location data.
  - `pnpm --filter @carwash/geo run decisions -- purge` deletes rows whose expiry is more
    than 24 h old, in batches of 1000. It prints only a count.
  - It must be scheduled by operations. No scheduler is configured in this PR.

## Changed paths

- `services/geo/**`:
  - domain: `decision.ts` (new); `geometry.ts` (wire point); `zone.ts` (`nameEn`);
  - application: `serviceability.application.ts` (new);
  - ports;
  - Identity adapter and deny-all workload adapter (new);
  - Prisma store;
  - HTTP transport: E1 error filter, controller, rate-limit hint;
  - the decisions CLI;
  - schema and migration;
  - tests;
  - README.
- `tests/production/A/geo.integration.test.mjs`: rewritten for `geo.v1`.
- `tests/production/A/_support.mjs`: additive `guest()` / `contracts` / `eventContracts`
  exports, byte-identical to P02-A1's copy so the PRs merge cleanly.
- `scripts/production/A/acceptance-plan.mjs` and
  `tests/production/A/acceptance-plan.test.mjs`: geo is now an Identity-using suite (one
  line each).
- `docs/production/A/P02-A3_GEO_V1_PROVIDER.md` and `docs/production/A/evidence/cw-p01a-3fd7a92df51a.json`.

No change to `packages/**`, the lockfile, the gateway, CI, apps or design references.
`services/geo/package.json` changes only `scripts` (adds `decisions`, adds the unit spec).
It has no dependency change.

## Evidence (commands and results)

All results below are from the exact code commit `17d4bd1` (tree `b7517e9`) or the
identical working tree immediately before it.

| Family | Command | Result |
| --- | --- | --- |
| Domain + application unit, Nest runtime | `pnpm --filter @carwash/geo run test:unit` | **PASSED** 34/34 |
| Real PostgreSQL 16 + real Identity + Redis, provider verification | `node scripts/production/A/acceptance-a.mjs --services geo` | **PASSED** 19/19, `dirtyTrackedFiles: 0`, evidence `cw-p01a-3fd7a92df51a.json` |
| Migrate deploy (migration identity) + Prisma schema mirror diff | same harness | **PASSED** |
| Typecheck / build | `tsc -p tsconfig.json --noEmit`, `pnpm --filter @carwash/geo run build` | **PASSED** |
| Lint / format | `eslint services/geo/src services/geo/test tests/production/A scripts/production/A`, `prettier --check` | **PASSED** |
| Design lock | `node scripts/check-design-reference.mjs` | **PASSED** (no UI touched) |
| Boundaries / layers / service template | `pnpm check:boundaries` | **PASSED** |
| Migrations static check | `pnpm check:migrations` | **PASSED** |
| Ownership / foundation | `pnpm check:ownership`, `pnpm check:foundation` | **PASSED** |
| Contract surface / docs drift | `pnpm check:contract-surface`, `pnpm check:contract-docs` | **PASSED** (no contract change) |
| Root unit suite | `pnpm test:unit` (after `pnpm build:domain`) | **PASSED** 558/558 |
| E contract tests touching geo | `node --test tests/production/E/contracts-vehicle-geo.test.mjs tests/unit/x003-contract-registry.test.mjs tests/parallel/E/lifecycle.test.mjs` | **PASSED** 36/36 |

### What the real-infrastructure suite proves

- **Provider verification.** Every 2xx body is parsed by the built
  `parseServiceabilityDecisionV1`, `parseServiceZoneV1` and `parseValidateDecisionResultV1`
  parsers. Every error body is parsed by `parseApiErrorEnvelope`, with the status taken
  from `API_ERROR_STATUS`.
- **Guest and account access.** A real guest session (cookie and bearer) and a real account
  are accepted. Missing, forged, foreign-cookie and logged-out sessions return 401.
- **Validation.** Fifteen contract-invalid bodies return 422 with exact issues. Malformed
  and oversized bodies return 400. No decision row is written for any of them.
- **Decisions.** With no data the answer is `GEO_DATASET_UNAVAILABLE`. Inside, outside,
  edge, vertex and overlap answers are exact. The dataset revision advances exactly once
  under four concurrent imports.
- **Validation use case.** Valid, `POINT_MISMATCH`, `ZONE_CHANGED` after a real revise, and
  `DECISION_NOT_FOUND` for a non-serviceable decision. The HTTP route returns 403 for every
  caller.
- **PostgreSQL invariants.** All decision invariants hold, decisions are immutable, the
  dataset singleton holds, `name_en` is CHECKed, the audit log is append-only, and the
  trigger functions have no EXECUTE grants.
- **Retention and events.** The purge removes only expired rows and never prints a
  coordinate. Outbox events carry no coordinates and no provenance.
- **Failure paths.**
  - The rate limiter runs before Identity (401, 401, 401, 429, 429), and 429 carries
    `retryAfterMs`.
  - A PostgreSQL outage returns `503 DEPENDENCY_UNAVAILABLE` for both routes.
  - An Identity outage returns 503 and records no decision, while the public list keeps
    working.

### Real vs mocked

| Dependency | Status |
| --- | --- |
| PostgreSQL 16.10 | **Real**: disposable, least-privilege roles from `infra/postgres/provision.sh`, migration identity separate from runtime identity |
| Identity | **Real**: Nest application, real Argon2/RS256, real Redis rate budget. Only OTP delivery is captured in-process. |
| Redis 8.2 | **Real** (Identity's budget) |
| Geo HTTP adapter and CLIs | **Real**: built `dist`, loopback, real child processes |
| Workload identity | **Absent**: the route is closed. The validate use case is exercised in-process against the real store with a scoped actor. |
| Broker / outbox relay | **Not exercised**. Rows are written but not published (Lane E topology). |
| Gateway, browser, deployment | **Not involved** |

### Failures observed during development (reported, not hidden)

- **Missing NULL guard (fixed).** The first full run caught a missing NULL guard in the new
  decision CHECK. An `INDETERMINATE` row with NULL reason/detail passed, because a NULL
  CHECK passes. The migration is new in this PR and was corrected before commit. A test
  now enforces it.
- **Unexplained CLI zone-import refusals (open).** In 2 of the first 6 local runs, one
  operator-CLI zone import was refused with an undiagnosed code. The tests affected were
  `import` and `overlap` (with `retire` failing as a consequence).
  - The CLI then printed only `INTERNAL_ERROR`. It now writes the error class and driver
    code (no message, no data) to stderr.
  - The next 4 runs, including the committed-head run above, passed 19/19.
  - The cause is **not established**. The prime suspect is Prisma's 2 s interactive-
    transaction `maxWait` on a loaded Windows host, which P01-A3 already had.
  - This is recorded as an open reliability risk for the operator CLI. It is not claimed
    as fixed.

## Security and privacy

- **Coordinates are personal location data.** They are:
  - never logged: the error filter logs code, status and ids only, and a 5xx logs only the
    error class name;
  - never placed in events or URLs;
  - never printed by the CLIs.
  - They are stored only in `serviceability_decision`, with bounded retention.
- **Deny by default.** No Identity origin configured returns 503 for every serviceability
  call. The service route stays closed. Unknown routes return the 404 envelope.
- **Zone geometry and provenance** are no longer exposed publicly.
- **Known limits:**
  - The rate limit is per replica (unchanged; a shared budget needs `security-kit`, a
    Lane E lockfile change).
  - The runtime role can still `TRUNCATE` or `DELETE` decisions. UPDATE is blocked by the
    trigger. Role-level revocation belongs in `infra/postgres/provision.sh` (Lane E).

## Rollback

- **Application:** redeploy the previous geo image.
  - The migration is expand-only, and the previous application ignores the new column and
    tables.
  - Callers of the old `{coordinates}` shape will get 422 again only with the new image.
    Rollback restores the old (non-contract) shape.
  - There is no data migration to undo. `geo_dataset_state` holds one row, and
    `serviceability_decision` holds short-lived rows only.
- **Database contraction:** dropping the new tables or column needs its own reviewed
  migration. It is not done here.

## Blockers and next consumers

| ID | Blocker | Owner |
| --- | --- | --- |
| A-P02-G1 | No approved Aleppo (or any) zone dataset exists. Every production answer is `INDETERMINATE / GEO_DATASET_UNAVAILABLE` until an approved dataset with provenance is imported. | Owner / product (external) |
| A-P02-G2 | Workload identity (`service:` scopes) is not on main. `/serviceability/validate` stays closed, and Booking cannot validate a decision over HTTP. | Lane E (P02-E2) |
| A-P02-G3 | Gateway: `GatewayOwner` lacks `geo`, and there are no `/api/v1/...` routes for `service-zones` (public) or `serviceability` (principal, forwarding bearer/cookies). The customer-web Place step cannot reach Geo. | Lane E |
| A-P02-G4 | `geo.v1` has no reason for "the decision was never SERVICEABLE". Geo answers `DECISION_NOT_FOUND`; an explicit `NOT_SERVICEABLE` validation reason needs a contract change. | Lane E (contract request) |
| A-P02-G5 | `geo.v1` publishes no wrapper for the `listZones` response. Geo returns `{items: ServiceZoneV1[]}`; the wrapper should be published in the contract. | Lane E (contract request) |
| A-P02-G6 | `@carwash/contracts` is not a Geo dependency (lockfile). Geo mirrors the E1 envelope codes locally, and this suite is the drift gate. | Lane E |
| A-P02-G7 | `geo.zone-updated.v1` is still the P01 payload. It is not migrated to envelope v2 and is not relayed (no broker registration). | Lane E + Lane A follow-up |
| A-P02-G8 | Decision purge scheduling and a suspension state (`SUSPENDED`) are not configured. | Operations / owner |

**Next consumers:**

- The customer-web Place step (P02-A4). It is blocked on G3.
- Pricing and Scheduling, which take a `zoneId` from a SERVICEABLE decision.
- Booking, which validates a decision before confirming. It is blocked on G2.

**Status:** this child is a reviewed provider PR. The parent P02-A remains
**INTEGRATION_PENDING**. This is not production-ready, and there is no deployment.
