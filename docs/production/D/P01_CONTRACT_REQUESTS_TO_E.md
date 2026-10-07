# P01-D contract and dependency requests to Lane E

Status: **SUBMITTED BY D / NOT ACCEPTED**. Lane D does not write shared packages,
manifests that change the lockfile, CI, infrastructure or the gateway. Each
request below names the exact change. D consumes only E's merged, versioned
result. Until a request merges, the dependent D behavior stays fail-closed, as
described in its row.

Base observed when these were written: `origin/main` `f875d31bf62b153b6d36ac7a607949f8c4e29389`.

## CR-D-P01-01: Identity permissions for supporting domains

Add to `packages/contracts/src/identity.ts` (`IDENTITY_PERMISSIONS`) and to the
Identity role mapping (`services/identity/src/domain/auth-policy.ts`, owned by
Identity/E):

| Permission | Purpose | Proposed roles |
| --- | --- | --- |
| `configuration.read` | Read effective values and revision history | `operations`, `support`, `finance`, `super-admin` |
| `configuration.write` | Propose/activate a revision (review metadata required) | `super-admin` |
| `reporting.read` | Read projection series and reconciliation drift | `operations`, `finance`, `super-admin` |
| `communications.read` | Read notification delivery state (no message bodies) | `operations`, `support`, `super-admin` |
| `admin.shell.access` | Enter the admin application shell at all | every staff role except `customer`, `technician` |

Compatibility: additive enum members. Today, `isIdentityPermission` in the
gateway rejects unknown strings. The gateway and Identity must ship the new
members together, before any service relies on them.

Interim D behavior: the services check these exact strings against the
Identity session's `permissions`. No current role carries them, so every
protected route returns `403 AUTH_FORBIDDEN` (deny by default). D does not reuse
an unrelated permission such as `operations.dispatch`.

## CR-D-P01-02: admin-web React dependencies (lockfile)

Add to `apps/admin-web/package.json` the versions **already resolved** in
`pnpm-lock.yaml` for `apps/customer-web`. This adds importer entries only and no
new packages to the store:

```json
"dependencies": {
  "react": "19.3.0",
  "react-dom": "19.3.0",
  "react-router-dom": "7.18.4"
},
"devDependencies": {
  "@types/react": "19.3.0",
  "@types/react-dom": "19.3.0",
  "@vitejs/plugin-react": "6.1.1",
  "typescript": "5.9.3",
  "vite": "8.3.1"
}
```

Also requested, if E accepts browser evidence for admin-web in this phase:
`@playwright/test` and `axe-core` are already root devDependencies, so no
change is needed there.

Interim D behavior: `apps/admin-web` stays the W01 technical boot. The React
shell (P01-D4) is not started, because typechecking and building it would
require editing the lockfile.

## CR-D-P01-03: service dependencies on shared libraries (lockfile)

| Service | Add | Why |
| --- | --- | --- |
| `services/configuration` | `@carwash/contracts: workspace:*` | Use the published `IdentitySessionView`/`isAccessPrincipal` instead of a local tolerant reader |
| `services/configuration` | `@carwash/platform-messaging: workspace:*` | Relay the configuration-change Outbox (CR-D-P01-04) |
| `services/communications` | `@carwash/contracts: workspace:*` | Same as above, for the delivery-state read API |
| `services/reporting` | `@carwash/contracts: workspace:*` | Same as above, for the projection read API |

Interim D behavior: each service has a minimal, documented, tolerant reader of
the Identity session response. It reads only `subject`, `sessionId`,
`authVersion` and `permissions`, cross-checks them, and fails closed on any
other shape. It is not a published contract copy, and it is deleted when this
request merges.

## CR-D-P01-04: events and broker topology

