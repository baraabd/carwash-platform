# Develop recovery analysis

Inspected: 2026-10-04. Scope: PRs #22–#38, first-parent history of `main` from the last
`develop` promotion (#24) to `6013d161`, current CI of `main`, PR #37 and PR #38. This is a
bounded audit of that range and those execution paths; it does not prove the absence of other
defects. The machine-readable register is `develop-recovery-defect-register.json`.

## Refs at inspection

| Ref | Commit | Tree |
| --- | --- | --- |
| `origin/main` | `6013d161bbe9200b9ee6a6ba3dbd5f0cfc63d396` | `b3502dfe17172711d043a456d67fafd6fa10eea0` |
| `origin/develop` | `320200cf5da05892424016e262ed1c209caa6480` | `7194edd12fba0e1219c088dc1d2a6e54fc309c61` |
| `origin/sync/develop-from-main` (PR #37 head) | `6013d161…` | `b3502dfe…` |
| `origin/feat/C012-payment-method-selection` (PR #38) | `75f50c52…` at inspection | `68a78e55…` |

- `git merge-base origin/main origin/develop` = `320200cf…` (develop itself).
- `git rev-list --left-right --count origin/develop...origin/main` = `0 44`.

## Finding: develop is stale, not corrupted

`develop` is a pure ancestor of `main`: it has no commit that `main` lacks. Its tip is the C002
merge (#22), already promoted to `main` by #24. Everything after #24 (#25–#36, including the F008
recovery barrier #31) was delivered to `main` only, under the agreed feature→`main` workflow.
There is no bad merge resolution, dropped feature, unresolved marker or mutated reference in
the inspected range (`git grep` for conflict markers on `main` is empty; the reference guard
passes).

Recovery branch A applies: PR #37 (`sync/develop-from-main` → `develop`) is exactly `main`
`6013d161` and promotes it unchanged. No duplicate synchronization PR is needed and no
develop-only patch exists.

## Finding: the C011 wrong-target merge did not lose content

PR #34 merged C011 into `feat/C010-scheduling-time-selection` (`1f874fc`) after #33 had already
merged C010 into `main` — a wrong feature-to-feature target. The C011 work was then promoted by
PR #35 (merge `6013d161`, second parent `d10907f`); PR #36 (`integrate/C011-main`) is reported as
merged with the same merge commit because its head `30b90a1` became reachable. The tree of
`6013d161` equals the tree of the reviewed head `d10907f` (`b3502dfe…`), so `main` holds exactly
the reviewed C011 source. No revert or repair is required; the lesson is procedural (target
`main`).

## Finding: a recurring one-pixel failure on main (shared baseline)

`main` push run 37127326124 (C011 workflow, job `customer-contact`) failed in the C008 suite:
`sheet-map-zoomed-panned-tapped@768: 1 pixels differ`. The same case failed on the C008 merge
push (run 37050062833) and on `f0487fe` (run 37105992192); the same `main` tree passed under
PR #37. Retained evidence shows the pixel (301,353), the map pin's edge: the candidate is always
`246,249,247`; the reference is sometimes `255,255,255`. In the failing run two consecutive
reference captures held that value, which the two-capture stability rule accepted. The stability
batch of the same run (repeat 18) shows the reference deviating for one capture after two equal
captures. Geometry (pin style, world transform, rects) is identical on both pages.

Root cause: **supported hypothesis, not proven** — compositor re-rasterisation timing of the
reference's scaled `.map-world { will-change: transform }` layer. The reference has no resize
handler and no asynchronous work after the tap.

Repair (this branch): a page now counts as settled after three consecutive equal captures of
itself (bound 8, was 2 of 6). The cross-page comparator, channel threshold (8) and allowed ratio
(0) are unchanged; stable-but-different pages still fail. A negative regression reproduces the
failing shape and is shown to be accepted by the previous helper. This is hardening that lowers
the probability of the transient; it is not a root-cause fix.

## C012-owned failures (not develop defects)

PR #38's failures at `75f50c5` belong to C012 and are fixed on that branch, not here: the EOF
blank line (F001 `diff-whitespace`, cascading to F007/F009), the C002 `/book/5` route expectation
superseded by the C012 guard, the duplicate selected-method text, runtime method validation, and
test-sequence defects. See `docs/customer/C012_PAYMENT_METHOD_SELECTION.md` on that branch.

## Other paths checked

- F008: `main` push run 37127326140 and PR #37 run 37130767160/37130767168 pass; the
  historical RabbitMQ cascade is not reproduced, so outbox/inbox and consumer code are not touched.
- F001/F006/F007/F009/F010, reference guard and Sprint 0.2: green on `main` push and PR #37.
- Local executor: Windows 11, Node 24.21.0, pnpm 10.32.1, Playwright Chromium 1243. The Docker
  engine returned HTTP 500, so database/broker acceptance relies on Linux CI. Pixel parity is
  authoritative only on Linux CI.

## Status

- Develop recovery: `RECOVERY_CANDIDATE_VERIFIED` for PR #37 at `6013d161` (all its PR checks
  passed). Develop itself is unchanged until an owner merges PR #37.
- Shared hardening: on `fix/parity-settle-confirmation` → `main`; once merged, PR #37's head must
  be fast-forwarded to the new `main` so `develop` receives the same reviewed change. See
  `DEVELOP_RECOVERY_RUNBOOK.md`.
