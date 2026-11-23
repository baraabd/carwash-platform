# W02-B entry readiness and prerequisite evidence

Task: `W02-B` — persistent Catalog and immutable Pricing quotes. Phase:
**ENTRY_BLOCKED / LANE_LOCAL_PROPOSAL**. Parent: **NOT STARTED**; this packet is
not implementation, contract acceptance, operational evidence or a DONE claim.

## Immutable observation

Audited target on 2026-10-05:
`3db1afdd04c6ec65a38ca83f3993c964a1bf7587`, tree
`5b51ed5f1779a2cbefc359fdbdc4720779989b4b`. This observed main SHA is not
`BASE_W02`. No current-main CI conclusion is asserted by this source inventory.

At that source, `architecture/parallel-contract-release.json:20–23` records
`BASE_W01=69d81a83a3409d0693272efeb19ebeb9805750f5` and `BASE_W02=null`.
Its lines 87–94 record no accepted next-wave contracts, no accepted release
source/review record and no published W02 package versions. These explicit
release fields take precedence over inferring acceptance from merged documents.

Existing packages are `@carwash/contracts@0.0.2`,
`@carwash/event-contracts@0.0.2` and `@carwash/api-clients@0.0.1`.
The executable HTTP registry publishes only `identity.v1` and `gateway.v1`
(`packages/contracts/src/registry.ts:14–32`). API clients remain empty
(`packages/api-clients/src/index.ts:1–2`). The two registered event shapes are
`foundation.probe.created.v1` and contract-only `booking.confirmed.v1`
(`docs/asyncapi/contract-registry.json:4–20`), not Pricing business events.

## Current source versus historical observations

Pricing now has a technical Nest/Prisma runtime, Docker artifact and the
service-local migration `20261005060000_w01_foundation`; it is no longer only the
directory/TypeScript skeleton described in the earlier W01 source inventory.
Its schema still contains only `ServiceMarker`
(`services/pricing/prisma/schema.prisma:20–28`), and business readiness remains
false (`services/pricing/src/app.module.ts:14–15`). This is bootstrap progress,
not persistent pricing, a quote endpoint or commerce acceptance.

Catalog preserves its foundation probe and transactional outbox tables
(`services/catalog/prisma/schema.prisma:30–62`) and remains business-unready
(`services/catalog/src/app.module.ts:16–17`). The existing pure quote helper is
an unconnected prototype with Pricing as its future owner
(`architecture/service-catalog.json:1281–1285`); its maximum and half-up rounding
are not approved market inputs and must not become policy defaults.

