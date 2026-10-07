# P01-B1 — Catalog production provider

Status: **implemented and locally verified; review required; INTEGRATION_PENDING**.
Readiness remains 503. Not production-ready, not deployed, not integrated.

## Ownership

`architecture/service-catalog.json`: Catalog owns packages, add-ons and
compatibility, "never monetary quotes". ADR 0003's older wording ("Catalog owns
price versions and wash quotes") predates that registry; this change follows the
registry and the Lane B W01 packet. No price, amount, currency or quote field
exists in any Catalog table, DTO or event. The unconnected legacy
`services/catalog/src/domain/quote.ts` is left untouched (it is referenced by
architecture inventories and `tests/domain.test.mjs`, which are outside Lane B's
write scope) and is not exported or used.

## Architecture

| Layer          | Files                                                                    | Notes                                                    |
| -------------- | ------------------------------------------------------------------------ | -------------------------------------------------------- |
| domain         | `domain/catalog-definitions.ts`, `domain/catalog-revision.ts`            | Pure validation/canonicalisation and revision schedule   |
| application    | `application/catalog.service.ts`, `canonical-json.ts`, `catalog-errors.ts` | Use cases, idempotency, authorization decisions        |
| ports          | `ports/catalog.ports.ts`                                                 | Repository/UoW, Clock, IdGenerator, Hasher, AccessAuthority |
| infrastructure | `persistence/prisma-catalog.repository.ts`, `identity/identity-session.authority.ts`, `system/system.adapters.ts` | Prisma, Identity HTTP, node:crypto |
| transport      | `transport/http/catalog.controller.ts`                                   | Extracts credential/correlation/key; fixed public errors |

`scripts/check-layers.mjs` passes: no Nest/Prisma/pg import in inner layers.

## Domain rules

- IDs: stable opaque `^[a-z][a-z0-9-]{1,47}$`, unique per kind and per relation.
- Arabic labels required (1–80, NFC, no surrounding whitespace/control chars);
  English labels optional (`null`) — no English design is inferred.
- Durations: package 1–600 min, add-on 1–240 min, category extra 0–240 min.
- Every package/add-on must allow ≥ 1 category; every reference must resolve
  inside the same revision.
- An add-on is either INCLUDED or OPTIONAL for a package, never both.
- An INCLUDED add-on must be allowed for every category the package accepts.
- Unknown and missing fields are rejected (`400`), never stripped.
- Canonical form: entities ordered by `(sortOrder, id)`, relation IDs sorted,
  feature order preserved. The fingerprint is SHA-256 of canonical JSON and is
  reproducible from the stored rows (proven on PostgreSQL).

## Revisions and effective windows

- Linear chain: `previous_revision = revision - 1`, unique successor.
- `effectiveFrom` ≥ server now (no retroactive publication), strictly greater than
  the previous revision's, and at most 366 days ahead. `null` = now.
- Revision N is in force on `[effectiveFrom(N), effectiveFrom(N+1))`; reads return
  `effectiveUntil` when a successor is scheduled.
- `expectedRevision` must equal the current head (optimistic concurrency).

## Idempotency, concurrency and audit

- `Idempotency-Key` `[A-Za-z0-9_-]{16,128}` scoped to (verified actor, operation).
- Fingerprint covers operation, actor, expected revision, effective time and the
  definitions fingerprint (so JSON key order never matters).
- One transaction: lock the singleton publication row → read receipt → plan →
  insert revision rows → save receipt → append audit. Same key + same payload
  replays the recorded status/body (`idempotency-replayed: true`); same key +
  different payload → `409 IDEMPOTENCY_CONFLICT` with no effect. State-dependent
  rejections (`REVISION_CONFLICT`, `EFFECTIVE_FROM_*`) are durable receipts;
  malformed/unauthorised requests create no receipt.
- Audit rows (`catalog_audit_event`) record actor subject (pseudonymous UUID),
  action, revision, outcome and correlation ID. No contact data, no tokens.

## Database (migration `20261007090000_p01b_catalog_definitions`)

