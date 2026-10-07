# P01-A3 — Geo production provider (service zones and serviceability)

Status: **IMPLEMENTED, INTEGRATION_PENDING. No zone data exists.** The provider runs against real
PostgreSQL in the Lane A harness. Readiness stays 503 (`BUSINESS_READY = false`).

There is **no approved Aleppo dataset** in this repository or in this PR. None was invented.
Until an approved dataset is imported, every serviceability answer is
`INDETERMINATE / NO_APPROVED_ZONES`, which Booking must reject. This is a genuine external
blocker (A-P01-12).

This child is based on current `main`, including P01-A1. The harness validates that every
selected service suite exists before starting infrastructure; absent sibling suites are refused.

## Ownership boundary

Geo owns `service_zone`, `outbox_message` and `audit_entry` in `cw_geo`. Geo is **never** the
address authority: it receives a coordinate, stores nothing about the caller and returns only
zone references. Customer owns saved addresses. A manual address has no coordinate, so it is
never sent here and is never treated as serviceable.

## Domain

- **Coordinates.** WGS 84 (EPSG:4326) only, as exact decimal strings with at most 6 fractional
  digits. They are converted to integer micro-degrees (`bigint`). JSON numbers, NaN, Infinity
  and exponent notation are refused.
- **Zone ring.** A ring is `[[lng, lat], ...]` and must be:
  - closed;
  - made of 3 to 1000 distinct vertices;
  - simple, i.e. it does not cross itself (exact segment-intersection test);
  - of non-zero area;
  - narrower than 180° of longitude, so it cannot cross the antimeridian.
  - Holes are not supported.
- **Point placement.** Even-odd ray casting with exact integer cross-products, so no floating
  point is involved anywhere. A point on an edge or a vertex is `BOUNDARY`.
- **Serviceability.** The answer is computed against all ACTIVE zones. Boundary, overlap and
  effective-window rules have not been decided by the owner yet (W02 EP:269), so every unclear
  case fails closed.

  | Situation                        | Answer                                        |
  | -------------------------------- | --------------------------------------------- |
  | No ACTIVE zone at all            | `INDETERMINATE` / `NO_APPROVED_ZONES`         |
  | Point on any zone edge or vertex | `INDETERMINATE` / `ON_ZONE_BOUNDARY`          |
  | Point inside two or more zones   | `INDETERMINATE` / `OVERLAPPING_ZONES`         |
  | Point inside exactly one zone    | `SERVICEABLE` with `{zoneId, code, revision}` |
  | Otherwise                        | `OUTSIDE_ZONE`                                |

- **Provenance.** Every zone needs a `datasetRef` naming the approved dataset it came from. The
  import, revise and retire actions are all audited with the operator label and that
  `datasetRef`.

## Data (migration `20261007120000_p01a_service_zones`, additive, creates **no rows**)

- **`service_zone`:**
  - `code` is unique.
  - The ring is stored as JSONB of decimal strings.
  - The bounding box is stored as exact `NUMERIC(9,6)` and is used only to pre-select candidate
    zones.
  - `status` is `ACTIVE` or `RETIRED`, with a `revision` and `retired_at`.
  - CHECKs enforce:
    - the code, `dataset_ref` and name shapes;
    - a closed JSON array of 4 to 1001 positions;
    - a finite, non-NaN, in-range, ordered bounding box less than 180° wide;
    - status and `retired_at` consistency.
- **`outbox_message`:** `geo.zone-updated.v1` events, carrying references and revision only.
- **`audit_entry`:** append-only; a trigger refuses UPDATE and DELETE with SQLSTATE 42501.
  Follow-up migration `20261007140000_p01a_geo_function_acl` removes PostgreSQL's implicit
  PUBLIC EXECUTE grant on the trigger function. The migration owner retains access and the
  existing trigger remains active. Retain this restriction on application rollback.

Serviceability reads "is any zone active" and the candidate zones in a single
REPEATABLE READ snapshot.

Rollback:

- Before any rows exist, drop the three tables and the trigger function.
- Once rows exist, rollback needs a reviewed data plan.
- The application can roll back on its own.

## Interfaces

**HTTP (`/internal/v1/geo`, proposed `geo.v1`):**