The old W01-B security failure is resolved. [PR #44](https://github.com/baraabd/carwash-platform/pull/44)
passed 32/32 checks on corrected head
`15e8a2916b6260564ef3d26cd5d27c4519b0514c` and merged at
`0bec363355aa7eefff56fee4a8d6704253c86ba7`.
This verifies that historical proposal repair, not this main SHA or W02 commerce.
E's historical intake snapshots are left intact; their former B security blocker
is not carried forward as an active W02 prerequisite. Registry lines 109–122
still classify the merged B packet as a proposal with no accepted contract IDs.

## Readiness blockers

All seven IDs below remain **UNRESOLVED**. Apply ENTRY-01 through ENTRY-06 to
the prerequisite surfaces of each child. Catalog is the provider to implement;
its own finished API is not a prerequisite for its first source write. Pricing
subsequently consumes merged Catalog. ENTRY-07 governs agreed sequencing and
downstream parent acceptance, not completed W02-B integration before the first
implementation write. Owner/action assignments are dependency requests, not
approval records or a claim that a required command already exists.

| Stable ID      | Missing entry or acceptance evidence                                                                            | Authoritative dependency and exact source basis                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W02-B-ENTRY-01 | Verified common base, completed barrier and reconciled lease handoff                                            | E publishes full `BASE_W02` SHA/tree, unchanged candidate/target/head checks, review and resulting-target evidence. Registry release fields are empty (`architecture/parallel-contract-release.json:20–23,87–94`); `architecture/parallel-ownership.json:10` has no verified base. Pricing's recorded technical lease expires at verified `BASE_W02` (`:1027–1031`). Reconcile this with the prompt's statement that the lease has expired; do not infer a release or overwrite product code.                                           |
| W02-B-ENTRY-02 | Accepted Catalog/Pricing wire contracts and reviewed proposal deltas                                            | E and affected owners accept identifiers/revisions, public/service/admin boundaries, exact request/response/events, money/time, idempotency, errors, deadlines and compatibility; publish package/export/client versions and provider/consumer conformance. B's packet explicitly remains unaccepted (`docs/parallel/B/W01/W02_CONTRACT_PACKET.md:3–12`), with accepted IDs empty in E's registry (`architecture/parallel-contract-release.json:109–122`).                                                                              |
| W02-B-ENTRY-03 | Approved monetary, catalog and versioned configuration inputs                                                   | Baraa/business/accounting with B/D/A provide actual catalog IDs/labels/compatibility, vehicle/location inputs, currency/exponent/max amount, prices/fees/tax, rounding order/tie rule, quote TTL/honouring/revocation and replay/deadline policy. B03–B05 remain OPEN (`docs/parallel/B/W01/POLICY_DECISIONS.md:11–13`); D Configuration contracts are proposed only (`docs/parallel/D/W01/CONTRACT_PROPOSALS.md:3`).                                                                                                                   |
| W02-B-ENTRY-04 | Real Identity validation, guest capability and admin actor/beneficiary authorization                            | E/A/D publish and test account/guest ownership, expiry/revocation/claim, current publishing grants, admin-for-distinct-beneficiary quote authority, CSRF and exact trusted principal transport. Existing permissions do not define Catalog/price publishing or guest capabilities (`packages/contracts/src/identity.ts:14–29`; `architecture/parallel-contract-release.json:429–436`). Keep optional plates and do not fabricate an account.                                                                                            |
| W02-B-ENTRY-05 | E-owned manifests/clients/Gateway/broker wiring and usable Catalog/Configuration/location provider dependencies | E publishes reviewed reserved-file dependency/export/wiring changes; owner producers supply accepted usable APIs/events and versioned policy/location evidence. Both Catalog/Pricing omit a declared contracts dependency, and Pricing has no platform-messaging dependency (`services/catalog/package.json:14–25`; `services/pricing/package.json:15–25`). These observations are change requests, not a mandate to import private implementations. Existing route names and empty clients do not establish usable business providers. |
| W02-B-ENTRY-06 | Actual isolated runtime allocation and provisioning                                                             | E provides a specific B/W02/run allocation manifest, shared workstation state root, separate Compose project/ports, provisioned DB/runtime/migration/test identities, broker/object/Redis prefixes and output/browser paths. The allocator defines names and requires test provisioning; it is not a published B allocation or running resource (`scripts/parallel/E/allocate-environment.mjs:67–150`).                                                                                                                                 |
| W02-B-ENTRY-07 | Real provider acceptance followed by serialized consumer/integration evidence                                   | E/owners accept the bounded prerequisite and producer children, then actual consumers against merged producers; verify all parent-listed cases on the combined candidate. B's proposed Catalog-before-Pricing sequence is at `docs/parallel/B/W01/W02_CONTRACT_PACKET.md:14–25`; E's proposed provider/consumer barrier is at `docs/parallel/E/W01/CHILD_SPRINTS.md:17–25`. Fixtures cannot close database, HTTP/event integration or checkout acceptance.                                                                              |

`W02-B-ENTRY-01` includes a discrepancy requiring reconciliation, not a categorical
override of the task's lease instruction. Dependent source writes are independently
blocked by the task's explicit verified-base, accepted-contract and approved-policy
entry conditions. A bootstrap merge or the calendar alone does not supply them.

## Evidence required from E and affected owners

- Full accepted base SHA/tree; barrier/review record; actual resulting-target
  checks and artifact links; reconciled effective writer/lease paths and status.
- Accepted contract IDs, exact versions/export paths/schema digests, reviewed
  delta dispositions, provider/consumer identities and compatibility results.
- Approved immutable currency/catalog/configuration policy revisions and input
  provenance; explicit unresolved fields must retain their blocked status.
- Real Identity/guest/admin authorization surfaces, route/credential transport,
  grants and ownership/expiry/revocation/CSRF negative-path evidence.
- Exact installed public dependencies, client/runtime wiring and usable provider
  endpoints/events; current commands and gate-manifest version, not plan aliases.
- Actual B/W02/run manifest and active allocation proof; scoped provisioning
  and credentials supplied outside Git; owned process/container handles and cleanup.
- Child scope/gates and serialized producer-to-consumer order; candidate SHA/tree,
  DB migration/upgrade/rollback/constraint evidence and real integrated outcomes.

Canonical service identities remain separate: Catalog uses `cw_catalog`,
`cw_catalog_app`, `cw_catalog_migrate`
(`architecture/service-catalog.json:193–195`); Pricing uses `cw_pricing`,
`cw_pricing_app`, `cw_pricing_migrate` (`:250–252`). The allocation must bind these
to a private disposable stack or provisioned test scope; reserved names alone
do not prove isolation. Allocated test names are separately provisioned before use.

## Work permitted at this checkpoint

Continue B-local source inventories, reviewed contract/delta proposals, declarative
acceptance specifications and handoffs under `docs/parallel/B/W02/`,
`tests/parallel/B/W02/` and `scripts/parallel/B/` as appropriate. Do not enable
Catalog/Pricing commerce, append business migrations or advertise readiness while
dependent entry proof is missing. Do not edit E-owned package manifests, lockfiles,
TS/Docker/shared contracts, architecture, CI/infra or another permanent owner's code.

After the entry gate is satisfied, implementation remains bounded to Catalog and
Pricing with owned schemas/new append-only migrations/tests. Billing, Wallet and
Subscription business work, production providers and real money are later scope.
Preserve every mandatory check and all frozen design references. Update this
checkpoint against the newly published source; do not relabel a proposal, fixture,
old CI run or provider-only result as parent acceptance.
