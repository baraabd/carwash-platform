# ADR 0005 — Clean-architecture microservice template

Status: Accepted for F003 foundation shells.

## Decision

Every service whose catalog entry is marked `runtimeImplementation: existing-health-only-shell` uses the same generated outer shell and exposes five explicit source layers:

- `domain`: business invariants and value/domain logic; framework and IO free.
- `application`: use-case orchestration; depends inward and on ports, never concrete IO.
- `ports`: contracts required by application code; framework and IO free.
- `infrastructure`: service-owned implementations such as Prisma adapters.
- `transport`: HTTP and message adapters. Transport delegates to application handlers.

`src/app.module.ts` is the composition root. It may import infrastructure and transport-facing technical modules because wiring is its purpose. `src/main.ts` contains no wiring policy beyond invoking the shared bootstrap.

## Compatibility with F002

F002 acceptance code imports `src/prisma.service.ts` and expects `src/app.module.ts` to expose `SERVICE_NAME`, `BUSINESS_READY` and `postgresProbe`. F003 preserves those interfaces. `src/prisma.service.ts` is now a thin re-export of the infrastructure implementation rather than the implementation itself.

The existing catalog/communications/reporting outbox/inbox probe slice remains at its current paths. Moving that already-tested F002 messaging code is not required to establish the F003 template and would create unrelated acceptance risk. Later messaging work may migrate it behind explicit ports.

## Runtime semantics

- Typed configuration fails closed and owns bounded startup/shutdown timeouts.
- `/health/live` means the process can answer requests.
- `/health/ready` means business traffic is permitted. Foundation shells stay `503` with `BUSINESS_READY=false` even if a dependency is healthy.
- One shared bootstrap installs correlation propagation, the standard error filter and graceful SIGTERM/SIGINT handling.
- Public error responses never echo arbitrary internal exception messages.
- Message-consumer adapters invoke application handlers but do not invent ACK, retry or DLQ policy.

## Generation and drift

`scripts/dev/service-template.mjs` is the side-effect-free renderer and owns the catalog selector for F003 foundation shells. `generate-service-shells.mjs` and `scripts/check-layers.mjs` use that same selector, so F001 ownership-only entries marked `directory-and-typescript-skeleton-only` are not mistaken for fully materialised F003 runtime shells. A service enters the F003 template contract only when its catalog runtime status is promoted explicitly. `generate-service-shells.mjs` materialises only template-owned files and supports `--check`. CI runs the drift check through the architecture boundary gate, so copy/paste edits to one service shell fail instead of silently diverging.

Each service receives its own multi-stage Dockerfile. It builds with the locked toolchain, a frozen lockfile and a non-root runtime. The existing root parameterised Dockerfile remains for F002 compatibility.

## Enforcement

`scripts/check-layers.mjs` rejects forbidden dependencies from domain/application/ports and requires the five layers, non-ready foundation semantics and per-service Dockerfile contract. Negative tests prove the guard fails when a framework import is introduced into an inward layer.

## Consequences

The template reduces duplicated bootstrap code while preserving independent service packages and service-local database adapters. It intentionally does not implement any business endpoint and does not make any foundation shell production-ready.
