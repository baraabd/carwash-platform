# W03-A — Resumable English handoff

Task/phase: W03-A / **ENTRY_BLOCKED, PROPOSAL_ONLY**. Server-authoritative booking implementation is **NOT_STARTED**. This packet does not mark W03 DONE, WAVE_ACCEPTED or release ready.

## Immutable source and changed boundary

Observed target/proposal parent: `82e7402ed9ab6cc4f565f423441cd0655f2d627a`; tree `050b4b8a03be2bc671cbaa00151ea7105891e2d4`. Own worktree `/workspace/scratch/6a9547568741/carwash-w03-source`, branch `proposal/w03-A-booking-entry`. Prior W01/W02 worktrees and their work are preserved. Final proposal head/tree are recorded in the draft PR body after commit creation; resume with `git rev-parse HEAD` and `git rev-parse HEAD^{tree}`, then verify against PR metadata. No file inside a commit invents its own SHA.

Only six new lane-local files are intended: README, SCREEN_FACTS_AND_RECOVERY, W04_CONTRACT_REQUESTS, this checkpoint and source-observation under `docs/parallel/A/W03/`, plus `tests/parallel/A/W03/ACCEPTANCE_SPECIFICATIONS.md`. No product/shared/manifest/architecture/workflow/reference/schema change; migration IDs introduced: **none**. No producer, client or test command is implemented by documenting its candidate shape.

Since the prior bootstrap target `3db1afdd04c6ec65a38ca83f3993c964a1bf7587`, PR46–50 merged **31 new lane-local proposal/spec files**. A's packet is present; the unchanged registry's A-unreceived field is stale. Semantic acceptance remains absent. Current user instruction ends E bootstrap writes immediately; permanent owners apply, while E reconciles publication. This does not publish any accepted base or authorize private DTO substitution.

## Contracts, producers and gate status

Existing packages: contracts `0.0.2`, event-contracts `0.0.2`, api-clients `0.0.1`. Only Identity/Gateway foundation HTTP and foundation-probe/strict contract-only booking-confirmed events exist. API clients still export nothing. `BASE_W02:null`, `BASE_W03` absent, accepted next-wave contracts empty, guest unaccepted. Actual W02 durable Customer/Vehicle/Geo and real quote/capacity/Booking/Billing authorities are not delivered by proposal merges.

Merged A W02 W03 requests are referenced; this packet adds W03 screen/recovery analysis and the **W04 customer read/update/cash/media/cancellation proposal**. Candidate vocabulary is unaccepted. E/owners must reconcile beneficiary/delegation, optional one-time inputs, consent purpose, revision/money/quantity, routes/query/error versions and real operational policy before publishing exports. No unmerged peer imports or cross-service DB/Prisma access.

PR46 head's eight returned workflows passed. Its later merge did not have complete successful resulting-target evidence; the audit observed cancellations and aggregate failures without diagnosing logs. Current target workflow snapshot is in source-observation; some gates were still running at capture. Neither old head success nor completion of foundation CI alone publishes BASE_W03. Human review arrays for PR46–50 were empty at inspection; bot/subagent activity is not independent approval. E owns the reviewed latest-target candidate and resulting-target barrier.

## Exact commands actually run

All local checks used **Node 24.19.0**, while repository authority is Node **24.21.0** / pnpm **10.32.1**. Default pnpm is **11.25.0**. No pins or guards were changed; static/demo passes are supplementary. Source observation records the exact 11-file test invocation.

