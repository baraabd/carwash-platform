# W06-A resumable English checkpoint

Task/phase **W06-A / ENTRY_PROPOSAL**. Product implementation
**BLOCKED / NOT_STARTED**; parent **NOT_ACCEPTED**. Accepted BASE_W06 is absent.
Proposal parent/observed target `78adaa2d0436f9e0fc6697a36f3f0bd7a521ad8b`,
tree `c5bd3137ef9d4e0ab7b70b9646e126f10e011883`. Own branch/worktree
`proposal/w06-A-account-entry`, `/workspace/scratch/6a9547568741/carwash-w06a-source`.
Final full head/tree, dated target and exact-head CI/review snapshots are bound
in the draft PR; embedding this document's resulting SHA would change that SHA.
Accepted integration candidate/resulting target: none.

## Scope, contracts and migrations

Eight new permanent-A documents/specifications only: README, approved account
inventory, account requests/retention, support/review/private Media, W07 requests,
this checkpoint and source-observation.json under docs/parallel/A/W06;
ACCEPTANCE_SPECIFICATIONS.md under tests/parallel/A/W06.
No app/service source, schema, old migration, manifest/shared/registry/CI/infra,
approved reference or peer work is changed. New migration IDs: **none**.

Actual A models: Customer/Vehicle/Geo each only ServiceMarker. Actual sole
foundation migrations: Customer20260920000000_sprint_02_foundation;
Vehicle/Geo20261005060000_w01_foundation. Business readiness false.
Shared contracts/event-contracts/api-clients0.0.2/0.0.2/0.0.1; foundation
Identity/Gateway and probe/strict contract-only booking.confirmed.v1, empty
business clients. All W06/W07 business schemas here remain proposed/unaccepted.

## Actual source/document diagnostics

- Clean freshly recovered main, one worktree and no open PRs at initial dated
  remote observation; C014#41 merged and not duplicated. Prior A#61/B#65 merged
  proposals were re-read; neither publishes accepted W06 providers.
- `git worktree add -b proposal/w06-A-account-entry /workspace/scratch/6a9547568741/carwash-w06a-source 78adaa2d0436f9e0fc6697a36f3f0bd7a521ad8b`: PASS.
- `node scripts/check-design-reference.mjs --base-ref 78adaa2d0436f9e0fc6697a36f3f0bd7a521ad8b`:
  PASS before/after, 10 locked artifacts/base comparison; exact byte preservation
  only, not React parity or pixels.
- `node scripts/f010/reference-registry.mjs --base-ref 78adaa2d0436f9e0fc6697a36f3f0bd7a521ad8b`:
  PASS three references/base comparison; no baseline regeneration.
- `node scripts/verify-toolchain.mjs`: FAIL38/40, Node24.19.0/pnpm11.25.0
  versus pinned Node24.21.0/pnpm10.32.1; shared pins unchanged.
  `node scripts/verify-toolchain.mjs --config-only`: PASS39/39, runtime skipped.
- `node architecture/implementation-status.mjs --self-test`: PASS source
  inventory and nine adversarial cases; productionReady:false/current candidate
  unverified. No product readiness or independent approval is inferred.
- `node scripts/parallel/E/check-owners.mjs --inventory`: PASS historical
  proposal-inventory-only,69d81a83a3409d0693272efeb19ebeb9805750f5,
  832 paths/165 conditional leases. Task expiry overrides stale lease permission.
- `node scripts/c001/customer-behavior-manifest.mjs`: PASS87 literal prototype
  actions/six forms/seven screens/seven steps; reference inventory only.
- `node scripts/c002/check-feature-boundaries.mjs`: PASS seven feature
  boundaries; not owner DB/HTTP/guest authorization or a customer build.
- Standalone Prettier3.9.8 fetched outside repo with ignored lifecycle scripts;
  no repository install, package/lock change or whole-repository format write.
  Exact command/archive SHA256 and eight-file write/check in source observation/PR.
- Changed-path/final-head owner commands, whitespace, specification/JSON/source
  fingerprints/relative-link check, exact file counts and final tree are bound
  in source observation/PR after execution. They are document diagnostics.

## Unexecuted required evidence

All **28 W06-A families** and **eight W07-A gate families** are UNEXECUTED.
Zero W06 business acceptance passes. No customer/service build/typecheck, new
domain/session unit suite, real DB/migration/upgrade/constraints, HTTP/Identity/
guest/Media authorization, broker replay/crash/restart, owner privacy executor/
backup/projection/provider-copy evidence, chat/case retention/moderation/wallet,
real private image pair, browser/canonical pixels/accessibility/Windows/device,
staging/provider/live money/refund/deployment gate ran. Existing foundation,
session units or old CI counts are not these results. New W06 runners remain
PROPOSED_ENTRYPOINT_MISSING until E publishes runnable allocated commands.

Environment: actual local source/document checks only. No mocked/synthetic
W06 provider fixture was executed. Agent read-only QA is not eligible independent
review. No merchant account login, private provider API, messaging delivery or
live operation occurred. Owned long-running PIDs/ports/Compose/DB roles/vhosts/
queues/object prefixes/browser profiles: **none**; no teardown is required.

## Resume / next action

E/owners publish real accepted predecessors/BASE_W06, current guest/object/purpose
authority, exact profile/preferences/Wallet/Subscription/Support/Reviews/private
Media/participant/retention/privacy action schemas and clients, approved account
scope/copy, coordinator/required-owner fulfillment manifest and isolated executable
gates. Explicitly settle B's earlier W07 privacy provider scheduling/action/outcome
mapping before required W06 automated fulfillment; do not substitute intake.
Accept narrow real producers, then full affected customer/operator/admin journeys
before consumer merge. E serializes latest-target/exact-head candidates, obtains
eligible independent review and verifies actual resulting target before promotion.
W07 commerce/repeat and scoped Customer/Vehicle/Geo administration are early
requests only. Stop after this draft handoff; no automatic merge/deploy/later wave.