| Event | Producer | Payload (exact keys) | Consumers |
| --- | --- | --- | --- |
| `configuration.revision-activated.v1` | configuration | `namespace`, `key`, `environment`, `tenantId` (nullable), `revision` (int ≥ 1), `valueHash` (sha256 hex) — never the value itself | services that cache configuration |
| `communications.delivery-state-changed.v1` | communications | `notificationId`, `state` (closed enum), `attempt` (int ≥ 1), `observedAt` — no recipient, address or body | reporting |

Each also needs a producer exchange, subscriber queues/DLQ and a least-privilege
ACL in `infra/rabbitmq/acceptance-bootstrap.sh` and
`packages/platform-messaging/src/topology.ts`.

Interim D behavior: configuration revisions are audited in their own append-only
table, but no event is emitted. The Communications state machine and the
Reporting primitives run on the only accepted runtime stream, the foundation
probe.

## CR-D-P01-05: gateway routes

Add `GatewayOwner` `configuration` and `communications`, plus these routes, all
`GET` and read-only in P01:

| Route id | Path | Upstream | Permission |
| --- | --- | --- | --- |
| `configuration.effective` | `/admin/configuration/{namespace}/{key}` | `/internal/v1/configuration/values/{namespace}/{key}` | `configuration.read` |
| `reporting.metric-series` | `/admin/reporting/metrics/{projection}/{metricKey}` | `/internal/v1/reporting/metrics/{projection}/{metricKey}` | `reporting.read` |

Mutating configuration routes (`POST .../revisions`, `POST .../activate`) are
requested only after CR-D-P01-01 merges, with `idempotency: 'required'`.

## CR-D-P01-06: reconcile the configuration contract with the owner model

Observed while preparing this handoff: E's **unmerged** branch
`prod/p01-e1-business-contract-conventions` drafts `configuration.v1` as
closed, market-scoped namespaces (`booking.policy.v1`,
`market.presentation.v1`) with structured content, a `drafts → approve →
publish` lifecycle and permissions `configuration.write`/`approve`/`publish`
plus `service:configuration.read`.

P01-D3 implements what P01-D asked for: typed values scoped by environment and
tenant, with `revisions → review → activate`. The owner mechanics carry over
one-to-one:

| E draft | D3 implementation |
| --- | --- |
| draft | `config_revision` (append-only, idempotent, author and reason) |
| approve (`SELF_APPROVAL_FORBIDDEN`) | `config_review` (one decision, `SELF_REVIEW_FORBIDDEN`) |
| publish with `expectedVersion` (`DRAFT_NOT_APPROVED`) | `activate` compare-and-set on `config_pointer.version` (`REVISION_NOT_APPROVED`) |
| `POLICY_UNAVAILABLE`, no defaults | `NOT_CONFIGURED`, no defaults; reads fail closed |

D does not consume the unmerged draft (no stacking on a private provider
branch). Request: E and the owner decide on one wire model. If E's closed
namespaces are accepted, D adds `/scopes/:marketId/:namespace/...` routes as an
adapter over the same revision store (market → tenant scope, namespace content →
a closed typed value) and aligns the reason codes and the separate
approve/publish permissions. The generic key/value routes are retired or kept
internal only by that decision.

## CR-D-P01-07: foundation integration harness leaks a relay on failure (Windows)

`tests/integration/outbox-inbox.test.mjs` "Case D: a row leased by a worker that
died…" sets a 2-second lease, spawns a relay process and waits for it to connect
plus 500 ms. On a loaded host this exceeds the lease, the relay legitimately
reclaims the row, the assertion fails, and `relay.stop()` is skipped (no
`try/finally`/`t.after`). The leaked `recovery-relay` keeps leasing Catalog rows,
so every later relay case fails: competing relays, D3, E and F.

Evidence (2026-10-07): the same five-to-six failure cluster on a `main`-identical
tree (Catalog, Communications, Reporting, packages and tests byte-equal to
`f875d31`) and on the P01-D1 tree. Two `recovery-relay` processes were still
running after the suite ended, and stopping them was required. Request (E owns
`tests/integration`): stop the relay in `finally`, and measure the lease window
from after the relay is connected. P01-D changes no Catalog relay code.
