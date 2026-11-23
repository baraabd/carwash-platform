# W02-B — Catalog/Pricing entry and acceptance handoff

Task: W02-B. Permanent writer: Lane B. Phase: **ENTRY_BLOCKED / PROPOSAL_READY**.
This packet is bounded dependency work permitted by the task when its verified
wave base/contracts are absent. It is not persistent Catalog or Pricing implementation.

## Observed source and publication boundary

- Audited main: `3db1afdd04c6ec65a38ca83f3993c964a1bf7587`.
- Source tree: `5b51ed5f1779a2cbefc359fdbdc4720779989b4b`.
- E-published `BASE_W02`: **null**, not replaced by the observed main SHA.
- Accepted W02 business-contract IDs: **none**. Existing package versions:
  `@carwash/contracts@0.0.2`, `@carwash/event-contracts@0.0.2`,
  `@carwash/api-clients@0.0.1`; the client export remains empty.
- W01-B PR #44 and W01-E PR #45 are merged. Merging their documents/bootstrap
  does not publish accepted business policies/contracts or `BASE_W02`.
- The B-11 scanner-prose incident is repaired: 32 successful checks belonged to
  W01-B head `15e8a2916b6260564ef3d26cd5d27c4519b0514c`, not this packet or
  a W02 financial implementation. E's old failure snapshots remain historical.

See [ENTRY_READINESS.md](ENTRY_READINESS.md) for the seven exact blockers and
E's required proof. The task describes an expired bootstrap lease; the registry
still conditions release on verified `BASE_W02`. Reconcile that publication.
Missing base, contracts and approved monetary policy independently prevent the
requested dependent service writes; no additional permission requirement is inferred.

## Packet

| File                                                                                                          | Purpose                                                                |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| [ENTRY_READINESS.md](ENTRY_READINESS.md)                                                                      | Source-derived entry blockers and release evidence                     |
| [ENTRY_EVIDENCE.json](ENTRY_EVIDENCE.json)                                                                    | Immutable source/path fingerprints and observed facts                  |
| [SOURCE_INVENTORY.md](SOURCE_INVENTORY.md)                                                                    | Current Catalog/Pricing foundation and canonical UI identifier mapping |
| [CONTRACT_DELTA_REQUESTS.md](CONTRACT_DELTA_REQUESTS.md)                                                      | Concrete W01 proposal gaps needing owner/E acceptance                  |
| [W03_CONTRACT_PACKET.md](W03_CONTRACT_PACKET.md)                                                              | Conditional quote validation and Billing/Booking dependency request    |
| [catalog-pricing-acceptance.spec.json](../../../../tests/parallel/B/W02/catalog-pricing-acceptance.spec.json) | Declarative W02 acceptance cases; no runtime execution                 |

The W01 packet remains historical and unaccepted; this packet requests reviewed
changes to it, rather than silently changing its closed schemas or shared exports.
No new accepted package version or migration ID is assigned.

## Execution sequence requested from E

1. Publish the verified common base, exact contract versions, release/writer record,
   approved policy revisions and a provisioned isolated B/W02 run.
2. Accept the narrow **W02-B-CATALOG** provider against actual Identity/configuration
   prerequisites: owned migrations, lifecycle/revisions, authorization, constraints,
   audited publishing and real PostgreSQL/HTTP acceptance.
3. Accept **W02-B-PRICING** against merged real Catalog and approved configuration:
   price versions, immutable subject-bound snapshots, exact arithmetic, durable
   replay/conflict, authorized admin beneficiary commands and real owner DB tests.
4. A/C/D accept their affected real consumers against merged providers, including
   customer quote consumption and admin publication/on-behalf journeys where scoped.
   E sequences the latest-target candidate and mandatory integration gates.

These are child-scope proposals, not authorization to start another wave or to
consume an unmerged peer implementation. W02-B stays INTEGRATION_PENDING after
provider-only checks until every required combined journey is proved.

## Validation and environment

The observed source's pre-edit checks used isolated Node **24.21.0** and pnpm
**10.32.1**. Both commands passed: reference guard verified 10 artifacts/protected
policies; F010 registry verified all three unchanged customer/technician/admin references.

Apply these existing commands to the final proposal as well:

```sh
node scripts/check-design-reference.mjs --base-ref 3db1afdd04c6ec65a38ca83f3993c964a1bf7587
node scripts/f010/reference-registry.mjs --base-ref 3db1afdd04c6ec65a38ca83f3993c964a1bf7587
prettier --ignore-path /dev/null --check docs/parallel/B/W02/*.md docs/parallel/B/W02/*.json tests/parallel/B/W02/*.json
git diff --check
```

Validate JSON/source fingerprints, local links, case coverage and explicit
nonexecution labels; run the pinned Gitleaks history/source checks without
exceptions before delivering. Actual commands/results and final head/tree/CI
links are recorded in the draft PR after execution, so commit-self references
are not invented inside this document.

No service source, schema, migration, package manifest, shared contract/client,
Gateway, architecture registry, CI, infrastructure or approved reference is edited.
There is no Docker executable in this audit environment and no B/W02 provisioned
allocation was supplied. No finance database/broker/HTTP/browser journey is run.
Existing hosted foundation checks, if successful, are not execution of these specs.
No canceled/skipped check may be called passed. Owned running resource handles: none.

## Resume checkpoint

E reviews the concrete deltas and publishes the missing entry evidence. Re-read
that exact immutable base and the then-current target before choosing provider
source paths and migration IDs. Reconcile policy/authorization answers with A/C/D,
then run real isolated provider acceptance and the serialized consumer gates.
This handoff does not mark W02-B DONE, publish a price, approve a policy or
permit a money operation, merge, deployment or automatic next sprint.
