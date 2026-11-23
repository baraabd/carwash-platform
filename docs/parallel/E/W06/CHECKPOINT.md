# W06-E resumable checkpoint

Parent: **NOT_STARTED / ENTRY_BLOCKED**.
Child: **W06-E-INTEGRATION-PROPOSAL / DRAFT_REVIEW_PENDING**.
All 50 business acceptance families: **BLOCKED_NOT_RUN**.
BASE_W06 and BASE_W07: **unpublished**. No wave acceptance or merge performed.

## Source and scope

Analysis parent/main observation: `78adaa2d0436f9e0fc6697a36f3f0bd7a521ad8b`.
Tree: `c5bd3137ef9d4e0ab7b70b9646e126f10e011883`.
Ordered parents: `d9f2c88548395f98fbe309f93db74dc4d2fa782d`,
`467a66d3bfd072e102a6234dfd50dcbf657b38cf`.
Proposal branch: sprint/w06-E-resilient-events. This source is not an accepted
wave base. Exact delivery head/tree and hosted run evidence belong in the PR;
this file names the immutable analysis parent and avoids a self-referential SHA.

Source packages: contracts0.0.2, event-contracts0.0.2, api-clients0.0.1 empty.
Existing registry: W01 INTEGRATION_PENDING, BASE_W02:null, accepted contracts[].
No accepted new schemas/versions, migration IDs or provider access invented.

Eight lane-local files: README.md, SOURCE_OBSERVATION.json,
INTEGRATION_AND_CONTRACT_REQUESTS.md, EVENT_RECOVERY_MATRIX.md,
W07_SCOPE_GAPS.md, BLOCKERS_AND_DECISIONS.md, CHECKPOINT.md and
tests/parallel/E/W06/INTEGRATION_ACCEPTANCE_SPEC.md. The source evidence and
owner proposals are read-only intake; no B/C/D implementation is copied or changed.

## Local verification commands

Use pinned Node24.21.0/pnpm10.32.1. The toolchain is installed outside this Git
worktree; do not change repository pins to match ambient Node24.19/pnpm11.

```sh
node scripts/verify-toolchain.mjs
node scripts/check-design-reference.mjs --base-ref 78adaa2d0436f9e0fc6697a36f3f0bd7a521ad8b
node scripts/f010/reference-registry.mjs --base-ref 78adaa2d0436f9e0fc6697a36f3f0bd7a521ad8b
node scripts/parallel/E/check-owners.mjs --base-ref 78adaa2d0436f9e0fc6697a36f3f0bd7a521ad8b --worktree --lane E
node /workspace/scratch/baf0b620615a/toolchain-w06/prettier/bin/prettier.cjs --ignore-path /dev/null --check docs/parallel/E/W06/*.md docs/parallel/E/W06/SOURCE_OBSERVATION.json tests/parallel/E/W06/INTEGRATION_ACCEPTANCE_SPEC.md
git diff --cached --check
git write-tree
git status --porcelain
```

The preparatory owner CLI may require a separately reviewed base-registry pin;
local path classification is not protected approval. Exact actually executed
commands/results, head CI and candidate status are recorded in the live PR.
Formatting/JSON/spec-count/source guards verify this packet, not domain behavior.
No tautological prose tests are created. Full foundation CI remains mandatory.

No local DB/HTTP/broker/browser/provider/staging/Windows/device business exercise
is executed for this proposal. Docker is unavailable in this environment. No
owned listener, port, DB/role, queue, container/volume, object/browser profile or
runtime lease exists; tool downloads and temporary diagnostics own only their
scratch files. No shared cleanup, production exercise or live-money action runs.

## Resume only on concrete dependencies

Refresh actual main/open PRs/refs/reviews/evidence and accepted registry. If an
accepted BASE_W06 exists, verify full SHA/tree, owner contracts/parsers/clients/
versions and actual retained W05 provider/cash/compensation evidence. Otherwise
continue this packet's review; do not substitute current main for BASE_W06.

Resolve E06-B01..B13 and accepted producer sequencing. Owner B/D closes its
source defects with real DB/broker tests; E implements only accepted shared
technical contracts/harness/gateway/Identity behavior in its child branch.
Resolve privacy scope/execution wave and location authority before consumers.
Allocate/prove owned resources and one measured heavy slot before fault seams.

Accept real narrow providers, then durable Booking/owner coordinator, then full
app consumers with integrated journeys. E builds each PR's latest-target
candidate, executes mandatory/affected gates, obtains eligible independent
review, rechecks refs and uses only the authorized merge process. Check actual
resulting target before any BASE_W07/package publication. Recompute on ref
changes. Stop at this bounded reviewed handoff; no automatic next task starts.
