# Develop recovery analysis

Inspected: 2026-10-04 (first pass), revised the same day after the first CI of PR #39. Scope:
PRs #22–#39, first-parent history of `main` from the last `develop` promotion (#24) to
`6013d161`, and the check runs of `main` `6013d161`, PR #37, PR #38 and PR #39. This is a bounded
audit of that range and those execution paths; it does not prove the absence of other defects.
The machine-readable register is `develop-recovery-defect-register.json`.

## Refs at inspection

| Ref | Commit | Tree |
| --- | --- | --- |
| `origin/main` | `6013d161bbe9200b9ee6a6ba3dbd5f0cfc63d396` | `b3502dfe17172711d043a456d67fafd6fa10eea0` |
| `origin/develop` | `320200cf5da05892424016e262ed1c209caa6480` | `7194edd12fba0e1219c088dc1d2a6e54fc309c61` |
| `origin/sync/develop-from-main` (PR #37 head) | `6013d161…` | `b3502dfe…` |

- `git merge-base origin/main origin/develop` = `320200cf…` (develop itself).
- `git rev-list --left-right --count origin/develop...origin/main` = `0 44`.

## Finding: develop is stale, not corrupted

`develop` is a pure ancestor of `main`: it has no commit that `main` lacks. Its tip is the C002
merge (#22), already promoted to `main` by #24. Everything after #24 (#25–#36, including the F008
recovery barrier #31) was delivered to `main` only, under the agreed feature→`main` workflow.
There is no bad merge resolution, dropped feature, unresolved marker or mutated reference in the
inspected range (`git grep` for conflict markers on `main` is empty; the reference guard passes).

Recovery branch A applies: PR #37 (`sync/develop-from-main` → `develop`) is exactly `main`
`6013d161` and promotes it unchanged. No duplicate synchronization PR is needed and no
develop-only patch exists.

## Finding: the C011 wrong-target merge did not lose content

PR #34 merged C011 into `feat/C010-scheduling-time-selection` (`1f874fc`) after #33 had already
merged C010 into `main` — a wrong feature-to-feature target. The C011 work was then promoted by
PR #35 (merge `6013d161`, second parent `d10907f`); PR #36 (`integrate/C011-main`) is reported as
merged with the same merge commit because its head `30b90a1` became reachable. The tree of
`6013d161` equals the tree of the reviewed head `d10907f` (`b3502dfe…`), so `main` holds exactly
the reviewed C011 source. No revert or repair is required; the lesson is procedural (target `main`).

## Check runs on the inspected sources (2026-10-04)

| Source | Event | Result |
| --- | --- | --- |
| `6013d161` (`main`, PR #37 head) | `push` on `main` | 16 workflows success; **C011 run 37127326124 attempt 1 failure** (job `customer-contact`, step "Browser parity against the approved reference") |
| `6013d161` | `pull_request` (#37) | 19 workflows success, attempt 1 each (runs 37130767051–37130767288) |
| `6013d161` | `push` on the C012 branch (when its head was `6013d161`) | Sprint 0.2 run 37130792061 **cancelled** by the branch's next push (concurrency), not failed |
| `e1545a06` (PR #38 head) | `pull_request` + `push` | 19 workflows, 48 check runs, all success |
| `eacccde3` (PR #39 head) | `pull_request` | 16 workflows, 41 check runs, all success |

Passing PR runs of `6013d161` did not exclude the main-push failure: the failure is intermittent,
and each run is one sample. The same source therefore has both a failed and a passing C011 run;
neither is deleted or re-run to change the record.

## Incident: one pixel in `sheet-map-zoomed-panned-tapped@768`

### 1. Observed failure

`main` push run 37127326124 (C011 workflow; its title is the PR #35 merge message), job
`customer-contact`: the workflow's sequential browser order C011 → C010 → C009 passed (56/19,
56/16, 80/16 visual/interaction checks), then the C008 runner failed in `comparePixels`
(`scripts/c004/parity-harness.mjs`) with `sheet-map-zoomed-panned-tapped@768: 1 pixels differ
from the approved reference`. It is not a Contact-form, dependency-installation or RabbitMQ
failure. The same case failed on the C008 merge push (run 37050062833) and on `f0487fe`
(run 37105992192).

Raw artifacts of run 37127326124 (`c011-contact-parity-6013d161…`, artifact 11276230152) were
decoded: the only differing pixel is (301,353), the map pin's left edge — reference
`255,255,255`, candidate `246,249,247`. Pin style (`273.343px`, `295px`), world transform
(`translate(46px,-22px) scale(1.4)`), pin and map rects, scroll and device pixel ratio are
identical on both pages in the stability batches.

### 2. Demonstrated acceptance weakness

The two-frame stop rule (return the second of two consecutive captures with zero
comparator-classified pixels, at most six captures) can return an early plateau: for the synthetic
sequence A,A,B,B,B it returns A at capture 2. This is demonstrated against `main`'s unchanged
helper and is a property of the rule, independent of the browser. In run 37127326124 the rule
returned a reference frame differing from the candidate; by definition it equalled the capture
before it, so that state lasted at least two captures. Whether it would have changed later in that
run is not observable from the retained artifacts.

PR #39 changes the rule to three consecutive equal captures, at most eight. Each page is still
judged only by its own frames, with the unchanged F010 comparator (`comparePngBuffers`, per-channel
threshold 8; equality means zero classified pixels, not byte identity), and the two retained
frames are compared once (allowed ratio 0).

### 3. Supported hypothesis (not proven)

In every retained batch the deviating side is the reference, which returns to the candidate's
value after a deviation; the candidate never deviated. The suspected mechanism is compositor
re-rasterisation timing of the reference's scaled `.map-world { will-change: transform }` layer.
The reference has no resize handler and no asynchronous work after the tap. No experiment has
established this mechanism, and three captures are not proof of physical rendering stability.

### Evidence limitation found in the repeat batch

`scripts/stability/c008-c011-repeat-batch.mjs` (PR #36) evaluated its pass criterion only after
eight diagnostic captures, i.e. later than the acceptance runner settles. Its 20/20 map passes on
`main` (two-frame rule) and on PR #39 (three-frame rule) therefore cannot distinguish the rules;
the deviations it recorded (main: repeats 6, 8, 18, 19; PR #39 run 37188703216: repeats 1, 11, 14)
all fall in its diagnostic window. PR #39 adds a paired evaluation at the runner's timing: eight
captures per page are replayed through both rules, and the current rule joins the pass criterion.
Its results exist only once CI has run it.

## C012-owned failures (not develop defects)

PR #38's failures at `75f50c5` belong to C012 and are fixed on that branch, not here: the EOF
blank line (F001 `diff-whitespace`, cascading to F007/F009), the C002 `/book/5` route expectation
superseded by the C012 guard, the duplicate selected-method text, runtime method validation, a
stale announcement total and test-sequence defects. See
`docs/customer/C012_PAYMENT_METHOD_SELECTION.md` on that branch. None of them is related to the map
pixel incident.

## Other paths checked

- F008: `main` push run 37127326140 and PR #37 runs 37130767160/37130767168 pass; the historical
  RabbitMQ cascade is not reproduced, so outbox/inbox and consumer code are not touched.
- F001/F006/F007/F009/F010, reference guard and Sprint 0.2: green on `main` push and PR #37.
- Local executor: Windows 11, Node 24.21.0, pnpm 10.32.1, Playwright Chromium 1243, about 2.8 GB of
  16 GB free memory. The Docker engine returns HTTP 500 and WSL Ubuntu is not the pinned
  `ubuntu-24.04` runner, so the Linux rendering contract is not available locally
  (`BLOCKED_PREPUSH_RENDERING_EVIDENCE`); database/broker and pixel evidence come from CI.

## Status

- Develop recovery: PR #37 at `6013d161` is a verified promotion candidate. It does not contain the
  PR #39 hardening; `develop` is unchanged until an owner merges PR #37.
- Shared hardening: PR #39 → `main`, `VERIFIED_WITH_DOCUMENTED_HARDENING` once its final head's CI
  passes. After it merges, PR #37's head is fast-forwarded to the new `main` (see the runbook).