| Command / inspection                                                                                                                                              | Actual result                                                                                              | Bound interpretation                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `git status --short`; `git worktree list --porcelain`; `git log --oneline -8 origin/main`; `git diff --stat 3db1afdd04c6ec65a38ca83f3993c964a1bf7587 origin/main` | Actual worktree/PR/31-file source delta inspected before editing.                                          | No discard/reset/clean/stash/force-push or other writer overwrite.                                       |
| `node scripts/check-design-reference.mjs --base-ref 82e7402ed9ab6cc4f565f423441cd0655f2d627a`                                                                     | **PASS**, exit 0; 10 exact artifacts, base compared before proposal edits. Repeat after final assembly.    | Byte integrity only; no React pixel/browser acceptance.                                                  |
| `node scripts/verify-toolchain.mjs --config-only`                                                                                                                 | **PASS**, exit 0, 39 declaration/propagation/install-policy checks.                                        | Runtime checks explicitly skipped by the command; not a pinned runtime pass.                             |
| `node scripts/verify-toolchain.mjs --json`                                                                                                                        | **FAIL**, exit 1; Node 24.19.0 and pnpm 11.25.0 do not match pins.                                         | Required local runtime gate not closed.                                                                  |
| `node architecture/implementation-status.mjs --self-test`                                                                                                         | **PASS**, source inventory valid; 9 adversarial cases; productionReady=false/current candidate unverified. | Source/status guard, not W03 functionality.                                                              |
| `node scripts/parallel/E/check-owners.mjs --inventory`                                                                                                            | **PASS**, proposal-inventory-only.                                                                         | Its sourceSha/count label belongs to historical registry inventory, not current HEAD or approved policy. |
| `node --test --test-reporter=tap` with all 11 existing C004–C014 files (full command in source-observation)                                                       | **PASS**, 271 tests, 0 failures/cancelled/skipped/todo; matched file existence checked before execution.   | Existing session/fixture state regressions; no server Quote/Hold/Booking/reload/guest acceptance.        |

Final six-file formatting, path ownership, diff whitespace and reference results are recorded in the draft PR body after checks and PR creation. Formatter writes/checks only those explicitly named new A paths; no whole-repository formatting or generator. Actual customer build/typecheck, canonical parity and real-provider/browser commands remain unexecuted for this document-only child and required for the later implementation consumer; no fake acceptance runner is supplied.

## Unexecuted cases, dependencies and resources

All **31** new W03 matrix cases are **UNEXECUTED**; zero W03 production acceptance cases passed. No real PostgreSQL/migration/Identity guest/owner business HTTP/broker/provider/browser/visual/accessibility/Windows/device or financial operation ran. Existing pure state tests cannot establish browser storage, durable operation recovery, server capacity or settlement.

External blockers: reviewed actual BASE_W03 through predecessor barriers; compiled accepted Catalog/quote/serviceability/availability/hold/Booking-recovery/initial-payment/guest clients; real A/B/C/E providers; approved Aleppo/catalog/prices/capacity/expiry/consent/recovery/cancellation/privacy/retention/provider/copy decisions; E transport/model metadata and runtime allocation/commands; independent review/protected enforcement and combined-source gates. These are explicit dependencies, not silently removed scope.

Owned long-running PIDs, listeners/ports, containers, databases, queues, objects and browser profiles: **none**. No heavy acceptance stack started; no shared shutdown/prune/broad process kill or destructive operation. Short-lived checks exited and own worktree is preserved.

## Resume and next action

1. E reviews this W03/W04 packet alongside merged owner proposals, reconciles stale intake and accepted schemas/versions/operational decisions, finishes legitimate predecessor and W03 contract/base/resource/gate publication.
2. Verify the new immutable source rather than renaming current main. B obligation and C Scheduling provider acceptance precede C Booking's real durable coordinator; all prerequisite real A/B/E sources must already be accepted. Each child uses an E-published common source and latest-target process.
3. A integrates the seven-screen customer consumer only against published clients and merged real producers. Prove six review loops, changed/expired facts, no-plate guest, explicit reconfirmation, duplicate/unknown outcome/reload/deep links and independent saved-record failures with real full flow and approved UI evidence before consumer merge.
4. E serializes all-three-app W04 scenario readiness and actual resulting-target checks. W04 requests are one-wave-ahead proposals only; no W04 implementation, merge, deployment or live-money execution follows from this handoff.