Additive (expand-only). Tables: `catalog_publication_lock` (seeded singleton),
`catalog_revision`, `catalog_vehicle_category`, `catalog_package`,
`catalog_addon`, `catalog_package_category`, `catalog_addon_category`,
`catalog_package_addon`, `catalog_idempotency_receipt`, `catalog_audit_event`.

Constraints proven on real PostgreSQL 16.10: composite FKs for every relation,
CHECKs for ID format/labels/durations/bounds/relation vocabulary/key format,
linear-chain CHECK, unique `effective_from` and `previous_revision`,
non-retroactive CHECK, trigger for strictly increasing `effective_from`,
UPDATE/DELETE rejection on every table, and a trigger that only allows definition
rows to be inserted by the transaction that created their revision.

Rollback: the migration is additive; rolling the application back to the
previous image leaves the new tables unused and harmless. Dropping them is a
destructive contract step that needs a separate reviewed data plan and is not
part of this change. No `db push`, no reset.

## HTTP API (proposed `catalog.v1`; consumers must wait for E publication)

```
GET  /internal/v1/catalog/definitions            → 200 RevisionView | 404 CATALOG_NOT_PUBLISHED
GET  /internal/v1/catalog/definitions/:revision  → 200 RevisionView | 404 NOT_FOUND
GET  /internal/v1/catalog/revisions              → 200 { revisions: RevisionSummary[] } (newest 50)
POST /internal/v1/catalog/definitions            → 201 RevisionView
     headers: Authorization: Bearer <Identity access token>, Idempotency-Key
     body:    { expectedRevision: int ≥ 0, effectiveFrom: "YYYY-MM-DDTHH:mm:ss.sssZ" | null,
                definitions: { categories[], packages[], addons[] } }

RevisionView = { revision, effectiveFrom, effectiveUntil|null, publishedAt,
                 definitionsFingerprint, definitions }
```

Errors use the shared envelope `{ error: { code, message, correlationId, status } }`
with fixed messages: 400 `REQUEST_INVALID`/`IDEMPOTENCY_KEY_INVALID`,
401 `AUTH_REQUIRED`, 403 `AUTH_FORBIDDEN`, 404, 409 `IDEMPOTENCY_CONFLICT`/
`REVISION_CONFLICT`, 422 `DEFINITIONS_INVALID`/`EFFECTIVE_FROM_*`,
503 `AUTH_UNAVAILABLE`.

## Security

- Deny by default: every route needs a current Identity session; publishing
  needs `catalog.publish`, which Identity does not grant today — so in a real
  environment **nobody can publish until E/Identity add the grant**. That is the
  intended fail-closed state, not a defect.
- Gateway hint headers (`x-auth-*`) are ignored; only Identity's answer counts.
- Identity call: bearer shape check before forwarding, `redirect: error`,
  bounded timeout (no retry), 16 KiB response cap, strict response parsing;
  any ambiguity → 503.
- Public catalog/guest read mode (W01 packet) is not enabled: it needs E's
  guest/public transport decision (B-15).

## Observability

Structured `catalog_publish_outcome` log (status, replayed, revision, rejection
code); correlation/trace IDs come from the instrumented request context and are
forwarded to Identity as `x-correlation-id`. No body, token or label is logged.

## Tests (exact commands)

| Family                                 | Command                                                                     | Real/mocked                                         |
| -------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------- |
| Domain invariants                      | `node --test services/catalog/dist-tests/test/catalog.domain.spec.js`       | pure                                                |
| HTTP auth/object access, idempotency, concurrency | `node --test services/catalog/dist-tests/test/catalog.http.spec.js` | real Nest HTTP + real Identity adapter; Identity = local HTTP stub; repository = in-memory double |
| Nest runtime/readiness                 | `node --test services/catalog/dist-tests/test/catalog.nest.spec.js`         | real HTTP listener, no DB                           |
| PostgreSQL persistence/constraints/races/upgrade/drift | `node scripts/production/B/postgres-acceptance.mjs --service catalog` | **real PostgreSQL 16.10** as `cw_catalog_app`; Identity stub |

Not applicable / not claimed: RabbitMQ (no event is emitted), browser/Playwright
(no UI changed), real Identity (E), Gateway journey (E), production.

Results are recorded per commit in the PR description and in
`docs/production/B/evidence/catalog-postgres-<sha>.json`.
