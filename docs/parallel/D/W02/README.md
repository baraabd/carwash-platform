# W02-D — Entry checkpoint and prerequisite packet

Task: **Build the authorized admin shell and audited Configuration service**.
Phase: **BLOCKED_ENTRY / lane-local proposals**. Parent acceptance: **NOT STARTED**.
Product implementation, real integration and deployment: **NOT_RUN**.

This packet records authorized independent work while the task's entry requirements
are absent. It does not publish a wave base, accept a contract, expire E's lease,
approve a missing design state, or start another lane or wave.

## Immutable observation

| Fact | Observed value |
| --- | --- |
| Repository | `baraabd/carwash-platform` |
| Observation target | `3db1afdd04c6ec65a38ca83f3993c964a1bf7587` |
| Target tree | `5b51ed5f1779a2cbefc359fdbdc4720779989b4b` |
| Local proposal branch | `proposal/w02-D-entry-gate` |
| Accepted `BASE_W02` | **null** in E's release and ownership registries |
| W02 accepted contract IDs / published package versions | **empty** |
| W01-D packet | [PR #42](https://github.com/baraabd/carwash-platform/pull/42), merged; semantic contract approval still pending |
| E technical bootstrap | [PR #45](https://github.com/baraabd/carwash-platform/pull/45), merged; parent `INTEGRATION_PENDING` |

`BASE_OBSERVATION.json` records the dated API/source observation. The source SHA is
an audit target, **not BASE_W02**. Current checks on that target do not turn empty
contract registries into an accepted release. E's `W01-E-CONTRACTS` and
`W01-E-BARRIER` remain the recorded release path.

The prompt describes the W01 lease as expired, but also explicitly requires E's
verified base and explicit lease termination before dependent writes. The checked
registry has `verifiedBaseW02: null` and lease expiry `verified-BASE_W02`; no
published termination was found. The dependent source writes therefore remain
closed. Lane-local documentation is permitted by the task and current checker.

## Source facts that changed since W01

| Surface | Current source-derived behavior | Required dependency |
| --- | --- | --- |
| Admin boot | `apps/admin-web/src/index.ts::WEB_RUNTIME` marks `foundation-only`, `businessReady: false`; no product router or real session/client integration | Accepted shell/state decisions and Identity/client contracts |
| Admin commands | Package now supplies Vite `dev`, `preview`, `build`, `typecheck`, `start`, `test:runtime`; root build/typecheck still omit frontend apps | Explicit app commands in the scope gate |
| Browser transport | `server.mjs::createWebRuntime` CSP has `default-src 'none'` without `connect-src`; flat asset routing lacks product deep-link fallback. Vite has no proxy; Gateway has no CORS setup | E-approved deployment/origin/CSRF/CSP policy, reserved config changes and D-owned transport implementation after ownership opens |
| Shared clients/UI | API clients, UI and design tokens each export an empty module | E publishes actual public exports and manifest dependencies; D does not copy private implementations |
| Identity | Real V1 sessions, live authorization, CSRF, revocation and account mutations exist | Preserve V1; accept scoped administration/Configuration grants separately |
| Gateway | Current owner/route registry excludes Configuration; admin overview combines Billing/Support; query strings are rejected by route matching | E accepts precise routes, clients, query/deadline/error behavior; no generic proxy |
| Configuration | Nest/Prisma foundation exists, `BUSINESS_READY=false`; schema/migration contain only `ServiceMarker` | Typed policy contract, authorization, owner validators and a new D-owned migration |
| Configuration messaging | Generic consumer adapter exists; no business publisher, audit, idempotency, outbox or adoption behavior | Accepted event schema and E broker identity/ACL/topology |

Configuration's Nest test uses a placeholder DSN and proves framework/health
behavior. It is not database, broker, policy persistence or publication evidence.
The unused `postgresProbe()` does not establish a live readiness dependency.

## Concrete prerequisite requests

| ID | Responsible owner | Required reviewable result | Writes/gates blocked |
| --- | --- | --- | --- |
| ENTRY-D-01 | E | Publish full verified `BASE_W02`, accepted package/wire versions and review record; explicitly end exact W01 leases and publish effective ownership of current paths | D app/service business source |
| ENTRY-D-02 | E / Identity | Accept CP-D-001's applicable scoped session/grant/delegation contract, current authorization/CSRF/revocation and role-command semantics; preserve strict V1 compatibility | Scoped reads/writes and real admin role controls |
| ENTRY-D-03 | E + D, with A/B/C approval for affected policies | Accept CP-D-002 closed namespace schemas, scope/version/receipt/publication semantics and concrete validation providers | Configuration schema/API/publication and settings consumer |
| ENTRY-D-04 | E | Publish generated clients, Gateway Configuration routes, compatible exports/dependencies; settle browser origin/CSP/deep-link policy and reserved app config | Real browser session/settings integration and build dependencies |
| ENTRY-D-05 | Baraa/design + D | Resolve DEC-D-18 for shell additions, missing auth/loading/denied/empty/error/conflict/save states and English/LTR; pin exact approved additions | Claiming those surfaces approved or visual acceptance |
| ENTRY-D-06 | B + C, with A for Geo references | Approve currency/exponent/timezone, holds/delays, service-hours/zone references and current owner validation revisions | Domain-impacting publication; existing transactions remain immutable |
| ENTRY-D-07 | E + D | Allocate D/W02/run resources and pinned Node/pnpm, register Configuration broker capability and updated gate commands | Real HTTP/DB/broker/browser scope evidence |

### ENTRY-D-01 ownership transition defect

A read-only, in-memory `effectiveOwner()` expiry-branch diagnostic reproduces
eight currently leased D paths becoming `undeclared-path` after the lease ends:

```text
services/reviews/prisma.config.ts
services/reviews/README.md
services/configuration/prisma.config.ts
services/configuration/README.md
apps/admin-web/index.html
apps/admin-web/vite.config.ts
apps/admin-web/server.mjs
apps/admin-web/test/runtime.test.mjs
```

The historical inventory predates these paths; `permanentOwner()` recognizes
service `src/test/prisma` and app `src`, but not these added paths. Admin README is
already inventoried D and correctly survives the transition. E should resolve
each exact path in a reviewed inventory transition and test **every lease path**
after expiry. The current expiry test covers only Vehicle main and the C014
workflow. Preserve E ownership of reserved manifests/config and active leases
until actual expiry. No registry/checker changes or accepted-base data were made
by this diagnostic; it tests control flow only and cannot approve a transition.

The existing W01 decision IDs remain **OPEN** unless an accepted decision record is
published. No SAR/Riyadh/Card samples, proposed TTLs, market inputs, reviewer or
last-admin policy become production values through this packet.

See [IMPLEMENTATION_SEQUENCE.md](IMPLEMENTATION_SEQUENCE.md) for bounded child
acceptance and [W03_CONTRACT_REQUESTS.md](W03_CONTRACT_REQUESTS.md) for next-wave
requests. Neither document is an accepted contract or implementation authorization.
