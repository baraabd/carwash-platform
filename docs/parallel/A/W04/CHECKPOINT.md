# W04-A resumable checkpoint

Task/phase: W04-A / entry audit and lane-local proposal. Product implementation:
**BLOCKED**. Parent acceptance: **NOT ACCEPTED**. No deployment or live operation.

Observed target and proposal parent:
`1ec9d8aebf4470a2815471116643fa6ebe0d5a95`; target tree:
`9f04d674056041bbc810a62e4cc7f275c32581b8`. `BASE_W04` is absent.
Branch/worktree: `proposal/w04-A-cash-journey`,
`/workspace/scratch/6a9547568741/carwash-w04-source`.
Final full head/tree, remote changed-path verification, PR and CI links are bound
in the live draft PR body after commit creation. A document cannot include its
own resulting commit SHA without changing that SHA. There is no accepted candidate.

## Changed paths and versions

Only six new files: `docs/parallel/A/W04/{README.md,CUSTOMER_CASH_SURFACES.md,
W05_CONTRACT_REQUESTS.md,CHECKPOINT.md,source-observation.json}` and
`tests/parallel/A/W04/ACCEPTANCE_SPECIFICATIONS.md`. No product source, shared
package/configuration, approved design, registry, workflow or migration changed.
Migration IDs: **none**.

Current versions: `@carwash/contracts@0.0.2` (Identity v1 foundation/Gateway v1
routing), `@carwash/event-contracts@0.0.2` (foundation probe and strict
contract-only `booking.confirmed.v1`), `@carwash/api-clients@0.0.1` (empty).
There are no accepted W04 order/update/Work/Media/cash receipt clients or schemas.
W05 packet IDs/field names remain review requests and are not shared exports.

## Commands actually run and evidence limits

- `git status --short` and `git worktree list --porcelain` before creating the
  isolated proposal worktree: existing work preserved; new worktree initially clean.
- `git fetch origin main`; `git worktree add -b proposal/w04-A-cash-journey /workspace/scratch/6a9547568741/carwash-w04-source 1ec9d8aebf4470a2815471116643fa6ebe0d5a95`:
  observed-source proposal only.
- `node scripts/check-design-reference.mjs --base-ref 1ec9d8aebf4470a2815471116643fa6ebe0d5a95`:
  PASS before and after proposal edits, 10 byte-locked artifacts/base comparison;
  this does not prove React pixels.
- `node architecture/implementation-status.mjs --self-test`: PASS source inventory
  and nine adversarial cases; `productionReady: false`, current candidate unverified.
- `node scripts/f010/reference-registry.mjs --base-ref 1ec9d8aebf4470a2815471116643fa6ebe0d5a95`:
  PASS three registered customer/technician/admin hashes and base comparison;
  no registration or visual matching is inferred.
- `node scripts/verify-toolchain.mjs`: FAIL two runtime mismatches:
  actual Node `24.19.0` / pnpm `11.25.0`, pins `24.21.0` / `10.32.1`.
  `node scripts/verify-toolchain.mjs --config-only`: PASS 39/39, runtime skipped.
  The initial incorrect `node scripts/check-toolchain.mjs` attempt failed because
  that file does not exist; the existing verifier above supersedes it. Pins unchanged.
- `node scripts/parallel/E/check-owners.mjs --inventory`: PASS
  `proposal-inventory-only`; its source/count is the historical registry inventory,
  not accepted live ownership/base publication.
- Existing C001–C014 unit command is enumerated completely in source-observation:
  PASS **304/304**, zero failures/cancellations/skips/todos. Actual fixture/session
  tests on the observed source; unchanged product files at the submitted head.
  Runs used the mismatched local runtime and do not satisfy a pinned W04 gate.
- Explicit six-file Prettier check with `/dev/null` ignore override, exact A
  worktree/head scope checker and `git diff --check`: results bound in the draft PR.
  No whole-repository format write. Prettier `3.9.8` came from the existing local
  dependency installation; no shared lock/dependency changes.

Temporary unit TAP: `/workspace/scratch/6a9547568741/w04-existing-customer-unit.tap`.
Durable command/result summary: [source-observation.json](source-observation.json).
GitHub target workflow observation is timestamped there; foundation head/target
greens are not an accepted W04 base or independent human review.

## Not run / blocked

All new W04 acceptance cases are **UNEXECUTED**. No real guest/account cash order,
operator assignment/accept/arrival/evidence/completion/collection, authorized admin
reconciliation, durable receipt, broker fault/replay, cross-customer/media HTTP,
populated business-data migration, provider/consumer business conformance or
three-app reload/restart was run. No customer build/typecheck, real browser,
reference/candidate/diff, accessibility, Windows/device, staging, live money or
production deployment was run by this child. Zero W04 production acceptance passes.

Owned long-running processes, ports, Compose projects, DB roles/namespaces, queues,
objects and browser profiles: **none**. All diagnostics completed; no runtime cleanup
is needed. No shared integration stack was started or stopped.

## Next action and stop boundary

E/owners reconcile present packets and publish reviewed schemas/clients, source-bound
verified bases, product copy/policies and isolated resources. Accept narrow real
providers in the README dependency queue, then implement A's consumers against a
published accepted base and run every specified case on E's serialized candidate.
Any target/head change requires a new candidate and applicable rerun. An eligible
independent reviewer must approve; same-login agents do not qualify. Stop at this
W04 proposal handoff; no merge, deployment, peer product fix or W05 implementation.
