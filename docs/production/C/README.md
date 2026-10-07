# Lane C — Operations & Technician: production providers (P01-C)

Parent task P01-C: Workforce, Media and Scheduling production providers.
Parent status: **INTEGRATION_PENDING** until all three children pass together
and their contracts are published by Lane E.

| Child | Scope | Status |
| --- | --- | --- |
| C1 | Scheduling: capacity windows, expiring holds, no oversell | implemented; real PG/RabbitMQ/restart evidence; PR open |
| C2 | Workforce: technician profile, verification, skills, availability, readiness | next |
| C3 | Media: private object lifecycle, S3 port, presigned access | after C2 |

Each child is one branch and one PR from `main`; no child is stacked on another.

## Shared lane tooling

- `scripts/production/C/stack.mjs`: disposable PostgreSQL 16 (provisioned by
  `infra/postgres/provision.sh`, with the same post-migration hardening as the
  acceptance runner), RabbitMQ 4.2 and SeaweedFS S3 (pinned by digest).
- `scripts/production/C/verify.mjs <service>`: runs every required family and
  writes an exact-source record (`HEAD`, tree, image references) under
  `.acceptance/production-C/evidence/`. A dirty tree is refused for evidence.
- `tests/production/C/`: process-level suites (SIGKILL restarts, database
  restart, broker publication, object storage).

## Contract requests to Lane E

- `contract-requests/CR-C1-scheduling-v1.md`

## Known constraints (not hidden)

- Lane C cannot add dependencies (lockfile is Lane E's). Consequences, all
  requested in CR-C1: no in-service outbox relay process yet, Identity reused
  over HTTP instead of local JWT verification, interim service credentials.
- `architecture/parallel-ownership.json` is still a W01 proposal
  (`verifiedBaseW02: null`); under it these paths are owned by C but writes are
  "not open". The P01-C assignment grants this scope; reviewers decide.
- The test identity double maps bearer tokens to permission sets only; Identity's
  token verification is covered by Identity's own suites, not re-proven here.