- `POST /serviceability` with body `{coordinates:{crs:'EPSG:4326', latitude, longitude}}`
  returns 200 with a serviceability result, or 422 for invalid input.
  - The route is guest-safe: no session is needed and nothing is stored.
  - It is rate-limited per client address (`GEO_SERVICEABILITY_RATE_PER_MINUTE`, default 60)
    and returns 429 over the limit.
  - Behind a gateway, configure `GEO_TRUSTED_PROXY_IPS` with the exact comma-separated IPv4 or
    IPv6 addresses of controlled proxies. The default trusts no forwarding headers. Wildcards,
    hostnames, CIDRs and numeric hop counts are refused at startup.
  - Trusted ingress must overwrite or append the actual connecting client address to
    `X-Forwarded-For`. Express walks from the socket toward the caller and stops at the nearest
    untrusted address, so unrelated clients behind the same gateway receive separate budgets
    and a spoofed leftmost prefix cannot choose the key. Never trust end-user addresses.
  - The limit is per replica. A shared budget needs A-P01-05.
- `GET /service-zones` returns the ACTIVE zones with code, name, revision and polygon. It
  exposes no provenance and no personal data.
- There is no HTTP write route. Identity has no zone-management permission yet (A-P01-13).

**Operator CLI** (`pnpm --filter @carwash/geo run zones -- …`, runtime identity):

- `import <file> --actor <label>`
  - Re-importing an identical definition is a no-op.
  - A different shape under an existing code is refused with `ZONE_CODE_CONFLICT`.
- `revise <file> --revision <n> --actor <label>` changes a zone, using compare-and-set on the
  revision.
- `retire <code> --revision <n> --actor <label>` is safe to retry.

The CLI prints one JSON line per zone and exits non-zero if any operation was refused.

## Evidence

- Unit tests, run with `pnpm --filter @carwash/geo run test:unit`. They cover:
  - exact placement, including vertices and a concave notch;
  - each ring refusal reason, including that a symmetric bow-tie is refused for zero area while
    an asymmetric one is refused as self-intersecting;
  - the fail-closed serviceability matrix;
  - the rate limiter;
  - isolated budgets behind a trusted proxy and refusal of untrusted/spoofed forwarding;
  - the framework specs.
- Real infrastructure, run with `node scripts/production/A/acceptance-a.mjs --services geo`
  (PostgreSQL 16 with least-privilege roles, the real HTTP adapter and the real CLI process).
  It shows:
  - migrations seed nothing, so the answer is `NO_APPROVED_ZONES`;
  - import records provenance and is idempotent;
  - exact inside, outside and boundary answers;
  - non-finite and non-string input is refused;
  - overlap is `INDETERMINATE`;
  - 4 concurrent imports create 1 zone and 1 event;
  - a stale revise is refused, and of two concurrent revises one wins;
  - invalid geometry writes nothing;
  - retire is idempotent, and the audit is append-only (42501);
  - PostgreSQL CHECKs (23514) and uniqueness (23505);
  - events carry no polygon or provenance;
  - the HTTP 429 limit;
  - cross-database isolation.
  - the audit trigger function's effective EXECUTE privileges for all service roles.
- Test shapes are synthetic squares around (0, 0), labelled `test-fixture:*`. They are not
  service areas.
- The committed 13-test report remains evidence for source `7ce5f18`, not for these fixes.
  Its scope description is corrected explicitly: Geo started its HTTP adapter and CLI;
  Identity was migrated but its HTTP application was not exercised. New tests require a
  fresh run before they can be reported as accepted.

## Contract requests and blockers

| ID       | Request / blocker                                                                                              | Owner      |
| -------- | -------------------------------------------------------------------------------------------------------------- | ---------- |
| A-P01-12 | Approved Aleppo zone dataset (source, licence, boundary/overlap/effective rules)                               | Owner      |
| A-P01-13 | Identity permission for zone management (e.g. `geo.zones.write:operations`) and an audited admin route         | Identity/E |
| A-P01-14 | Publish `geo.v1` contract and client; gateway owner `geo` and the public serviceability route                  | Lane E     |
| A-P01-15 | Register `geo.zone-updated.v1`; declare the `washgo.geo.events` exchange and its ACL; add the relay dependency | Lane E     |

Next consumers:

- Booking re-validates serviceability for the chosen coordinate before confirming. It snapshots
  `zone {zoneId, revision}` and rejects `INDETERMINATE`.
- customer-web uses the place step through the gateway after A-P01-14.
