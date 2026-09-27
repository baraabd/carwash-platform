# F009 — Foundation CI and security runbook

## Entry point and source of truth

Workflow: `.github/workflows/f009-foundation.yml`.
Required check name: **Foundation release gate**.
Every PR to main/develop, main/develop push, F009 feature push and manual invocation runs it. Concurrency cancels superseded work without declaring it accepted. No production environment or deployment step exists.

F009 starts from main `f368c397d2274eb00261d5dd2a70b25209966c02`. The previous F008 acceptance is a prerequisite, not evidence for the new commit. Read the final PR run and its aggregate report before accepting this sprint.

## Local equivalents

Use the repository's exact `.nvmrc` and `packageManager` versions. Work in a clean dedicated branch. In a Bash shell:

```bash
export CI_TOOLS_DIR="$(mktemp -d)"
export CI_EVIDENCE_DIR="$(mktemp -d)"
export BASE_SHA="$(git merge-base HEAD origin/main)"
corepack enable
corepack prepare --activate
pnpm install --frozen-lockfile
node scripts/ci/install-tools.mjs actionlint gitleaks trivy
node --test --test-reporter=tap tests/ci/gates.test.mjs
node scripts/ci/run.mjs static
node scripts/ci/run.mjs security
node scripts/ci/run.mjs integration
node scripts/ci/image.mjs catalog
```

Repeat `image.mjs` for every target returned by `inventory()` in `scripts/ci/policy.mjs`, including `api-gateway`. Running only catalog is a focused check, never complete image acceptance. The integration command needs Docker, online pinned image/browser installation, PostgreSQL, RabbitMQ and Redis resources. It creates disposable, namespaced infrastructure and uses owner-local migration identities. The inherited migration suite replays and compares migrations for every current database service. Do not replace unavailable infrastructure with mocks or mark it skipped.

`CODEQL_RESULTS` must point to genuine output from the pinned CodeQL action and `CODEQL_VERSION` to its actual init output before running `node scripts/ci/run.mjs codeql`. Empty, missing or malformed SARIF blocks. Local analyzer absence is not a clean CodeQL result.

The aggregate is normally run by GitHub because it needs the current run's complete downloaded artifacts and `NEEDS_JSON`. Do not fabricate these inputs as acceptance evidence. Unit fixtures are explicitly negative tests, not a substitute for CI.

## Gate and evidence map

| Job | Required verification | Artifact record |
| --- | --- | --- |
| plan | Catalog runtime classification and conservative changed-path analysis | plan.json |
| targeted | Early builds of affected owner packages; full gates still required | targeted.json |
| static | actionlint, adversarial CI tests, F001, all builds/types/lints, unit/Nest/gateway/observability, contracts, design and migration guards | static.json |
| integration | Real PostgreSQL/RabbitMQ, all schema drift, real Identity/Redis/browser and gateway | integration.json |
| images | Eleven independent image builds, non-root/live/readiness/shutdown, Trivy and CycloneDX | image-owner.json, scan-owner.json, sbom-owner.json |
| security | Gitleaks source/history, zero pnpm advisories at inherited threshold, reproducible frozen lock | security.json |
| codeql | Pinned JS/TS analyzer plus blocking SARIF severity evaluation | codeql.json, codeql-findings.json |
| aggregate | All jobs successful, complete exact-source records, no unproven evidence | aggregate.json |

Artifacts are named `f009-stage-runId-runAttempt` and retained for 14 days. Only output under the dedicated runner temporary evidence directory is uploaded by F009. No broad repository/evidence-directory glob is used. F009 leaves the inherited byte-frozen reference workflow unchanged; its older evidence policy is not re-described as F009's policy.

## Failure handling

Inspect the failed named step and its stage status. Fix the owning source or test; rerun every required gate on the new head. A successful old head, successful build alone, a canceled matrix member or a manually edited evidence file cannot authorize release. Tool-download checksum mismatches and vulnerability database outages are blocking. Negative tests remove only their own temporary directories.

The aggregate verifies source identity but does not replace review: an author able to modify the workflow can modify its policy too. Configure required reviews and required checks on the protected branch. The repository administrator must apply that setting; this runbook does not assert it has been enabled.

## Acceptance limits

Actual execution results belong in the PR and current-run artifacts. This document is not a passing test report. No full customer/technician/admin app, production deployment, sustained-load result, disaster recovery exercise or physical-device testing is claimed. F010 must not be called accepted before its separate visual/behavior/accessibility evidence exists.

## Runtime maintenance

`NODE_IMAGE` remains the exact F002 builder toolchain. `RUNTIME_IMAGE` is an immutable reviewed distroless Debian 13 digest, also recorded in `scripts/ci/tools.lock.json`. Updating it requires a source change, regenerated service Dockerfiles, reviewed template assertions and the full container/security suite; do not substitute a floating tag. The final runtime uses numeric UID/GID 1000, the exact builder Node binary and only deployed production dependencies. Liveness healthchecks use JSON command form, with no shell dependency.

The first F009 run exposed real image advisories, an old ShellCheck warning and a gateway fixture that used a display name instead of the catalog owner ID. These must be corrected in source and proven on the replacement head. Passing earlier security/integration jobs does not excuse a later failed or missing gate. CodeQL summaries retain only rule/severity and source path/line metadata; snippets and full flow contents stay out of generic artifacts.

## Source security remediation and reference conflict

The first full CodeQL run exposed previously unreviewed findings. F009 hardens the browser-test proxy to a validated loopback port, rejects reserved object-prototype cookie names, uses a single bounded file descriptor for scanner/patch verification, removes check-before-read from the integration context loader, and makes test-file classification segment/filename anchored. Dedicated regression tests exercise these changes without weakening scanner thresholds.

The descriptor helper rejects final-component symlinks, verifies descriptor/path identity and closes on every exit. Parent directories remain trusted; it is not a generic filesystem sandbox. Linux O_NOFOLLOW behavior is exercised by CI. No Windows filesystem-race certification is claimed.

CodeQL also reported findings in the byte-frozen customer HTML and the Redis acceptance ACL's SHA-256 credential representation. These are not automatically classified as exploitable production defects or suppressed. Redis credentials in that fixture are generated from 32 cryptographically random bytes, not human passwords. The protocol-specific finding and prototype-only flows need explicit security review; golden bytes and scanner policy remain unchanged. F009 is BLOCKED while any required finding gate fails, and F010 acceptance cannot precede F009 acceptance.
