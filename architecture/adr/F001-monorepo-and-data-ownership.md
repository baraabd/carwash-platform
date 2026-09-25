# ADR F001 — Canonical monorepo and exclusive data ownership

Status: implementation candidate for F001; acceptance requires the final-source gates.
Baseline: `0d6453fc65b62efd287ad3728930857d930e6601` on `baraabd/carwash-platform`.

## Decision and precedence

The owner's F001 request names 20 backend boundaries: 19 data-owning services and
one gateway. This supersedes the **target grouping** in section 2 of
`docs/ARCHITECTURE_AR.md`; it does not rewrite the historical architecture,
attached plan, design authorities, or existing prototype source.

`architecture/service-catalog.json` schema version 2 is the machine-readable
ownership authority. The `services` array intentionally includes only data owners
so the original `scripts/check-boundaries.mjs` remains compatible. `gateway` is
an explicit separate entry with null database/roles and an empty data list.
There is no duplicate `services/gateway` or new `admin-service`.

The existing technician path remains `apps/operator-web`; its audience is
`technician`. The public gateway remains `apps/api-gateway`. Those names are
preserved rather than moving existing files or creating duplicate applications.

## Source and runtime are not the same claim

There are 33 workspace definitions: 19 data services, the gateway, three user
applications, and ten controlled shared packages. Twenty-two previously missing
package skeletons are added. The ten original service packages and original
`event-contracts` package remain in place.

A new `src/index.ts` containing only `export {}` is a module skeleton, not an
application, HTTP server, health endpoint, integration, or deployment result.
The new workspaces have independent build targets, not fabricated start/readiness
scripts. Existing health-only service entry points remain unchanged.

All API/event surfaces in the catalog are versioned **proposals**, not live
endpoints. Reserved `cw_*` database/role identities do not create databases or
prove physical isolation. F001 adds no migration, Prisma client, business write,
queue, network listener, authentication, booking, or payment implementation.

## Exclusive data allocation

| Previously grouped state                              | F001 write owner |
| ----------------------------------------------------- | ---------------- |
| Customer-owned vehicles and plate metadata            | Vehicle          |
| Price versions, quotes and promotions                 | Pricing          |
| Capacity, reservations and expiring holds             | Scheduling       |
| Assignments and assignment attempts                   | Dispatch         |
| Authoritative financial postings and ledger           | Billing          |
| Wallet balances/holds with Billing posting references | Wallet           |
| Subscriptions and entitlement reservations            | Subscription     |
| Booking lifecycle and persistent orchestration        | Booking          |

Wallet is not a second financial ledger. It must reconcile references to Billing
postings through public contracts; it cannot inspect or update Billing tables.
Reporting writes its own event-derived projections, never source-domain tables.
The gateway coordinates transport and response composition, not business state.

The pure files `services/catalog/src/domain/quote.ts`,
`services/booking/src/domain/lifecycle.ts`, and
`services/billing/src/domain/ledger.ts` remain untouched. They are historical,
unconnected prototypes; keeping them is not a claim that the target domain has
been migrated or deployed. Later feature work must implement/extract behavior at
its new owner with tests, rather than import those implementations from another
service. This sprint does not move or copy business logic between services.

## Allowed shared zones

Contracts/event contracts/API clients, UI primitives/design tokens, observability,
security-kit, test-utils, and lint/TS configuration are the only shared zones.
Every package has a concrete version. Runtime consumers must use declared public
package exports, not source aliases or relative paths across owners. No shared
business package, shared Prisma client, or all-domain database package is added.

The existing event-contract package is preserved; F001 does not invent a new
wire format or claim that the proposed events have been implemented. Its current
pure contract tests remain part of the original foundation gate.

## Distributed write policy for subsequent implementations

No distributed write is performed by F001. Before any is introduced, the owning
service must persist an actor/operation-scoped idempotency key, canonical request
fingerprint, and replayable outcome. Reusing a key with a different payload must
conflict. Outbox and local business state commit together; Inbox and consumer
state commit together before ACK. Retries must be bounded and distinguish
transient failure from a rejected command; transport timeouts must not be
interpreted as proof that a write did not happen.

Booking owns durable orchestration and compensation deadlines. Capacity-hold
release belongs to Scheduling, assignment release to Dispatch, and financial
reversal/refund to Billing. Each compensation needs its own idempotency identity
and recorded outcome. A late payment must not restore expired capacity silently.
No distributed transaction or exactly-once guarantee is asserted by this ADR.

## Enforcement and limitations

The original boundary and design gates remain unchanged. New gates add AST
import/dependency checking, JSON Schema plus semantic validation, exact workspace
discovery, and comparison with an actual `pnpm list` during acceptance. JSON
Schema validation uses a small fail-closed implementation of the exact vocabulary
used by this schema; unsupported keywords and remote references are errors. It is
not a general JSON Schema library. An independent Draft 2020-12 implementation
was also used for diagnostic cross-checking, with evidence recorded separately.

Static import checking is not a network firewall or a PostgreSQL/RabbitMQ access
proof. Physical isolation belongs to the runtime/infrastructure sprint. The
separate Sprint 0.2 branch must be reconciled with these 19 owners before merge;
its older ten-service runtime assumptions must not be silently treated as a
compatible implementation of this catalog.

## Patched transitive dependency required by the existing Nest shells

The first real F001 dependency audit failed on Multer 2.2.0 pulled by
`@nestjs/platform-express@11.2.1`: GHSA-wc9g-mqfw-jrwm,
GHSA-qfvm-cv95-jqjf, GHSA-535w-7cp7-47q4 and GHSA-qvfw-j98x-7q72.
Upstream identifies 2.3.0 as the patched release. The root workspace pins only
`@nestjs/platform-express>multer` to **2.3.0**, within the same major version;
this does not disable or filter audit findings or rewrite the existing services.
The lockfile must be generated and audited again after this change. Tests check
the resolved Multer version and adapter/middleware loading in all ten existing
Nest dependency trees; this is dependency compatibility, not production upload
validation. Future upload APIs still need explicit field/file limits and tests.

Upstream: https://github.com/expressjs/multer/security/advisories/GHSA-wc9g-mqfw-jrwm
