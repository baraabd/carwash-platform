# P01-E2 — Runtime artifacts, readiness semantics and app build gates

Lane E, child sprint 2 of P01-E (includes the planned E4 app/CI work; both are
CI/runtime-only and independent of the contract PR). Base:
`f875d31bf62b153b6d36ac7a607949f8c4e29389`.

## Changes

1. **Readiness reports dependency state independently.**
   `@carwash/service-kit` `/health/ready` now always includes
   `dependenciesReady`. `code` keeps its precedence:

   | businessReady | dependencies | HTTP | code | dependenciesReady |
   | --- | --- | --- | --- | --- |
   | false | up | 503 | `FOUNDATION_NOT_READY` | true |
   | false | down | 503 | `FOUNDATION_NOT_READY` | false |
   | true | up | 200 | `READY` | true |
   | true | down/timeout | 503 | `DEPENDENCY_DOWN` | false |
   | any | none registered | — | (by `code`) | `null` (not checked) |

   **Finding from CI on this PR:** all 18 foundation shells register **no**
   dependency probe, so before this fix they would have reported
   `dependenciesReady: true` with the database unreachable. They now report
   `null`. The image check accepts `null` only for a shell; a service with
   `businessReady=true` must probe its database and report `false` when it is
   unreachable. Each owner lane must register its PostgreSQL (and broker)
   probe when it implements its service.

   Before this change a shell with a broken database was indistinguishable from
   a healthy shell. The field is additive; existing assertions on `code` and
   `ready` are unchanged.

2. **18 of 19 owner runtimes are built and boot-verified as images in CI.**
   The `images` job is a matrix over every `architecture/service-catalog.json`
   service except `identity` (previously only `catalog`).
   `scripts/check-images.mjs` defaults to the same set and now parses the
   readiness body: with the DSN pointing at a closed port it requires 503,
   `dependenciesReady=false` and the code matching `businessReady`
   (`DEPENDENCY_DOWN` for an implemented service, `FOUNDATION_NOT_READY` for a
   shell). A 200 is always a failure.

   **Identity is excluded by name.** Its image needs Redis plus signing, CSRF,
   rate and OTP key material just to start, so a database-only boot proves
   nothing. F006 tests Identity in-process, so **today no gate boots the
   Identity image**. This gap is open; an Identity image profile with a real
   Redis container belongs with the Identity changes in P01-E3.

3. **All three web apps are typechecked and built by the root scripts.**
   `pnpm typecheck` and `pnpm build` now include `customer-web`, `operator-web`
   and `admin-web` (`typecheck:apps`, `build:apps`), so the static CI job gates
   them on every PR.

4. **Coverage guard.** `tests/production/E/ci-runtime-coverage.test.mjs` fails
   if the image matrix drifts from the service catalog, an app loses its
   build/typecheck script, or root scripts stop including the apps.

## What this does not prove

- Business readiness of any service: all 19 still report
  `businessReady=false` from source (`BUSINESS_READY = false`), including
  Identity. The status registry is not changed by assertion.
- Production deployment, image vulnerability scanning, registry publication or
  digest custody (E10-B07) — not in scope.
- Per-lane writer enforcement in CI. The existing F001 workflow runs the
  ownership checker on every PR. Binding a PR to one lane needs the externally
  approved policy commit described in `architecture/parallel-ownership.json`
  `trust.laneInput`, which depends on repository governance (E10-B12).
