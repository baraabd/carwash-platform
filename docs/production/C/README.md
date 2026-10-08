# Lane C — Operations & Technician: production providers

## P02-C — Durable Booking coordinator and initial Dispatch provider

Parent status: **INTEGRATION_PENDING** until all children pass together on one
merge tree and their contracts are published by Lane E.

| Child | Scope | Document |
| --- | --- | --- |
| C1 | Scheduling conforms to the published `scheduling.v1` (holds, commit by Booking, availability) | `P02-C1-scheduling-v1.md` |
| C2 | Booking aggregate, immutable snapshots, idempotent create, durable creation saga, outbox | `P02-C2-booking.md` |
| C3 | Dispatch assignment records and offers, separate from Booking state | `P02-C3-dispatch.md` |

Each child is one branch and one PR from `main`; no child is stacked on another.
Cross-child assumptions: Booking commits the Scheduling hold as its LAST remote
step (pivot), so Dispatch may open a job from a COMMITTED
`scheduling.hold-changed.v1`.

## P01-C — Workforce, Media and Scheduling providers

| Child | Scope | Status |
| --- | --- | --- |
| C1 | Scheduling: capacity windows, expiring holds, no oversell | merged (#96) |
| C2 | Workforce: technician profile, verification, skills, availability, readiness | merged (#102) |
| C3 | Media: private object lifecycle, S3 port, presigned access | not started |

## Shared lane tooling

- `scripts/production/C/stack.mjs`: disposable PostgreSQL 16 (provisioned by
  `infra/postgres/provision.sh`, with the same post-migration hardening as the
  acceptance runner), RabbitMQ 4.2 and SeaweedFS S3 (pinned by digest).
- `scripts/production/C/verify.mjs <service>`: runs every required family and
  writes an exact-source record (`HEAD`, tree, image references) under
  `.acceptance/production-C/evidence/`. A dirty tree is refused for evidence.
- `tests/production/C/`: process-level suites (SIGKILL restarts, database
  restart, broker publication, object storage, published-contract parity).

## Contract requests to Lane E

- `contract-requests/CR-C1-scheduling-v1.md`
- `contract-requests/CR-P02-C1-scheduling-v1-provider.md`
- `contract-requests/CR-P02-C2-booking-v1.md`
- `contract-requests/CR-P02-C3-dispatch-v1.md`

## Known constraints (not hidden)

- Lane C cannot add dependencies (the lockfile is Lane E's): no in-service outbox
  relay or inbox consumer process yet, Identity reused over HTTP instead of local
  JWT verification, interim service credentials, local contract parsers checked
  against the published ones by parity tests.
- `architecture/parallel-ownership.json` is still a W01 proposal
  (`verifiedBaseW02: null`); under it these paths are owned by C but writes are
  "not open". The P0x-C assignments grant this scope; reviewers decide.
- The test identity double maps bearer tokens to session views only; Identity's
  token verification is covered by Identity's own suites, not re-proven here.
