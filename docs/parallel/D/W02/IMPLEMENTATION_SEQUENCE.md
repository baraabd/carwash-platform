# W02-D — Proposed producer and consumer acceptance

Status: **PROPOSED; entry blocked** at the target recorded in `README.md`.
This sequence addresses dependency cycles; it creates no child PR or source code.
E must confirm child scope/gates and immutable accepted bases before coding.

## Dependency order

| Child / prerequisite | Bounded owner scope | Entry and independent exit evidence |
| --- | --- | --- |
| E Identity/Gateway prerequisites | E's existing real Identity plus accepted scoped grants, clients, routes and browser transport | Preserve V1 contracts; real Identity DB/session/CSRF/revocation/forbidden access and compatible wire tests. Guest extensions follow E's own task; D invents none |
| A/B/C policy-validator providers | Each domain owns its validation endpoints and rules, without requiring an unmerged Configuration UI | Accepted typed inputs/receipts; real domain revisions/constraints and authorization. Validator cannot depend on publishing the draft it is validating |
| `W02-D-CONFIGURATION-PROVIDER` | D Configuration domain/application/ports/adapters/HTTP and owned persistence/audit/outbox | Verified base/ownership, frozen contracts, real Identity and required merged validators. Real provider DB/HTTP/broker and contract gates below; does not require a future admin consumer |
| `W02-D-ADMIN-CONSUMER` | D admin shell, real session navigation, settings and accepted Identity role controls | Required producers merged and available in E's accepted candidate/base. Full affected browser journeys pass before consumer acceptance |
| W02 combined barrier | E serialized candidate and actual resulting target | Every parent task-listed test, mandatory job and required independent review; publish next base only through E's authorized process |

Children target `main` from accepted bases and use latest-target candidate checks.
They never branch from an unmerged peer. Provider completion alone keeps the parent
**INTEGRATION_PENDING**; it does not satisfy W02-D's DONE gate.

## Configuration provider boundaries

Configuration owns `market_settings`, `feature_policies`, `configuration_versions`
and its local draft/receipt/audit/outbox state. Add a **new append-only migration**
and schema mirror after entry opens. Preserve
`20261005060000_w01_foundation`; this packet creates no migration ID.

Accept closed, discriminated schemas before interpreting CP-D-002's proposed
`payload: unknown`. Bind market/namespace, exact content hash, draft revision,
expected active version and approved decision/validator receipt references.
Recheck current command authorization and validation applicability at commit.
Append immutable published version, audit, idempotent receipt and outbox together;
the active pointer may change only in that same owner-local transaction.

Scope locks/version constraints must reject concurrent publication from the same
old active version. Lost-response replay returns the committed receipt; a changed
fingerprint conflicts. Broker failure retains durable pending publication without
claiming consumer adoption. An uncommitted DB failure preserves the prior version.
Rollback, if accepted, publishes a newly validated version rather than editing
history. Immediate versus scheduled activation is an unresolved policy decision;
future-time input is not proof of an implemented activation worker.

Configuration does not price a booking, reserve capacity, authorize work, alter
financial records or rewrite historical snapshots. Role/grant records stay in
Identity. Missing authorization, validators or capabilities keep sensitive
operations unavailable and unpublished.

## Task-listed acceptance coverage

All cases below are **BLOCKED / NOT_RUN** for W02-D. Existing W01 case families in
`tests/parallel/D/W01/ACCEPTANCE_SPEC.md` remain the detailed starting inventory.

| Required case | Provider evidence first | Consumer / combined evidence |
| --- | --- | --- |
| Authenticated, anonymous and revoked sessions | Real Identity and Configuration HTTP; recheck revocation during mutation; CSRF failures | Real login/session expiry/revocation; permitted navigation and direct URL access |
| Forbidden settings writes | Service rejects absent command grant even if route can be read | Button visibility separate from route/endpoint authorization; forged/direct requests rejected |
| Cross-market access | Scope-bound reads/commands/operation replay; foreign IDs and receipt mismatch rejected | No foreign-market details or cached values displayed after scope change |
| Invalid values | Closed schema, timezone/currency/duration/feature rules and actual owner-validator refusals | Field/command failure state; no saved toast or current-value replacement |
| Concurrent editors | Draft and active-version races with one commit/immutable audit; stale validation/approval rejected | Conflict preserves unsaved input and shows accepted conflict recovery |
| Retry after timeout | Same actor/scope/key/fingerprint, one effect and replayable receipt after response loss | Query/replay the same operation; do not announce success before authoritative receipt |
| Database restart | Fresh/upgrade migrations, runtime/migration role isolation; restart persistence and transaction recovery | Reload shows committed server values and exact effective version |
| Publication failure | Atomic version/audit/outbox; broker outage/restart, duplicate delivery and crash before ACK; required validator failure prevents publication | Pending delivery/adoption separate from committed policy; historical Booking/Pricing/Billing facts unchanged |
| Shell/reference/accessibility | Accepted design decisions and exact reference bytes | All 17 destinations; pinned Linux reference/candidate/diff at canonical widths; keyboard/modal focus, RTL/LTR, reduced motion and mobile interactions; separate Windows/device evidence |

Unavailable routes remain in the 17-screen scope matrix and display accepted
truthful states. An unavailable destination cannot count as a functional screen.
Production data never falls back to prototype rows or client-side save simulation.

## Discovered commands

These commands exist at the observation target. They are **NOT_RUN** by this
proposal and are not new business acceptance suites. Use the pinned toolchain and
E-allocated environment before execution; each result must bind its actual SHA.

```bash
pnpm --filter @carwash/admin-web typecheck
pnpm --filter @carwash/admin-web build
pnpm --filter @carwash/admin-web test:runtime
pnpm --filter @carwash/configuration generate
pnpm --filter @carwash/configuration typecheck
pnpm --filter @carwash/configuration build
pnpm --filter @carwash/configuration test:runtime
pnpm --filter @carwash/configuration migrate:deploy
pnpm check:boundaries
pnpm check:migrations
pnpm test:contracts
pnpm acceptance:gateway
pnpm acceptance:preflight
pnpm acceptance:run
```

`migrate:deploy` requires the allocated migration identity, not a runtime role.
No production `db push`, reset, shared `infra:down` or broad generator is allowed.
E's `GATE_MANIFEST.json` supplies inherited mandatory CI and isolated-resource
capabilities; W02 business suites and accepted browser policies still need a new
scope manifest. Do not treat existing foundation acceptance as Configuration
business or admin application acceptance.
