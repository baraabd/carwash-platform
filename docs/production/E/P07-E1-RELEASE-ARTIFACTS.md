# P07-E1 — Immutable release artifacts, SBOM/provenance and separate migration jobs

Lane E · parent task P07-E (staging, artifacts, migrations, backup/restore, governance).
Status: **implemented; registry evidence comes from the workflow run on this PR (rehearsal)
and from the first run on `main` (GHCR publication).** Not a staging deployment and
not a release candidate.

## What this adds

| Path | Purpose |
| --- | --- |
| `infra/release/Dockerfile.migrate` | One-shot migration job image per database owner. Contains only the owner's `prisma/` directory, the pinned Prisma CLI and `migrate-job.mjs`; no application code. Install layer is shared across owners (`ARG SERVICE` is declared after it). Runs as uid 1000, npm/corepack/yarn removed. |
| `infra/release/migrate-job.mjs` | Fail-closed job entry point (see below). |
| `scripts/production/E/release/manifest.mjs` | Release manifest schema, validation, migration-set digest, canonical manifest digest. |
| `scripts/production/E/release/build-release.mjs` | `build` one catalog target (runtime + migration image) with BuildKit SPDX SBOM and `mode=max` SLSA provenance, push, read the attestations back **from the registry**; `assemble` all parts into `release-manifest.json`; `local-registry` for PR rehearsal. |
| `scripts/production/E/release/verify-release.mjs` | Verifies a manifest (or one part) against the registry by digest: digest, platform, revision label, attestation presence and hashes, provenance names the source commit, migration-set digest recomputed from git, `docker pull <repo>@<digest>`. |
| `scripts/production/E/release/rehearse-migration-job.mjs` | Runs the **published** migration image by digest against a real PostgreSQL 16 provisioned by `infra/postgres/provision.sh`. |
| `.github/workflows/p07-release-artifacts.yml`, `p07-release-build.yml` | PR: rehearsal against a loopback registry, read-only token. `main`: GHCR publication + `actions/attest-build-provenance` (Sigstore). |
| `tests/production/E/release-artifacts.test.mjs` | Pure/static tests (18 incl. existing CI coverage guard). |

## Artifact model

For every catalog runtime target (19 services, `api-gateway`, 3 web apps):

- runtime image `<registry>/carwash-<id>@sha256:…` built from the target's **own** Dockerfile,
  the same file the F009 image gate scans;
- for each of the 19 database owners, `<registry>/carwash-<id>-migrate@sha256:…`.

Every image build arg naming an image is a digest: Node base resolved once per run
(`public.ecr.aws/docker/library/node@sha256:…` or Docker Hub), runtime and native donor
from `scripts/ci/tools.lock.json`. The pushed tag is the full commit SHA and is never
read by a deployment; `validateManifest` rejects any reference that is not
`repository@sha256:<64 hex>` (including `name:tag@digest`).

`release-manifest.json` binds: source SHA/tree/commit time, `pnpm-lock.yaml`,
`tools.lock.json` and `Dockerfile.migrate` blob ids, base image digests, every artifact
digest, SBOM/provenance hashes, and each owner's migration set
(sha256 over git blob ids of `prisma/migrations/**` + `schema.prisma`, line-ending proof).
`manifestDigest` is sha256 of the canonical JSON. Assembly refuses parts built from a
different commit, different base images or a different registry, and refuses
incomplete coverage. The build refuses a context that differs from the commit
(modified or untracked files under the build inputs).

## Migration job contract (`migrate-job.mjs`)

| Rule | Failure code |
| --- | --- |
| DSN only from `MIGRATION_DATABASE_URL_FILE` (absolute, regular file, one line, ≤4 KiB) | `PLAINTEXT_DATABASE_URL_REFUSED`, `MIGRATION_DATABASE_URL_FILE_REQUIRED`, `SECRET_FILE_*` |
| User must be `cw_<svc>_migrate`, database `cw_<svc>`, `schema=app`, password present | `NOT_THIS_OWNERS_MIGRATION_IDENTITY`, `NOT_THIS_OWNERS_DATABASE`, `DSN_SCHEMA_MUST_BE_APP` |
| TLS `sslmode` ∈ require/verify-ca/verify-full unless `MIGRATION_DB_TLS=disabled-rehearsal` (recorded in evidence) | `DSN_TLS_REQUIRED` |
| Session `current_user`/`current_database()` re-checked after connect | `SESSION_IDENTITY_MISMATCH` |
| Applied migration checksum must equal the image's file | `APPLIED_MIGRATION_MODIFIED` |
| Failed/running or rolled-back migration rows stop the job | `FAILED_OR_RUNNING_MIGRATION`, `ROLLED_BACK_MIGRATION_PRESENT` |
| Database contains a migration this image does not know (older job vs newer schema) | `DATABASE_AHEAD_OF_IMAGE` |
| After deploy: owner-executed hardening (history table and schema CREATE revoked from runtime role; configuration history append-only) | — |
| Deployed schema must equal `schema.prisma` (`prisma migrate diff --from-config-datasource --to-schema --exit-code`) | `schemaDrift: DRIFT` |

Exit codes: 0 pass, 1 failed, 3 refused before connecting. Child output is redacted
(password raw and URL-encoded, any `postgres://` URL). Hardening needs no superuser:
the migration role owns the database, schema and tables it grants on.

## Real-dependency rehearsal per owner (runs in CI, not on this workstation)

`rehearse-migration-job.mjs` runs the image **by digest** with `--read-only`,
`--cap-drop ALL`, `no-new-privileges`, uid 1000 and an internal-only Docker network, and
requires every case to PASS: `refuse-plaintext-env`, `refuse-runtime-identity`,
`refuse-missing-tls`, `deploy` (applied == manifest migration set, no drift),
`deploy-idempotent`, `runtime-ddl-denied` (CREATE TABLE in app/public, CREATE SCHEMA,
ALTER, DROP, TRUNCATE, CREATE FUNCTION, read `_prisma_migrations`, `SET ROLE` to the
migration role), `runtime-dml-allowed`, `detect-database-ahead`, `detect-schema-drift`,
`verify-after-repair`, `job-sandbox`. Across the 19 matrix jobs this covers all-owner
runtime DDL denial and deployed-schema drift detection.

## Evidence on this PR

Recorded in the PR body after the workflow run: run id, per-target pass/fail, the
rehearsal manifest digest. Evidence artifacts (`p07-release-rehearsal-*`) hold every
part, SBOM, provenance, verify report and migration-job report for 90 days.

## Not proven here / remaining blockers

- **GHCR publication** happens only on `main` after merge; until that run is green there
  is no published release. Package visibility/retention on GHCR is an owner setting.
- Staging deployment by digest, sanitized config revisions, TLS/DNS/object storage
  wiring: P07-E2. Populated upgrade, backup/restore, broker/Redis/object recovery,
  alerts, RPO/RTO: P07-E3. Governance and CodeQL disposition: P07-E4. RC freeze: P07-E5.
- Only `linux/amd64` is built (the reviewed CVE VEX applies to amd64 only).
- The migration job base is Node bookworm-slim by digest (schema engine needs OpenSSL);
  its Trivy scan is not yet part of the F009 image gate — tracked as P07-E1-B1.
- BuildKit provenance is unsigned in the PR rehearsal; Sigstore-signed GitHub
  attestations exist only for the GHCR publication.
