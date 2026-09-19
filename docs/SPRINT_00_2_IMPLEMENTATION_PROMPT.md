# Sprint 0.2 implementation brief

Implement the next foundation slice in THIS carwash-platform repository, not baraabd/homeservicemarketplace. Read AGENTS.md, docs/ARCHITECTURE_AR.md, docs/VERIFICATION.md and architecture/service-catalog.json first. The current shells are not completed microservices.

## Goal

Establish a reproducible Node24/pnpm build and a genuinely isolated, authenticated PostgreSQL/RabbitMQ development runtime. Keep live payments disabled. No redesign, no broad product implementation and no hidden expansion of scope.

## Required work

Inspect Git state and preserve uncommitted work. Resolve package compatibility on supported Node24, generate the real pnpm lockfile and record exact dependency versions. Do not invent lockfile integrity values. Pin CI actions and production image references only after verifying them. Build all NestJS shells, contracts and domain code. Add the minimum NestJS framework tests that exercise bootstrap and dependency injection.

Create service-local Prisma schemas/migrations. Never introduce a shared business Prisma client. Establish runtime and migrator DB identities and prove that each runtime role cannot read/write another service database or change its own schema. Migrations run as separate jobs and are not run by application replicas.

Add a RabbitMQ technical messaging adapter with per-service broker identities, exchange ownership, one queue per subscriber, publisher confirms and handling of unroutable publications. Include durable queues and explicit topology setup. Do not call a single-node local broker highly available. Test two independent consumers receiving the same event, two replicas of one consumer sharing work, and producer ACL denial. Handle shutdown, bounded retries and dead-letter operation.

Implement a persistent Outbox and Inbox for ONE minimal vertical slice with an owner-local transaction. Use a disposable non-financial event. Prove that the consumer commits once despite duplicated delivery and that an unacknowledged event survives a worker restart. Test outage after publisher commit and before broker availability, and crash after consumer commit but before ACK. State clearly which guarantees remain unproven.

Add readiness checks for implemented direct dependencies; keep unimplemented business services marked as foundation-only, and never make readiness green merely to satisfy a dashboard. Keep liveness distinct from readiness. Add structured redacted logging and trace propagation with no personal data in event payloads or log labels.

Add CI lint/typecheck/build/unit/real-DB/real-broker gates, dependency and secret scans. Run the existing 55 tests, add integration/negative tests, capture outputs and final SHA. Use tests as evidence, not labels. No claim of browser, mobile, payment or production readiness in this slice.

## Definition of done

Provide changed files and rationale, source/target SHA, exact runtime/toolchain versions, lockfile and build results, successful isolation and broker integration tests, documented failure/compensation behavior, and remaining blockers. A skipped or unavailable check is not a pass. Open a PR only when the user has authorized a GitHub destination and write; never merge or deploy implicitly.
