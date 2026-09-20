# Sprint 0.2 verification

Evidence for the foundation-runtime slice. Every number below was produced by a command run
against this tree; nothing is carried over from an earlier round, and nothing is estimated.

A gate that did not run is recorded as NOT RUN. A skipped test is not a pass.

## Source and toolchain

| Item | Value |
| --- | --- |
| Base commit | `0d6453fc65b62efd287ad3728930857d930e6601` |
| Branch | `feat/sprint-00-2-foundation-runtime` |
| Node | 24.21.0 (pinned by `.nvmrc`, `engines` requires `>=24 <25`) |
| pnpm | 10.32.1 (pinned by `packageManager`) |
| TypeScript | 5.9.3 |
| Lockfile | `pnpm-lock.yaml` present; `pnpm install --frozen-lockfile` succeeds |
| Host | win32/x64, Docker Engine 29.1.3, Compose 2.40.3 |

Resolved dependency versions are read from the installed tree by
`node scripts/resolve-dependencies.mjs`, never from a manifest range:

| Package | Version | Declared by |
| --- | --- | --- |
| @nestjs/core, common, platform-express, testing | 11.2.5 | services/* |
| prisma / @prisma/client / @prisma/adapter-pg | 7.10.0 | services/* |
| pg | 8.23.0 | services/* |
| amqplib | 2.0.1 | packages/platform-messaging |
| rxjs | 7.8.2 | services/* |
| typescript | 5.9.3 | root |
| eslint | 10.11.0 | root |
| prettier | 3.9.8 | root |

Acceptance infrastructure images are pinned by tag and resolved to a digest at run time:

| Image | Tag | Digest resolved during the accepted run |
| --- | --- | --- |
| PostgreSQL | `postgres:16.10-alpine` | `sha256:029660641a0cfc575b14f336ba448fb8a75fd595d42e1fa316b9fb4378742297` |
| RabbitMQ | `rabbitmq:4.2-management-alpine` | `sha256:643139a7e9b4d7e2c1d6a06295d0296c3c58e5de7666a09630b4564a15c951cd` |
| Node (service images) | `node:24.21.0-bookworm-slim` | `sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6` |

## Gate results

### Offline gates

| Gate | Command | Result |
| --- | --- | --- |
| Formatting | `pnpm format:check` | PASS |
| Lint | `pnpm lint` | PASS |
| Frozen design reference | `pnpm check:design-reference` | PASS, 10 artifacts verified |
| Design guard tests | `pnpm test:design-lock` | 12 passed, 0 failed, 0 skipped |
| Architecture boundaries | `pnpm check:boundaries` | PASS, 10 owners / 60 source files / 34 architectural rules |
| Typecheck | `pnpm typecheck` | PASS |
| Build | `pnpm build` | PASS |
| Domain and contract tests | `pnpm test:domain` | 55 passed, 0 failed, 0 skipped |
| Unit tests | `pnpm test:unit` | 139 passed, 0 failed, 0 skipped |
| NestJS bootstrap / DI tests | `pnpm test:nest` | 80 passed, 0 failed, 0 skipped |
| Secret scan | `node scripts/check-secrets.mjs` | PASS |

The customer design lock is unchanged: the same 10 reference artifacts verify, and the guard's
own negative cases (deleted reference, tampered manifest, path traversal, symlink, policy
tampering) still fail closed.

### Real-infrastructure acceptance

`pnpm acceptance:run` provisions an ephemeral PostgreSQL and RabbitMQ per run, migrates each
service with its own migration identity, hardens runtime privileges, declares the broker
topology, runs the integration suites and tears the stack down.

**Result: ACCEPTED - 12/12 phases, 145 integration tests passed, 0 failed, 0 skipped.**

| Suite | Tests | What it proves against real servers |
| --- | --- | --- |
| `migrations` | 53 | migrations applied by a separate identity; re-deploy is a no-op; committed migrations reproduce `schema.prisma` with zero drift for all 10 services; replicas hold no privilege that could migrate |
| `postgres-isolation` | 54 | runtime roles cannot run DDL, cannot touch `_prisma_migrations`, cannot `SET ROLE`, cannot connect to another service's database (runtime **and** migration identities); `public` is unusable |
| `rabbitmq-acl` | 20 | producer/subscriber ACL denials are real 403s; no default-exchange bypass; `guest` deleted; no identity holds the administrator tag; vhost isolation |
| `messaging-delivery` | 5 | fan-out to two services; competing consumers sharing one queue; unroutable returns; poison message to DLQ; durability with no consumer attached |
| `outbox-inbox` | 13 | state + outbox commit and roll back together; broker outage after commit recovers; duplicate delivery applies once; crash between commit and ACK does not duplicate; lease takeover; no personal data in envelopes |

Evidence for the accepted run is committed at `evidence/acceptance/20260920-47190f29/`:
`acceptance-report.json`, `integration.tap`, and redacted PostgreSQL and RabbitMQ logs. The run
was performed on the final tree, after the last source change.

### Container images - NOT RUN locally, runs in CI

`node scripts/check-images.mjs` builds each image from `Dockerfile` and asserts the contract it
claims: non-root execution, liveness 200, readiness 503, no `.env` in the image, and a clean
SIGTERM shutdown.

A readiness of 503 is the CORRECT result here. These are foundation shells with no business API,
and a 200 would mean a shell was advertising a readiness it does not have.

**Local result: NOT RUN.** Two attempts were made and neither completed. The image build performs
a cold `pnpm install --frozen-lockfile` inside the container, which downloads several hundred
megabytes, and download throughput from this host was measured at the time as:

| Path | Measured throughput |
| --- | --- |
| host -> registry.npmjs.org | ~30 KB/s |
| container -> registry.npmjs.org | ~26 KB/s |

The container is not the bottleneck; the host's own connection was equally slow, so a cold install
would take hours. The first attempt reached 337 of 338 packages after roughly 15 minutes and was
stopped by a timeout; the second was stopped deliberately after 27 minutes once the throughput
above was measured.

This is an environment limitation, not a finding about the Dockerfile, and it is recorded as NOT
RUN rather than as a pass. The `images` job in `.github/workflows/sprint-02-ci.yml` runs the same
script on a GitHub runner, and its result is the evidence for this gate.

### Security

`pnpm audit` reported 7 advisories (5 high) before this slice was completed. Both chains were
exact upstream pins, so no update resolved them and explicit `pnpm.overrides` were added:

| Advisory | Package | Chain | Action |
| --- | --- | --- | --- |
| 4 advisories, 3 high + 1 low | multer <2.3.0 | `@nestjs/platform-express` (runtime) | override to `>=2.3.0`, resolves to 2.4.0 |
| 2 advisories, 1 high + 1 moderate | mysql2 <3.23.1 | `prisma` CLI (build only) | override to `>=3.23.1` |
| 1 high | deepmerge-ts <8.0.0 | `prisma` > `@prisma/config` (build only) | override to `>=8.0.0` |

`pnpm audit` now reports no known vulnerabilities. The Prisma CLI still functions on the bumped
`deepmerge-ts` major, proven by the migration suite running to completion afterwards.

No private key, credential, `.env` file or per-run acceptance secret is committed. Acceptance
credentials are generated per run into the git-ignored `.acceptance/` directory and redacted from
every log and report that is persisted.

## Defects found and fixed while verifying

Three defects were found by running the gates rather than by reading the code:

1. **The acceptance gate hung indefinitely.** On a freshly provisioned stack the subscriber
   queues do not exist yet, because a subscriber declares its own queues when its consumer
   starts. The fixture's purge/depth helpers called `purgeQueue`/`checkQueue` on a missing queue;
   RabbitMQ replied 404, which closes the channel and emits `error` on the connection. With no
   listener the pending promise never settled, so `beforeEach` blocked forever - with
   `--test-timeout=0` that was an unbounded hang, not a failure. Fixed by declaring each
   subscriber's own topology as that subscriber, using one channel per operation, and attaching
   the connection/channel error handlers that turn a broker refusal back into a rejected promise.
   A per-test timeout was also added so a future hang fails fast instead of consuming the phase
   budget.

2. **A vacuous test.** `exec-harness`'s process-tree kill test interpolated a Windows temp path
   through two levels of JavaScript string parsing. The inner process wrote to the
   drive-relative path `C:Users...` inside the repository while the test looked in `%TEMP%` and
   found nothing, so both measured sizes were `0` and the assertion passed whether or not the
   grandchild had been killed. The path now travels in the environment, the test asserts the
   grandchild was actually writing before the kill, and the marker is cleaned up.

3. **Missing orchestration.** `package.json` referenced `scripts/acceptance.mjs`,
   `scripts/run-integration-tests.mjs` and `scripts/resolve-dependencies.mjs`, none of which
   existed; the acceptance library modules had no entry point. These were implemented.

## Guarantees this slice does NOT establish

- **Not exactly-once delivery.** The model is at-least-once transport plus idempotent
  consumption through the Inbox. The tests prove the effect is applied once; they do not prove
  the message is delivered once, and no such claim is made.
- **Not high availability.** The acceptance broker and database are single nodes on a developer
  or CI host. Nothing here says anything about clustering, failover or quorum queues.
- **Not production readiness.** No production deployment, no TLS to the acceptance broker, no
  container vulnerability scan, no load or soak testing.
- **Not payment, browser or mobile readiness.** No payment provider is connected, live money
  stays disabled, and no browser or device testing was performed in this slice.
- **Not a complete security audit.** `scripts/check-secrets.mjs` covers this repository's own
  leak shapes and does not inspect git history; it is not a substitute for a dedicated scanning
  product, and no SAST or image scanning runs yet.
- **Business APIs are still unimplemented.** All ten services remain foundation shells whose
  readiness is deliberately 503. Only the catalog -> communications/reporting probe slice
  exercises the messaging path end to end.
