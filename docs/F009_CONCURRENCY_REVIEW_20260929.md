# F009 concurrency incident and regression verification

## Observed incident

The report concerns PR #16 at source commit
`fee6340062b7145004d12abfcba223b45f32b57e`.

Run `36352651120` (workflow number 7, push) was cancelled. Its aggregate failed
because plan and the other required jobs were cancelled.
Run `36352654293` (workflow number 8, pull_request) completed successfully:
all 18 jobs, including the aggregate and all 11 image jobs, succeeded.

Both runs used the same source SHA. The push was created at 21:41:31 UTC
and the pull request run at 21:41:34 UTC on 2026-09-27.
The earlier key used the source repository and branch name for both events.
With `cancel-in-progress: true`, those events competed for the same group.
The aggregate's `if: always()` then correctly refused the cancelled dependencies.
No application build failure can be inferred from that cancelled run alone.

## Correction and invariants

Namespace concurrency by event name, source repository, and PR number or full Git ref.
A push, a pull request synchronization and a manual run no longer share a group.
Updates within one event and PR/ref still supersede older work.
Independent PRs from one branch no longer share a group either.

Keep all existing triggers and acceptance jobs. This deliberately retains both
push and pull-request verification, at the cost of duplicate work when both fire.
Trigger deduplication is a separate policy change, not part of this correction.

Do not change `assertJobResults`, aggregate conditions, scanner thresholds,
required dependencies, source/run/attempt matching or artifact requirements.
Do not convert cancellation, missing evidence or skipped tests into success.
Historical run 7 remains cancelled; it must not be relabeled as passing.

## New security findings during revalidation

Fresh verification on 2026-09-29 exposed an independent dependency advisory and
an OS-package scan finding. Neither is the cause of the original cancelled run.
Historical acceptance on 2026-09-27 is not evidence of a clean current scan.

### Patched upload dependency

The reviewed advisory GHSA-3pph-fpjx-jg34 / CVE-2026-88932 covers Multer versions
`>=2.2.0 <2.4.0`; the patched version is `2.4.0`. GitHub's advisory database
published and reviewed it on 2026-09-28:
<https://github.com/advisories/GHSA-3pph-fpjx-jg34>.

Set both existing Multer overrides to exactly `2.4.0`, preserving the other
security overrides. Generate the lockfile with pnpm 10.32.1 rather than editing
resolution hashes. Diagnostic run `36592939908` at source parent
`301e6dd1f862e7d80280d88784482311872d151b` executed the real resolver, frozen
install, full dependency audit, Prettier and clean-state reproducibility checks.
The audit found no known vulnerabilities; frozen installation passed 8/8 checks.
The generated diff changes only Multer and removes its now-unused stream dependencies.
This authoring run prepares source objects; final-source CI remains necessary.

### Runtime scan remains blocked

Trivy v0.74.0 reported CVE-2026-97399 against `libc6` version
`2.41-12+deb13u4`, severity `UNKNOWN`, without a fixed version in its report.
The existing policy intentionally blocks UNKNOWN as well as HIGH and CRITICAL.
The safe catalog report from run `36591908021`, artifact `11044257272`, contains
one blocking finding and zero secrets. Its ZIP digest is
`492f9ca23a502e4da785f5dfdc72f84bd14e0b1e91eda44c537df00481161ef0`.

A fresh pull and scan of the maintained `gcr.io/distroless/cc-debian13:nonroot`
candidate reproduced the same finding in diagnostic run `36592939908`.
The resolved candidate digest was
`sha256:54df941ed0d06a1bd95ef5e0ce391fd8d9f94b64782dc9a60062727849ee3f97`.
Consequently, changing the runtime tag to this candidate does not solve the gate.
The runtime pin and scanner policy are left unchanged.

At review time, Debian's security tracker also listed this source package as
unfixed. Its description specifically concerns the Power8 implementation of
`strncasecmp`, so a package-level finding alone does not establish exploitability
on the Linux x64 CI image:
<https://security-tracker.debian.org/tracker/CVE-2026-97399>.
Nevertheless, this change does not introduce an unreviewed architecture exception,
VEX assertion, ignore rule or severity downgrade. Full F009 acceptance remains
blocked until a verified runtime remediation or separately reviewed applicability
policy is available. Do not report this as proof of an exploitable x64 vulnerability.

## Verification

Run with the repository-pinned Node and pnpm versions:

```sh
node --test --test-reporter=tap tests/unit/f009-concurrency-regression.test.mjs
node --test --test-reporter=tap tests/ci/gates.test.mjs
pnpm test:unit
pnpm check:design-reference
pnpm format:check
pnpm audit
pnpm verify:frozen-install
```

The six concurrency regressions are included by the existing unit-test glob,
including the F009 static acceptance stage. They check the exact workflow key,
cross-event isolation, same-PR supersession, independent PR/ref/repository scopes,
and policy rejection of cancelled, failed or skipped required dependencies.
These are policy tests, not a substitute for executing GitHub Actions.

Final acceptance requires both push and pull-request F009 runs to complete on
the corrected source without cross-cancellation, with all required jobs and
current-source evidence passing. All inherited PR workflows must pass as well.
Record final commit, run IDs and results in the PR after they actually complete;
do not reuse run 8 or the authoring diagnosis as final-source acceptance evidence.

The correction changes CI configuration, regression tests, this incident report,
and the two dependency-resolution files. No frontend, immutable design authority,
business service, schema or production environment is changed. No automatic merge
or deployment. Current verification is performed on GitHub runners; local execution
is unavailable in this session.
