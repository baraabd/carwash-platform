# W02-C — Resumable checkpoint

Task/phase: **W02-C / ENTRY_BLOCKED_PREWORK_PROPOSAL**. Parent: **INTEGRATION_PENDING**; product implementation **NOT_STARTED**. Observation date: 2026-10-05 UTC.

## Immutable refs and write scope

- Verified wave base: **BASE_W02 = null**, never replaced by an observation SHA.
- Inspected target/branch parent: `main@3db1afdd04c6ec65a38ca83f3993c964a1bf7587`; tree `5b51ed5f1779a2cbefc359fdbdc4720779989b4b`.
- Own branch: `sprint/w02-C-entry-handoff`; own worktree: `/workspace/scratch/d980e1354a15/carwash-w02-c`.
- Submitted head/tree: recorded as exact immutable Git objects in the draft PR's English handoff after publication. The checkpoint cannot contain its own commit/tree SHA. No pending placeholder is represented as a tested commit.
- Paths: `docs/parallel/C/W02/{README.md,PREWORK_REQUEST.md,W03_CONTRACT_PROPOSAL.md,ENTRY_SNAPSHOT.json,CHECKPOINT.md}` and `tests/parallel/C/W02/acceptance-specifications.md` only.
- Migration IDs: **none added**; both Media/Workforce retain `20260920000000_sprint_02_foundation` unchanged.
- Contracts consumed/published: no new business contracts; current shared packages `contracts@0.0.2`, `event-contracts@0.0.2`, `api-clients@0.0.1`; existing Identity V1/Gateway V1 preserved. All new packet schemas are proposals.

This branch is based on inspected main solely for the explicit lane-local proposal exception. It is not a product branch from an accepted wave base. No app/service/generated source is written; all reserved and reference paths remain untouched.

## Commands actually run on this worktree

| Exact command | Actual result and limit |
| --- | --- |
| `node scripts/check-design-reference.mjs --base-ref 3db1afdd04c6ec65a38ca83f3993c964a1bf7587` before/after edits | PASS; 10 verified artifacts and comparison to the exact source. Reference preservation, not application pixels. |
| `node --test tests/design/reference-lock.test.mjs` | PASS; 12 tests, zero failure/skip/cancel/TODO. Existing reference guard tests only. |
| `node scripts/check-boundaries.mjs` | PASS; 19 owners, 241 source files, 74 architectural rules. Static smoke scope, not a complete security audit. |
| `node scripts/check-layers.mjs` | PASS; 19 services, 129 layered source files. No product runtime exercised. |
| `node scripts/parallel/E/check-owners.mjs --inventory` | PASS; proposal inventory only, frozen inventory 832 paths, 165 lease paths/33 C014 exceptions. Does not approve ownership trust or release a lease. |
| `node scripts/verify-toolchain.mjs --config-only` | PASS; 39/39 declaration/propagation checks. Declared Node 24.21.0/pnpm 10.32.1. |
| `node scripts/verify-toolchain.mjs` | **FAIL**; 38/40, actual Node 24.19.0/pnpm 11.25.0. No pins changed; no approved-toolchain build claim. |
| Changed-path diagnostic using `checkChangedPaths()` from the inspected base's E checker | PASS; six paths, effective writer C, no forbidden paths. Read-only diagnostic, **not** protected-policy approval. Exact invocation is retained below. |
| `git diff --check`; JSON parse of `docs/parallel/C/W02/ENTRY_SNAPSHOT.json` | PASS; text/JSON integrity only. |

Existing guards above ran under the actual local toolchain recorded in the failed runtime gate. No dependency install, whole-repository formatter write or heavy slot was used. Declared toolchain checks are not build proof. The changed tree is pinned in the PR handoff; commit metadata alone is not new product test evidence.

Exact changed-path diagnostic, after explicitly staging the six listed paths:

```bash
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { checkChangedPaths } from '../carwash/scripts/parallel/E/check-owners.mjs';
const registry = JSON.parse(readFileSync('architecture/parallel-ownership.json', 'utf8'));
const paths = execFileSync('git', ['diff', '--cached', '--name-only', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const result = checkChangedPaths(registry, { lane: 'C', paths });
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
JS
```

The checker import uses the untouched observation checkout at the recorded main source. This avoids executing a candidate-modified checker; its proposed trust policy is still unapproved. E must supply independently reviewed pins/writer plans for protected CI.

## Remote evidence and required cases

[ENTRY_SNAPSHOT.json](ENTRY_SNAPSHOT.json) records actual resulting-main workflow statuses and links on the inspected target. At capture, 20 observed push workflows comprised 19 completed successes and one in-progress C012 workflow. That is a dated observation, not a complete barrier inventory, independent review or BASE_W02 publication. It does not certify this new proposal head. Required head/combined-source gates and review remain pending with E.

All W02 business cases in [acceptance specifications](../../../../tests/parallel/C/W02/acceptance-specifications.md) are **BLOCKED_NOT_RUN**: real migration/upgrade/restart/constraints; store/scanner/MIME/hash/size/quarantine/finalize/private access; current reviewer scope/version/expiry/revocation; outbox/inbox/broker crash/replay; authorized admin review API/customer/admin ownership; real Operator session/RTL/focus/motion/pixels/English. No fixture, historical foundation count or source guard closes them. D's full admin-browser review is W03; required W02 reviewer API integration stays in this scope.

No actual W02 business provider is running. No actual endpoint captures were produced for B payment evidence or D reviewer/roster; no fake sample is labeled live integration. No browser, Windows/device, staging, provider money operation or production deployment was run. No new executable test or tautological packet test was added.

## Resources and continuation

Allocated C/W02 environment: **none**. Owned process IDs/container/browser handles/queue/store/scanner jobs: **none**. No shared resources started, stopped, pruned or reset; no cleanup action needed. Worktree/branch are owned C artifacts, not runtime isolation.

Next action: E/provider/consumer review [PREWORK_REQUEST.md](PREWORK_REQUEST.md), resolve state vocabulary/current authority/content-retention/design decisions, publish accepted contracts/dependencies and provision a C/W02 allocation including scanner. E completes its contract/barrier children, verifies actual resulting main and publishes full BASE_W02 with lease release. Refresh source, PRs and protected trust then start **Workforce Binding Provider**, followed by real Media, Workforce Review/Eligibility and approved Operator consumer. Keep parent pending through combined acceptance. W03 proposals are handed off early; this task does not start W03 or authorize merge/deployment.
