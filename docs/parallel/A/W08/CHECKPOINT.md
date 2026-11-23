# W08-A resumable checkpoint

Task/lane: **W08-A / A**. Phase **ENTRY_PROPOSAL**; parent **NOT_STARTED /
ENTRY_BLOCKED**, product **NOT_ACCEPTED**. Accepted BASE_W08: **absent**.

| Binding | Value |
| --- | --- |
| Immutable analysis main | f0b76221c1a1991ba78327c019f0b4a0a7c53dff |
| Analysis tree | 1a6b3a54e926fc9e3387ac547ecc20c3d3f4252d |
| Own branch | proposal/w08-A-hardening-entry |
| Own worktree | /workspace/scratch/6a9547568741/carwash-w08a-source |
| Package versions at source | contracts0.0.2 / event-contracts0.0.2 / api-clients0.0.1 |
| Proposal packet | w08-a-w09-customer-hardening/0.1.0; unaccepted |
| Final head/tree/current target/hosted CI | Bound in English PR handoff; not a self-referential source field |
| Changed scope | Seven docs/parallel/A/W08 files and one tests/parallel/A/W08 declarative specification |
| Runtime/schema/contracts/migrations | No edits; new migration IDs[]; no business contract exports |
| Required W08 families | 52 UNEXECUTED / ENTRY_BLOCKED |
| Reproduced source findings | D01 late location, D02 missing edit target, D03 nonfinite position; not remediated |

## Completed authorized work

Read the supplied W08-A contract and applicable AGENTS/design/ADR/F001/catalog/
verification and E W07/registry source; refreshed main/open PRs and W07 merges.
Used a clean own worktree from immutable current main, explicitly not an
invented wave base. Read-only delegates audited source; that is agent QA,
not eligible independent approval. Wrote only the eight files in README.

Pinned task-owned Node24.21.0/pnpm10.32.1/Prettier3.9.8 are installed outside
tracked source. Source guards, existing customer unit diagnostics, three pure
defect reproducers and explicit customer build/inventory are recorded with
exact commands/results in source-observation.json. Source-only comparisons
preserve all10 locked artifacts and3 F010 references; they do not prove React
pixels, English, accessibility or production flow.

An initial customer typecheck attempt ran before frozen installation completed
and failed because tsc/node_modules were unavailable. This was a prerequisite
ordering failure, not a diagnosed source/compiler defect. The final command
record distinguishes that attempt from the subsequent completed-install checks.
Never substitute it or an old build/CI result for final-source evidence.

No new executable product test is manufactured. Pure reproducer assertions
describe current defective behavior; they are not successful remediation tests.
All52 new real-provider/HTTP/DB/broker/browser/AT/device/load/restore families
remain unexecuted. No staging, live provider/money/refund or deployment occurs.

## Owned resources and verification

Only this own worktree, task toolchain, ignored dependency/build outputs and
temporary diagnostic logs exist locally. No service/browser listener, port,
Compose project/container/volume, test DB/role, vhost/queue/object namespace or
browser profile is allocated. No peer resource or tracked output is changed.
Docker is unavailable locally. Hosted foundation CI has separately scoped
ephemeral resources; its result does not accept these W08 business families.

Run these existing source/packet commands on the actual final proposal source
with the pinned task toolchain and protected analysis base:

```sh
node scripts/verify-toolchain.mjs
node scripts/check-design-reference.mjs --base-ref f0b76221c1a1991ba78327c019f0b4a0a7c53dff
node scripts/f010/reference-registry.mjs --base-ref f0b76221c1a1991ba78327c019f0b4a0a7c53dff
node scripts/parallel/E/check-owners.mjs --base-ref f0b76221c1a1991ba78327c019f0b4a0a7c53dff --worktree --lane A
node architecture/implementation-status.mjs --self-test
node scripts/c001/customer-behavior-manifest.mjs
node scripts/c002/check-feature-boundaries.mjs
node --test --test-reporter=spec tests/unit/c0*.test.mjs
pnpm --filter @carwash/customer-web typecheck
pnpm --filter @carwash/customer-web build
git diff --cached --check
```

Format/check only the eight new packet files with pinned Prettier. Validate
JSON/source digests, 52 unique family IDs, source/link existence and the exact
allowlist. Do not run repository-wide format writes, source generators or
another lane's acceptance resources. Final mandatory hosted gates remain
required on each new head/candidate/target; no skips/failure waivers.

## Exact next action

E reviews the proposed children and unresolved W08-A-C01..08, publishes the
actual accepted BASE_W08/full release versions, real providers and execution
manifest. Product/design resolves required English/production states and
accessibility reference conflicts; product/E approves numeric workloads,
budgets/device/AT matrix and recovery policy. Then A implements the accepted
children and proves each failed-before/passed-after source defect plus all
required real journeys in owned resources. Parent remains INTEGRATION_PENDING
until the combined-source gate passes. W09 requests here are a handoff only;
stop at this task's reviewed proposal and await the accepted base.
