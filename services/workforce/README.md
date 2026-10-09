# workforce

Owner of the technician as a capacity resource: operator profile, employment,
suspension, verification cases and their projection, skills (work grants),
shifts, operational readiness / eligibility, and the technician's own
availability (ready/break). Database `cw_workforce`; no other service reads or
writes these tables. Design and evidence: `docs/production/C/P03-C1-workforce.md`
(P01-C2 introduced the operator/verification/skill/shift model).

Status: implemented and verified on real PostgreSQL in the lane-C stack —
published `workforce.v1.listCapacityResources`, published
`workforce.eligibility-changed.v1` (outbox rows), requested technician
availability. `/health/ready` still answers 503 (`BUSINESS_READY = false`):
the availability routes are not published by Lane E, no outbox relay process is
wired (dependency is Lane E's), service credentials are interim, and no release
acceptance has run on this source. Not production-ready.

## Model

- `operator`: profile, `employment_status`, `suspension_reason`,
  `verification_status` / `verified_until`, `version`, and
  `eligibility_revision` (moves with every eligibility-input change; CHECK
  `1 <= eligibility_revision <= version`).
- `work_grant` (skills), `verification_case`, `work_shift` (ACTIVE shifts of
  one operator never overlap: `EXCLUDE USING gist`).
- `operator_availability`: `AVAILABLE | ON_BREAK`, revision; no row = never set
  (`ON_BREAK`, revision 0). Not an eligibility input; no event.
- `outbox_message`, `audit_entry`: written in the same transaction as the change.

Eligibility (`ELIGIBLE`) = active employment, not suspended, verification
VERIFIED and valid at the instant, at least one skill.

## API (`/internal/v1/workforce`)

| Method | Path | Caller | Contract |
| --- | --- | --- | --- |
| GET | `/capacity-resources?zoneId&from&to&limit&cursor` | service scope `workforce.capacity.read` | **published** `workforce.v1` |
| GET | `/me/availability` | user `work.read:assigned` (self) | requested (CR-P03-C1 §1) |
| PUT | `/me/availability` `{status, expectedRevision}` | user `work.execute:assigned` (self) | requested (CR-P03-C1 §1) |
| GET / PATCH | `/me` | user `work.read:assigned` (self) | internal (P01-C2) |
| POST | `/me/verification-cases` | user `work.read:assigned`, `Idempotency-Key` | internal |
| POST | `/verification-cases/:id/withdraw` | the operator | internal |
| POST | `/:caseId/review` | user `verification.review` (not the operator) | internal |
| POST | `/operators` | user `operations.dispatch` | internal |
| PATCH | `/operators/:id/status` | user `operations.dispatch` | internal |
| POST | `/operators/:id/skills`, `/operators/:id/skills/:skill/revoke` | user `operations.dispatch` | internal |
| GET | `/operators/:id/readiness` | `operations.dispatch` or scope `workforce.eligibility.read` | internal |
| POST | `/operators/:id/shifts`, `/shifts/:id/cancel` | the operator, `Idempotency-Key` on create | internal |
| GET | `/eligible?zoneId&at[&skillCode]` | scope `workforce.eligibility.read` | internal |

Errors use the shared envelope `{error:{code, reason, message, requestId,
correlationId, retryable, retryAfterMs, issues}}`; the domain code travels in
`reason` (e.g. `404 NOT_FOUND / OPERATOR_NOT_FOUND`,
`409 CONFLICT / REVISION_CONFLICT`, `400 REQUEST_INVALID / INVALID_CURSOR`).

## Events

`workforce.eligibility-changed.v1` (published, envelope v2): exchange
`workforce.events`, routing key = event type, aggregate
`{type:'capacity-resource', id: operatorId, version: eligibilityRevision}`,
data `{eligibility}`. Emitted exactly when the eligibility revision moves, in
the same transaction. Time-driven expiry of a verification emits nothing.
`workforce.shift-updated.v1` (P01-C2) is **not** published and keeps its old
shape.

## Configuration

`DATABASE_URL` (runtime role `cw_workforce_app`), `IDENTITY_URL`,
`IDENTITY_TIMEOUT_MS`, `WORKFORCE_SERVICE_CLIENTS` (JSON, SHA-256 digests only;
scopes `workforce.operator.read`, `workforce.eligibility.read`,
`workforce.capacity.read`), `WORKFORCE_USER_REQUESTS_PER_MINUTE`,
`WORKFORCE_SERVICE_REQUESTS_PER_MINUTE`. Migrations run only as
`cw_workforce_migrate` in a separate job; runtime startup never migrates.

## Tests

```
node scripts/production/C/stack.mjs up
pnpm --filter @carwash/workforce run generate && pnpm --filter @carwash/workforce run build
node scripts/production/C/verify.mjs workforce     # unit, postgres (incl. HTTP edge), lane contract
node scripts/production/C/stack.mjs down
```

`test/unit` (pure + in-memory ports), `test/integration/*.pg.spec.ts` (real
PostgreSQL, runtime role; HTTP edge with an Identity double),
`tests/production/C/workforce-contract.test.mjs` (published parsers on live
responses and real outbox rows). `test/workforce.nest.spec.ts` checks module
wiring and the 503 readiness.
